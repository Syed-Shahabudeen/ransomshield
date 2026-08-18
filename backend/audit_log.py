"""
audit_log.py — Tamper-evident, hash-chained audit log.

Every entry carries the SHA-256 of the previous entry, so altering or
removing any historical record breaks the chain and is detectable by
recomputing it (`verify()`). Persisted as append-only JSONL so the chain
survives restarts — this is the forensic-integrity story behind the
incident report's verification badge.
"""
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("ransomshield.audit")

GENESIS_HASH = "0" * 64


def _canonical(entry: dict) -> bytes:
    """Deterministic serialization so hashes are stable across runs."""
    body = {k: v for k, v in entry.items() if k != "hash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


class AuditLog:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.entries: list[dict] = []
        self._load()

    def _load(self):
        if not self.path.exists():
            return
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    self.entries.append(json.loads(line))
                except json.JSONDecodeError:
                    # Preserve the bad record so verification can flag it
                    # instead of silently dropping evidence.
                    self.entries.append({
                        "seq": len(self.entries) + 1,
                        "parse_error": True,
                        "prev_hash": "<unparseable>",
                        "hash": "<unparseable>",
                    })
        logger.info(f"[AUDIT] loaded {len(self.entries)} entries from {self.path}")

    def append(self, event_type: str, data: dict) -> dict:
        seq = len(self.entries) + 1
        prev_hash = self.entries[-1]["hash"] if self.entries else GENESIS_HASH
        entry = {
            "seq": seq,
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": event_type,
            "data": data,
            "prev_hash": prev_hash,
        }
        entry["hash"] = hashlib.sha256(_canonical(entry)).hexdigest()
        self.entries.append(entry)
        try:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, separators=(",", ":")) + "\n")
        except OSError as e:
            logger.error(f"[AUDIT] failed to persist entry {seq}: {e}")
        return entry

    def verify(self) -> dict:
        """
        Recompute the chain from the PERSISTED file (the source of truth) so
        tampering is caught immediately — not just after a restart re-reads
        the file. Returns valid/entries and, on failure, the first bad
        sequence number.
        """
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                raw_lines = [ln.strip() for ln in f if ln.strip()]
        except OSError:
            # No file (fresh start): fall back to the in-memory chain.
            raw_lines = [json.dumps(e, separators=(",", ":")) for e in self.entries]

        prev = GENESIS_HASH
        for i, line in enumerate(raw_lines):
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                return {
                    "valid": False,
                    "entries": len(raw_lines),
                    "first_bad_seq": i + 1,
                    "reason": "unparseable record in chain file",
                }
            expected = hashlib.sha256(_canonical(entry)).hexdigest()
            if entry.get("prev_hash") != prev or entry.get("hash") != expected:
                return {
                    "valid": False,
                    "entries": len(raw_lines),
                    "first_bad_seq": entry.get("seq", i + 1),
                    "reason": "chain broken at entry (hash mismatch or tampered record)",
                }
            prev = entry["hash"]
        return {
            "valid": True,
            "entries": len(raw_lines),
            "last_hash": prev,
        }

    def recent(self, limit: int = 10) -> list[dict]:
        return list(reversed(self.entries[-limit:]))
