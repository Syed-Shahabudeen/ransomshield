package com.ransomshield.process;

public class CmdlineProbe {
    public static void main(String[] a) {
        ProcessHandle.allProcesses()
                .filter(p -> p.info().command().map(c -> c.toLowerCase().contains("python")).orElse(false))
                .forEach(p -> System.out.println("pid=" + p.pid()
                        + " args=[" + p.info().arguments().map(java.util.Arrays::toString).orElse("<empty>") + "]"));
    }
}
