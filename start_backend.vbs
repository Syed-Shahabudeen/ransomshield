Set WshShell = WScript.CreateObject("WScript.Shell")
WshShell.Run "cmd /c """ & "c:\Users\syeds\3D Objects\Ransome\.venv\Scripts\python.exe" & """ -m uvicorn main:app --port 8000 --app-dir """ & "c:\Users\syeds\3D Objects\Ransome\backend" & """ >> """ & "c:\Users\syeds\3D Objects\Ransome\uvicorn.log" & """ 2>&1", 0, False
