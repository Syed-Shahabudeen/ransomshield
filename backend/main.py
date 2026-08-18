import asyncio
import json
import logging
import os
import time
import urllib.request
import subprocess
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse

from monitor import FileMonitor
from snapshot import SnapshotEngine
from llm_engine import generate_incident_summary
from report_generator import generate_pdf_report
from canary import CanaryManager
from audit_log import AuditLog
from network_sim import NetworkSim

# ── Config ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ransomshield.main")

# Resolve the monitored dir relative to the repo root (backend/..) so the
# path is stable regardless of the cwd uvicorn is launched from. The startup
# script and README both `cd backend` before starting the server, and the
# demo simulator always targets <repo>/demo/sample_hospital_files — a
# cwd-relative default silently watches a different (empty) directory and
# the whole demo never triggers.
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MONITORED_DIR = REPO_ROOT / "demo" / "sample_hospital_files"
MONITORED_DIR = os.getenv("MONITORED_DIR", str(DEFAULT_MONITORED_DIR))
SNAPSHOT_INTERVAL = int(os.getenv("SNAPSHOT_INTERVAL", "30"))
HOSPITAL_NAME = os.getenv("HOSPITAL_NAME", "AIIMS Delhi - Digital Health Division")

# Detection-engine ownership. The Java engine (java-engine/) is the preferred
# monitoring core: when it is reachable its alerts arrive via POST
# /api/v1/alert and the in-process watchdog stays off to avoid double
# detection. Modes: auto | java | python
MONITOR_ENGINE = os.getenv("MONITOR_ENGINE", "auto").strip().lower()
JAVA_ENGINE_URL = os.getenv("JAVA_ENGINE_URL", "http://127.0.0.1:7000").rstrip("/")
# Seed for the network sim's background RNG (0/unset = unseeded, as before).
# The scripted campaign accepts its own seed per start.
NETWORK_SEED = int(os.getenv("NETWORK_SEED") or 0) or None


def java_engine_healthy(url: str, timeout: float = 1.5) -> bool:
    """Probe the Java engine's /health endpoint with a short timeout."""
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False

# ── Global state ──────────────────────────────────────────────────────────
connected_clients: list[WebSocket] = []
attack_log: list[dict] = []
snapshot_engine: SnapshotEngine | None = None
file_monitor: FileMonitor | None = None
canary_manager: CanaryManager | None = None
audit_log: AuditLog | None = None
network_sim: NetworkSim | None = None
start_time = time.time()


# ── WebSocket broadcast ───────────────────────────────────────────────────
async def broadcast(message: dict):
    # Cache attack events for late-joining clients and the report API even
    # when no WebSocket client happens to be connected right now.
    if message.get("type") == "attack_detected":
        attack_log.append(message)

    if not connected_clients:
        return
    data = json.dumps(message)
    dead = []
    for ws in connected_clients:
        try:
            await ws.send_text(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            connected_clients.remove(ws)
        except ValueError:
            pass


# ── App lifespan ──────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global snapshot_engine, file_monitor, canary_manager, audit_log, network_sim
    loop = asyncio.get_event_loop()

    Path(MONITORED_DIR).mkdir(parents=True, exist_ok=True)

    # Tamper-evident audit chain — must exist before the monitor logs to it.
    audit_log = AuditLog(REPO_ROOT / "audit" / "chain.jsonl")
    audit_log.append("system_startup", {"hospital": HOSPITAL_NAME, "monitored_dir": MONITORED_DIR})

    # Plant decoys BEFORE the first snapshot so rollback restores them too.
    canary_manager = CanaryManager(MONITORED_DIR)
    canary_manager.plant()

    snapshot_engine = SnapshotEngine(MONITORED_DIR, interval=SNAPSHOT_INTERVAL)
    snapshot_engine.start()
    logger.info(f"Snapshot engine started (interval={SNAPSHOT_INTERVAL}s)")

    # Nationwide simulated hospital network — after every incident the
    # anonymized attack fingerprint is broadcast to all nodes and the sim
    # plays out quarantine/recovery across the country.
    network_sim = NetworkSim(source_node_id="hq-delhi", broadcast_fn=broadcast, loop=loop, seed=NETWORK_SEED)
    network_sim.start()

    # Detection engine ownership: prefer the Java engine when present.
    java_healthy = False
    if MONITOR_ENGINE in ("auto", "java"):
        java_healthy = java_engine_healthy(JAVA_ENGINE_URL)
        if java_healthy:
            logger.info(
                f"Java engine detected at {JAVA_ENGINE_URL} — "
                "Python watchdog runs in events-only mode (Java owns detection)"
            )
    if MONITOR_ENGINE == "java" and not java_healthy:
        logger.error(
            f"MONITOR_ENGINE=java but no engine at {JAVA_ENGINE_URL} — "
            "detection is DISABLED until the engine starts"
        )

    # Always start the file monitor. When the Java engine is healthy, run in
    # events_only mode: broadcasts file_change for the live feed / event counter
    # but never triggers the attack-response pipeline (Java handles that).
    # When Python is primary, run fully (detection + response + broadcast).
    file_monitor = FileMonitor(
        monitored_dir=MONITORED_DIR,
        snapshot_engine=snapshot_engine,
        broadcast_fn=broadcast,
        loop=loop,
        canary_manager=canary_manager,
        audit_log=audit_log,
        network_sim=network_sim,
        events_only=java_healthy,
    )
    file_monitor.start()
    if java_healthy:
        logger.info("[MONITOR] events-only watchdog started — live feed + event counter active")
    else:
        logger.info(f"[MONITOR] Python watchdog started (primary detection): {MONITORED_DIR}")
    logger.info("RansomShield backend ready ✅")

    yield

    # Cleanup
    if file_monitor:
        file_monitor.stop()
    if snapshot_engine:
        snapshot_engine.stop()
    if network_sim:
        network_sim.stop()
    if audit_log:
        audit_log.append("system_shutdown", {})


app = FastAPI(title="RansomShield API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket endpoint ────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    logger.info(f"Client connected. Total: {len(connected_clients)}")

    # Send current state on connect
    await websocket.send_text(json.dumps({
        "type": "init",
        "status": "protected",
        "attack_log": attack_log[-10:],  # last 10 attacks
        "snapshots": snapshot_engine.get_snapshots() if snapshot_engine else [],
        "event_count": file_monitor.event_count if file_monitor else 0,
        "uptime_seconds": round(time.time() - start_time),
        "hospital": HOSPITAL_NAME,
    }))

    try:
        while True:
            # Keep alive + heartbeat
            await asyncio.sleep(5)
            await websocket.send_text(json.dumps({
                "type": "heartbeat",
                "timestamp": datetime.now().isoformat(),
                "event_count": file_monitor.event_count if file_monitor else 0,
                "attack_count": file_monitor.attack_count if file_monitor else 0,
                "snapshots": len(snapshot_engine.snapshots) if snapshot_engine else 0,
                "uptime_seconds": round(time.time() - start_time),
            }))
    except WebSocketDisconnect:
        # The broadcast loop may already have removed a dead socket; guard
        # against double-removal.
        try:
            connected_clients.remove(websocket)
        except ValueError:
            pass
        logger.info(f"Client disconnected. Total: {len(connected_clients)}")


# ── REST endpoints ────────────────────────────────────────────────────────
@app.get("/status")
async def get_status():
    return {
        "status": "protected",
        "uptime_seconds": round(time.time() - start_time),
        "monitored_dir": MONITORED_DIR,
        "hospital": HOSPITAL_NAME,
        "event_count": file_monitor.event_count if file_monitor else 0,
        "attack_count": file_monitor.attack_count if file_monitor else 0,
        "snapshot_count": len(snapshot_engine.snapshots) if snapshot_engine else 0,
        "latest_snapshot": snapshot_engine.latest_snapshot() if snapshot_engine else None,
    }


@app.get("/attacks")
async def get_attacks():
    return {"attacks": attack_log}


@app.get("/snapshots")
async def get_snapshots():
    if not snapshot_engine:
        return {"snapshots": []}
    return {"snapshots": snapshot_engine.get_snapshots()}


@app.get("/audit")
async def get_audit():
    """Hash-chain integrity status + most recent entries."""
    if not audit_log:
        return {"valid": False, "entries": 0, "reason": "audit log not initialized"}
    status = audit_log.verify()
    status["recent"] = audit_log.recent(5)
    return status


@app.get("/canaries")
async def get_canaries():
    return {"canaries": canary_manager.snapshot() if canary_manager else []}


@app.get("/network")
async def get_network():
    """Nationwide simulated hospital network: nodes, statuses, fingerprint
    broadcasts and the threat-intel dissemination log."""
    if not network_sim:
        return {"nodes": [], "counts": {}, "broadcasts": [], "events": []}
    return network_sim.snapshot()


@app.post("/network/campaign")
async def start_network_campaign(payload: dict = Body(default=None)):
    """
    Start a deterministic, scripted campaign for the map demo. Body (both
    optional): {acts: [{at, sweep_ms?, targets? | count?+regions?}],
    seed: int}. `sweep_ms` tunes how long the dashboard's region-target
    lock-on plays before each act lands (default 4000). With a seed, every
    replay hits the same hospitals in the same order.
    """
    if not network_sim:
        return JSONResponse({"error": "Network sim not initialized"}, status_code=503)
    payload = payload or {}
    plan = network_sim.start_campaign(
        acts=payload.get("acts"),
        seed=payload.get("seed"),
    )
    # Immediate push so the dashboard reflects the campaign state right away.
    await broadcast({"type": "network_update", "network": network_sim.snapshot()})
    return plan


@app.post("/network/campaign/stop")
async def stop_network_campaign():
    if not network_sim:
        return JSONResponse({"error": "Network sim not initialized"}, status_code=503)
    network_sim.stop_campaign()
    await broadcast({"type": "network_update", "network": network_sim.snapshot()})
    return {"status": "stopped"}


# ── Demo Orchestration Endpoints ──────────────────────────────────────────
demo_process = None

@app.post("/api/v1/demo/start")
async def start_demo():
    global demo_process
    if demo_process and demo_process.poll() is None:
        return JSONResponse({"error": "Demo already running"}, status_code=400)
    
    script_path = REPO_ROOT / "demo" / "simulate_ransomware.py"
    demo_process = subprocess.Popen(["python", str(script_path)])
    
    await broadcast({"type": "demo_started"})
    return {"status": "demo_started"}


@app.post("/api/v1/demo/reset")
async def reset_demo():
    global demo_process
    if demo_process and demo_process.poll() is None:
        demo_process.terminate()
        demo_process.wait()
    
    script_path = REPO_ROOT / "demo" / "simulate_ransomware.py"
    subprocess.run(["python", str(script_path), "--reset"], check=True)
    
    await broadcast({"type": "demo_reset"})
    return {"status": "demo_reset"}


@app.post("/api/v1/alert")
async def java_alert(payload: dict):
    """
    Alert from the Java detection engine. The engine has already detected the
    attack and terminated the process chain; this endpoint runs the shared
    response pipeline (rollback, WebSocket broadcast, audit entry).
    """
    if not file_monitor:
        return JSONResponse({"error": "Monitor not initialized"}, status_code=503)
    event = file_monitor.respond_to_java_alert(payload)
    if event is None:
        return {"status": "suppressed", "message": "An incident is already being handled."}
    logger.info(f"[JAVA-ALERT] incident #{event['attack_id']} handled (score {event['threat_score']})")
    return {"status": "ok", "attack_id": event["attack_id"]}


@app.post("/snapshot/manual")
async def manual_snapshot():
    if not snapshot_engine:
        return JSONResponse({"error": "Snapshot engine not running"}, status_code=503)
    snap = snapshot_engine.take_snapshot()
    await broadcast({"type": "snapshot_taken", "snapshot": snap})
    return snap


@app.post("/rollback/manual")
async def manual_rollback():
    if not snapshot_engine:
        return JSONResponse({"error": "Snapshot engine not running"}, status_code=503)
    result = snapshot_engine.rollback()
    await broadcast({"type": "rollback_complete", "rollback": result})
    return result


@app.post("/report/{attack_id}")
async def generate_report(attack_id: int):
    # Find the attack event
    event = next((a for a in attack_log if a.get("attack_id") == attack_id), None)
    if not event:
        # If no real attack, create demo event for testing
        event = {
            "attack_id": attack_id,
            "filepath": f"{MONITORED_DIR}/patient_records.encrypted",
            "entropy": 7.89,
            "threat_score": 85,
            "reasons": ["High entropy (7.89/8.0)", "Known ransomware extension (.encrypted)"],
            "freeze_results": [],
            "ransom_note": {
                "gang": "DarkReaper Ransomware Group",
                "btc_address": "1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW",
                "amount_btc": 5.0,
                "contact": "decrypt@darknet.onion",
                "deadline_hours": 72,
                "file": f"{MONITORED_DIR}/READ_ME_NOW.txt",
            },
            "rollback": {
                "success": True,
                "snapshot_name": "snap_demo",
                "snapshot_timestamp": datetime.now().isoformat(),
                "files_restored": 42,
                "duration_seconds": 14.3,
                "infected_backup": "./snapshots/INFECTED_demo",
                "integrity": {
                    "verified": 42, "missing": 0, "mismatch": 0, "extra": 0,
                    "ok": True, "manifest": "snap_demo.manifest.json", "verify_seconds": 0.02,
                },
            },
        }

    ai_summary = generate_incident_summary(event, HOSPITAL_NAME)
    audit_status = audit_log.verify() if audit_log else {"valid": False, "entries": 0}
    pdf_bytes = generate_pdf_report(event, ai_summary, HOSPITAL_NAME, audit_status=audit_status)

    filename = f"RansomShield_Incident_{attack_id:03d}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/report/demo")
async def demo_report():
    """Generate a demo report without needing a real attack."""
    demo_event = {
        "attack_id": 1,
        "filepath": f"{MONITORED_DIR}/patient_data/aadhaar_records.locked",
        "entropy": 7.92,
        "threat_score": 85,
        "reasons": [
            "High entropy (7.92/8.0) — file appears encrypted",
            "Known ransomware extension: .locked",
            "Rapid file modification: 12 files in 10s",
        ],
        "freeze_results": [
            {"pid": 4821, "name": "python.exe", "success": True, "message": "Process frozen."}
        ],
        "ransom_note": {
            "gang": "DarkReaper Ransomware Group",
            "btc_address": "1A2b3C4d5E6f7G8h9I0jKLMnopQRSTUVW",
            "amount_btc": 5.0,
            "contact": "decrypt@darknet.onion",
            "deadline_hours": 72,
            "file": f"{MONITORED_DIR}/READ_ME_NOW.txt",
        },
        "rollback": {
            "success": True,
            "snapshot_name": "snap_20240915_143022",
            "snapshot_timestamp": "2024-09-15T14:30:22",
            "files_restored": 87,
            "duration_seconds": 11.4,
            "infected_backup": "./snapshots/INFECTED_20240915_143055",
            "integrity": {
                "verified": 87, "missing": 0, "mismatch": 0, "extra": 0,
                "ok": True, "manifest": "snap_20240915_143022.manifest.json", "verify_seconds": 0.03,
            },
        },
    }
    ai_summary = generate_incident_summary(demo_event, HOSPITAL_NAME)
    audit_status = audit_log.verify() if audit_log else {"valid": False, "entries": 0}
    pdf_bytes = generate_pdf_report(demo_event, ai_summary, HOSPITAL_NAME, audit_status=audit_status)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=RansomShield_Demo_Report.pdf"},
    )
