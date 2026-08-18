"""Tests for snapshot.py — post-rollback integrity verification: a SHA-256
manifest is written at snapshot time, rollback re-hashes every restored file
against it, and missing/mismatched/extra files are counted (including the
legacy fallback that hashes the snapshot tree when no manifest exists)."""

from pathlib import Path

import pytest

import snapshot as snap_mod
from snapshot import SnapshotEngine, _sha256_file

FILES = {
    "records.txt": b"patient record A",
    "lab/report.csv": b"hemoglobin,13.2",
    "imaging/scan.dcm": b"\x00\x01fake-dicom-payload",
}


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A SnapshotEngine pointed at a fresh monitored dir + tmp snapshot store."""
    monitored = tmp_path / "hospital"
    _seed(monitored, FILES)
    snap_dir = tmp_path / "snapshots"
    snap_dir.mkdir()
    monkeypatch.setattr(snap_mod, "SNAPSHOT_DIR", snap_dir)
    engine = SnapshotEngine(str(monitored), interval=0)
    return engine, monitored


def _seed(root: Path, files: dict):
    for rel, data in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)


# ── manifest writing ───────────────────────────────────────────────────────


def test_snapshot_writes_manifest_with_hashes(env):
    engine, _ = env
    entry = engine.take_snapshot()
    manifest = snap_mod.SNAPSHOT_DIR / f"{entry['name']}.manifest.json"
    assert manifest.exists(), "manifest should be written alongside the snapshot"

    import json
    m = json.loads(manifest.read_text(encoding="utf-8"))
    assert set(m) == set(FILES), "manifest covers every snapshot file"
    assert "lab/report.csv" in m, "manifest keys use forward-slash relative paths"
    assert m["records.txt"] == _sha256_file(
        Path(engine.monitored_dir) / "records.txt"
    )
    assert entry["file_count"] == len(FILES)


# ── post-rollback verification ─────────────────────────────────────────────


def test_rollback_verifies_every_restored_file(env):
    engine, monitored = env
    engine.take_snapshot()

    # Simulate the attack: overwrite a file, delete another, plant a new one.
    (monitored / "records.txt").write_bytes(b"RANSOMED!!")
    (monitored / "lab" / "report.csv").unlink()
    (monitored / "extra.bin").write_bytes(b"stray")

    result = engine.rollback()
    assert result["success"] is True
    iv = result["integrity"]
    assert iv["verified"] == len(FILES), "every restored file re-hashed OK"
    assert iv["missing"] == 0
    assert iv["mismatch"] == 0
    assert iv["extra"] == 0
    assert iv["ok"] is True
    assert iv["manifest"] == f"{result['snapshot_name']}.manifest.json"
    assert result["files_restored"] == len(FILES)

    # The tree really is byte-identical again — no leftovers, no strays.
    assert (monitored / "records.txt").read_bytes() == FILES["records.txt"]
    assert (monitored / "lab" / "report.csv").read_bytes() == FILES["lab/report.csv"]
    assert not (monitored / "extra.bin").exists()


def test_verify_counts_missing_mismatch_extra(env):
    engine, monitored = env
    engine.take_snapshot()

    (monitored / "records.txt").write_bytes(b"RANSOMED!!")
    (monitored / "lab" / "report.csv").unlink()
    (monitored / "extra.bin").write_bytes(b"stray")

    iv = engine.verify_restore()
    assert iv["verified"] == 1            # scan.dcm untouched
    assert iv["missing"] == 1             # lab/report.csv deleted
    assert iv["mismatch"] == 1            # records.txt corrupted
    assert iv["extra"] == 1               # extra.bin planted
    assert iv["ok"] is False


def test_verify_ok_when_pristine(env):
    engine, _ = env
    engine.take_snapshot()
    iv = engine.verify_restore()
    assert iv["verified"] == len(FILES)
    assert iv["ok"] is True


# ── legacy snapshots without a manifest ────────────────────────────────────


def test_legacy_snapshot_without_manifest_falls_back(env):
    engine, monitored = env
    entry = engine.take_snapshot()
    # Simulate a snapshot taken before manifests existed.
    (snap_mod.SNAPSHOT_DIR / f"{entry['name']}.manifest.json").unlink()

    (monitored / "records.txt").write_bytes(b"RANSOMED!!")
    result = engine.rollback()
    assert result["success"] is True
    iv = result["integrity"]
    assert iv["verified"] == len(FILES), "tree hashing covers legacy snapshots"
    assert iv["ok"] is True
    assert iv["manifest"] is None
