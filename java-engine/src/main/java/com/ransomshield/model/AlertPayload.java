package com.ransomshield.model;

import java.util.List;

/**
 * Alert payload POSTed to the FastAPI backend at /api/v1/alert.
 * Public fields keep Jackson mapping trivial.
 */
public class AlertPayload {
    public long timestamp;
    public String filepath;
    public String department;
    public double entropy;
    public double entropyDelta;
    public int threatScore;
    /** Base name of the canary that was touched, or null if none. */
    public String canaryTriggered;
    public int filesAffected;
    public List<String> reasons;
    /** Full process ancestry, deepest (the encryptor) first. */
    public List<PidInfo> pidChain;
    /** Result of freezing each chain member. */
    public List<FreezeResult> freezeResults;

    public static class PidInfo {
        public long pid;
        public String name;
        public String cmdline;

        public PidInfo() {}

        public PidInfo(long pid, String name, String cmdline) {
            this.pid = pid;
            this.name = name == null ? "?" : name;
            this.cmdline = cmdline == null ? "" : cmdline;
        }
    }

    public static class FreezeResult {
        public long pid;
        public String name;
        public boolean success;
        public String message;

        public FreezeResult() {}

        public FreezeResult(long pid, String name, boolean success, String message) {
            this.pid = pid;
            this.name = name == null ? "?" : name;
            this.success = success;
            this.message = message == null ? "" : message;
        }
    }
}
