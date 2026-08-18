"""Tests for ransom_note.py — parsing the attacker's demand note (wallet,
amount, contact, deadline, gang), scanning the monitored tree, and
propagation of the note intel into the network fingerprint broadcast."""

import pytest

from ransom_note import extract_ransom_note, parse_ransom_note
from network_sim import NetworkSim

# Mirrors demo/simulate_ransomware.py's make_ransom_note() so the test proves
# the parser handles the exact note the demo drops.
SIM_NOTE = """
!!!  YOUR FILES HAVE BEEN ENCRYPTED  !!!

All your hospital records, patient data, and administrative files
have been encrypted using military-grade AES-256 encryption.

To restore your files, you must pay 5 BTC to:
  1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW

Contact: decrypt@darknet.onion

** DO NOT attempt to restore backups — we have monitoring in place **
** DO NOT contact law enforcement — your data will be published **

You have 72 hours. Clock starts NOW.

— DarkReaper Ransomware Group
"""


# ── parsing ────────────────────────────────────────────────────────────────


def test_parse_demo_note():
    p = parse_ransom_note(SIM_NOTE)
    assert p["btc_address"] == "1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW"
    assert p["amount_btc"] == 5.0
    assert p["contact"] == "decrypt@darknet.onion"
    assert p["deadline_hours"] == 72
    assert p["gang"] == "DarkReaper Ransomware Group"


def test_parse_returns_none_for_missing_fields():
    p = parse_ransom_note("your files are gone. pay up or else.")
    assert p["btc_address"] is None
    assert p["amount_btc"] is None
    assert p["contact"] is None
    assert p["deadline_hours"] is None
    assert p["gang"] is None


def test_parse_deadline_in_days():
    p = parse_ransom_note("You have 3 days to pay.")
    assert p["deadline_hours"] == 72


# ── tree scanning ──────────────────────────────────────────────────────────


def test_extract_finds_standard_note_name(tmp_path):
    (tmp_path / "READ_ME_NOW.txt").write_text(SIM_NOTE, encoding="utf-8")
    p = extract_ransom_note(tmp_path)
    assert p is not None
    assert p["gang"] == "DarkReaper Ransomware Group"
    assert p["file"].endswith("READ_ME_NOW.txt")


def test_extract_prefers_note_over_binary(tmp_path):
    # An encrypted binary that merely contains the words "BTC" must lose to
    # the real note.
    (tmp_path / "records.encrypted").write_bytes(
        b"\x00\x01\xff ransomware 5 BTC " + b"\x00" * 200
    )
    (tmp_path / "readme.txt").write_text(SIM_NOTE, encoding="utf-8")
    p = extract_ransom_note(tmp_path)
    assert p is not None
    assert p["gang"] == "DarkReaper Ransomware Group"


def test_extract_decodes_locale_encoded_note(tmp_path):
    # The simulator writes notes with the locale encoding (cp1252 on
    # Windows); the em-dash before the gang signature must not come back as
    # U+FFFD glued to the group name.
    (tmp_path / "READ_ME_NOW.txt").write_bytes(SIM_NOTE.encode("cp1252"))
    p = extract_ransom_note(tmp_path)
    assert p is not None
    assert p["gang"] == "DarkReaper Ransomware Group"


def test_extract_returns_none_when_no_note(tmp_path):
    (tmp_path / "records.txt").write_text("patient data", encoding="utf-8")
    assert extract_ransom_note(tmp_path) is None


def test_extract_skips_binary_only_tree(tmp_path):
    (tmp_path / "READ_ME_NOW.txt").write_bytes(b"\x00\x01ransom note payload")
    assert extract_ransom_note(tmp_path) is None


# ── propagation into the network broadcast ─────────────────────────────────


def test_broadcast_carries_note_intel():
    sim = NetworkSim(seed=42)
    event = {
        "attack_id": 1,
        "filepath": "x.encrypted",
        "entropy": 7.9,
        "threat_score": 85,
        "canary_triggered": None,
        "ransom_note": {
            "gang": "DarkReaper Ransomware Group",
            "btc_address": "1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW",
            "amount_btc": 5.0,
            "deadline_hours": 72,
            "contact": "decrypt@darknet.onion",
        },
    }
    rec = sim.broadcast_fingerprint(event)
    assert rec["note_intel"]["gang"] == "DarkReaper Ransomware Group"
    assert rec["note_intel"]["btc_address"] == "1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW"
    assert rec["note_intel"]["deadline_hours"] == 72
    assert sim.broadcasts[0]["note_intel"]["gang"] == "DarkReaper Ransomware Group"


def test_broadcast_without_note_has_no_note_intel():
    sim = NetworkSim(seed=7)
    rec = sim.broadcast_fingerprint({"attack_id": 2, "filepath": "y.encrypted",
                                     "entropy": 7.5, "threat_score": 80})
    assert "note_intel" not in rec
