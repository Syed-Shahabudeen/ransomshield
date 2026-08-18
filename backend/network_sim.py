"""
network_sim.py — Simulated Nationwide Hospital Network

Models a country-wide federation of hospitals connected through the
RansomShield threat-intelligence channel. After a confirmed incident at the
monitored facility, an ANONYMIZED attack fingerprint (a SHA-256 hash derived
from observable indicators — entropy bucket, ransom extension, decoy signal —
never file contents or patient data) is broadcast to every node in the
network. The simulation then plays out the campaign:

  * at-risk nodes get hit by the same campaign and are auto-quarantined,
  * nodes that hold the fingerprint in their intel store recognize the
    pattern and block before damage,
  * quarantined nodes recover automatically once the intel is validated.

This is the "threat intelligence dissemination" story of the demo: the
incident at the monitored hospital protects the rest of the country.

State lives in a thread with a lock; the sim pushes `network_update`
WebSocket messages to the dashboard whenever something changes, and the
backend exposes the full state via GET /network.
"""

import asyncio
import hashlib
import json
import logging
import random
import threading
import time
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("ransomshield.network")

# Node lifecycle windows (seconds)
ATTACK_WINDOW = 6.0       # attacked -> quarantined (no intel) or protected (intel match)
QUARANTINE_WINDOW = 22.0  # quarantined -> recovered (auto-contained, offscreen rollback)
RECOVER_WINDOW = 18.0     # recovered -> protected (intel retained)

# Background noise: chance per tick that some OTHER hospital gets probed by
# the same campaign (keeps the map alive between local incidents).
PROBE_PROBABILITY = 0.04
SPREAD_TARGETS = 3        # nodes auto-quarantined after a local incident

# Lock-on animation window before a campaign act lands (milliseconds).
# Per-act overridable via `sweep_ms` in the campaign payload, so demo
# operators can tune how long the map sweeps the target region(s) first.
DEFAULT_SWEEP_MS = 4000
MIN_SWEEP_MS = 500
MAX_SWEEP_MS = 30000

# Default scripted campaign for the deterministic demo mode. Each act fires
# `at` seconds after the campaign starts and hits either an explicit target
# list or `count` nodes drawn deterministically (seeded) from `regions`.
DEFAULT_CAMPAIGN = [
    {"at": 8, "targets": ["fortis-noida", "sms-jaipur"]},
    {"at": 26, "regions": ["south"], "count": 2},
    {"at": 48, "regions": ["east", "northeast"], "count": 3},
]


# ── Nationwide node catalog ────────────────────────────────────────────────
# (id, name, city, state, region, lat, lon, beds, tier, security)
NODES = [
    # north
    ("hq-delhi", "AIIMS Delhi (Monitored)", "New Delhi", "Delhi", "north", 28.61, 77.21, 2400, 1, 93),
    ("pgimer-chd", "PGIMER Chandigarh", "Chandigarh", "Chandigarh", "north", 30.74, 76.77, 1800, 1, 88),
    ("sgpgi-lko", "SGPGIMS Lucknow", "Lucknow", "Uttar Pradesh", "north", 26.85, 80.94, 950, 1, 86),
    ("sms-jaipur", "SMS Jaipur", "Jaipur", "Rajasthan", "north", 26.90, 75.80, 1200, 1, 84),
    ("fortis-noida", "Fortis Noida", "Noida", "Uttar Pradesh", "north", 28.57, 77.32, 420, 2, 80),
    ("dist-karnal", "District Hospital Karnal", "Karnal", "Haryana", "north", 29.69, 76.98, 350, 3, 64),
    # west
    ("aims-jodhpur", "AIIMS Jodhpur", "Jodhpur", "Rajasthan", "west", 26.24, 73.03, 960, 1, 85),
    ("kem-mum", "KEM Hospital Mumbai", "Mumbai", "Maharashtra", "west", 19.01, 72.84, 1800, 1, 87),
    ("civil-ahm", "Civil Hospital Ahmedabad", "Ahmedabad", "Gujarat", "west", 23.03, 72.57, 750, 1, 82),
    ("nair-mum", "Nair Hospital Mumbai", "Mumbai", "Maharashtra", "west", 18.97, 72.83, 620, 2, 74),
    ("gh-surat", "Civil Surat", "Surat", "Gujarat", "west", 21.17, 72.83, 480, 2, 72),
    # central
    ("aims-bhopal", "AIIMS Bhopal", "Bhopal", "Madhya Pradesh", "central", 23.20, 77.43, 900, 1, 84),
    ("aims-raipur", "AIIMS Raipur", "Raipur", "Chhattisgarh", "central", 21.23, 81.63, 750, 1, 83),
    ("jnmc-wardha", "JNMC Wardha", "Wardha", "Maharashtra", "central", 20.90, 78.87, 800, 2, 76),
    # south
    ("nims-hyd", "NIMS Hyderabad", "Hyderabad", "Telangana", "south", 17.41, 78.47, 1400, 1, 86),
    ("kims-blr", "KIMS Bengaluru", "Bengaluru", "Karnataka", "south", 12.94, 77.61, 1100, 1, 85),
    ("cmc-vellore", "CMC Vellore", "Vellore", "Tamil Nadu", "south", 12.92, 79.13, 2200, 1, 90),
    ("apollo-chennai", "Apollo Chennai", "Chennai", "Tamil Nadu", "south", 13.06, 80.24, 700, 1, 84),
    ("amrita-kochi", "Amrita Kochi", "Kochi", "Kerala", "south", 10.03, 76.29, 900, 1, 85),
    ("ggh-vijay", "Guntur General Hospital", "Vijayawada", "Andhra Pradesh", "south", 16.51, 80.65, 620, 2, 71),
    # east
    ("sskm-kolkata", "SSKM Kolkata", "Kolkata", "West Bengal", "east", 22.54, 88.35, 1900, 1, 87),
    ("aims-patna", "AIIMS Patna", "Patna", "Bihar", "east", 25.59, 85.14, 1000, 1, 85),
    ("aims-bbsr", "AIIMS Bhubaneswar", "Bhubaneswar", "Odisha", "east", 20.26, 85.82, 800, 1, 84),
    ("gimsr-vizag", "GIMSR Visakhapatnam", "Visakhapatnam", "Andhra Pradesh", "east", 17.69, 83.21, 540, 2, 73),
    # northeast
    ("gmch-guwahati", "GMCH Guwahati", "Guwahati", "Assam", "northeast", 26.14, 91.74, 900, 1, 82),
    ("rims-imphal", "RIMS Imphal", "Imphal", "Manipur", "northeast", 24.81, 93.94, 700, 2, 70),
    ("aims-dibrugarh", "AIIMS Dibrugarh", "Dibrugarh", "Assam", "northeast", 27.47, 94.91, 550, 2, 71),
    ("jln-shillong", "JLN Shillong", "Shillong", "Meghalaya", "northeast", 25.57, 91.88, 480, 2, 68),
]

REGION_LABELS = {
    "north": "NORTH",
    "west": "WEST",
    "central": "CENTRAL",
    "south": "SOUTH",
    "east": "EAST",
    "northeast": "NORTHEAST",
}

STATUS_LABELS = {
    "protected": "Protected",
    "attacked": "Under attack",
    "quarantined": "Quarantined",
    "recovered": "Recovered",
}


def make_fingerprint(event: dict) -> str:
    """
    Anonymized campaign fingerprint: SHA-256 of *observable indicators only*
    (entropy bucket, ransom extension, decoy signal, score band). Stable for
    the same campaign, so a later matching attack is recognized as known
    intel — without ever hashing file contents or patient data.
    """
    ext = Path(str(event.get("filepath", ""))).suffix.lower() or "unknown"
    raw = json.dumps({
        "entropy": round(float(event.get("entropy") or 0), 1),
        "ext": ext,
        "canary": bool(event.get("canary_triggered")),
        "score": (int(event.get("threat_score") or 0) // 10) * 10,
    }, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def short_fp(fp: str) -> str:
    return f"{fp[:6]}…{fp[-2:]}" if fp else "—"


class NetworkSim:
    def __init__(
        self,
        source_node_id: str = "hq-delhi",
        broadcast_fn=None,
        loop: asyncio.AbstractEventLoop | None = None,
        tick: float = 2.0,
        seed: int | None = None,
    ):
        self.source_node_id = source_node_id
        self.broadcast_fn = broadcast_fn   # async fn(message: dict) — WS push
        self.loop = loop
        self.tick = tick
        self._seed = seed
        # Seeded RNG makes the background probes reproducible; without a seed
        # the module-level (unseeded) random is used as before.
        self._rng = random.Random(seed) if seed is not None else random

        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._dirty = False

        self.nodes: list[dict] = []
        self.intel_store: dict[str, dict] = {}   # fingerprint -> meta
        self.broadcasts: list[dict] = []          # fingerprint broadcasts (newest last)
        self.network_events: list[dict] = []      # sim-side events (newest last)
        self.campaign: dict | None = None         # deterministic scripted campaign
        self._boot_ts = time.time()
        self._init_nodes()

    # ── setup ────────────────────────────────────────────────────────────
    def _init_nodes(self):
        ts = time.time()
        self.nodes = []
        for nid, name, city, state, region, lat, lon, beds, tier, security in NODES:
            self.nodes.append({
                "id": nid,
                "name": name,
                "city": city,
                "state": state,
                "region": region,
                "lat": lat,
                "lon": lon,
                "beds": beds,
                "tier": tier,
                "security": security,
                "monitored": nid == self.source_node_id,
                "hit_by": None,
                "status": "protected",
                "intel": [],            # fingerprint hashes held by this node
                "status_since": ts,
                "attacked_at": None,
                "quarantined_at": None,
                "recovered_at": None,
            })

    def _node(self, nid: str) -> dict | None:
        return next((n for n in self.nodes if n["id"] == nid), None)

    # ── lifecycle ────────────────────────────────────────────────────────
    def start(self):
        if self._thread:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="network-sim")
        self._thread.start()
        logger.info(f"[NETWORK] sim started — {len(self.nodes)} hospitals, source={self.source_node_id}, seed={self._seed}")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)

    def _loop(self):
        while self._running:
            time.sleep(self.tick)
            try:
                self._tick()
            except Exception:
                logger.exception("[NETWORK] tick failed")

    # ── broadcast push over WebSocket ────────────────────────────────────
    def _push(self):
        """Schedule a network_update message to connected dashboards."""
        if not self.broadcast_fn or not self.loop:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self.broadcast_fn({"type": "network_update", "network": self.snapshot()}),
                self.loop,
            )
        except Exception:
            logger.exception("[NETWORK] push failed")

    # ── incident hook (called by the shared response pipeline) ───────────
    def broadcast_fingerprint(self, event: dict) -> dict:
        """
        After a confirmed incident, derive the anonymized fingerprint and
        broadcast it to the whole network. Simulates the campaign spreading:
        at-risk nodes are hit (quarantined), everyone else stores the intel.
        Returns the broadcast record (attached to the incident event).
        """
        fp = make_fingerprint(event)
        ts = time.time()
        with self._lock:
            src = self._node(self.source_node_id)
            # Every node receives and stores the fingerprint (threat intel).
            for n in self.nodes:
                if fp not in n["intel"]:
                    n["intel"].append(fp)
            # The campaign hits the most at-risk nodes (region-biased toward
            # the source so the map shows a believable spread pattern).
            candidates = [n for n in self.nodes if not n["monitored"]]
            candidates.sort(key=lambda n: (-n["security"], n["region"] != src["region"]))
            targets = candidates[:SPREAD_TARGETS]
            target_ids = [t["id"] for t in targets]
            for t in targets:
                t["status"] = "attacked"
                t["status_since"] = ts
                t["attacked_at"] = ts
                t["hit_by"] = "campaign"   # quarantines regardless of intel

            record = {
                "fingerprint": fp,
                "short": short_fp(fp),
                "ts": ts,
                "attack_id": event.get("attack_id"),
                "source_node": src["id"],
                "source_name": src["name"],
                "nodes_reached": len(self.nodes),
                "targets": target_ids,
                "target_names": [t["name"] for t in targets],
                "known": fp in self.intel_store,
            }
            # Attacker-visible intel from the demand note rides along with the
            # (anonymized) fingerprint — the note is attacker content, so
            # sharing the gang/wallet/deadline keeps the mesh useful without
            # ever touching patient data.
            note = event.get("ransom_note") or {}
            if note and any(note.get(k) for k in ("gang", "btc_address", "amount_btc", "deadline_hours", "contact")):
                record["note_intel"] = {
                    "gang": note.get("gang"),
                    "btc_address": note.get("btc_address"),
                    "amount_btc": note.get("amount_btc"),
                    "deadline_hours": note.get("deadline_hours"),
                    "contact": note.get("contact"),
                }
            if fp not in self.intel_store:
                self.intel_store[fp] = {
                    "first_seen": ts,
                    "source_node": src["id"],
                    "nodes_armed": len(self.nodes),
                }
                self.broadcasts.append(record)
            note_gang = (event.get("ransom_note") or {}).get("gang")
            gang_suffix = f" — ransom note attributes the attack to {note_gang}" if note_gang else ""
            self._log_event(ts, "fingerprint_broadcast",
                            f"Fingerprint {record['short']} broadcast to {len(self.nodes)} hospitals — "
                            f"{len(target_ids)} at-risk nodes hit{gang_suffix}")
            self._dirty = True

        self._push()
        logger.info(f"[NETWORK] fingerprint {record['short']} broadcast — {len(self.nodes)} nodes reached")
        return record

    # ── deterministic scripted campaign ──────────────────────────────────
    def start_campaign(self, acts: list | None = None, seed: int | None = None) -> dict:
        """
        Start a deterministic, scripted campaign for the map demo. `acts` is
        a list of {at, sweep_ms?, targets? | count?+regions?} — each act
        fires `at` seconds after start and hits its targets (explicit ids, or
        `count` nodes drawn from `regions` with a seeded RNG so every replay
        is identical). `sweep_ms` (default DEFAULT_SWEEP_MS) tunes how long
        the dashboard's lock-on sweep plays before the hit lands. Defaults to
        DEFAULT_CAMPAIGN. Returns the plan.
        """
        ts = time.time()
        with self._lock:
            acts = list(acts) if acts else list(DEFAULT_CAMPAIGN)
            plan = []
            for i, a in enumerate(acts):
                plan.append({
                    "index": i,
                    "at": float(a.get("at", 0)),
                    "sweep_ms": min(max(int(a.get("sweep_ms", DEFAULT_SWEEP_MS)), MIN_SWEEP_MS), MAX_SWEEP_MS),
                    "targets": list(a.get("targets") or []),
                    "count": int(a.get("count", 1)),
                    "regions": list(a.get("regions") or []),
                    "fired": False,
                    "fired_at": None,
                    "hits": [],
                })
            self.campaign = {
                "active": True,
                "seed": seed,
                "started_at": ts,
                "rng": random.Random(seed) if seed is not None else random,
                "acts": plan,
            }
            self._log_event(ts, "campaign",
                            f"Deterministic campaign started (seed={seed}) — {len(plan)} scripted acts")
            self._dirty = True
        self._push()
        logger.info(f"[NETWORK] campaign started (seed={seed}) — {len(plan)} acts")
        return self._campaign_snapshot()

    def stop_campaign(self):
        with self._lock:
            if self.campaign and self.campaign["active"]:
                self.campaign["active"] = False
                self._log_event(time.time(), "campaign", "Campaign stopped — network calm")
                self._dirty = True
        self._push()

    def _fire_campaign_act(self, act: dict, now: float) -> list[str]:
        """Resolve and apply one campaign act; returns hit node ids."""
        if act.get("targets"):
            ids = act["targets"]
        else:
            regions = act.get("regions") or []
            count = act.get("count", 1)
            pool = [n for n in self.nodes
                    if not n["monitored"]
                    and n["status"] == "protected"
                    and (not regions or n["region"] in regions)]
            pool.sort(key=lambda n: n["id"])
            chosen = pool[:]
            self.campaign["rng"].shuffle(chosen)   # seeded -> reproducible
            ids = [n["id"] for n in chosen[:count]]
        hits = []
        for nid in ids:
            n = self._node(nid)
            if not n or n["monitored"] or n["status"] != "protected":
                continue
            n["status"] = "attacked"
            n["status_since"] = now
            n["attacked_at"] = now
            n["hit_by"] = "campaign"
            hits.append(nid)
        return hits

    def _campaign_snapshot(self) -> dict:
        c = self.campaign
        if not c:
            return {"active": False}
        return {
            "active": c["active"],
            "seed": c["seed"],
            "started_at": c["started_at"],
            "elapsed": round(time.time() - c["started_at"], 1) if c["active"] else None,
            "acts": [{
                "index": a["index"],
                "at": a["at"],
                "sweep_ms": a["sweep_ms"],
                "targets": a["targets"],
                "count": a["count"],
                "regions": a["regions"],
                "fired": a["fired"],
                "fired_at": a["fired_at"],
                "hits": a["hits"],
            } for a in c["acts"]],
        }

    # ── background dynamics ──────────────────────────────────────────────
    def _tick(self):
        changed = False
        now = time.time()
        with self._lock:
            # attacked -> quarantined (containment) or, for a probe at an
            # already-armed node, blocked outright (fingerprint match).
            for n in self.nodes:
                if n["status"] == "attacked" and n["attacked_at"] and now - n["attacked_at"] > ATTACK_WINDOW:
                    if n.get("hit_by") == "probe" and n["intel"]:
                        n["status"] = "protected"
                        n["status_since"] = now
                        self._log_event(now, "blocked",
                                        f"{n['name']} blocked campaign — fingerprint matched intel store")
                    else:
                        n["status"] = "quarantined"
                        n["status_since"] = now
                        n["quarantined_at"] = now
                        self._log_event(now, "quarantined",
                                        f"{n['name']} auto-quarantined — campaign confirmed")
                    changed = True

            # quarantined -> recovered (auto-contained, rolled back)
            for n in self.nodes:
                if n["status"] == "quarantined" and n["quarantined_at"] and now - n["quarantined_at"] > QUARANTINE_WINDOW:
                    n["status"] = "recovered"
                    n["status_since"] = now
                    n["recovered_at"] = now
                    self._log_event(now, "recovered",
                                    f"{n['name']} recovered — snapshot rollback complete")
                    changed = True

            # recovered -> protected
            for n in self.nodes:
                if n["status"] == "recovered" and n["recovered_at"] and now - n["recovered_at"] > RECOVER_WINDOW:
                    n["status"] = "protected"
                    n["status_since"] = now
                    changed = True

            # scripted campaign acts fire on schedule (seeded, reproducible)
            if self.campaign and self.campaign["active"]:
                elapsed = now - self.campaign["started_at"]
                for act in self.campaign["acts"]:
                    if act["fired"] or elapsed < act["at"]:
                        continue
                    hits = self._fire_campaign_act(act, now)
                    act["fired"] = True
                    act["fired_at"] = now
                    act["hits"] = hits
                    names = ", ".join(self._node(h)["name"] for h in hits if self._node(h)) or "none"
                    self._log_event(now, "campaign_act",
                                    f"Campaign act #{act['index'] + 1}: {len(hits)} hospital(s) hit — {names}")
                    changed = True

            # background noise: the same campaign probes another hospital
            if self._rng.random() < PROBE_PROBABILITY:
                pool = [n for n in self.nodes if not n["monitored"] and n["status"] == "protected"]
                if pool:
                    n = self._rng.choice(pool)
                    n["status"] = "attacked"
                    n["status_since"] = now
                    n["attacked_at"] = now
                    n["hit_by"] = "probe"
                    self._log_event(now, "probe",
                                    f"Campaign probe at {n['name']} — monitoring…")
                    changed = True

            if changed:
                self._dirty = True

        if changed:
            self._push()

    # ── helpers ──────────────────────────────────────────────────────────
    def _log_event(self, ts: float, kind: str, text: str):
        self.network_events.append({
            "ts": ts,
            "kind": kind,
            "text": text,
            "time": datetime.fromtimestamp(ts).strftime("%H:%M:%S"),
        })
        if len(self.network_events) > 40:
            del self.network_events[:-40]

    def _counts(self) -> dict:
        counts = {s: 0 for s in STATUS_LABELS}
        for n in self.nodes:
            counts[n["status"]] = counts.get(n["status"], 0) + 1
        return counts

    # ── full state for GET /network and the dashboard ────────────────────
    def snapshot(self) -> dict:
        with self._lock:
            nodes = []
            for n in self.nodes:
                nodes.append({
                    "id": n["id"],
                    "name": n["name"],
                    "city": n["city"],
                    "state": n["state"],
                    "region": n["region"],
                    "lat": n["lat"],
                    "lon": n["lon"],
                    "beds": n["beds"],
                    "tier": n["tier"],
                    "security": n["security"],
                    "monitored": n["monitored"],
                    "status": n["status"],
                    "intel_count": len(n["intel"]),
                    "status_since": n["status_since"],
                })
            return {
                "source_node_id": self.source_node_id,
                "generated_at": datetime.now().isoformat(),
                "uptime_seconds": round(time.time() - self._boot_ts),
                "nodes": nodes,
                "counts": self._counts(),
                "intel_fingerprints": len(self.intel_store),
                # Keep a longer broadcast history so the dashboard's replay/
                # scrub timeline has a real span to animate (newest first).
                "broadcasts": list(reversed(self.broadcasts[-20:])),
                "events": list(reversed(self.network_events[-12:])),
                "campaign": self._campaign_snapshot(),
            }


if __name__ == "__main__":
    """Headless demo: run the sim with a seeded campaign and print the
    timeline, so reproducibility can be checked (same seed → same output).

        python backend/network_sim.py --seed 42 --ticks 60
    """
    import argparse

    parser = argparse.ArgumentParser(description="Headless RansomShield network-sim demo")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--ticks", type=int, default=60)
    args = parser.parse_args()

    sim = NetworkSim(seed=args.seed)
    sim.start()
    plan = sim.start_campaign(seed=args.seed)
    print(f"campaign plan (seed={args.seed}):")
    for a in plan["acts"]:
        targets = a["targets"] or f"{a['count']} from {a['regions'] or 'any region'}"
        print(f"  act {a['index'] + 1}: at {a['at']:>2}s -> {targets}")
    try:
        for i in range(args.ticks):
            time.sleep(1)
            snap = sim.snapshot()
            hits = [f"{n['id']}={n['status'][:4]}" for n in snap["nodes"] if n["status"] != "protected"]
            acts = [(a["index"] + 1, a["fired"]) for a in snap["campaign"]["acts"]]
            print(f"t={i + 1:>3}s acts={acts} " + (" ".join(hits) if hits else "all protected"))
    finally:
        sim.stop()
