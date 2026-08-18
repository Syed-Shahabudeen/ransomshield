"""
launch_backend.py — Launches uvicorn as a subprocess that outlives this
script by using DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP on Windows.
Run from the repo root with: python launch_backend.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
BACKEND_DIR = ROOT / "backend"
LOG = ROOT / "uvicorn.log"

# Windows detachment flags
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW

with open(LOG, "w") as log_f:
    proc = subprocess.Popen(
        [str(PYTHON), "-m", "uvicorn", "main:app", "--port", "8000",
         "--app-dir", str(BACKEND_DIR)],
        cwd=str(ROOT),
        stdout=log_f,
        stderr=log_f,
        stdin=subprocess.DEVNULL,
        close_fds=True,
        creationflags=flags,
    )

print(f"Backend launched (PID {proc.pid}). Log: {LOG}")
with open(ROOT / "backend.pid", "w") as f:
    f.write(str(proc.pid))
