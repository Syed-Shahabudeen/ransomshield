package com.ransomshield.detection;

import com.ransomshield.monitor.FileActivityBaseline;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DetectionTest {

    @Test
    void randomBytesScoreNearMaxEntropy() throws IOException {
        Path f = Files.createTempFile("rs_entropy", ".bin");
        byte[] data = new byte[32768];
        new Random(42).nextBytes(data);
        Files.write(f, data);
        double e = EntropyAnalyzer.entropy(f);
        assertTrue(e >= 7.9, "expected ~8.0, got " + e);
    }

    @Test
    void plainTextScoresLowEntropy() throws IOException {
        Path f = Files.createTempFile("rs_text", ".txt");
        Files.writeString(f, "The quick brown fox jumps over the lazy dog. ".repeat(500));
        double e = EntropyAnalyzer.entropy(f);
        assertTrue(e < 6.0, "expected low entropy, got " + e);
    }

    @Test
    void missingFileScoresZero() {
        assertEquals(0.0, EntropyAnalyzer.entropy(Path.of("does-not-exist-xyz.bin")));
    }

    @Test
    void canaryTriggerIsAnAttackEvenAtZeroScore() {
        AnomalyDetector detector = new AnomalyDetector();
        FileActivityBaseline baseline = new FileActivityBaseline();
        long now = System.currentTimeMillis();
        var a = detector.analyze(Path.of("000_urgent_rounds_notes.txt"), 0.0,
                "000_urgent_rounds_notes", "root", now, baseline);
        assertTrue(a.attack);
        assertEquals(0, a.threatScore);
        assertNotNull(a.canaryTriggered);
    }

    @Test
    void entropyPlusExtensionScoresAboveThreshold() {
        AnomalyDetector detector = new AnomalyDetector();
        FileActivityBaseline baseline = new FileActivityBaseline();
        long now = System.currentTimeMillis();
        var a = detector.analyze(Path.of("patient_001.txt.encrypted"), 7.99, null,
                "patient_records", now, baseline);
        assertTrue(a.attack);
        assertEquals(85, a.threatScore);
    }

    @Test
    void ransomwareExtensionDetected() {
        assertTrue(AnomalyDetector.isRansomwareExtension(Path.of("x.txt.encrypted")));
        assertTrue(AnomalyDetector.isRansomwareExtension(Path.of("data.locky")));
        assertTrue(!AnomalyDetector.isRansomwareExtension(Path.of("report.pdf")));
    }

    @Test
    void canaryNameMatchesThroughRenameSuffix() throws IOException {
        Path dir = Files.createTempDirectory("rs_canary");
        CanaryFileManager cm = new CanaryFileManager(dir);
        cm.plant();
        assertEquals("000_urgent_rounds_notes",
                cm.isCanary(dir.resolve("000_urgent_rounds_notes.txt.encrypted")));
        assertEquals("000_lab_queue_urgent",
                cm.isCanary(dir.resolve("lab_reports").resolve("000_lab_queue_urgent.txt.encrypted")));
        assertEquals(null, cm.isCanary(dir.resolve("real_patient_record.txt")));
    }

    @Test
    void burstAgainstBaselineTriggers() {
        FileActivityBaseline baseline = new FileActivityBaseline();
        long now = System.currentTimeMillis();
        // 12 events in 2s = clear burst on a fresh department
        for (int i = 0; i < 12; i++) {
            baseline.record("icu", now - 2000L + i * 100L);
        }
        assertTrue(baseline.isBurst("icu", now));
        // A quiet department with a few events is not a burst
        FileActivityBaseline quiet = new FileActivityBaseline();
        for (int i = 0; i < 3; i++) {
            quiet.record("admin", now - 5000L + i * 1000L);
        }
        assertTrue(!quiet.isBurst("admin", now));
    }
}
