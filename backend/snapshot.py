import hashlib
import json
import shutil
import os
import time
import threading
import logging
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("ransomshield.snapshot")

# Anchor the snapshot store to the repo root so rollback finds the same
# snapshots no matter which cwd the server was started from.
SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "snapshots"
MAX_SNAPSHOTS = 10  # keep last 10 snapshots


def _sha256_file(path: Path) -> str:
    """Streaming SHA-256 of a file's contents."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


class SnapshotEngine:
    def __init__(self, monitored_dir: str, interval: int = 30):
        self.monitored_dir = Path(monitored_dir)
        self.interval = interval
        self.snapshots: list[dict] = []
        self._running = False
        self._thread: threading.Thread | None = None
        # Serialize take_snapshot/rollback: the background snapshot thread
        # and an on-demand rollback both copy the same directory. Without a
        # lock a rollback can race a mid-copy snapshot (slow, and the
        # snapshot may capture a partially-restored/partially-encrypted
        # state that a later rollback then restores from).
        self._lock = threading.Lock()
        SNAPSHOT_DIR.mkdir(exist_ok=True)

    # ── Snapshot creation ──────────────────────────────────────────────────

    def take_snapshot(self) -> dict:
        """Copy monitored dir to a timestamped snapshot folder."""
        ts = datetime.now()
        snap_name = ts.strftime("snap_%Y%m%d_%H%M%S")
        snap_path = SNAPSHOT_DIR / snap_name

        with self._lock:
            try:
                shutil.copytree(
                    self.monitored_dir,
                    snap_path,
                    dirs_exist_ok=False,
                )
                file_count = sum(1 for _ in snap_path.rglob("*") if _.is_file())
            except Exception as e:
                logger.error(f"[SNAPSHOT] Failed: {e}")
                return {}
            entry = {
                "name": snap_name,
                "path": str(snap_path),
                "timestamp": ts.isoformat(),
                "file_count": file_count,
                "size_bytes": self._dir_size(snap_path),
            }
            self.snapshots.append(entry)
            self._prune_old_snapshots()
            self._write_manifest(snap_name, snap_path)
            logger.info(f"[SNAPSHOT] {snap_name} — {file_count} files")
            return entry

    def _dir_size(self, path: Path) -> int:
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    def _prune_old_snapshots(self):
        while len(self.snapshots) > MAX_SNAPSHOTS:
            oldest = self.snapshots.pop(0)
            try:
                shutil.rmtree(oldest["path"], ignore_errors=True)
                (SNAPSHOT_DIR / f"{oldest['name']}.manifest.json").unlink(missing_ok=True)
                logger.info(f"[SNAPSHOT] Pruned old snapshot: {oldest['name']}")
            except Exception:
                pass

    def _write_manifest(self, snap_name: str, snap_path: Path):
        """Record the SHA-256 of every snapshot file (relative path → hash) in
        a sibling `<snap>.manifest.json`, so a post-rollback re-hash can prove
        restoration byte-for-byte. The manifest lives OUTSIDE the snapshot tree
        so a restore never copies it into the monitored directory."""
        try:
            manifest = {}
            for f in snap_path.rglob("*"):
                if f.is_file():
                    manifest[f.relative_to(snap_path).as_posix()] = _sha256_file(f)
            (SNAPSHOT_DIR / f"{snap_name}.manifest.json").write_text(
                json.dumps(manifest, indent=0, sort_keys=True), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(
                f"[SNAPSHOT] manifest write failed (verification will hash the tree instead): {e}"
            )

    # ── Post-recovery verification ────────────────────────────────────────

    def verify_restore(self) -> dict:
        """Re-hash every file in the monitored dir and compare it against the
        latest snapshot's manifest (falling back to hashing the snapshot tree
        itself when the manifest is missing, e.g. snapshots taken before
        manifests existed). Returns verified / missing / mismatch / extra
        counts plus a single `ok` verdict.

        NOTE: callers hold self._lock (rollback does); this method
        intentionally does not acquire it, so it must not be called
        concurrently with take_snapshot/rollback from other threads.
        """
        if not self.snapshots:
            return {
                "verified": 0, "missing": 0, "mismatch": 0, "extra": 0,
                "ok": False, "manifest": None, "verify_seconds": 0.0,
            }
        latest = self.snapshots[-1]
        snap_path = Path(latest["path"])
        manifest_path = SNAPSHOT_DIR / f"{latest['name']}.manifest.json"

        expected: dict | None = None
        manifest_used = False
        if manifest_path.exists():
            try:
                expected = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest_used = True
            except Exception as e:
                logger.warning(f"[VERIFY] manifest unreadable ({e}); hashing snapshot tree")
        if expected is None:
            expected = {}
            for f in snap_path.rglob("*"):
                if f.is_file():
                    expected[f.relative_to(snap_path).as_posix()] = _sha256_file(f)

        t0 = time.time()
        verified = mismatch = extra = 0
        seen: set[str] = set()
        for f in self.monitored_dir.rglob("*"):
            if not f.is_file():
                continue
            rel = f.relative_to(self.monitored_dir).as_posix()
            seen.add(rel)
            want = expected.get(rel)
            if want is None:
                extra += 1
            elif _sha256_file(f) == want:
                verified += 1
            else:
                mismatch += 1
        missing = sum(1 for rel in expected if rel not in seen)
        ok = missing == 0 and mismatch == 0 and extra == 0
        return {
            "verified": verified,
            "missing": missing,
            "mismatch": mismatch,
            "extra": extra,
            "ok": ok,
            "manifest": f"{latest['name']}.manifest.json" if manifest_used else None,
            "verify_seconds": round(time.time() - t0, 3),
        }

    # ── Rollback ───────────────────────────────────────────────────────────

    def rollback(self) -> dict:
        """Restore monitored dir from the latest clean snapshot."""
        start_time = time.time()

        if not self.snapshots:
            return {
                "success": False,
                "message": "No snapshots available for rollback.",
                "duration_seconds": 0,
            }

        latest = self.snapshots[-1]
        snap_path = Path(latest["path"])

        # Hold the same lock as take_snapshot so a background snapshot cannot
        # copy a half-restored (or half-encrypted) tree mid-rollback.
        with self._lock:
            try:
                # Backup the current (infected) state for forensics
                infected_backup = SNAPSHOT_DIR / f"INFECTED_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                if self.monitored_dir.exists():
                    shutil.copytree(self.monitored_dir, infected_backup, dirs_exist_ok=False)

                # Wipe the current (infected) contents but keep the watched root
                # directory itself alive. Deleting the watched root breaks the
                # watchdog observer on Windows — future events (and detection)
                # silently stop after the first rollback.
                self.monitored_dir.mkdir(parents=True, exist_ok=True)
                for child in self.monitored_dir.iterdir():
                    if child.is_dir():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        child.unlink(missing_ok=True)
                shutil.copytree(snap_path, self.monitored_dir, dirs_exist_ok=True)

                elapsed = round(time.time() - start_time, 2)
                file_count = sum(
                    1 for _ in self.monitored_dir.rglob("*") if _.is_file()
                )

                # Prove restoration: re-hash every restored file against the
                # snapshot manifest (runs under the same lock, so no snapshot
                # or rollback can interleave mid-verification).
                integrity = self.verify_restore()
                logger.info(
                    f"[ROLLBACK] Restored {file_count} files from '{latest['name']}' in {elapsed}s — "
                    f"integrity: {integrity['verified']}/{file_count} verified, "
                    f"{integrity['missing']} missing, {integrity['mismatch']} mismatch"
                )
                return {
                    "success": True,
                    "snapshot_name": latest["name"],
                    "snapshot_timestamp": latest["timestamp"],
                    "files_restored": file_count,
                    "duration_seconds": elapsed,
                    "infected_backup": str(infected_backup),
                    "integrity": integrity,
                    "message": f"Rollback complete in {elapsed}s. {file_count} files restored.",
                }
            except Exception as e:
                elapsed = round(time.time() - start_time, 2)
                logger.error(f"[ROLLBACK] Failed: {e}")
                return {
                    "success": False,
                    "message": str(e),
                    "duration_seconds": elapsed,
                }

    # ── Background scheduler ───────────────────────────────────────────────

    def start(self):
        self._running = True
        # Take one immediately
        self.take_snapshot()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info(f"[SNAPSHOT] Scheduler started (every {self.interval}s)")

    def stop(self):
        self._running = False

    def _loop(self):
        while self._running:
            time.sleep(self.interval)
            if self._running:
                self.take_snapshot()

    # ── Getters ────────────────────────────────────────────────────────────

    def get_snapshots(self) -> list[dict]:
        return list(reversed(self.snapshots))  # newest first

    def latest_snapshot(self) -> dict | None:
        return self.snapshots[-1] if self.snapshots else None
