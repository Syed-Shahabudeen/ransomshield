"""Ransom-note intelligence extraction.

When ransomware lands, the operator is left with a demand note (READ_ME_NOW.txt
and family). This module scans the monitored tree for demand notes and pulls
the attacker-visible intel out of them — wallet address, ransom amount, contact
channel, payment deadline, and gang name — so the dashboard, the incident PDF,
and the nationwide threat-intel mesh can show who is asking for what.

Only attacker-authored content is parsed (the note itself), never patient
data, so sharing the extracted indicators keeps the anonymization story
consistent: file contents are not read, hashed, or broadcast.
"""

import re
from pathlib import Path

# Note filenames used across the most common ransomware families.
NOTE_NAMES = {
    "read_me_now.txt", "readme.txt", "read_me.txt",
    "how_to_decrypt.txt", "decrypt_instructions.txt", "restore_files.txt",
    "recovery.txt", "what_happened.txt", "attention.txt",
}

MAX_NOTE_BYTES = 64 * 1024  # notes are short; skip anything pathological

# BTC addresses start with 1 (P2PKH) or 3 (P2SH). The demo simulator's
# fake address deliberately contains characters outside base58, so this
# stays pragmatic: a leading 1/3 followed by 25-40 alphanumerics.
_BTC_RE = re.compile(r"\b[13][A-Za-z0-9]{25,40}\b")
_AMOUNT_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(?:BTC|bitcoin|btc)\b", re.IGNORECASE)
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
_HOURS_RE = re.compile(r"\b(\d{1,4})\s*(?:hours?|hrs?|h)\b", re.IGNORECASE)
_DAYS_RE = re.compile(r"\b(\d{1,3})\s*days?\b", re.IGNORECASE)
_GANG_NAME_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9 ]{1,40}?(?:Ransomware|Group|Team|Gang|Crew|Collective|Syndicate))\b"
)


def parse_ransom_note(text: str) -> dict:
    """Extract attacker intel from a demand note's text.

    Returns a dict with None for anything not found, so callers can check
    fields without special-casing missing keys.
    """
    btc = _BTC_RE.findall(text)
    amounts = [float(m) for m in _AMOUNT_RE.findall(text)]
    emails = _EMAIL_RE.findall(text)
    hours = _HOURS_RE.findall(text)
    days = _DAYS_RE.findall(text)

    deadline_hours = None
    if hours:
        deadline_hours = min(int(h) for h in hours)
    elif days:
        deadline_hours = min(int(d) for d in days) * 24

    # Gang attribution: the note's signature line (last non-empty line that
    # names a group/team/etc.), falling back to any in-text group mention.
    gang = None
    for line in reversed(text.splitlines()):
        stripped = line.strip().strip("* -–—•·\ufffd").strip()
        if stripped and re.search(r"(ransomware|group|team|gang|crew|collective|syndicate)", stripped, re.I):
            gang = stripped
            break
    if not gang:
        m = _GANG_NAME_RE.search(text)
        if m:
            gang = m.group(1)

    return {
        "btc_address": btc[0] if btc else None,
        "amount_btc": max(amounts) if amounts else None,
        "contact": emails[0] if emails else None,
        "contact_email": emails[0] if emails else None,
        "deadline_hours": deadline_hours,
        "gang": gang,
        "file": None,
    }


def extract_ransom_note(monitored_dir, max_bytes: int = MAX_NOTE_BYTES) -> dict | None:
    """Scan the monitored tree for a demand note and parse its intel.

    Prefers the canonical note names, then the smallest candidate (real
    notes are short; this skips big binary blobs that merely match a name
    pattern). Returns the parsed dict (with the note's path attached) or
    None when no demand note is found.
    """
    root = Path(monitored_dir)
    if not root.exists():
        return None

    candidates = []
    for f in root.rglob("*"):
        if not f.is_file():
            continue
        name = f.name.lower()
        if (
            name in NOTE_NAMES
            or "ransom" in name
            or "decrypt" in name
            or "recover" in name
        ):
            try:
                candidates.append(f)
            except OSError:
                continue
    if not candidates:
        return None

    # Canonical note names first, then smallest files (notes are short).
    candidates.sort(key=lambda p: (p.name.lower() not in NOTE_NAMES, p.stat().st_size))

    for f in candidates[:3]:
        try:
            if f.stat().st_size > max_bytes:
                continue
            data = f.read_bytes()[:max_bytes]
            if b"\x00" in data:      # binary payload — not a demand note
                continue
        except OSError:
            continue
        # The simulator writes notes with the locale encoding (cp1252 on
        # Windows), so strict UTF-8 first, then cp1252 — otherwise the
        # signature line's em-dash decodes to U+FFFD and pollutes the gang.
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            text = data.decode("cp1252", errors="replace")
        parsed = parse_ransom_note(text)
        if parsed["btc_address"] or parsed["gang"] or parsed["deadline_hours"] or parsed["contact"]:
            parsed["file"] = str(f)
            return parsed
    return None
