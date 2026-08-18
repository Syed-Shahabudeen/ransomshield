package com.ransomshield.detection;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Decoy (canary) file layer. Plants realistic-looking decoy files whose names
 * sort to the front of the tree, so an encryptor working in name order touches
 * one before any real record. Idempotent: existing canaries are skipped, so
 * running alongside the Python backend's canary layer (same names) is safe.
 */
public class CanaryFileManager {
    // base name (no extension) -> subdirectory relative to the monitored root
    private static final Map<String, String> PATTERNS = new LinkedHashMap<>();

    static {
        PATTERNS.put("000_urgent_rounds_notes", "");
        PATTERNS.put("000_handover_icu_pending", "patient_records");
        PATTERNS.put("000_vitals_overflow_ledger", "radiology");
        PATTERNS.put("000_pharma_shortage_list", "pharmacy");
        PATTERNS.put("000_admission_batch_pending", "admin");
        PATTERNS.put("000_lab_queue_urgent", "lab_reports");
    }

    private static final String CONTENT =
            "URGENT — INTER-DEPARTMENT HANDOVER (CONFIDENTIAL)\n"
            + "Patient cohort: post-op ICU transfers, ward 4B.\n"
            + "Attending: Dr. S. Mehta. Notes pending sign-off.\n"
            + "vault_key: 7f3a9c2e1d8b4a6f0e5d3c2b1a9f8e7d\n"
            + "This file is an automated decoy placed by RansomShield.\n";

    private final Path monitoredDir;

    public CanaryFileManager(Path monitoredDir) {
        this.monitoredDir = monitoredDir;
    }

    public int plant() throws IOException {
        Files.createDirectories(monitoredDir);
        int count = 0;
        for (Map.Entry<String, String> e : PATTERNS.entrySet()) {
            String base = e.getKey();
            String sub = e.getValue();
            Path dir = sub.isEmpty() ? monitoredDir : monitoredDir.resolve(sub);
            Files.createDirectories(dir);
            Path file = dir.resolve(base + ".txt");
            if (!Files.exists(file)) {
                Files.writeString(file, CONTENT, StandardCharsets.UTF_8);
            }
            count++;
        }
        return count;
    }

    /**
     * Return the canary base name if the path refers to a planted canary
     * (handles the "<name>.txt.encrypted" rename pattern), else null.
     */
    public String isCanary(Path path) {
        String name = path.getFileName() == null ? "" : path.getFileName().toString();
        int dot = name.indexOf('.');
        String base = dot < 0 ? name : name.substring(0, dot);
        return PATTERNS.containsKey(base) ? base : null;
    }

    public List<Path> plantedPaths() {
        return PATTERNS.entrySet().stream()
                .map(e -> e.getValue().isEmpty()
                        ? monitoredDir.resolve(e.getKey() + ".txt")
                        : monitoredDir.resolve(e.getValue()).resolve(e.getKey() + ".txt"))
                .toList();
    }
}
