package com.ransomshield.monitor;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-department baseline of "normal" file activity. Keeps a sliding window
 * of event timestamps per department and answers two questions:
 *   - rate():    current events/sec over the window
 *   - isBurst(): whether the short-window rate grossly exceeds the baseline
 *
 * Baselines are meant to cut false positives in busy departments (e.g. a
 * pharmacy terminal that legitimately churns CSVs) without delaying alerts
 * on quiet ones.
 */
public class FileActivityBaseline {
    private static final long WINDOW_MS = 60_000L;   // baseline horizon
    private static final long SHORT_MS = 10_000L;    // burst horizon
    private static final int MIN_BURST_EVENTS = 8;   // absolute floor
    private static final double BURST_FACTOR = 6.0;  // vs. baseline rate

    private final Map<String, Deque<Long>> events = new ConcurrentHashMap<>();

    public void record(String department, long nowMs) {
        events.computeIfAbsent(department, k -> new ArrayDeque<>()).addLast(nowMs);
    }

    /** Events per second over the full window (the department's baseline). */
    public double rate(String department, long nowMs) {
        Deque<Long> q = events.get(department);
        if (q == null || q.isEmpty()) {
            return 0.0;
        }
        long cutoff = nowMs - WINDOW_MS;
        int count = 0;
        for (long t : q) {
            if (t >= cutoff) {
                count++;
            }
        }
        return count / (WINDOW_MS / 1000.0);
    }

    /** Events in the short window (the current burst). */
    public int burstCount(String department, long nowMs) {
        Deque<Long> q = events.get(department);
        if (q == null || q.isEmpty()) {
            return 0;
        }
        long cutoff = nowMs - SHORT_MS;
        int count = 0;
        for (long t : q) {
            if (t >= cutoff) {
                count++;
            }
        }
        return count;
    }

    /**
     * True when the department's short-window rate exceeds both the absolute
     * floor and a multiple of its own baseline. A fresh department with no
     * baseline triggers once the floor is reached (mirrors the Python
     * detector's "8 files in 10s" rule).
     */
    public boolean isBurst(String department, long nowMs) {
        int burst = burstCount(department, nowMs);
        if (burst < MIN_BURST_EVENTS) {
            return false;
        }
        double baseline = rate(department, nowMs);
        double threshold = Math.max(baseline * BURST_FACTOR, MIN_BURST_EVENTS / (SHORT_MS / 1000.0));
        // Epsilon: 0.2 * 6.0 computes to 1.2000000000000002 while 12/10.0 is
        // 1.19999999999999996 — a bare >= misses the exact boundary.
        double burstRate = burst / (SHORT_MS / 1000.0);
        return burstRate >= threshold - 1e-9;
    }
}
