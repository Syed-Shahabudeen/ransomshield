import React, { useEffect, useMemo, useRef, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoMercator } from "d3-geo";
import indiaTopoJson from "../assets/india-states.json";
import {
  Globe, RefreshCw, Radio, ShieldCheck, ShieldX, ShieldAlert,
  RotateCcw, Fingerprint, Activity, MapPin, Building2,
  Play, Pause, Square, History
} from "lucide-react";
import { getAudioContext } from "../audio";

// ── Projection: lat/lon -> SVG coords ─────────────────────────────────────
const W = 640;
const H = 640;
const proj = geoMercator().scale(1050).center([82, 23.5]).translate([W / 2, H / 2]);
const P = ([lat, lon]) => proj([lon, lat]);



// region -> [x (pixels), latitude] — label anchor for each cluster
const REGION_POS = {
  north: [250, 31.5],
  west: [120, 21.0],
  central: [330, 20.5],
  south: [330, 10.5],
  east: [490, 22.5],
  northeast: [452, 27.5],
};

const STATUS_COLOR = {
  protected: "#22C55E",
  attacked: "#EF4444",
  quarantined: "#F97316",
  recovered: "#0EA5E9",
};

const STATUS_LABEL = {
  protected: "Protected",
  attacked: "Under attack",
  quarantined: "Quarantined",
  recovered: "Recovered",
};

const fmtClock = (ts) => {
  try { return new Date(ts * 1000).toLocaleTimeString(); } catch { return "—"; }
};

// ── Replay timeline (derived purely from the broadcast history) ──────────
// Each fingerprint broadcast is one campaign wave. Windows mirror the
// backend lifecycle (network_sim.py): attacked -> quarantined -> recovered.
const REPLAY_ATTACK = 6;
const REPLAY_QUARANTINE = 22;
const REPLAY_RECOVER = 18;
const REPLAY_TOTAL = REPLAY_ATTACK + REPLAY_QUARANTINE + REPLAY_RECOVER;

// Node states at a given playhead, derived from the wave list (ascending ts).
// Untargeted nodes stay protected; once the first wave has fired, every node
// holds the fingerprint (armed ring). Returns { status: {id -> state},
// curWave: index of the wave currently spreading (-1 before the first), armed }.
function replayModel(waves, playhead) {
  const status = {};
  let fired = 0;
  for (const w of waves) {
    if (playhead < w.ts) break;
    fired += 1;
    const elapsed = playhead - w.ts;
    for (const tid of w.targets || []) {
      if (elapsed < REPLAY_ATTACK) status[tid] = "attacked";
      else if (elapsed < REPLAY_ATTACK + REPLAY_QUARANTINE) status[tid] = "quarantined";
      else if (elapsed < REPLAY_TOTAL) status[tid] = "recovered";
      else delete status[tid];
    }
  }
  return { status, curWave: fired > 0 ? fired - 1 : -1, armed: fired > 0 };
}

// ── Region-target sweep (campaign act "lock-on") ─────────────────────────
// In the seconds before a scripted act fires, its target region(s) are
// highlighted with a scan-line sweep so the hit lands with a visible setup.
// The window is backend-driven per act (`sweep_ms`); this is just the
// fallback when an older backend doesn't send it.
const DEFAULT_SWEEP_MS = 4000;

export default function NetworkMap({ network, onRefresh, onCampaignStart, onCampaignStop, isAttack, impactFx = true, sound = true, animDensity = "full" }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);

  // ── replay / scrub timeline state ──
  const [replayOn, setReplayOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);   // epoch seconds
  const [speed, setSpeed] = useState(4);
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef(4);
  const lastTickRef = useRef(0);

  useEffect(() => { playheadRef.current = playhead; }, [playhead]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Campaign "lock-on" clock — ticks while a campaign has unfired acts so
  // the region-target sweeps animate smoothly up to each act's fire time.
  const [animClock, setAnimClock] = useState(() => Date.now());
  useEffect(() => {
    const running = network?.campaign?.active &&
      (network.campaign.acts || []).some((a) => !a.fired);
    if (!running) return;
    const id = setInterval(() => setAnimClock(Date.now()), 100);
    return () => clearInterval(id);
  }, [network?.campaign?.active, network?.campaign?.started_at, network?.campaign?.acts]);

  // The region-target sweep animates only while motion is allowed (Impact FX
  // on AND animation density not "off"). Otherwise the sweep clock is pinned
  // on the render where motion turned off, so the scan line holds its current
  // progress — visible and paused — instead of finishing. The lock-on window
  // still opens on real time so the targeting box appears, and the reticle
  // timing freezes with the sweep so the whole animation pauses as a unit.
  const motionOn = impactFx && animDensity !== "off";
  const frozenSweepClockRef = useRef(null);
  useEffect(() => {
    if (!motionOn) {
      if (frozenSweepClockRef.current === null) frozenSweepClockRef.current = animClock;
    } else {
      frozenSweepClockRef.current = null;
    }
  }, [motionOn, animClock]);
  const sweepClock = motionOn ? animClock : (frozenSweepClockRef.current ?? animClock);

  // Impact cue: when a campaign act transitions unfired → fired, punctuate
  // the lock-on with a screen shake + a synthesized impact blip.
  const prevFiredRef = useRef(new Set());
  const prevCampaignKeyRef = useRef(null);
  const [impact, setImpact] = useState(null); // { n, actIndex }
  const [shaking, setShaking] = useState(false);

  const playImpact = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return; // audio unavailable — stay silent, never crash
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t = ctx.currentTime;
      // low impact thump
      const thump = ctx.createOscillator();
      const tg = ctx.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(180, t);
      thump.frequency.exponentialRampToValueAtTime(55, t + 0.25);
      tg.gain.setValueAtTime(0.001, t);
      tg.gain.exponentialRampToValueAtTime(0.4, t + 0.012);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      thump.connect(tg).connect(ctx.destination);
      thump.start(t); thump.stop(t + 0.4);
      // bright lock-on ping on top
      const ping = ctx.createOscillator();
      const pg = ctx.createGain();
      ping.type = "square";
      ping.frequency.setValueAtTime(880, t);
      pg.gain.setValueAtTime(0.001, t);
      pg.gain.exponentialRampToValueAtTime(0.07, t + 0.005);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      ping.connect(pg).connect(ctx.destination);
      ping.start(t); ping.stop(t + 0.2);
    } catch { /* audio blocked — impact is still shown visually */ }
  };

  useEffect(() => {
    const campaign = network?.campaign;
    if (!campaign?.active) { prevFiredRef.current = new Set(); return; }
    const acts = campaign.acts || [];
    // A restart (or stop → start) resets fired state — forget the old plan.
    if (`${campaign.started_at}` !== prevCampaignKeyRef.current) {
      prevCampaignKeyRef.current = `${campaign.started_at}`;
      prevFiredRef.current = new Set();
    }
    const nowFired = new Set(acts.filter((a) => a.fired).map((a) => a.index));
    let fresh = null;
    for (const i of nowFired) {
      if (!prevFiredRef.current.has(i)) { fresh = i; break; }
    }
    prevFiredRef.current = nowFired;
    if (fresh !== null) {
      const act = acts.find((a) => a.index === fresh);
      setImpact((prev) => ({
        n: (prev?.n || 0) + 1,
        actIndex: fresh,
        hits: act?.hits || [],
      }));
    }
  }, [network?.campaign?.active, network?.campaign?.started_at, network?.campaign?.acts]);

  // Impact cue: shake + sound (gated by the dashboard settings) and a
  // brief caption naming the hit hospitals (always shown — it is the
  // audio-free signal for judges).
  const [toast, setToast] = useState(null); // { key, hits: [node ids] }
  useEffect(() => {
    if (!impact) return;
    if (impactFx) setShaking(true);
    if (impactFx && sound) playImpact();
    setToast({ key: impact.n, hits: impact.hits || [] });
    const timers = [setTimeout(() => setToast(null), 2600)];
    if (impactFx) timers.push(setTimeout(() => setShaking(false), 450));
    return () => timers.forEach(clearTimeout);
  }, [impact, impactFx, sound]);

  if (!network) {
    return (
      <div style={mapCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Globe size={16} color="#0EA5E9" />
          <span style={cardTitle}>NATIONWIDE HOSPITAL NETWORK</span>
        </div>
        <div style={{ color: "#334155", fontSize: 13, padding: "60px 0", textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
          Connecting to the nationwide threat-intelligence channel…
        </div>
      </div>
    );
  }

  const { nodes, broadcasts, events, counts, source_node_id } = network;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const latest = broadcasts?.[0] || null;
  const nowS = Date.now() / 1000;
  const showEdges = latest && nowS - latest.ts < 90;
  const src = byId[source_node_id];

  // Region bounding boxes (projected SVG space) used by the target sweeps.
  const regionBoxes = useMemo(() => {
    const boxes = {};
    for (const n of nodes) {
      const b = boxes[n.region] || (boxes[n.region] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      const [x, y] = P([n.lat, n.lon]);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
    }
    const out = {};
    for (const r in boxes) {
      const b = boxes[r];
      out[r] = { x: b.minX - 22, y: b.minY - 22, w: b.maxX - b.minX + 44, h: b.maxY - b.minY + 44 };
    }
    return out;
  }, [nodes]);

  // Scheduled acts currently in their target-sweep window (progress 0→1),
  // plus reticle lock-ons on the exact hospitals an explicit-target act will
  // hit in its final second. Region-based acts resolve targets server-side
  // at fire time, so they get the region sweep only.
  const campaign = network.campaign;
  const sweeps = [];
  const reticles = [];
  let targetingActIndex = -1;
  if (campaign?.active && campaign.started_at) {
    for (const a of campaign.acts || []) {
      if (a.fired) continue;
      const sweepMs = a.sweep_ms || DEFAULT_SWEEP_MS;
      const fireMs = (campaign.started_at + (a.at || 0)) * 1000;
      // Window membership uses the real clock so the targeting box appears;
      // the scan-line progress uses `sweepClock`, which FX-off pins in place.
      if (animClock < fireMs - sweepMs) continue; // window not reached yet
      const p = Math.min(Math.max((sweepClock - (fireMs - sweepMs)) / sweepMs, 0), 1);
      const regions = a.targets?.length
        ? [...new Set(a.targets.map((id) => byId[id]?.region).filter(Boolean))]
        : (a.regions || []);
      const boxes = regions.map((r) => regionBoxes[r]).filter(Boolean);
      if (boxes.length) {
        sweeps.push({ actIndex: a.index, regions, boxes, p });
        if (targetingActIndex < 0 && p > 0) targetingActIndex = a.index;
        // Final second before impact: outline each still-eligible target.
        if (a.targets?.length && fireMs - sweepClock <= 1000) {
          for (const tid of a.targets) {
            const tn = byId[tid];
            if (tn && !tn.monitored && tn.status === "protected") {
              reticles.push({ id: tid, node: tn, actIndex: a.index });
            }
          }
        }
      }
    }
  }

  // ── replay timeline (waves = broadcasts, ascending) ──
  const waves = useMemo(
    () => (broadcasts || []).slice().sort((a, b) => a.ts - b.ts),
    [broadcasts]
  );
  const hasReplay = waves.length > 0;
  const rStart = hasReplay ? waves[0].ts : 0;
  const rEnd = hasReplay ? waves[waves.length - 1].ts + REPLAY_TOTAL : 0;

  useEffect(() => {
    if (!playing || !hasReplay) return;
    lastTickRef.current = Date.now() / 1000;
    const id = setInterval(() => {
      const now = Date.now() / 1000;
      const dt = (now - lastTickRef.current) * speedRef.current;
      lastTickRef.current = now;
      let next = playheadRef.current + dt;
      if (next >= rEnd) { next = rEnd; setPlaying(false); }
      setPlayhead(next);
    }, 80);
    return () => clearInterval(id);
  }, [playing, hasReplay, rEnd]);

  const toggleReplay = () => {
    if (!replayOn) { setPlayhead(rStart); setReplayOn(true); setPlaying(true); }
    else setPlaying(!playing);
  };
  const scrubReplay = (v) => {
    setPlayhead(parseFloat(v));
    setReplayOn(true);
    setPlaying(false);
  };
  const exitReplay = () => { setPlaying(false); setReplayOn(false); };

  // Replay overlay: node states derived from the playhead over the wave list.
  const ph = replayOn ? Math.min(playhead, rEnd) : null;
  const model = replayOn && hasReplay ? replayModel(waves, ph) : null;
  const curWave = model ? model.curWave : -1;
  const curWaveData = curWave >= 0 ? waves[curWave] : null;
  const displayNodes = model
    ? nodes.map((n) => ({
        ...n,
        status: model.status[n.id] || "protected",
        intel_count: model.armed && n.intel_count === 0 ? 1 : n.intel_count,
      }))
    : nodes;
  const displayById = Object.fromEntries(displayNodes.map((n) => [n.id, n]));
  const hoveredNode = hovered ? displayById[hovered] : null;
  const selectedNode = selected ? displayById[selected] : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 380px", gap: 16, alignItems: "start" }}>
      {/* ── Map card ── */}
      <div style={mapCard}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Globe size={16} color="#0EA5E9" />
            <span style={cardTitle}>NATIONWIDE HOSPITAL NETWORK — THREAT-INTEL MESH</span>
          </div>
          <button onClick={onRefresh} style={iconBtn} title="Refresh network state">
            <RefreshCw size={13} color="#64748B" />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            ["Protected", counts?.protected ?? 0, "#22C55E"],
            ["Under attack", counts?.attacked ?? 0, "#EF4444"],
            ["Quarantined", counts?.quarantined ?? 0, "#F97316"],
            ["Recovered", counts?.recovered ?? 0, "#0EA5E9"],
          ].map(([k, v, c]) => (
            <div key={k} style={{
              display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
              borderRadius: 999, background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c, boxShadow: `0 0 6px ${c}` }} />
              <span style={{ fontSize: 10, color: "#94A3B8" }}>{k}</span>
              <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#E2E8F0" }}>{v}</span>
            </div>
          ))}
          <div style={{
            display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
            borderRadius: 999, background: "rgba(14,165,233,0.06)",
            border: "1px solid rgba(14,165,233,0.25)",
          }}>
            <Fingerprint size={11} color="#0EA5E9" />
            <span style={{ fontSize: 10, color: "#7DD3FC" }}>intel store</span>
            <span style={{ fontSize: 11, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: "#7DD3FC" }}>
              {network.intel_fingerprints ?? 0}
            </span>
          </div>
        </div>

        {/* SVG map — wrapper shakes on campaign-act impact. `fx-off` freezes
            the animated edges/pings (impact FX off, or density = "off");
            `density-reduced` slows edges and stops pings/reticle spins. */}
        <div className={(shaking ? "map-shake" : "") + (impactFx && animDensity !== "off" ? "" : " fx-off") + (animDensity === "reduced" ? " density-reduced" : "")}
          style={{ borderRadius: 10, position: "relative" }}>
        <ComposableMap projection={proj} width={W} height={H} style={{ width: "100%", height: "auto", background: "rgba(2,6,14,0.5)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
          <Geographies geography={indiaTopoJson}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="rgba(14,165,233,0.03)"
                  stroke="rgba(14,165,233,0.25)"
                  strokeWidth={1.2}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>
          {/* subtle graticule */}
          {[0.2, 0.4, 0.6, 0.8].map((f) => (
            <g key={f}>
              <line x1={W * f} y1={0} x2={W * f} y2={H} stroke="rgba(255,255,255,0.02)" />
              <line x1={0} y1={H * f} x2={W} y2={H * f} stroke="rgba(255,255,255,0.02)" />
            </g>
          ))}

          {/* Region labels */}
          {Object.entries(REGION_POS).map(([region, [px, lat]]) => {
            const y = P([lat, 80])[1];
            return (
              <text key={region} x={px} y={y} textAnchor="middle"
                style={{ fontSize: 9, letterSpacing: "0.18em", fill: "rgba(100,116,139,0.5)", fontFamily: "'JetBrains Mono', monospace" }}>
                {region.toUpperCase()}
              </text>
            );
          })}

          {/* Region-target sweep — lock-on before a scheduled campaign act hits.
              Always rendered while in its window; `sweepClock` freezes the
              scan line when FX or density disables motion. */}
          {sweeps.map(({ actIndex, regions, boxes, p }) => {
            const eased = 1 - Math.pow(1 - p, 2);
            return boxes.map((b, bi) => {
              const scanY = b.y + eased * b.h;
              return (
                <g key={`sweep-${actIndex}-${bi}`} data-sweep={regions.join("+")}>
                  <defs>
                    <linearGradient id={`sweepGrad-${actIndex}-${bi}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(239,68,68,0)" />
                      <stop offset="100%" stopColor="rgba(239,68,68,0.28)" />
                    </linearGradient>
                  </defs>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={14}
                    fill="rgba(239,68,68,0.05)" stroke="rgba(239,68,68,0.55)"
                    strokeWidth={1.1} strokeDasharray="5 5"
                    opacity={0.25 + 0.75 * eased} />
                  <rect x={b.x} y={scanY - 30} width={b.w} height={30}
                    fill={`url(#sweepGrad-${actIndex}-${bi})`} opacity={eased} />
                  <line x1={b.x} y1={scanY} x2={b.x + b.w} y2={scanY}
                    stroke="#EF4444" strokeWidth={1.5}
                    opacity={0.3 + 0.7 * eased}
                    style={{ filter: "drop-shadow(0 0 4px rgba(239,68,68,0.9))" }} />
                </g>
              );
            });
          })}
          {sweeps.map(({ actIndex, regions, p }) => regions.map((r) => {
            const [px, lat] = REGION_POS[r];
            const y = P([lat, 80])[1];
            return (
              <text key={`sweep-label-${actIndex}-${r}`} x={px} y={y} textAnchor="middle"
                style={{ fontSize: 9, letterSpacing: "0.18em", fill: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}
                opacity={0.35 + 0.65 * p}>
                {r.toUpperCase()} ▸
              </text>
            );
          }))}

          {/* Broadcast spread edges — live (recent fingerprint) or replay (current wave) */}
          {(() => {
            const edges = replayOn && hasReplay && src
              ? (curWaveData?.targets || []).map((tid) => ({ tid, t: displayById[tid] }))
              : showEdges && src
                ? (latest.targets || []).map((tid) => ({ tid, t: byId[tid] }))
                : [];
            return edges.filter(({ t }) => t).map(({ tid, t }) => {
              const [sx, sy] = P([src.lat, src.lon]);
              const [tx, ty] = P([t.lat, t.lon]);
              const color = STATUS_COLOR[t.status] || "#F97316";
              return (
                <g key={tid}>
                  <line x1={sx} y1={sy} x2={tx} y2={ty}
                    stroke={color} strokeWidth={1}
                    strokeDasharray="3 4" opacity={0.55} className="net-edge" />
                  <circle cx={tx} cy={ty} r={9} fill="none"
                    stroke={color} strokeWidth={0.7} opacity={0.5} className="net-ping" />
                </g>
              );
            });
          })()}

          {/* Nodes */}
          {displayNodes.map((n) => {
            const r = 3.5 + Math.min(n.beds / 500, 6);
            const color = STATUS_COLOR[n.status] || "#22C55E";
            const armed = n.intel_count > 0 && n.status === "protected";
            return (
              <Marker key={n.id} coordinates={[n.lon, n.lat]}
                onMouseEnter={() => setHovered(n.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setSelected(n.id === selected ? null : n.id)}
                style={{ cursor: "pointer", default: { outline: "none" }, hover: { outline: "none" }, pressed: { outline: "none" } }}>
                {n.monitored && (
                  <circle cx={0} cy={0} r={r + 6} fill="none" stroke="#F1F5F9"
                    strokeWidth={1.4} className="net-ping" />
                )}
                {(n.status === "attacked" || n.monitored) && (
                  <circle cx={0} cy={0} r={r + 3} fill="none" stroke={color}
                    strokeWidth={1} opacity={0.7} className="net-ping" />
                )}
                {armed && (
                  <circle cx={0} cy={0} r={r + 2.5} fill="none" stroke="#0EA5E9"
                    strokeWidth={0.8} opacity={0.6} />
                )}
                <circle cx={0} cy={0} r={r}
                  fill={color} fillOpacity={n.monitored ? 1 : 0.9}
                  stroke={selected === n.id ? "#F8FAFC" : "rgba(255,255,255,0.35)"}
                  strokeWidth={selected === n.id ? 1.6 : 0.8} />
                {n.monitored && (
                  <circle cx={0} cy={0} r={2} fill="#F1F5F9" />
                )}
                {(hovered === n.id || selected === n.id) && (
                  <g>
                    <rect x={-86} y={-44}
                      width={172} height={34} rx={6} fill="rgba(2,6,14,0.94)"
                      stroke="rgba(255,255,255,0.12)" />
                    <text x={0} y={-30}
                      textAnchor="middle" style={{ fontSize: 10, fill: "#E2E8F0", fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>
                      {n.name.length > 26 ? n.name.slice(0, 25) + "…" : n.name}
                    </text>
                    <text x={0} y={-17}
                      textAnchor="middle" style={{ fontSize: 8.5, fill: color, fontFamily: "'JetBrains Mono', monospace" }}>
                      {STATUS_LABEL[n.status]} · {n.city}, {n.state} · {n.beds} beds · Sec {n.security}
                    </text>
                  </g>
                )}
              </Marker>
            );
          })}

          {/* Reticle lock-on on exact targets in the final second before impact */}
          {reticles.map(({ id, node, actIndex }) => {
            const r = 3.5 + Math.min(node.beds / 500, 6);
            return (
              <Marker key={`reticle-${actIndex}-${id}`} coordinates={[node.lon, node.lat]} data-reticle={id}>
                <circle cx={0} cy={0} r={r + 8} fill="none" stroke="#EF4444" strokeWidth={1.1}
                  strokeDasharray="4 4" opacity={0.95} className="reticle-ring" />
                <circle cx={0} cy={0} r={r + 14} fill="none" stroke="rgba(239,68,68,0.5)" strokeWidth={0.7}
                  strokeDasharray="2 6" opacity={0.75} className="reticle-ring rev" />
                {[[0, -1], [0, 1], [-1, 0], [1, 0]].map(([dx, dy], i) => (
                  <line key={i} x1={dx * (r + 9)} y1={dy * (r + 9)}
                    x2={dx * (r + 13)} y2={dy * (r + 13)}
                    stroke="#EF4444" strokeWidth={1.1} opacity={0.95} />
                ))}
                <circle cx={0} cy={0} r={2} fill="#EF4444" opacity={0.95} />
              </Marker>
            );
          })}

          {/* Selected node details (bottom-left legend card) */}
          <g>
            <rect x={8} y={H - 34} width={300} height={26} rx={6} fill="rgba(2,6,14,0.9)"
              stroke="rgba(255,255,255,0.08)" />
            <text x={16} y={H - 17} style={{ fontSize: 9.5, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>
              {selectedNode
                ? `${selectedNode.name} · ${selectedNode.status.toUpperCase()} · intel ${selectedNode.intel_count} FP · tier ${selectedNode.tier}`
                : "CLICK A NODE FOR DETAILS · DASHED LINES = ACTIVE CAMPAIGN SPREAD"}
            </text>
          </g>
        </ComposableMap>

        {/* Impact caption — hit hospitals, for judges watching without audio */}
        {toast && (
          <div key={toast.key} className="impact-toast" style={{
            position: "absolute", top: 10, right: 10, zIndex: 5,
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", borderRadius: 9,
            background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.5)",
            boxShadow: "0 4px 20px rgba(239,68,68,0.3)",
            backdropFilter: "blur(4px)", pointerEvents: "none",
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace" }}>
              ⚡ IMPACT
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#FECACA", fontFamily: "'JetBrains Mono', monospace" }}>
              {(() => {
                const names = toast.hits.map((h) => byId[h]?.name?.split(" (")[0] || h).filter(Boolean);
                return names.length ? names.join(", ") : "targets contained — no hits";
              })()}
            </span>
          </div>
        )}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono', monospace" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", display: "inline-block" }} /> protected
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} /> attacked
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F97316", display: "inline-block" }} /> quarantined
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#0EA5E9", display: "inline-block" }} /> recovered
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid #F1F5F9", display: "inline-block" }} /> monitored source
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid #0EA5E9", display: "inline-block" }} /> holds fingerprint
          </span>
        </div>

        {/* ── Campaign replay / scrub timeline ── */}
        {hasReplay && (
          <div style={{
            marginTop: 14, padding: "12px 14px", borderRadius: 10,
            background: "rgba(14,165,233,0.04)", border: "1px solid rgba(14,165,233,0.2)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <History size={13} color="#0EA5E9" />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#7DD3FC" }}>
                CAMPAIGN REPLAY — SPREAD TIMELINE
              </span>
              {replayOn && (
                <span style={{
                  marginLeft: "auto", fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
                  color: playing ? "#86EFAC" : "#FDE68A",
                }}>
                  {playing ? "▶ PLAYING" : "⏸ PAUSED"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={toggleReplay} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: 8, cursor: "pointer", flexShrink: 0,
                background: replayOn ? "rgba(14,165,233,0.18)" : "rgba(14,165,233,0.1)",
                border: "1px solid rgba(14,165,233,0.4)", color: "#7DD3FC",
              }} title={replayOn ? (playing ? "Pause replay" : "Resume replay") : "Play the campaign replay"}>
                {replayOn && playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <input
                type="range" min={rStart} max={rEnd} step={0.5}
                value={replayOn ? Math.min(playhead, rEnd) : rStart}
                onChange={(e) => scrubReplay(e.target.value)}
                style={{ flex: 1, accentColor: "#0EA5E9", cursor: "pointer" }}
              />
              <span style={{
                fontSize: 10, color: "#64748B", fontFamily: "'JetBrains Mono', monospace",
                minWidth: 84, textAlign: "right", flexShrink: 0,
              }}>
                {fmtClock(replayOn ? Math.min(playhead, rEnd) : rStart)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#94A3B8", flexShrink: 0 }}>
                WAVE {curWave >= 0 ? curWave + 1 : 0}/{waves.length}
              </span>
              {curWaveData && (
                <span style={{
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#FCA5A5",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 120,
                }}>
                  {curWaveData.target_names?.join(", ") || curWaveData.targets?.join(", ")}
                </span>
              )}
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {[1, 4, 16].map((s) => (
                  <button key={s} onClick={() => setSpeed(s)} style={{
                    padding: "3px 8px", borderRadius: 5, cursor: "pointer", fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    background: speed === s ? "rgba(14,165,233,0.2)" : "rgba(255,255,255,0.03)",
                    border: speed === s ? "1px solid rgba(14,165,233,0.45)" : "1px solid rgba(255,255,255,0.08)",
                    color: speed === s ? "#7DD3FC" : "#64748B",
                  }}>
                    {s}×
                  </button>
                ))}
              </div>
              {replayOn && (
                <button onClick={exitReplay} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontSize: 10,
                  fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
                  background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)",
                  color: "#86EFAC", flexShrink: 0,
                }}>
                  <Activity size={10} /> LIVE
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Threat intel panel ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={mapCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Radio size={15} color="#F97316" />
            <span style={cardTitle}>THREAT INTELLIGENCE CHANNEL</span>
          </div>

          {!latest ? (
            <div style={{ color: "#334155", fontSize: 12, fontFamily: "'JetBrains Mono', monospace", padding: "24px 0", textAlign: "center" }}>
              No fingerprints broadcast yet —<br />an incident at the monitored hospital seeds the network.
            </div>
          ) : (
            <div style={{
              padding: 14, borderRadius: 10,
              background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.25)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: "#FDBA74", fontWeight: 700, letterSpacing: "0.08em" }}>LAST FINGERPRINT BROADCAST</span>
                <span style={{ fontSize: 10, color: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtClock(latest.ts)} · attack #{latest.attack_id}
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#FED7AA", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                {latest.short}
                {latest.known && <span style={{ color: "#86EFAC", fontSize: 10, marginLeft: 8 }}>KNOWN CAMPAIGN</span>}
              </div>
              <div style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.6 }}>
                Broadcast from <b style={{ color: "#E2E8F0" }}>{latest.source_name}</b> to{" "}
                <b style={{ color: "#E2E8F0" }}>{latest.nodes_reached} hospitals</b> —{" "}
                <b style={{ color: "#FDBA74" }}>{latest.targets?.length} at-risk nodes hit</b>
              </div>
              {latest.target_names?.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {latest.target_names.map((t) => (
                    <span key={t} style={{
                      padding: "2px 8px", borderRadius: 999, fontSize: 10,
                      background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
                      color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {(() => {
                const ni = latest.note_intel;
                if (!ni || (!ni.gang && !ni.btc_address && !ni.deadline_hours && !ni.amount_btc)) return null;
                const chips = [
                  ni.gang && { label: ni.gang, mono: false },
                  ni.amount_btc && { label: `${ni.amount_btc} BTC demanded`, mono: true },
                  ni.btc_address && { label: ni.btc_address, mono: true },
                  ni.deadline_hours && { label: `${ni.deadline_hours}h deadline`, mono: true },
                ].filter(Boolean);
                return (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(249,115,22,0.15)" }}>
                    <div style={{ fontSize: 9.5, color: "#FDBA74", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                      RANSOM NOTE INTEL — RECOVERED FROM DEMAND NOTE
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {chips.map((c) => (
                        <span key={c.label} style={{
                          padding: "2px 8px", borderRadius: 999, fontSize: 10,
                          background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.3)",
                          color: "#FED7AA", fontFamily: c.mono ? "'JetBrains Mono', monospace" : "'Syne', sans-serif",
                        }}>
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Deterministic campaign control */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
              DETERMINISTIC CAMPAIGN
            </div>
            {network.campaign?.active ? (
              <div style={{
                padding: 12, borderRadius: 10,
                background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.25)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, color: "#FCA5A5", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    ▶ ACTIVE · seed {network.campaign.seed ?? "unseeded"} · +{network.campaign.elapsed}s
                  </span>
                  <button onClick={onCampaignStop} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)",
                    color: "#FCA5A5", fontSize: 10, fontWeight: 700, fontFamily: "'Syne', sans-serif",
                  }}>
                    <Square size={9} /> Stop
                  </button>
                </div>
                {network.campaign.acts?.map((a) => {
                  const targets = a.targets?.length
                    ? a.targets.map((id) => byId[id]?.name?.split(" (")[0] || id).join(", ")
                    : `${a.count} from ${a.regions.join("+") || "any region"}`;
                  return (
                    <div key={a.index} style={{
                      display: "flex", gap: 8, padding: "5px 8px", borderRadius: 6,
                      background: a.fired ? "rgba(34,197,94,0.07)" : "rgba(255,255,255,0.02)",
                      fontSize: 10, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4,
                    }}>
                      <span style={{
                        color: a.fired ? "#86EFAC" : targetingActIndex === a.index ? "#FCA5A5" : "#475569",
                        flexShrink: 0, fontWeight: targetingActIndex === a.index ? 800 : 400,
                      }}>
                        {a.fired ? "✓" : targetingActIndex === a.index ? "◉ TARGETING" : `+${a.at}s`}
                      </span>
                      <span style={{ color: "#94A3B8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Act {a.index + 1}: {targets}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <button onClick={onCampaignStart} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 14px", borderRadius: 8, cursor: "pointer",
                width: "100%", background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#FCA5A5", fontSize: 11, fontWeight: 700, fontFamily: "'Syne', sans-serif",
              }}>
                <Play size={12} />
                Replay deterministic campaign (seed 42)
              </button>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
              NETWORK ACTIVITY
            </div>
            {events?.length === 0 ? (
              <div style={{ color: "#1E293B", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                Waiting for network activity…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {events.slice(0, 8).map((ev, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 8, padding: "6px 10px", borderRadius: 7,
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    <span style={{ color: "#334155", flexShrink: 0 }}>{ev.time}</span>
                    <span style={{
                      color: ev.kind === "fingerprint_broadcast" ? "#FDBA74"
                        : ev.kind === "quarantined" ? "#FCA5A5"
                        : ev.kind === "blocked" ? "#86EFAC"
                        : ev.kind === "probe" ? "#FDE68A"
                        : "#7DD3FC",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {ev.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Node detail card */}
        <div style={mapCard}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <MapPin size={15} color="#0EA5E9" />
            <span style={cardTitle}>NODE DETAIL</span>
          </div>
          {!selectedNode && !hoveredNode ? (
            <div style={{ color: "#1E293B", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
              Hover or click any hospital on the map.
            </div>
          ) : (
            <NodeDetail node={selectedNode || hoveredNode} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes netPing { 0% { transform: scale(0.6); opacity: 0.9; } 100% { transform: scale(1.35); opacity: 0; } }
        .net-ping { animation: netPing 1.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes netDash { to { stroke-dashoffset: -14; } }
        .net-edge { animation: netDash 0.8s linear infinite; }
        @keyframes reticleSpin { to { transform: rotate(360deg); } }
        .reticle-ring { animation: reticleSpin 1.6s linear infinite; transform-box: fill-box; transform-origin: center; }
        .reticle-ring.rev { animation-direction: reverse; animation-duration: 1.1s; }
        @keyframes mapShake {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(-7px, 2px); }
          30% { transform: translate(6px, -3px); }
          45% { transform: translate(-5px, 2px); }
          60% { transform: translate(4px, -1px); }
          75% { transform: translate(-2px, 1px); }
        }
        .map-shake { animation: mapShake 0.45s ease-in-out; }
        /* Muted mode: fully static map — no animated edges, pings, or reticle
           spins. Elements still render; only their motion stops. */
        .fx-off .net-edge, .fx-off .net-ping, .fx-off .reticle-ring { animation: none; }
        /* Reduced density: edges keep a slow dash, pings and reticle spins stop. */
        .density-reduced .net-ping, .density-reduced .reticle-ring { animation: none; }
        .density-reduced .net-edge { animation-duration: 2.4s; }
        @keyframes toastIn {
          0% { transform: translateY(-8px); opacity: 0; }
          12% { transform: translateY(0); opacity: 1; }
          82% { opacity: 1; }
          100% { opacity: 0; }
        }
        .impact-toast { animation: toastIn 2.6s ease-in-out forwards; }
      `}</style>
    </div>
  );
}

function NodeDetail({ node }) {
  const color = STATUS_COLOR[node.status] || "#22C55E";
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#E2E8F0", marginBottom: 2 }}>
        {node.monitored && <span style={{ color: "#F1F5F9", marginRight: 6 }}>◎</span>}
        {node.name}
      </div>
      <div style={{ fontSize: 10.5, color: "#64748B", marginBottom: 10, fontFamily: "'JetBrains Mono', monospace" }}>
        {node.city}, {node.state}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          ["Status", <span key="s" style={{ color, fontWeight: 700 }}>{STATUS_LABEL[node.status]}{node.monitored ? " (monitored)" : ""}</span>],
          ["Region", node.region.toUpperCase()],
          ["Beds", String(node.beds)],
          ["Tier", `Tier-${node.tier}` + (node.tier === 3 ? " district" : node.tier === 2 ? " secondary" : " tertiary")],
          ["Security posture", `${node.security}/100`],
          ["Threat intel held", `${node.intel_count} fingerprint(s)`],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: "#64748B" }}>{k}</span>
            <span style={{ color: "#CBD5E1", fontFamily: "'JetBrains Mono', monospace" }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "#475569" }}>
        {node.monitored ? <ShieldAlert size={11} color="#EF4444" /> : <ShieldCheck size={11} color="#22C55E" />}
        <span>
          {node.monitored
            ? "This facility is monitored live by RansomShield (engine + backend + dashboard)."
            : node.intel_count > 0
              ? "Holds campaign fingerprints — matching patterns are blocked automatically."
              : "No fingerprints yet — awaiting the next nationwide broadcast."}
        </span>
      </div>
    </div>
  );
}

const mapCard = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: 20,
};

const cardTitle = {
  fontSize: 12,
  fontWeight: 700,
  color: "#64748B",
  letterSpacing: "0.08em",
};

const iconBtn = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 7, cursor: "pointer",
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
};
