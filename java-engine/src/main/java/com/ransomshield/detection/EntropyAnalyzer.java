package com.ransomshield.detection;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Shannon entropy over the first 64KB of a file. Max = 8.0 bits (random data).
 * A file that cannot be read (locked, just-renamed, permission denied) yields
 * 0.0 so detection never crashes on a transient race — the caller combines
 * this with canary and extension signals.
 */
public final class EntropyAnalyzer {
    private static final int SAMPLE_BYTES = 65536;

    private EntropyAnalyzer() {}

    public static double entropy(Path file) {
        byte[] data = new byte[SAMPLE_BYTES];
        int n;
        try (InputStream in = Files.newInputStream(file)) {
            n = in.readNBytes(data, 0, data.length);
        } catch (IOException e) {
            return 0.0;
        }
        if (n <= 0) {
            return 0.0;
        }
        long[] counts = new long[256];
        for (int i = 0; i < n; i++) {
            counts[data[i] & 0xFF]++;
        }
        double sum = 0.0;
        for (long c : counts) {
            if (c == 0) {
                continue;
            }
            double p = (double) c / n;
            sum -= p * (Math.log(p) / Math.log(2));
        }
        return Math.round(sum * 10000.0) / 10000.0;
    }
}
