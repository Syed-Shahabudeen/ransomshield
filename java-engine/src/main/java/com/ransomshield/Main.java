package com.ransomshield;

import com.ransomshield.api.AlertPublisher;
import com.ransomshield.api.ControlServer;
import com.ransomshield.detection.CanaryFileManager;
import com.ransomshield.model.AlertPayload;
import com.ransomshield.monitor.FileWatcher;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.atomic.AtomicLong;

/**
 * RansomShield Java detection engine — the low-level monitoring agent.
 *
 * Usage:
 *   java -jar ransomshield-java-engine.jar [--dir <path>] [--port <n>] [--backend <url>]
 *
 * Defaults: dir=demo/sample_hospital_files (relative to cwd),
 *           port=7000, backend=http://127.0.0.1:8000
 */
public class Main {
    public static void main(String[] args) throws Exception {
        String dir = arg(args, "--dir", "demo/sample_hospital_files");
        int port = Integer.parseInt(arg(args, "--port", "7000"));
        String backend = arg(args, "--backend", "http://127.0.0.1:8000");

        Path monitoredDir = Paths.get(dir).toAbsolutePath().normalize();
        if (!java.nio.file.Files.isDirectory(monitoredDir)) {
            System.out.println("[ENGINE] monitored dir does not exist yet, creating: " + monitoredDir);
            java.nio.file.Files.createDirectories(monitoredDir);
        }

        AtomicLong alertsSent = new AtomicLong();

        CanaryFileManager canaryManager = new CanaryFileManager(monitoredDir);
        int canaries = canaryManager.plant();
        System.out.println("[ENGINE] " + canaries + " canaries armed in " + monitoredDir);

        AlertPublisher publisher = new AlertPublisher(backend);

        FileWatcher watcher = new FileWatcher(monitoredDir, canaryManager, payload -> {
            boolean delivered = publisher.publish(payload);
            if (delivered) {
                alertsSent.incrementAndGet();
            }
        });
        watcher.setBackendUrl(backend);
        watcher.start();
        System.out.println("[ENGINE] watching " + monitoredDir + " -> backend " + backend);

        ControlServer control = new ControlServer(port, watcher, alertsSent);
        control.start();

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                watcher.stop();
            } catch (IOException ignored) {
            }
            control.stop();
            System.out.println("[ENGINE] stopped.");
        }));

        System.out.println("[ENGINE] ready. /health on http://127.0.0.1:" + port + "/health");
    }

    private static String arg(String[] args, String flag, String def) {
        for (int i = 0; i < args.length - 1; i++) {
            if (args[i].equals(flag)) {
                return args[i + 1];
            }
        }
        return def;
    }
}
