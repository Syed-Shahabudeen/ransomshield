import asyncio
import logging
import os
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent

from detector import RansomwareDetector
from freezer import freeze_process, get_suspicious_processes, get_process_ancestry
from snapshot import SnapshotEngine
from canary import CanaryManager
from audit_log import AuditLog
from network_sim import NetworkSim
from ransom_note import extract_ransom_note

logger = logging.getLogger("ransomshield.monitor")

# Seconds of quiet (no attack-class events) after which the handler will
# treat a new high-score event as a fresh incident instead of the tail of
# the current one.
REARM_WINDOW = 8.0


class RansomShieldHandler(FileSystemEventHandler):
    """Watchdog event handler: detection only. Response lives on FileMonitor
    so the Java engine's /api/v1/alert path shares the same pipeline."""

    def __init__(self, detector: RansomwareDetector, monitor: "FileMonitor"):
        super().__init__()
        self.detector = detector
        self.monitor = monitor
        self.attack_active = False
        self.last_attack_time = 0.0
        self.total_events = 0
        self.attack_count = 0

    def _process_path(self, filepath: str):
        self.total_events += 1

        result = self.detector.analyze_file(filepath)
        result["event_count"] = self.total_events

        now = time.time()
        # Re-arm once the previous incident has gone quiet, so a signal that
        # arrives later counts as a NEW incident. This must run BEFORE the
        # canary check below: both it and the incident gate consult
        # attack_active, and a canary reason was previously lost for
        # re-armed incidents because the flag was still set from the
        # previous incident when the canary check ran.
        if self.attack_active and now - self.last_attack_time > REARM_WINDOW:
            self.attack_active = False

        # High-confidence decoy signal: a planted canary was touched. Fires
        # even when entropy/extension heuristics score low, but only when the
        # system is not already mid-response — rollback restores canaries too,
        # and those restore events must not re-trigger the incident.
        canary = self.monitor.canary_manager.is_canary(filepath) if self.monitor.canary_manager else None
        if canary:
            result["canary_triggered"] = canary
            if not self.attack_active:
                result["is_attack"] = True
                result["reasons"].insert(0, f"Canary file '{canary}' touched — decoy trigger")

        # Broadcast every file change (for live counter and Live Feed tab).
        msg = {
            "type": "file_change",
            "filepath": filepath,
            "entropy": result["entropy"],
            "threat_score": result["threat_score"],
            "event_count": self.total_events,
        }
        asyncio.run_coroutine_threadsafe(self.monitor.broadcast_fn(msg), self.monitor.loop)
        logger.debug(f"[FILE_CHANGE] #{self.total_events} {filepath} H={result['entropy']:.3f} score={result['threat_score']}")

        # In events_only mode (Java engine owns detection) we never trigger
        # the attack-response pipeline — detection and containment are the
        # Java engine's responsibility.
        if self.monitor.events_only:
            return

        if result["is_attack"]:
            self.last_attack_time = now
            if not self.attack_active:
                self.monitor._respond(
                    filepath=filepath,
                    entropy=result["entropy"],
                    threat_score=result["threat_score"],
                    reasons=result["reasons"],
                    canary_triggered=result.get("canary_triggered"),
                )

    def _handle_event(self, event):
        if event.is_directory:
            return
        self._process_path(event.src_path)

    def on_modified(self, event):
        if isinstance(event, FileModifiedEvent):
            self._handle_event(event)

    def on_created(self, event):
        if isinstance(event, FileCreatedEvent):
            self._handle_event(event)

    def on_moved(self, event):
        """
        Mass renames to ransom extensions are a core detection signal, but
        they arrive as FileMovedEvent, which the other handlers never see.
        The 'modified' event for the source path often races with the rename
        (by the time it is processed the source is gone and its entropy reads
        as 0), so without this handler detection depended on winning that
        race. Analyze the destination path instead.
        """
        if event.is_directory:
            return
        self._process_path(event.dest_path)


class FileMonitor:
    def __init__(
        self,
        monitored_dir: str,
        snapshot_engine: SnapshotEngine,
        broadcast_fn,
        loop: asyncio.AbstractEventLoop,
        canary_manager: CanaryManager | None = None,
        audit_log: AuditLog | None = None,
        network_sim: NetworkSim | None = None,
        events_only: bool = False,
    ):
        """
        events_only=True: broadcast file_change events for the UI counter /
        live feed but never trigger the attack-response pipeline. Use this
        mode when the Java engine owns detection so the dashboard always has
        live telemetry without risking a double-response.
        """
        self.monitored_dir = monitored_dir
        self.snapshot_engine = snapshot_engine
        self.broadcast_fn = broadcast_fn
        self.loop = loop
        self.canary_manager = canary_manager
        self.audit_log = audit_log
        self.network_sim = network_sim
        self.events_only = events_only
        self.detector = RansomwareDetector()
        self.observer = Observer()
        self.handler = RansomShieldHandler(detector=self.detector, monitor=self)
        self._running = False

    def start(self):
        Path(self.monitored_dir).mkdir(parents=True, exist_ok=True)
        self.observer.schedule(self.handler, self.monitored_dir, recursive=True)
        self.observer.start()
        self._running = True
        logger.info(f"[MONITOR] Watching: {self.monitored_dir}")

    def stop(self):
        if not self._running:
            return
        self.observer.stop()
        self.observer.join()
        self._running = False

    @property
    def event_count(self):
        return self.handler.total_events

    @property
    def attack_count(self):
        return self.handler.attack_count

    def _respond(
        self,
        filepath: str,
        entropy: float,
        threat_score: int,
        reasons: list,
        canary_triggered: str | None = None,
        java_freeze_results: list | None = None,
    ) -> dict | None:
        """
        Shared incident-response pipeline: incident gate, process freeze,
        snapshot rollback, canary re-plant, WebSocket broadcast and audit
        entry. Used by the Python watchdog and by alerts posted by the Java
        engine. Returns the attack event, or None if an incident is already
        being handled (one response per incident).
        """
        h = self.handler
        now = time.time()
        if h.attack_active and now - h.last_attack_time > REARM_WINDOW:
            h.attack_active = False
        if h.attack_active:
            h.last_attack_time = now
            return None
        h.last_attack_time = now
        h.attack_active = True
        h.attack_count += 1
        logger.critical(f"[ATTACK DETECTED] {filepath} — Score: {threat_score}")

        # Ransom-note intelligence: capture the demand note BEFORE rollback
        # wipes the infected tree. Only attacker-authored content is parsed
        # (wallet, gang, deadline) — no patient data is read.
        ransom_note = extract_ransom_note(self.monitored_dir)
        if ransom_note:
            logger.warning(
                f"[RANSOM NOTE] attributed to {ransom_note.get('gang') or 'unknown gang'} — "
                f"{ransom_note.get('amount_btc') or '?'} BTC demand, "
                f"{ransom_note.get('deadline_hours') or '?'}h deadline, "
                f"wallet {ransom_note.get('btc_address') or 'unavailable'}"
            )

        # Containment: use the Java engine's chain-termination results when
        # provided, otherwise scan + suspend ourselves (and walk the parent
        # chain for the kill-chain data).
        freeze_results = list(java_freeze_results or [])
        pid_chain: list = []
        if not freeze_results:
            suspects = get_suspicious_processes(self.monitored_dir)
            for s in suspects[:3]:
                fr = freeze_process(s["pid"])
                freeze_results.append(fr)
                logger.warning(f"[FREEZE] {fr}")
            if suspects:
                pid_chain = get_process_ancestry(suspects[0]["pid"])

        rollback = self.snapshot_engine.rollback()

        # Re-plant any canaries that were missing from the restored snapshot
        # (e.g. after an admin wiped the tree) so the decoy layer stays armed.
        if self.canary_manager:
            self.canary_manager.plant()

        attack_event = {
            "type": "attack_detected",
            "attack_id": h.attack_count,
            "filepath": filepath,
            "entropy": entropy,
            "threat_score": threat_score,
            "reasons": reasons,
            "freeze_results": freeze_results,
            "pid_chain": pid_chain,
            "rollback": rollback,
            "canary_triggered": canary_triggered,
            "ransom_note": ransom_note,
            "timestamp": now,
        }
        asyncio.run_coroutine_threadsafe(self.broadcast_fn(attack_event), self.loop)

        if self.audit_log:
            self.audit_log.append("attack_detected", {
                "attack_id": h.attack_count,
                "filepath": filepath,
                "entropy": entropy,
                "threat_score": threat_score,
                "canary_triggered": canary_triggered,
                "freeze_count": len(freeze_results),
                "rollback_success": bool(rollback.get("success")),
                "files_restored": rollback.get("files_restored", 0),
                "ransom_intel": (
                    {k: ransom_note[k] for k in ("gang", "btc_address", "amount_btc", "deadline_hours")
                     if ransom_note.get(k)}
                    if ransom_note else None
                ),
            })

        # Nationwide threat-intel: anonymize the indicators into a campaign
        # fingerprint and broadcast it to every hospital in the sim network.
        if self.network_sim:
            attack_event["threat_intel"] = self.network_sim.broadcast_fingerprint(attack_event)
        return attack_event

    def respond_to_java_alert(self, payload: dict) -> dict | None:
        """
        Handle an alert posted by the Java engine (POST /api/v1/alert).
        The Java engine already terminated the process chain; we run the
        shared response (rollback, broadcast, audit) with its results.
        """
        if not isinstance(payload, dict):
            return None
        filepath = str(payload.get("filepath") or payload.get("files_affected") or "unknown")
        try:
            entropy = float(payload.get("entropy", 0) or 0)
        except (TypeError, ValueError):
            entropy = 0.0
        try:
            threat_score = int(payload.get("threatScore", 0) or 0)
        except (TypeError, ValueError):
            threat_score = 0
        canary = payload.get("canaryTriggered")
        reasons = payload.get("reasons") or []
        if not reasons:
            reasons = [f"Java engine reported threat score {threat_score}/100"]

        java_freeze = []
        for fr in payload.get("freezeResults") or []:
            if isinstance(fr, dict):
                java_freeze.append({
                    "pid": fr.get("pid"),
                    "name": fr.get("name"),
                    "success": bool(fr.get("success")),
                    "message": fr.get("message", "Terminated by Java engine."),
                })

        event = self._respond(
            filepath=filepath,
            entropy=entropy,
            threat_score=threat_score,
            reasons=reasons,
            canary_triggered=canary,
            java_freeze_results=java_freeze,
        )
        # Surface the Java engine's kill-chain for the frontend/PDF.
        if event and payload.get("pidChain"):
            event["pid_chain"] = payload["pidChain"]
        return event
