"""
canary.py — Decoy (canary) file layer.

Plants realistic-looking decoy files across the monitored hospital tree.
A canary is engineered to be touched *first* by typical encryption order
(names sort to the front), so any modification/rename of one is a
high-confidence, near-zero-false-positive attack signal that fires before
real patient data is reached.
"""
import logging
from pathlib import Path

logger = logging.getLogger("ransomshield.canary")

# Decoy names sort ahead of real sample files so an encryptor working
# through the tree in name order hits a canary before any real record.
CANARY_PATTERNS = [
    ("000_urgent_rounds_notes", ""),                      # repo root
    ("000_handover_icu_pending", "patient_records"),
    ("000_vitals_overflow_ledger", "radiology"),
    ("000_pharma_shortage_list", "pharmacy"),
    ("000_admission_batch_pending", "admin"),
    ("000_lab_queue_urgent", "lab_reports"),
]

CANARY_CONTENT = (
    "URGENT — INTER-DEPARTMENT HANDOVER (CONFIDENTIAL)\n"
    "Patient cohort: post-op ICU transfers, ward 4B.\n"
    "Attending: Dr. S. Mehta. Notes pending sign-off.\n"
    "vault_key: 7f3a9c2e1d8b4a6f0e5d3c2b1a9f8e7d\n"
    "This file is an automated decoy placed by RansomShield.\n"
)


class CanaryManager:
    """Plants and tracks canary files inside the monitored directory."""

    def __init__(self, monitored_dir: str):
        self.monitored_dir = Path(monitored_dir)
        # base name (no extension) -> directory relative to monitored_dir
        self.canaries: dict[str, str] = {}

    def plant(self) -> int:
        """
        Plant any missing canaries and register all known ones. Idempotent:
        re-running after a restart (or after rollback restored them) does not
        duplicate files. Returns the number of canaries registered.
        """
        self.monitored_dir.mkdir(parents=True, exist_ok=True)
        for base, sub in CANARY_PATTERNS:
            target_dir = self.monitored_dir / sub if sub else self.monitored_dir
            target_dir.mkdir(parents=True, exist_ok=True)
            path = target_dir / f"{base}.txt"
            if not path.exists():
                try:
                    path.write_text(CANARY_CONTENT, encoding="utf-8")
                except OSError as e:
                    logger.warning(f"[CANARY] failed to plant {path}: {e}")
                    continue
            self.canaries[base] = sub
        logger.info(f"[CANARY] {len(self.canaries)} decoy files active in {self.monitored_dir}")
        return len(self.canaries)

    def is_canary(self, path: str) -> str | None:
        """
        Return the canary base name if `path` refers to a planted canary,
        otherwise None. Handles the extension-renaming attack pattern (a
        canary renamed to '<name>.txt.encrypted' still resolves to its base).
        """
        try:
            name = Path(path).name
        except (TypeError, ValueError):
            return None
        # Strip every extension: "000_urgent_rounds_notes.txt.encrypted" -> base
        base = name.split(".")[0]
        return base if base in self.canaries else None

    def snapshot(self) -> list[dict]:
        """List planted canaries (for diagnostics / the API)."""
        return [
            {"name": base, "path": str((self.monitored_dir / sub / f"{base}.txt") if sub else (self.monitored_dir / f"{base}.txt"))}
            for base, sub in self.canaries.items()
        ]
