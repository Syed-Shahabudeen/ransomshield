package com.ransomshield.process;

import com.ransomshield.model.AlertPayload;

import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

public class TracerProbe {
    public static void main(String[] args) throws Exception {
        String dir = args.length > 0 ? args[0] : "demo/sample_hospital_files";
        System.out.println("scanning for suspects, dir=" + dir);
        ProcessHandle.allProcesses()
                .filter(p -> {
                    String cmd = p.info().commandLine().orElse("");
                    return cmd.toLowerCase().contains("simulate_ransomware");
                })
                .forEach(p -> System.out.println("  MATCH pid=" + p.pid()
                        + " cmd=[" + p.info().commandLine().orElse("?") + "]"));

        Optional<ProcessHandle> leaf = ProcessKillChainTracer.findSuspect(dir);
        if (leaf.isEmpty()) {
            System.out.println("findSuspect: EMPTY");
        } else {
            System.out.println("findSuspect -> pid=" + leaf.get().pid());
            List<AlertPayload.PidInfo> chain = ProcessKillChainTracer.ancestry(leaf.get());
            System.out.println("chain size=" + chain.size());
            chain.forEach(c -> System.out.println("   " + c.pid + " " + c.name + " [" + c.cmdline.substring(0, Math.min(60, c.cmdline.length())) + "]"));
        }
    }
}
