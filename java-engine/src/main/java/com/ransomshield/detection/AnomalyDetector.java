package com.ransomshield.detection;

import com.ransomshield.monitor.FileActivityBaseline;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Composite detection: Shannon-entropy spike, known ransomware extension,
 * burst vs. department baseline, and the high-confidence canary signal.
 * Scores mirror the Python detector so both engines agree on severity.
 */
public class AnomalyDetector {
    public static final double ENTROPY_THRESHOLD = 7.2;
    public static final int ENTROPY_SCORE = 50;
    public static final int EXTENSION_SCORE = 35;
    public static final int BURST_SCORE = 15;
    public static final int ATTACK_THRESHOLD = 50;

    private static final Set<String> RANSOMWARE_EXTENSIONS = Set.of(
            ".locked", ".encrypted", ".enc", ".crypto", ".crypt", ".crypted",
            ".crypz", ".locky", ".zepto", ".thor", ".aesir", ".odin",
            ".zzzzz", ".cerber", ".cerber2", ".cerber3", ".wallet", ".wcry",
            ".wncry", ".wncryt", ".onion", ".ctbl", ".ctb2", ".micro",
            ".vvv", ".exx", ".ezz", ".ecc", ".xyz", ".abc", ".ccc",
            ".xxx", ".ttt", ".mp3", ".aaa", ".zz", ".ransomware");

    /** Result of analyzing one file event. */
    public static class Analysis {
        public final double entropy;
        public final String canaryTriggered; // nullable
        public final int threatScore;
        public final boolean attack;
        public final List<String> reasons;

        Analysis(double entropy, String canaryTriggered, int threatScore,
                 boolean attack, List<String> reasons) {
            this.entropy = entropy;
            this.canaryTriggered = canaryTriggered;
            this.threatScore = threatScore;
            this.attack = attack;
            this.reasons = reasons;
        }
    }

    public static boolean isRansomwareExtension(Path path) {
        String name = path.getFileName() == null ? "" : path.getFileName().toString();
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return false;
        }
        return RANSOMWARE_EXTENSIONS.contains(name.substring(dot).toLowerCase());
    }

    /**
     * Analyze a changed file. `canary` is the canary base name or null;
     * `department` is used for the burst-vs-baseline check.
     */
    public Analysis analyze(Path file, double entropy, String canary,
                            String department, long nowMs, FileActivityBaseline baseline) {
        List<String> reasons = new ArrayList<>(3);
        int score = 0;
        boolean attack = false;

        if (canary != null) {
            // Highest-confidence signal: a decoy was touched. Fires even when
            // entropy/extension heuristics score zero.
            attack = true;
            reasons.add("Canary file '" + canary + "' touched — decoy trigger");
        }
        if (entropy >= ENTROPY_THRESHOLD) {
            score += ENTROPY_SCORE;
            reasons.add(String.format("High entropy (%.2f/8.0) — file appears encrypted", entropy));
        }
        if (isRansomwareExtension(file)) {
            score += EXTENSION_SCORE;
            reasons.add("Known ransomware extension detected: " + extensionOf(file));
        }
        if (baseline.isBurst(department, nowMs)) {
            score += BURST_SCORE;
            reasons.add("Rapid file modification burst vs. department baseline");
        }
        if (score >= ATTACK_THRESHOLD) {
            attack = true;
        }
        // Keep parity with the Python detector: a canary-only trigger scores
        // 0 but is still an attack — the decoy signal alone is authoritative.
        return new Analysis(entropy, canary, score, attack, reasons);
    }

    private static String extensionOf(Path file) {
        String name = file.getFileName() == null ? "" : file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot);
    }
}
