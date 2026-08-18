package com.ransomshield.api;

import com.ransomshield.monitor.FileWatcher;
import io.javalin.Javalin;
import io.javalin.http.Context;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Embedded Javalin server so the Python backend (and a human operator) can
 * manage the Java agent's lifecycle: GET /health, POST /control.
 */
public class ControlServer {
    private final int port;
    private final FileWatcher watcher;
    private final AtomicLong startedAtMs = new AtomicLong(System.currentTimeMillis());
    private final AtomicLong alertsSent;
    private Javalin app;

    public ControlServer(int port, FileWatcher watcher, AtomicLong alertsSent) {
        this.port = port;
        this.watcher = watcher;
        this.alertsSent = alertsSent;
    }

    public void start() {
        app = Javalin.create(config -> {
            config.showJavalinBanner = false;
        }).start(port);

        app.get("/health", this::health);
        app.post("/control", this::control);
        System.out.println("[ENGINE] control server listening on :" + port);
    }

    public void stop() {
        if (app != null) {
            app.stop();
        }
    }

    public boolean isPaused() {
        return watcher.isPaused();
    }

    private void health(Context ctx) {
        ctx.json(Map.of(
                "status", "running",
                "watched_dir", watcherRoot(),
                "uptime_seconds", (System.currentTimeMillis() - startedAtMs.get()) / 1000,
                "events_observed", watcher.eventsObserved(),
                "alerts_sent", alertsSent.get(),
                "paused", watcher.isPaused(),
                "backend_url", watcherBackendUrl()));
    }

    private void control(Context ctx) {
        @SuppressWarnings("unchecked")
        Map<String, Object> body = ctx.bodyAsClass(Map.class);
        String action = String.valueOf(body.getOrDefault("action", ""));
        switch (action) {
            case "pause" -> {
                watcher.setPaused(true);
                ctx.json(Map.of("status", "ok", "action", "pause", "message", "Detection paused."));
            }
            case "resume" -> {
                watcher.setPaused(false);
                ctx.json(Map.of("status", "ok", "action", "resume", "message", "Detection resumed."));
            }
            default -> ctx.status(400).json(Map.of(
                    "status", "error",
                    "message", "Unknown action. Use 'pause' or 'resume'.",
                    "supported_actions", new String[]{"pause", "resume"}));
        }
    }

    private String watcherRoot() {
        return watcher == null ? "?" : watcher.rootPath();
    }

    private String watcherBackendUrl() {
        return watcher == null ? "?" : watcher.backendUrl();
    }
}
