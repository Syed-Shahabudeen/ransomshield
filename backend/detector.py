import math
import os
import time
from collections import Counter
from typing import Optional

# Known ransomware extension signatures
RANSOMWARE_EXTENSIONS = {
    ".locked", ".encrypted", ".enc", ".crypto", ".crypt", ".crypted",
    ".crypz", ".locky", ".zepto", ".thor", ".aesir", ".odin",
    ".zzzzz", ".cerber", ".cerber2", ".cerber3", ".wallet", ".wcry",
    ".wncry", ".wncryt", ".onion", ".ctbl", ".ctb2", ".micro",
    ".vvv", ".exx", ".ezz", ".ecc", ".xyz", ".abc", ".ccc",
    ".xxx", ".ttt", ".mp3", ".aaa", ".zz", ".ransomware",
}

# High-entropy threshold (Shannon entropy above this = likely encrypted)
ENTROPY_THRESHOLD = 7.2

# Rapid modification detection: N files in T seconds = suspicious
RAPID_CHANGE_COUNT = 8
RAPID_CHANGE_WINDOW = 10  # seconds

class RansomwareDetector:
    def __init__(self):
        self.recent_changes: list[float] = []
        self.flagged_pids: set[int] = set()

    def calculate_entropy(self, filepath: str) -> float:
        """Shannon entropy of a file. Max = 8.0 (fully encrypted)."""
        try:
            with open(filepath, "rb") as f:
                data = f.read(65536)  # read first 64KB
            if not data:
                return 0.0
            counts = Counter(data)
            total = len(data)
            entropy = -sum(
                (c / total) * math.log2(c / total)
                for c in counts.values()
            )
            return round(entropy, 4)
        except (PermissionError, FileNotFoundError, OSError):
            return 0.0

    def has_ransomware_extension(self, filepath: str) -> bool:
        ext = os.path.splitext(filepath)[1].lower()
        return ext in RANSOMWARE_EXTENSIONS

    def track_change(self) -> bool:
        """Returns True if rapid-change threshold is hit."""
        now = time.time()
        self.recent_changes.append(now)
        # Prune old entries
        self.recent_changes = [
            t for t in self.recent_changes
            if now - t <= RAPID_CHANGE_WINDOW
        ]
        return len(self.recent_changes) >= RAPID_CHANGE_COUNT

    def analyze_file(self, filepath: str) -> dict:
        """Full analysis of a single file change event."""
        entropy = self.calculate_entropy(filepath)
        suspicious_ext = self.has_ransomware_extension(filepath)
        rapid = self.track_change()

        threat_score = 0
        reasons = []

        if entropy >= ENTROPY_THRESHOLD:
            threat_score += 50
            reasons.append(f"High entropy ({entropy:.2f}/8.0) — file appears encrypted")

        if suspicious_ext:
            threat_score += 35
            ext = os.path.splitext(filepath)[1].lower()
            reasons.append(f"Known ransomware extension detected: {ext}")

        if rapid:
            threat_score += 15
            reasons.append(
                f"Rapid file modification: {len(self.recent_changes)} files in {RAPID_CHANGE_WINDOW}s"
            )

        return {
            "filepath": filepath,
            "entropy": entropy,
            "suspicious_ext": suspicious_ext,
            "rapid_change": rapid,
            "threat_score": threat_score,
            "is_attack": threat_score >= 50,
            "reasons": reasons,
        }
