package com.ransomshield.process;

import com.ransomshield.model.AlertPayload;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Process-chain tracing with the ProcessHandle API (Java 9+).
 *
 * WatchService cannot tell us WHICH process wrote a file, so the suspect is
 * found by scanning process command lines for the attack script / monitored
 * path — the same heuristic the Python freezer uses. Once the suspect is
 * found, the full ancestry chain (ProcessHandle.parent()) is walked so the
 * true entry point is terminated, not just the leaf encryptor.
 */
public final class ProcessKillChainTracer {

    /** Shell/terminal wrappers that only echo the attack command line. */
    private static final Set<String> SHELL_NAMES = Set.of(
            "bash", "sh", "zsh", "fish", "dash", "ksh",
            "cmd", "powershell", "pwsh", "conhost", "explorer",
            "windowsterminal", "powershell_ise", "winpty", "winpty-agent",
            "mintty", "conhost2", "openconsole");

    private ProcessKillChainTracer() {}

    private static String command(ProcessHandle p) {
        return p.info().commandLine().orElse("");
    }

    private static String name(ProcessHandle p) {
        String cmd = p.info().command().orElse("");
        int sep = Math.max(cmd.lastIndexOf('\\'), cmd.lastIndexOf('/'));
        String base = sep >= 0 ? cmd.substring(sep + 1) : cmd;
        if (base.endsWith(".exe")) {
            base = base.substring(0, base.length() - 4);
        }
        return base.toLowerCase();
    }

    private static boolean isShell(ProcessHandle p) {
        return SHELL_NAMES.contains(name(p));
    }

    /**
     * Find the most likely encryptor process: a non-shell process whose
     * command line references the demo simulator or the monitored directory.
     * Never matches this engine's own JVM.
     */
    public static Optional<ProcessHandle> findSuspect(String monitoredDir) {
        String lowerDir = monitoredDir.toLowerCase();
        long self = ProcessHandle.current().pid();
        return ProcessHandle.allProcesses()
                .filter(p -> p.pid() != self)
                .filter(p -> !isShell(p))
                .filter(p -> {
                    String cmd = command(p).toLowerCase();
                    return cmd.contains("simulate_ransomware") || cmd.contains(lowerDir);
                })
                .findFirst();
    }

    /** Walk the parent chain from deepest (the encryptor) up to the root. */
    public static List<AlertPayload.PidInfo> ancestry(ProcessHandle leaf) {
        List<AlertPayload.PidInfo> chain = new ArrayList<>();
        Optional<ProcessHandle> cur = Optional.of(leaf);
        int hops = 0;
        while (cur.isPresent() && hops < 32) {
            ProcessHandle p = cur.get();
            chain.add(new AlertPayload.PidInfo(
                    p.pid(),
                    p.info().command().map(c -> {
                        int sep = Math.max(c.lastIndexOf('\\'), c.lastIndexOf('/'));
                        return sep >= 0 ? c.substring(sep + 1) : c;
                    }).orElse("?"),
                    command(p)));
            cur = p.parent();
            hops++;
        }
        return chain;
    }

    /**
     * Terminate the encryptor and its non-shell ancestors, deepest first;
     * destroyForcibly() as backup. Shell/terminal wrappers are reported but
     * NOT destroyed — killing the operator's terminal mid-demo (or mid-
     * response) is worse than leaving a harmless wrapper alive.
     */
    public static List<AlertPayload.FreezeResult> freezeChain(List<AlertPayload.PidInfo> chain) {
        List<AlertPayload.FreezeResult> results = new ArrayList<>();
        for (AlertPayload.PidInfo info : chain) {
            if (isShellName(info.name)) {
                results.add(new AlertPayload.FreezeResult(
                        info.pid, info.name, false, "Shell wrapper — left running."));
                continue;
            }
            Optional<ProcessHandle> ph = ProcessHandle.of(info.pid);
            if (ph.isEmpty()) {
                results.add(new AlertPayload.FreezeResult(
                        info.pid, info.name, false, "Process already exited."));
                continue;
            }
            ProcessHandle p = ph.get();
            String msg;
            boolean ok;
            try {
                p.destroy();
                // Give it a moment to exit, then escalate.
                long deadline = System.currentTimeMillis() + 800;
                while (p.isAlive() && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50);
                }
                if (p.isAlive()) {
                    p.destroyForcibly();
                    ok = !p.isAlive();
                    msg = ok ? "Process chain terminated (forced)." : "Termination requested.";
                } else {
                    ok = true;
                    msg = "Process chain member terminated.";
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                ok = false;
                msg = "Interrupted while terminating chain member.";
            }
            results.add(new AlertPayload.FreezeResult(info.pid, info.name, ok, msg));
        }
        return results;
    }

    private static boolean isShellName(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".exe")) {
            n = n.substring(0, n.length() - 4);
        }
        return SHELL_NAMES.contains(n);
    }
}
