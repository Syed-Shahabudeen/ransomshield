package com.ransomshield.monitor;

import com.ransomshield.detection.AnomalyDetector;
import com.ransomshield.detection.CanaryFileManager;
import com.ransomshield.detection.EntropyAnalyzer;
import com.ransomshield.model.AlertPayload;
import com.ransomshield.process.ProcessKillChainTracer;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchEvent;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * java.nio.file.WatchService monitor, recursive over the monitored tree.
 * File events are translated into analyses; an alert triggers a callback
 * that freezes the process chain and publishes the alert to the backend.
 *
 * After an alert is raised the engine enters a suppression window: the
 * backend's rollback re-creates files (including canaries) and those restore
 * events must not re-trigger the incident.
 */
public class FileWatcher {
    private final Path root;
    private final CanaryFileManager canaryManager;
    private final AnomalyDetector detector = new AnomalyDetector();
    private final FileActivityBaseline baseline = new FileActivityBaseline();
    private final Consumer<AlertPayload> onAlert;
    private final AtomicInteger eventsObserved = new AtomicInteger();
    private final AtomicInteger alertsSent = new AtomicInteger();
    private final AtomicLong suppressionUntilMs = new AtomicLong();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private final Map<WatchKey, Path> keys = new ConcurrentHashMap<>();

    private WatchService watchService;
    private Thread thread;
    private String backendUrl;
    private long suppressionMs = 12_000L;

    public FileWatcher(Path root, CanaryFileManager canaryManager, Consumer<AlertPayload> onAlert) {
        this.root = root;
        this.canaryManager = canaryManager;
        this.onAlert = onAlert;
    }

    public void setSuppressionMs(long ms) {
        this.suppressionMs = ms;
    }

    public void setPaused(boolean paused) {
        this.paused.set(paused);
    }

    public boolean isPaused() {
        return paused.get();
    }

    public void setBackendUrl(String url) {
        this.backendUrl = url;
    }

    public String backendUrl() {
        return backendUrl;
    }

    public String rootPath() {
        return root.toString();
    }

    public int eventsObserved() {
        return eventsObserved.get();
    }

    public int alertsSent() {
        return alertsSent.get();
    }

    public void start() throws IOException {
        watchService = FileSystems.getDefault().newWatchService();
        registerTree(root);
        running.set(true);
        thread = new Thread(this::loop, "ransomshield-file-watcher");
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() throws IOException {
        running.set(false);
        if (watchService != null) {
            watchService.close();
        }
    }

    private void registerTree(Path dir) throws IOException {
        Files.walk(dir).filter(Files::isDirectory).forEach(p -> register(p));
    }

    private void register(Path dir) {
        try {
            WatchKey key = dir.register(watchService,
                    StandardWatchEventKinds.ENTRY_CREATE,
                    StandardWatchEventKinds.ENTRY_MODIFY,
                    StandardWatchEventKinds.ENTRY_DELETE);
            keys.put(key, dir);
        } catch (IOException e) {
            // Directory vanished between walk and register; ignore.
        }
    }

    private void loop() {
        while (running.get()) {
            WatchKey key;
            try {
                key = watchService.take();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            Path dir = keys.get(key);
            for (WatchEvent<?> event : key.pollEvents()) {
                if (event.kind() == StandardWatchEventKinds.OVERFLOW) {
                    continue;
                }
                Path name = (Path) event.context();
                Path path = dir == null ? name : dir.resolve(name);
                try {
                    handleEvent(event.kind(), path);
                } catch (Exception e) {
                    // A single event must never kill the watcher loop.
                    System.err.println("[WATCHER] error handling " + path + ": " + e);
                }
            }
            if (!key.reset()) {
                // Watched directory was deleted/recreated; re-register if it
                // exists again so monitoring survives rollbacks.
                keys.remove(key);
                try {
                    if (Files.exists(dir)) {
                        register(dir);
                    } else {
                        registerTree(root);
                    }
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void handleEvent(WatchEvent.Kind<?> kind, Path path) {
        eventsObserved.incrementAndGet();
        if (paused.get()) {
            return; // operator-requested maintenance window — no analysis
        }
        if (kind == StandardWatchEventKinds.ENTRY_DELETE) {
            return; // deletions are not a trigger in this version (like Python)
        }
        if (Files.isDirectory(path)) {
            if (kind == StandardWatchEventKinds.ENTRY_CREATE) {
                register(path); // new subdirectory → watch it too
            }
            return;
        }
        long now = System.currentTimeMillis();
        if (now < suppressionUntilMs.get()) {
            return; // rollback restore flood — same incident
        }

        String department = departmentOf(path);
        baseline.record(department, now);

        String canary = canaryManager.isCanary(path);
        double entropy = EntropyAnalyzer.entropy(path);
        AnomalyDetector.Analysis analysis = detector.analyze(path, entropy, canary, department, now, baseline);

        if (analysis.attack) {
            raiseAlert(path, department, analysis, now);
        }
    }

    private void raiseAlert(Path path, String department,
                            AnomalyDetector.Analysis analysis, long now) {
        suppressionUntilMs.set(now + suppressionMs);

        AlertPayload payload = new AlertPayload();
        payload.timestamp = now;
        payload.filepath = path.toString();
        payload.department = department;
        payload.entropy = analysis.entropy;
        payload.entropyDelta = 0.0;
        payload.threatScore = analysis.threatScore;
        payload.canaryTriggered = analysis.canaryTriggered;
        payload.filesAffected = baseline.burstCount(department, now);
        payload.reasons = analysis.reasons;

        List<AlertPayload.PidInfo> chain = new ArrayList<>();
        List<AlertPayload.FreezeResult> freezeResults = new ArrayList<>();
        ProcessKillChainTracer.findSuspect(root.toString()).ifPresent(leaf -> {
            chain.addAll(ProcessKillChainTracer.ancestry(leaf));
            freezeResults.addAll(ProcessKillChainTracer.freezeChain(chain));
        });
        payload.pidChain = chain;
        payload.freezeResults = freezeResults;

        alertsSent.incrementAndGet();
        System.out.println("[ENGINE] ALERT: " + path + " score=" + analysis.threatScore
                + " canary=" + analysis.canaryTriggered + " chain=" + chain.size());
        onAlert.accept(payload);
    }

    /** Parent directory name relative to the monitored root (or "root"). */
    private String departmentOf(Path path) {
        Path parent = path.getParent();
        if (parent == null || parent.equals(root)) {
            return "root";
        }
        Path rel = root.relativize(parent);
        return rel.getNameCount() == 0 ? "root" : rel.getName(0).toString();
    }
}
