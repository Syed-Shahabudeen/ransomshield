import platform
import psutil
import os
import signal
import logging

logger = logging.getLogger("ransomshield.freezer")


def freeze_process(pid: int) -> dict:
    """
    Suspend (freeze) a process by PID.
    On Windows this uses psutil.suspend(); on Linux/Mac uses SIGSTOP.
    Returns status dict.
    """
    try:
        proc = psutil.Process(pid)
        proc_name = proc.name()
        proc_cmdline = " ".join(proc.cmdline()[:5])

        proc.suspend()
        logger.warning(f"[FREEZE] Suspended PID {pid} — {proc_name}")

        return {
            "success": True,
            "pid": pid,
            "name": proc_name,
            "cmdline": proc_cmdline,
            "message": f"Process '{proc_name}' (PID {pid}) frozen successfully.",
        }

    except psutil.NoSuchProcess:
        return {"success": False, "pid": pid, "message": "Process not found."}
    except psutil.AccessDenied:
        return {
            "success": False,
            "pid": pid,
            "message": "Access denied — insufficient privileges to freeze this process.",
        }
    except Exception as e:
        return {"success": False, "pid": pid, "message": str(e)}


def get_process_ancestry(pid: int, limit: int = 16) -> list[dict]:
    """
    Walk the parent chain of a process (deepest first) for kill-chain display.
    Used as a fallback when the Java engine cannot read command lines (a
    hardened Windows environment can block the JDK's PEB read; psutil uses a
    different technique and still works).
    """
    chain: list[dict] = []
    try:
        proc = psutil.Process(pid)
    except psutil.Error:
        return chain
    seen: set[int] = set()
    while proc is not None and len(chain) < limit and proc.pid not in seen:
        seen.add(proc.pid)
        try:
            chain.append({
                "pid": proc.pid,
                "name": proc.name(),
                "cmdline": " ".join(proc.cmdline()[:4]),
            })
            proc = proc.parent()
        except psutil.Error:
            break
    return chain


def kill_process(pid: int) -> dict:
    """Terminate process completely (escalation after freeze)."""
    try:
        proc = psutil.Process(pid)
        proc_name = proc.name()
        proc.kill()
        logger.warning(f"[KILL] Terminated PID {pid} — {proc_name}")
        return {"success": True, "pid": pid, "message": f"Process '{proc_name}' terminated."}
    except Exception as e:
        return {"success": False, "pid": pid, "message": str(e)}


def get_suspicious_processes(monitored_dir: str) -> list[dict]:
    """
    Heuristic: find processes plausibly responsible for the detected file
    changes. On Windows, psutil.Process.open_files() enumerates every open
    handle of every process — a full-system scan takes 20+ seconds, holds the
    GIL, and freezes the server exactly when it must be responding. So only
    scan open handles on platforms where it is cheap (Linux/macOS), and match
    by command line everywhere else.
    """
    # Shell/terminal wrappers only echo the attack command line; freezing
    # them would lock up the operator's terminal without stopping the
    # actual encryptor process doing the file writes.
    SHELL_NAMES = {
        "bash", "sh", "zsh", "fish", "dash", "ksh", "cmd", "cmd.exe",
        "powershell", "pwsh", "powershell.exe", "conhost", "conhost.exe",
        "explorer", "explorer.exe", "WindowsTerminal.exe", "windowsterminal",
    }

    suspects = []
    seen_pids: set[int] = set()

    def add(proc) -> None:
        if proc.pid in seen_pids:
            return
        seen_pids.add(proc.pid)
        # A previously frozen process is a relic of an earlier incident, not
        # the current writer: it is suspended, so it cannot be producing the
        # events that triggered this response. Excluding it stops frozen
        # leftovers from eating the suspect cap and letting the real attacker
        # escape the freeze (observed: a second simulator run froze two old
        # suspended processes instead of its own, and kept encrypting).
        try:
            if proc.status() == psutil.STATUS_STOPPED:
                return
        except psutil.Error:
            pass
        try:
            name = proc.name()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            name = "?"
        # Windows reports "bash.exe"; strip the extension before comparing.
        bare = name.lower().removesuffix(".exe")
        if bare in SHELL_NAMES:
            return
        try:
            cmdline = " ".join(proc.cmdline()[:4])
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            cmdline = ""
        suspects.append({
            "pid": proc.pid,
            "name": name,
            "cmdline": cmdline,
        })

    try:
        for proc in psutil.process_iter(["pid", "name", "cmdline"]):
            if proc.pid == os.getpid():
                continue
            # One problematic process must not abort the whole scan (a bare
            # AccessDenied here previously killed the scan and silently
            # returned no suspects at all).
            try:
                cmdline = " ".join(proc.cmdline()[:4])
                pname = proc.name() or ""
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue

            # Cmdline match: the process referenced the protected path, or is
            # the demo attack simulator.
            haystack = (cmdline + " " + pname).lower()
            if (
                monitored_dir.lower() in haystack
                or "simulate_ransomware" in haystack
            ):
                add(proc)
                continue

            # Open-handle match (cheap on non-Windows platforms)
            if platform.system() != "Windows":
                try:
                    files = proc.open_files()
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    files = []
                for f in files:
                    if monitored_dir.lower() in f.path.lower():
                        add(proc)
                        break
    except Exception:
        pass
    return suspects
