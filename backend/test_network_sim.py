"""Tests for network_sim.py — fingerprint stability, quarantine lifecycle,
and known-campaign dedup."""

import random as _random
import time

from network_sim import (
    ATTACK_WINDOW,
    QUARANTINE_WINDOW,
    RECOVER_WINDOW,
    SPREAD_TARGETS,
    PROBE_PROBABILITY,
    DEFAULT_SWEEP_MS,
    NODES,
    make_fingerprint,
    short_fp,
    NetworkSim,
)

# A seed whose first ticks never roll the random background probe
# (rng.random() < PROBE_PROBABILITY), so scheduler tests can assert on
# pools / containment without the probe stealing nodes from them.
PROBE_FREE_SEED = next(
    s for s in range(1, 300)
    if all(_random.Random(s).random() >= PROBE_PROBABILITY for _ in range(8))
)


# ── fixtures ──────────────────────────────────────────────────────────────

def make_sim(**kwargs):
    """A sim with the background thread disabled — ticks are driven manually,
    so the lifecycle tests are deterministic (no real timers)."""
    return NetworkSim(tick=9999.0, **kwargs)


def make_event(**overrides):
    event = {
        "attack_id": "atk-1",
        "filepath": "C:\\hospital\\000_urgent_rounds_notes.doc",
        "entropy": 8.0,
        "canary_triggered": True,
        "threat_score": 55,
    }
    event.update(overrides)
    return event


def attack_node(sim, nid, hit_by="campaign", with_intel=True):
    n = sim._node(nid)
    assert n is not None, f"no such node {nid}"
    n["status"] = "attacked"
    n["attacked_at"] = time.time() - (ATTACK_WINDOW + 1)  # past the window
    n["hit_by"] = hit_by
    if with_intel:
        n["intel"] = ["fp-armed"]
    return n


def node_region(nid):
    """Region of a node id from the static NODES catalog (id is column 0,
    region column 4)."""
    for row in NODES:
        if row[0] == nid:
            return row[4]
    return None


# ── fingerprint stability ─────────────────────────────────────────────────

class TestFingerprintStability:
    def test_same_event_same_fingerprint(self):
        assert make_fingerprint(make_event()) == make_fingerprint(make_event())

    def test_equivalent_events_same_fingerprint(self):
        """Anonymization: different filepaths with the same observable
        indicators hash identically — contents/names never enter the hash."""
        a = make_event(filepath="C:\\siteA\\000_urgent_rounds_notes.doc")
        b = make_event(filepath="D:\\siteB\\other_folder\\2024_Q3_billing.doc")
        assert make_fingerprint(a) == make_fingerprint(b)

    def test_entropy_bucket_absorbs_small_noise(self):
        """Entropy rounds to 1 decimal — detector noise within a bucket must
        not change the campaign identity."""
        assert make_fingerprint(make_event(entropy=8.04)) == \
               make_fingerprint(make_event(entropy=7.96))
        assert make_fingerprint(make_event(entropy=8.04)) == \
               make_fingerprint(make_event(entropy=8.0))

    def test_entropy_bucket_differentiates_distinct_campaigns(self):
        assert make_fingerprint(make_event(entropy=8.0)) != \
               make_fingerprint(make_event(entropy=4.0))

    def test_score_band_absorbs_small_noise(self):
        assert make_fingerprint(make_event(threat_score=55)) == \
               make_fingerprint(make_event(threat_score=59))
        assert make_fingerprint(make_event(threat_score=55)) != \
               make_fingerprint(make_event(threat_score=61))

    def test_extension_participates(self):
        assert make_fingerprint(make_event(filepath="a.txt")) != \
               make_fingerprint(make_event(filepath="a.lock"))

    def test_canary_signal_participates(self):
        assert make_fingerprint(make_event(canary_triggered=True)) != \
               make_fingerprint(make_event(canary_triggered=False))

    def test_missing_fields_are_stable_and_short_fp(self):
        fp = make_fingerprint({"attack_id": "x"})
        assert len(fp) == 64
        assert short_fp(fp) == f"{fp[:6]}…{fp[-2:]}"
        assert short_fp("") == "—"


# ── quarantine lifecycle transitions ──────────────────────────────────────

class TestQuarantineTransitions:
    def test_attacked_to_quarantined(self):
        sim = make_sim()
        attack_node(sim, "fortis-noida", hit_by="campaign")
        sim._tick()
        assert sim._node("fortis-noida")["status"] == "quarantined"
        assert sim._node("fortis-noida")["quarantined_at"] is not None

    def test_attacked_does_not_quarantine_before_window(self):
        sim = make_sim()
        n = sim._node("fortis-noida")
        n["status"] = "attacked"
        n["attacked_at"] = time.time()  # just now — inside ATTACK_WINDOW
        n["hit_by"] = "campaign"
        sim._tick()
        assert n["status"] == "attacked"

    def test_quarantined_to_recovered(self):
        sim = make_sim()
        n = sim._node("fortis-noida")
        n["status"] = "quarantined"
        n["quarantined_at"] = time.time() - (QUARANTINE_WINDOW + 1)
        sim._tick()
        assert n["status"] == "recovered"
        assert n["recovered_at"] is not None

    def test_recovered_to_protected(self):
        sim = make_sim()
        n = sim._node("fortis-noida")
        n["status"] = "recovered"
        n["recovered_at"] = time.time() - (RECOVER_WINDOW + 1)
        sim._tick()
        assert n["status"] == "protected"

    def test_full_lifecycle(self):
        """protected → attacked → quarantined → recovered → protected,
        driven entirely by manual ticks (no sleeps)."""
        sim = make_sim()
        nid = "fortis-noida"
        n = sim._node(nid)
        assert n["status"] == "protected"

        attack_node(sim, nid, hit_by="campaign")
        sim._tick()
        assert sim._node(nid)["status"] == "quarantined"

        sim._node(nid)["quarantined_at"] = time.time() - (QUARANTINE_WINDOW + 1)
        sim._tick()
        assert sim._node(nid)["status"] == "recovered"

        sim._node(nid)["recovered_at"] = time.time() - (RECOVER_WINDOW + 1)
        sim._tick()
        assert sim._node(nid)["status"] == "protected"

    def test_probe_at_armed_node_is_blocked_not_quarantined(self):
        """A probe hitting a node that already holds the fingerprint is
        blocked outright (intel match) — no quarantine phase."""
        sim = make_sim()
        nid = "kem-mum"
        attack_node(sim, nid, hit_by="probe", with_intel=True)
        sim._tick()
        assert sim._node(nid)["status"] == "protected"
        blocked = [e for e in sim.network_events if e["kind"] == "blocked"]
        assert len(blocked) == 1
        assert "fingerprint matched intel store" in blocked[0]["text"]

    def test_probe_without_intel_quarantines(self):
        """A probe at a node with no stored intel is treated like any attack."""
        sim = make_sim()
        nid = "kem-mum"
        attack_node(sim, nid, hit_by="probe", with_intel=False)
        sim._tick()
        assert sim._node(nid)["status"] == "quarantined"

    def test_recovery_keeps_intel(self):
        """Intel survives the lifecycle — a recovered node stays armed."""
        sim = make_sim()
        nid = "ggh-vijay"
        attack_node(sim, nid, hit_by="campaign")
        sim._tick()  # -> quarantined
        sim._node(nid)["quarantined_at"] = time.time() - (QUARANTINE_WINDOW + 1)
        sim._tick()  # -> recovered
        assert sim._node(nid)["status"] == "recovered"
        assert sim._node(nid)["intel"] == ["fp-armed"]


# ── known-campaign dedup / broadcast ──────────────────────────────────────

class TestKnownCampaignDedup:
    def test_first_broadcast_unknown_and_arms_all_nodes(self):
        sim = make_sim()
        rec = sim.broadcast_fingerprint(make_event())
        assert rec["known"] is False
        assert rec["nodes_reached"] == len(sim.nodes)
        assert len(sim.intel_store) == 1
        assert sim.snapshot()["intel_fingerprints"] == 1
        # every node holds the intel
        assert all(len(n["intel"]) == 1 for n in sim.nodes)

    def test_same_fingerprint_is_known_and_not_duplicated(self):
        sim = make_sim()
        sim.broadcast_fingerprint(make_event())
        rec2 = sim.broadcast_fingerprint(make_event(attack_id="atk-2"))
        assert rec2["known"] is True
        assert rec2["fingerprint"] == sim.broadcasts[0]["fingerprint"]
        assert len(sim.intel_store) == 1          # no dup entry
        assert len(sim.broadcasts) == 1           # no dup broadcast record

    def test_different_indicators_new_campaign_unknown(self):
        sim = make_sim()
        sim.broadcast_fingerprint(make_event(entropy=8.0))
        rec2 = sim.broadcast_fingerprint(make_event(entropy=4.0))
        assert rec2["known"] is False
        assert len(sim.intel_store) == 2

    def test_targets_are_at_risk_nodes_never_the_source(self):
        sim = make_sim()
        rec = sim.broadcast_fingerprint(make_event())
        assert len(rec["targets"]) == SPREAD_TARGETS
        assert sim.source_node_id not in rec["targets"]
        for nid in rec["targets"]:
            assert not sim._node(nid)["monitored"]
            assert sim._node(nid)["status"] == "attacked"
        assert sim._node(sim.source_node_id)["status"] == "protected"

    def test_broadcast_record_rides_on_incident_event(self):
        """The record returned is what monitor.py attaches to the incident —
        it must carry the identity + provenance fields the report uses."""
        sim = make_sim()
        rec = sim.broadcast_fingerprint(make_event(attack_id="atk-9"))
        for key in ("fingerprint", "short", "attack_id", "source_node",
                    "source_name", "nodes_reached", "targets", "target_names",
                    "known"):
            assert key in rec
        assert rec["attack_id"] == "atk-9"
        assert rec["source_node"] == "hq-delhi"
        assert len(rec["target_names"]) == SPREAD_TARGETS

    def test_seeded_campaign_is_reproducible(self):
        """Same seed → same act targets, in the same order, across two
        independent sim instances (driven through the real `_tick` path, so
        the act records its hits exactly as production does)."""
        def targets_for(seed):
            sim = make_sim()
            sim.start_campaign(acts=[{"at": 1, "regions": ["south"], "count": 2}], seed=seed)
            sim.campaign["started_at"] = time.time() - 2  # past the act's fire time
            sim._tick()
            assert sim.campaign["acts"][0]["fired"] is True
            return sim.campaign["acts"][0]["hits"]

        assert targets_for(42) == targets_for(42)
        assert targets_for(42) != targets_for(7)
        # seeded selection stays within the requested region
        for nid in targets_for(42):
            assert node_region(nid) == "south"


# ── campaign scheduler ─────────────────────────────────────────────────────
# start_campaign / stop_campaign / _tick: act timing, seeded target
# stability, skip-while-contained, and stop semantics. All timing is driven
# by back-dating campaign["started_at"] (no sleeps).

class TestCampaignScheduler:
    def _sim(self):
        return NetworkSim(seed=PROBE_FREE_SEED, tick=9999.0)

    def _start(self, acts, seed=None):
        sim = self._sim()
        sim.start_campaign(acts=acts, seed=seed)
        return sim

    # ── sweep window configuration ──
    def test_sweep_ms_is_parsed_defaulted_and_clamped(self):
        sim = self._start([
            {"at": 5, "targets": ["kem-mum"], "sweep_ms": 9000},
            {"at": 10, "targets": ["sms-jaipur"]},                # default applied
            {"at": 15, "targets": ["fortis-noida"], "sweep_ms": 1},   # clamped up
        ])
        acts = sim.campaign["acts"]
        assert acts[0]["sweep_ms"] == 9000
        assert acts[1]["sweep_ms"] == DEFAULT_SWEEP_MS
        assert acts[2]["sweep_ms"] >= 500
        # the dashboard reads it from the snapshot — must be present per act
        snap = sim.snapshot()["campaign"]["acts"]
        assert [a["sweep_ms"] for a in snap] == [9000, DEFAULT_SWEEP_MS, acts[2]["sweep_ms"]]

    # ── act timing ──
    def test_acts_fire_only_when_their_clock_elapses(self):
        sim = self._start([
            {"at": 10, "targets": ["fortis-noida"]},
            {"at": 20, "targets": ["sms-jaipur"]},
        ])
        now = time.time()

        sim.campaign["started_at"] = now - 5    # elapsed 5s — nothing due
        sim._tick()
        assert all(not a["fired"] for a in sim.campaign["acts"])

        sim.campaign["started_at"] = now - 10   # elapsed 10s — act 0 due
        sim._tick()
        assert sim.campaign["acts"][0]["fired"] is True
        assert sim.campaign["acts"][1]["fired"] is False

        sim.campaign["started_at"] = now - 25   # elapsed 25s — both due
        sim._tick()
        assert all(a["fired"] for a in sim.campaign["acts"])

    def test_at_zero_fires_on_the_first_tick(self):
        sim = self._start([{"at": 0, "targets": ["kem-mum"]}])
        sim.campaign["started_at"] = time.time() - 1
        sim._tick()
        act = sim.campaign["acts"][0]
        assert act["fired"] is True
        assert act["hits"] == ["kem-mum"]

    def test_a_tick_fires_only_due_acts_and_never_twice(self):
        sim = self._start([
            {"at": 10, "targets": ["fortis-noida"]},
            {"at": 10, "targets": ["sms-jaipur"]},
            {"at": 30, "targets": ["kem-mum"]},
        ])
        now = time.time()

        sim.campaign["started_at"] = now - 15   # acts 0,1 due; act 2 not
        sim._tick()
        assert [a["index"] for a in sim.campaign["acts"] if a["fired"]] == [0, 1]
        first_fired_at = sim.campaign["acts"][0]["fired_at"]

        sim.campaign["started_at"] = now - 40   # everything due
        sim._tick()
        assert all(a["fired"] for a in sim.campaign["acts"])
        # no double-fire: act 0's fired_at is unchanged
        assert sim.campaign["acts"][0]["fired_at"] == first_fired_at
        # fires recorded in schedule order
        fired_ats = [a["fired_at"] for a in sim.campaign["acts"]]
        assert fired_ats == sorted(fired_ats)

    # ── seeded target stability ──
    def test_multi_region_seeded_selection_is_stable_and_constrained(self):
        def hits_for(seed):
            sim = self._start(
                [{"at": 1, "regions": ["east", "northeast"], "count": 3}],
                seed=seed,
            )
            sim.campaign["started_at"] = time.time() - 2
            sim._tick()
            assert sim.campaign["acts"][0]["fired"] is True
            return sim.campaign["acts"][0]["hits"]

        h1, h2 = hits_for(42), hits_for(42)
        assert h1 == h2
        assert len(h1) == 3
        assert hits_for(42) != hits_for(7)
        assert all(node_region(h) in ("east", "northeast") for h in h1)

    # ── skip-while-contained ──
    def test_explicit_target_under_containment_is_skipped(self):
        sim = self._start([
            {"at": 5, "targets": ["fortis-noida", "sms-jaipur"]},
            {"at": 15, "targets": ["fortis-noida", "kem-mum"]},  # fortis again
        ])
        now = time.time()

        sim.campaign["started_at"] = now - 10
        sim._tick()
        assert sim.campaign["acts"][0]["hits"] == ["fortis-noida", "sms-jaipur"]

        sim.campaign["started_at"] = now - 20
        sim._tick()
        # fortis-noida is still under attack from act 1 → skipped, kem-mum hit
        assert sim.campaign["acts"][1]["hits"] == ["kem-mum"]
        assert sim._node("fortis-noida")["hit_by"] == "campaign"

    def test_contained_nodes_leave_the_region_pool(self):
        sim = self._start([{"at": 1, "regions": ["south"], "count": 3}], seed=42)
        n = sim._node("ggh-vijay")
        n["status"] = "quarantined"
        n["quarantined_at"] = time.time()   # fresh — stays quarantined this tick
        sim.campaign["started_at"] = time.time() - 2
        sim._tick()
        hits = sim.campaign["acts"][0]["hits"]
        assert len(hits) == 3                # count still honored from the pool
        assert "ggh-vijay" not in hits       # contained node excluded

    def test_monitored_and_unknown_targets_are_skipped(self):
        sim = self._start([
            {"at": 1, "targets": ["hq-delhi", "no-such-hospital", "kims-blr"]},
        ])
        sim.campaign["started_at"] = time.time() - 2
        sim._tick()
        assert sim.campaign["acts"][0]["hits"] == ["kims-blr"]
        assert sim._node("hq-delhi")["status"] == "protected"

    # ── stop semantics ──
    def test_stop_marks_inactive_and_blocks_further_acts(self):
        sim = self._start([{"at": 5, "targets": ["fortis-noida"]}])
        sim.stop_campaign()
        assert sim.campaign["active"] is False
        snap = sim.snapshot()["campaign"]
        assert snap["active"] is False
        assert snap["elapsed"] is None
        # even with the clock far past the act, nothing fires after stop
        sim.campaign["started_at"] = time.time() - 100
        sim._tick()
        assert not sim.campaign["acts"][0]["fired"]

    def test_stop_is_idempotent_and_safe_without_campaign(self):
        sim = self._sim()
        sim.stop_campaign()                  # no campaign yet — no crash
        sim.start_campaign(acts=[{"at": 1, "targets": ["kem-mum"]}])
        sim.stop_campaign()
        sim.stop_campaign()                  # double stop — no crash

    def test_restart_replaces_the_plan(self):
        sim = self._start([{"at": 5, "targets": ["fortis-noida"]}], seed=42)
        sim.campaign["started_at"] = time.time() - 10
        sim._tick()
        assert sim.campaign["acts"][0]["fired"] is True

        sim.stop_campaign()
        sim.start_campaign(
            acts=[{"at": 2, "regions": ["west"], "count": 2}], seed=42
        )
        acts = sim.campaign["acts"]
        assert len(acts) == 1
        assert not acts[0]["fired"]          # fresh plan, old state gone
        sim.campaign["started_at"] = time.time() - 5
        sim._tick()
        assert acts[0]["fired"] is True
        assert len(acts[0]["hits"]) == 2
