#!/usr/bin/env python3
"""
simulate_ransomware.py — RansomShield Demo Attack Simulator

Simulates a ransomware attack by:
1. Rapidly modifying files with high-entropy (random) data
2. Renaming files with .encrypted extension
3. Creating new encrypted files in rapid succession

⚠️  EDUCATIONAL USE ONLY. Only targets the sample_hospital_files folder.
"""

import os
import sys
import time
import random
import string
import shutil
import argparse
from pathlib import Path

# Windows consoles often default to a locale encoding (e.g. cp1252) that
# cannot represent the emoji/₹ glyphs used in this script's output.
# Force UTF-8 so prints never crash with UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

TARGET_DIR = Path(__file__).parent / "sample_hospital_files"
RANSOMWARE_EXT = ".encrypted"


def generate_encrypted_content(size_kb: int = 16) -> bytes:
    """Generate high-entropy pseudo-encrypted content (random bytes)."""
    return bytes(random.getrandbits(8) for _ in range(size_kb * 1024))


def make_ransom_note() -> str:
    return """
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


def simulate_attack(speed: float = 0.3, file_count: int = 15):
    """
    Run the simulation.
    speed: seconds between each file operation (lower = faster/more detectable)
    file_count: number of files to encrypt
    """
    print("\n" + "="*60)
    print("  🦠 RANSOMSHIELD ATTACK SIMULATOR")
    print("  Educational Demo — Targeting ONLY sample_hospital_files/")
    print("="*60 + "\n")

    if not TARGET_DIR.exists():
        print(f"[ERROR] Target directory not found: {TARGET_DIR}")
        print("  Run this from the /demo/ folder after setup.")
        sys.exit(1)

    existing_files = [f for f in TARGET_DIR.rglob("*") if f.is_file() and ".encrypted" not in f.name]
    existing_files.sort()  # deterministic order; canary decoys are named to sort first

    if not existing_files:
        print("[WARN] No files found in target dir. Creating dummy files first...")
        _create_dummy_files()
        existing_files = [f for f in TARGET_DIR.rglob("*") if f.is_file()]
        existing_files.sort()

    print(f"[*] Found {len(existing_files)} target files")
    print(f"[*] Simulating encryption of up to {file_count} files")
    print(f"[*] Speed: {speed}s per file\n")
    print("[!] Starting attack — RansomShield should detect within seconds...\n")

    # Drop ransom note
    ransom_path = TARGET_DIR / "READ_ME_NOW.txt"
    with open(ransom_path, "w") as f:
        f.write(make_ransom_note())
    print(f"[+] Dropped ransom note: {ransom_path.name}")

    # Encrypt files
    encrypted_count = 0
    for i, src_file in enumerate(existing_files[:file_count]):
        if encrypted_count >= file_count:
            break

        enc_path = src_file.with_suffix(src_file.suffix + RANSOMWARE_EXT)

        # Write high-entropy garbage to original file (simulates in-place encryption)
        with open(src_file, "wb") as f:
            f.write(generate_encrypted_content(random.randint(8, 64)))

        # Rename with encrypted extension
        try:
            src_file.rename(enc_path)
        except Exception:
            pass

        encrypted_count += 1
        print(f"[+] Encrypted ({i+1:02d}/{file_count}): {src_file.name} → {enc_path.name}")
        time.sleep(speed)

    # Create some new encrypted files to spike detection
    for i in range(5):
        new_file = TARGET_DIR / f"stolen_data_{i:03d}.encrypted"
        with open(new_file, "wb") as f:
            f.write(generate_encrypted_content(32))
        print(f"[+] Created new encrypted file: {new_file.name}")
        time.sleep(speed * 0.5)

    print(f"\n[✓] Simulation complete. {encrypted_count} files encrypted.")
    print("[*] Check RansomShield dashboard — rollback should be visible now.\n")


def _create_dummy_files():
    """Create sample hospital files for demo purposes."""
    subdirs = ["patient_records", "radiology", "pharmacy", "admin", "lab_reports"]
    for sd in subdirs:
        (TARGET_DIR / sd).mkdir(parents=True, exist_ok=True)

    sample_data = [
        ("patient_records/patient_001_aadhaar.txt", "Patient: Ramesh Kumar | Aadhaar: XXXX-XXXX-1234 | DOB: 1985-03-12 | Blood: O+"),
        ("patient_records/patient_002_records.txt", "Patient: Priya Sharma | Aadhaar: XXXX-XXXX-5678 | DOB: 1990-07-22 | Diagnosis: Hypertension"),
        ("patient_records/admission_log_2024.csv", "id,name,date,ward\n1,Kumar R,2024-09-01,ICU\n2,Sharma P,2024-09-02,General"),
        ("radiology/xray_report_001.txt", "X-Ray Report | Patient ID: 001 | Date: 2024-09-10 | Findings: No abnormality detected"),
        ("radiology/mri_scan_002.txt", "MRI Report | Patient ID: 002 | Sequence: T2 | Findings: Normal brain morphology"),
        ("pharmacy/drug_inventory.csv", "drug,quantity,expiry\nParacetamol,500,2025-12\nAmoxicillin,200,2025-06"),
        ("pharmacy/dispensing_log.txt", "2024-09-10 | Patient 001 | Paracetamol 500mg | Dr. Mehta"),
        ("admin/staff_roster.txt", "Dr. Suresh Mehta | Senior Physician | EMP001\nNurse Anitha | ICU | EMP002"),
        ("admin/budget_2024.txt", "Q3 Budget: ₹2,45,00,000 | Allocated: ₹1,89,00,000 | Remaining: ₹56,00,000"),
        ("lab_reports/blood_test_001.txt", "CBC Report | Patient 001 | Hb: 14.2 g/dL | WBC: 7200 | Platelets: 2.1L"),
        ("lab_reports/culture_report_002.txt", "Culture & Sensitivity | Patient 002 | Organism: E.Coli | Sensitive to: Ciprofloxacin"),
    ]

    for path, content in sample_data:
        full_path = TARGET_DIR / path
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content + "\n")

    print(f"[*] Created {len(sample_data)} sample hospital files in {TARGET_DIR}")


def reset():
    """Reset the sample_hospital_files directory to clean state."""
    print(f"[*] Resetting {TARGET_DIR}...")
    # Remove the contents but keep the root directory itself: deleting the
    # watched root breaks the backend's file monitor on Windows (events
    # silently stop), so subsequent attacks would go undetected.
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    for child in TARGET_DIR.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)
    _create_dummy_files()
    print("[✓] Reset complete.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RansomShield Attack Simulator")
    parser.add_argument("--reset", action="store_true", help="Reset demo files to clean state")
    parser.add_argument("--speed", type=float, default=0.3, help="Seconds between each file operation (default: 0.3)")
    parser.add_argument("--count", type=int, default=15, help="Number of files to encrypt (default: 15)")
    parser.add_argument("--setup", action="store_true", help="Just create sample files without attack")

    args = parser.parse_args()

    if args.reset:
        reset()
    elif args.setup:
        _create_dummy_files()
        print("[✓] Setup complete.")
    else:
        simulate_attack(speed=args.speed, file_count=args.count)
