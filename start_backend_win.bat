@echo off
setlocal
set ROOT=c:\Users\syeds\3D Objects\Ransome
set PYTHON=%ROOT%\.venv\Scripts\python.exe
set BACKEND=%ROOT%\backend
set LOG=%ROOT%\uvicorn.log

echo Starting RansomShield backend...
cd /d "%ROOT%"
"%PYTHON%" -m uvicorn main:app --port 8000 --app-dir "%BACKEND%" >> "%LOG%" 2>&1
