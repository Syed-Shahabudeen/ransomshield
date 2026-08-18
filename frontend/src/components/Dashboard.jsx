import React, { useState, useEffect, useRef } from "react";
import {
  Shield, ShieldAlert, ShieldCheck, Wifi, WifiOff,
  Activity, Clock, Database, FileText, Zap, RefreshCw,
  AlertTriangle, CheckCircle, Download, Eye, Terminal,
  HardDrive, Lock, Unlock, Camera, Network, Settings2, X,
  FileCode, Play, Square, RefreshCcw, EyeOff, Radio, RotateCcw
} from "lucide-react";
import NetworkMap from "./NetworkMap";
import ShieldHero from "./ShieldHero";
import DataCorruptionPanel from "./DataCorruptionPanel";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line
} from "recharts";

// Helper utilities for UI formatting
const fmt = (n) => String(n).padStart(2, "0");
const fmtUptime = (s) => `${fmt(Math.floor(s / 3600))}:${fmt(Math.floor((s % 3600) / 60))}:${fmt(s % 60)}`;
const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString(); } catch { return "—"; }
};

// Design Palette
const PALETTE = {
  bgBase: "#080B10",
  bgPanel: "#0D121F",
  bgPanelGlass: "rgba(13, 18, 31, 0.75)",
  accentTeal: "#19E3C2",
  accentRed: "#FF3B4E",
  accentAmber: "#FFB020",
  borderTeal: "rgba(25, 227, 194, 0.15)",
  borderRed: "rgba(255, 59, 78, 0.25)",
  borderAmber: "rgba(255, 176, 32, 0.2)",
  textPrimary: "#E6EDF3",
  textMuted: "#7D8590"
};

// Theme helper mapping to target colors based on state
const getThemeColors = (status) => {
  if (status === "under_attack") {
    return {
      main: PALETTE.accentRed,
      border: PALETTE.borderRed,
      glow: "rgba(255, 59, 78, 0.15)",
      bg: "rgba(255, 59, 78, 0.05)"
    };
  }
  if (status === "recovering" || status === "recovered") {
    return {
      main: PALETTE.accentAmber,
      border: PALETTE.borderAmber,
      glow: "rgba(255, 176, 32, 0.15)",
      bg: "rgba(255, 176, 32, 0.05)"
    };
  }
  return {
    main: PALETTE.accentTeal,
    border: PALETTE.borderTeal,
    glow: "rgba(25, 227, 194, 0.15)",
    bg: "rgba(25, 227, 194, 0.03)"
  };
};

export default function Dashboard({
  connected, status, attacks, snapshots, eventCount, attackCount,
  uptimeSeconds, hospital, activeAttack, recoveryTimer,
  fileChanges, auditStatus, network,
  onRefreshNetwork, onCampaignStart, onCampaignStop,
  onManualSnapshot, onManualRollback, onDownloadReport, onVerifyAudit,
  settings, onSettingsChange, forcedTab, onDemoStart, onDemoReset,
  demoPatients, demoState,
}) {
  const [tab, setTab] = useState("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullScreenFlash, setFullScreenFlash] = useState(null); // 'attack' | 'recovery' | null
  const logRef = useRef(null);

  useEffect(() => {
    if (forcedTab) setTab(forcedTab);
  }, [forcedTab]);

  // EKG waveform generation logic: calm teal with small ambient noise, Red spikes during attacks, amber during recovery
  const [ekgHistory, setEkgHistory] = useState(
    Array.from({ length: 80 }, (_, i) => ({ t: i, val: 50 }))
  );
  const ekgTickIndex = useRef(80);

  // Generate EKG signal path based on current state
  useEffect(() => {
    const interval = setInterval(() => {
      setEkgHistory((prev) => {
        const next = [...prev.slice(1)];
        let baseVal = 50;

        if (status === "under_attack") {
          // Rapid random heartrate spikes
          const r = Math.random();
          if (r < 0.2) baseVal = 95;
          else if (r < 0.4) baseVal = 5;
          else baseVal = 40 + Math.random() * 20;
        } else if (status === "recovering") {
          // Slow decaying recovery heartbeat wave
          const idx = ekgTickIndex.current;
          baseVal = 50 + Math.sin(idx * 0.3) * 25 * Math.exp(-0.02 * (idx % 30));
        } else {
          // Protected state: calm stable baseline with micro-fluctuations
          const idx = ekgTickIndex.current;
          if (idx % 12 === 0) baseVal = 75; // small QRS tick
          else if (idx % 12 === 1) baseVal = 20;
          else if (idx % 12 === 2) baseVal = 55;
          else baseVal = 48 + Math.random() * 4;
        }

        ekgTickIndex.current++;
        return [...next, { t: ekgTickIndex.current, val: baseVal }];
      });
    }, 150);

    return () => clearInterval(interval);
  }, [status]);

  // Full screen flash logic on state transitions
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (prev !== status) {
      if (status === "under_attack") {
        setFullScreenFlash("attack");
        setTimeout(() => setFullScreenFlash(null), 1000);
      } else if (status === "protected" && (prev === "under_attack" || prev === "recovering")) {
        setFullScreenFlash("recovery");
        setTimeout(() => setFullScreenFlash(null), 1000);
      }
      prevStatusRef.current = status;
    }
  }, [status]);

  // Log auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [fileChanges, tab]);

  const activeColors = getThemeColors(status);

  // Re-map the state to visual labeling
  const getStateLabel = () => {
    if (status === "under_attack") return "CRITICAL ATTACK ACTIVE";
    if (status === "recovering") return "AUTOMATED ROLLBACK PROCESSING";
    if (status === "recovered") return "INTEGRITY RESTORED";
    return "SECURE & WATCHING";
  };

  return (
    <div style={{
      fontFamily: "'Inter', sans-serif",
      background: PALETTE.bgBase,
      minHeight: "100vh",
      color: PALETTE.textPrimary,
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Background Interactive Ambient Canvas Grid & Particles */}
      <div style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
        background: `
          radial-gradient(circle at 30% 20%, ${activeColors.glow} 0%, transparent 60%),
          radial-gradient(circle at 80% 80%, rgba(8, 11, 16, 0.95) 0%, ${PALETTE.bgBase} 100%)
        `,
        opacity: 0.85,
        transition: "background 1s ease"
      }} />

      {/* Screen flash transition overlays */}
      {fullScreenFlash === "attack" && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(255, 59, 78, 0.4)",
          zIndex: 9999, pointerEvents: "none", animation: "flashFade 1s forwards"
        }} />
      )}
      {fullScreenFlash === "recovery" && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(25, 227, 194, 0.4)",
          zIndex: 9999, pointerEvents: "none", animation: "flashFade 1s forwards"
        }} />
      )}

      {/* Main Container */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        
        {/* HEADER */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 28px",
          borderBottom: `1px solid ${activeColors.border}`,
          backdropFilter: "blur(12px)",
          background: PALETTE.bgPanelGlass,
          transition: "all 0.5s ease"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8,
              background: `radial-gradient(circle, ${activeColors.main} 10%, transparent 100%)`,
              border: `1px solid ${activeColors.main}`,
              boxShadow: `0 0 16px ${activeColors.main}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: status === "under_attack" ? "pulseGlow 1.2s infinite" : "none"
            }}>
              {status === "under_attack" ? <ShieldAlert size={18} color={activeColors.main} /> : <ShieldCheck size={18} color={activeColors.main} />}
            </div>
            <div>
              <h1 style={{
                fontSize: 18, fontWeight: 700, letterSpacing: "0.08em", margin: 0,
                fontFamily: "'Space Grotesk', sans-serif", display: "flex", alignItems: "center", gap: 8
              }}>
                RANSOMSHIELD
                <span style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  border: `1px solid ${activeColors.border}`, background: "rgba(255,255,255,0.02)",
                  color: activeColors.main, fontFamily: "'JetBrains Mono', monospace"
                }}>
                  v2.0.4
                </span>
              </h1>
              <div style={{ fontSize: 11, color: PALETTE.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                {hospital}
              </div>
            </div>
          </div>

          {/* Signature EKG Strip inside Header */}
          <div style={{
            width: 250, height: 40, borderLeft: "1px solid rgba(255,255,255,0.05)",
            borderRight: "1px solid rgba(255,255,255,0.05)", padding: "0 10px", display: "flex", flexDirection: "column"
          }}>
            <div style={{ fontSize: 8, color: PALETTE.textMuted, letterSpacing: "0.1em", fontFamily: "'Space Grotesk', sans-serif" }}>
              NETWORK VITALS: {status.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={ekgHistory}>
                  <Line type="monotone" dataKey="val" stroke={activeColors.main} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* System status details */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 14px", borderRadius: 6,
              background: "rgba(255,255,255,0.02)", border: `1px solid ${activeColors.border}`
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                backgroundColor: activeColors.main,
                boxShadow: `0 0 10px ${activeColors.main}`,
                display: "inline-block",
                animation: "pulseGlow 1.5s infinite"
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, color: activeColors.main,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.05em"
              }}>
                {getStateLabel()}
              </span>
            </div>

            <div style={{ textRendering: "optimizeSpeed", fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>
              <div style={{ fontSize: 9, color: PALETTE.textMuted }}>SYS UPTIME</div>
              <div style={{ fontSize: 13, color: PALETTE.textPrimary }}>{fmtUptime(uptimeSeconds)}</div>
            </div>

            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 12px", borderRadius: 6,
              background: connected ? "rgba(25, 227, 194, 0.05)" : "rgba(255, 59, 78, 0.05)",
              border: connected ? `1px solid ${PALETTE.borderTeal}` : `1px solid ${PALETTE.borderRed}`
            }}>
              {connected ? <Wifi size={13} color={PALETTE.accentTeal} /> : <WifiOff size={13} color={PALETTE.accentRed} />}
              <span style={{
                fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                color: connected ? PALETTE.accentTeal : PALETTE.accentRed
              }}>
                {connected ? "LIVE" : "DISCONNECTED"}
              </span>
            </div>

            <button onClick={() => setSettingsOpen(!settingsOpen)} style={{
              background: "none", border: "none", cursor: "pointer", color: PALETTE.textMuted
            }}>
              <Settings2 size={16} />
            </button>
          </div>
        </header>

        {/* METRICS BAR */}
        <MetricsStrip attacks={attacks} attackCount={attackCount} network={network} activeColors={activeColors} />

        {/* SETTINGS PANELS */}
        {settingsOpen && (
          <div style={{
            position: "fixed", top: 80, right: 30, zIndex: 1000,
            background: PALETTE.bgPanel, border: `1px solid ${PALETTE.borderTeal}`,
            borderRadius: 8, padding: 20, width: 320, boxShadow: "0 10px 25px rgba(0,0,0,0.5)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}>SETTINGS CONTROL</h3>
              <X size={16} onClick={() => setSettingsOpen(false)} style={{ cursor: "pointer" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: PALETTE.textMuted }}>SOUND EFFECTS</label>
                <button onClick={() => onSettingsChange({ sound: !settings.sound })} style={{
                  display: "block", width: "100%", padding: "8px", background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)", color: PALETTE.textPrimary, cursor: "pointer", borderRadius: 4,
                  fontSize: 12, marginTop: 4
                }}>
                  {settings.sound ? "ACTIVE" : "MUTED"}
                </button>
              </div>
              <div>
                <label style={{ fontSize: 11, color: PALETTE.textMuted }}>VISUAL FX INTENSITY</label>
                <button onClick={() => onSettingsChange({ impactFx: !settings.impactFx })} style={{
                  display: "block", width: "100%", padding: "8px", background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.1)", color: PALETTE.textPrimary, cursor: "pointer", borderRadius: 4,
                  fontSize: 12, marginTop: 4
                }}>
                  {settings.impactFx ? "FULL EFFECTS" : "MINIMALIST"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* NAVIGATION TABS */}
        <div style={{
          display: "flex", padding: "12px 28px 0", gap: 8,
          borderBottom: "1px solid rgba(255, 255, 255, 0.05)"
        }}>
          {[
            { id: "dashboard", label: "Overview Vitals", icon: Activity },
            { id: "datacorr", label: "Data Under Attack", icon: Database },
            { id: "network", label: "Threat Propagation Map", icon: Network },
            { id: "attacks", label: `Attacks Logged (${attackCount})`, icon: ShieldAlert },
            { id: "snapshots", label: `Recovery Snapshots (${snapshots.length})`, icon: Camera },
            { id: "livelog", label: "Live Telemetry Feed", icon: Terminal }
          ].map((t) => {
            const IconComp = t.icon;
            const isSelected = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 16px", background: isSelected ? "rgba(25, 227, 194, 0.03)" : "none",
                border: "none", cursor: "pointer", borderBottom: isSelected ? `2px solid ${activeColors.main}` : "2px solid transparent",
                color: isSelected ? PALETTE.textPrimary : PALETTE.textMuted,
                fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: isSelected ? 600 : 400,
                transition: "all 0.2s ease"
              }}>
                <IconComp size={14} color={isSelected ? activeColors.main : PALETTE.textMuted} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* ACTIVE INCIDENT BANNER */}
        {activeAttack && (
          <div style={{
            background: "rgba(255, 59, 78, 0.1)",
            borderBottom: `1px solid ${PALETTE.accentRed}`,
            padding: "12px 28px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            animation: "slideDown 0.3s ease"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <AlertTriangle size={18} color={PALETTE.accentRed} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: PALETTE.textPrimary }}>
                  MALICIOUS ENCRYPTOR PROCESS ISOLATED — INCIDENT #{activeAttack.attack_id}
                </div>
                <div style={{ fontSize: 11, color: PALETTE.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                  PID Chain: {activeAttack.pid_chain?.join(" -> ") || "No local processes"} · File: {activeAttack.filepath?.split(/[\\/]/).pop()} · H: {activeAttack.entropy?.toFixed(3)}
                </div>
              </div>
            </div>
            {recoveryTimer !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Clock size={14} color={PALETTE.accentAmber} />
                <span style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.accentAmber }}>
                  Auto-Rollback processing: {recoveryTimer.toFixed(1)}s
                </span>
              </div>
            )}
          </div>
        )}

        {/* MAIN PANEL CONTENT */}
        <main style={{ padding: "24px 28px", flex: 1 }}>
          {tab === "dashboard" && (
            <DashboardTab
              eventCount={eventCount} attackCount={attackCount} attacks={attacks}
              snapshots={snapshots} fileChanges={fileChanges}
              status={status} auditStatus={auditStatus}
              onManualSnapshot={onManualSnapshot}
              onManualRollback={onManualRollback}
              onDownloadReport={onDownloadReport}
              onVerifyAudit={onVerifyAudit}
              activeColors={activeColors}
              onDemoStart={onDemoStart}
              onDemoReset={onDemoReset}
            />
          )}
          {tab === "network" && (
            <NetworkMap
              network={network}
              onRefresh={onRefreshNetwork}
              onCampaignStart={onCampaignStart}
              onCampaignStop={onCampaignStop}
              isAttack={status === "under_attack"}
              impactFx={settings.impactFx}
              sound={settings.sound}
              animDensity={settings.animDensity}
            />
          )}
          {tab === "attacks" && (
            <AttacksTab attacks={attacks} onDownloadReport={onDownloadReport} activeColors={activeColors} />
          )}
          {tab === "snapshots" && (
            <SnapshotsTab snapshots={snapshots} onManualSnapshot={onManualSnapshot} activeColors={activeColors} />
          )}
          {tab === "livelog" && (
            <LiveLogTab fileChanges={fileChanges} logRef={logRef} />
          )}
          {tab === "datacorr" && (
            <DataCorruptionPanel patients={demoPatients} demoState={demoState} settings={settings} />
          )}
        </main>
      </div>

      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 4px ${activeColors.main}; }
          50% { box-shadow: 0 0 16px ${activeColors.main}; }
          100% { box-shadow: 0 0 4px ${activeColors.main}; }
        }
        @keyframes flashFade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
      `}</style>
    </div>
  );
}

// Stats widget grid helper
function DashboardTab({
  eventCount, attackCount, attacks, snapshots, fileChanges, status, auditStatus,
  onManualSnapshot, onManualRollback, onDownloadReport, onVerifyAudit, activeColors,
  onDemoStart, onDemoReset
}) {
  const latest = snapshots[0];
  const avgEntropy = fileChanges.length > 0 
    ? (fileChanges.reduce((acc, c) => acc + (parseFloat(c.entropy) || 0), 0) / fileChanges.length).toFixed(3)
    : "1.240";

  let confidence = "100%";
  if (attacks && attacks.length > 0) {
    const recovered = attacks.filter(a => a.rollback?.success).length;
    confidence = Math.round((recovered / attacks.length) * 100) + "%";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 3D Shield Centerpiece Hero Section */}
      <ShieldHero status={status} />

      {/* Dynamic Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <StatCard icon={Activity} label="REALTIME TELEMETRY EVENTCOUNT" value={eventCount.toLocaleString()} sub="Events processed" accent={PALETTE.accentTeal} />
        <StatCard icon={ShieldAlert} label="PREEMPTIVE BLOCKS" value={attackCount} sub="Threats auto-mitigated" accent={attackCount > 0 ? PALETTE.accentRed : PALETTE.accentTeal} />
        <StatCard icon={Clock} label="RECOVERY CONFIDENCE SLA" value={confidence} sub="Rollback validation successful" accent={PALETTE.accentTeal} />
        <StatCard icon={HardDrive} label="PROTECTED SNAPSHOT SHARES" value={latest ? `${latest.file_count} files` : "0 shares"} sub={latest ? `Active: ${(latest.name || "").slice(0, 14)}` : "No backups"} accent={PALETTE.accentTeal} />
      </div>

      {/* Realtime Entropy analysis charting panel */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{
          background: PALETTE.bgPanelGlass, border: `1px solid ${activeColors.border}`,
          borderRadius: 8, padding: 20, backdropFilter: "blur(8px)"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'Space Grotesk', sans-serif" }}>
              PER-FILE ENTROPY SPECTRUM RECORD
            </div>
            <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.textMuted }}>
              AGGREGATED REALTIME MEAN: H = {avgEntropy}
            </div>
          </div>
          
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={(fileChanges || []).slice().reverse().map(c => ({...c, entropy: parseFloat(c.entropy) || 0}))}>
              <defs>
                <linearGradient id="entropyGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={activeColors.main} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={activeColors.main} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.02)" />
              <XAxis hide />
              <YAxis domain={[0, 8]} tick={{ fill: PALETTE.textMuted, fontSize: 10 }} />
              <Tooltip
                contentStyle={{ background: PALETTE.bgPanel, border: `1px solid ${activeColors.border}`, borderRadius: 4, fontSize: 11 }}
                labelFormatter={() => "File Event Data"}
              />
              <Area type="monotone" dataKey="entropy" stroke={activeColors.main} strokeWidth={2} fill="url(#entropyGlow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Operational recovery controls */}
        <div style={{
          background: PALETTE.bgPanelGlass, border: `1px solid ${activeColors.border}`,
          borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'Space Grotesk', sans-serif", marginBottom: 4 }}>
            MANUAL REMEDIATION UTILITIES
          </div>
          {[
            { label: "Start Live Demo", sub: "Simulate ransomware locally", icon: Play, color: PALETTE.accentRed, fn: onDemoStart },
            { label: "Trigger Manual Snapshot", sub: "Lock file state manifest", icon: Camera, color: PALETTE.accentTeal, fn: onManualSnapshot },
            { label: "Execute Rollback Recovery", sub: "Revert monitored directory", icon: RefreshCw, color: PALETTE.accentAmber, fn: onManualRollback },
            { label: "Reset Demo Environment", sub: "Clean up simulated files", icon: RotateCcw, color: PALETTE.accentAmber, fn: onDemoReset },
            { label: "Verify Audit Chain", sub: "Recalculate hash verification", icon: ShieldCheck, color: PALETTE.accentTeal, fn: onVerifyAudit },
            { label: "Generate Incident Report", sub: "Gemini + ReportLab compiler", icon: Download, color: PALETTE.accentTeal, fn: () => onDownloadReport(null) }
          ].map((item) => {
            const ItemIcon = item.icon;
            return (
              <button key={item.label} onClick={item.fn} style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 6, padding: "12px 16px", cursor: "pointer", textAlign: "left", transition: "all 0.15s ease"
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                  background: `${item.color}10`, border: `1px solid ${item.color}30`
                }}>
                  <ItemIcon size={14} color={item.color} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: PALETTE.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: PALETTE.textMuted }}>{item.sub}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live trace activity stream snippet */}
      <div style={{
        background: PALETTE.bgPanelGlass, border: `1px solid ${activeColors.border}`,
        borderRadius: 8, padding: 20
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'Space Grotesk', sans-serif" }}>
            REALTIME IO FEED TICKER
          </div>
          {auditStatus && (
            <div style={{
              fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
              color: auditStatus.valid ? PALETTE.accentTeal : PALETTE.accentRed
            }}>
              AUDIT HASHCHAIN LOG: {auditStatus.valid ? "INTEGRITY VALIDATED" : "CHAIN CORRUPT / INVAL"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fileChanges.length === 0 ? (
            <div style={{ color: PALETTE.textMuted, fontSize: 11, textAlign: "center", padding: "16px 0", fontFamily: "'JetBrains Mono', monospace" }}>
              WAITING FOR SYSTEM ACTIVITY STIMULI IN DETECTOR PATH...
            </div>
          ) : (
            (fileChanges || []).slice(0, 5).map((change, index) => (
              <div key={change.id || index} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "8px 12px",
                background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)", borderRadius: 4,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11
              }}>
                <span style={{ color: PALETTE.textMuted }}>{fmtTime(change.ts)}</span>
                <span style={{
                  color: change.entropy >= 7.2 ? PALETTE.accentRed : PALETTE.accentTeal,
                  fontWeight: 700
                }}>
                  [{change.entropy >= 7.2 ? "THREAT" : "OK"}]
                </span>
                <span style={{ flex: 1, color: PALETTE.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {change.filepath}
                </span>
                <span style={{ color: PALETTE.textMuted }}>H={change.entropy?.toFixed(3)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Metric block helper components
function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div style={{
      background: PALETTE.bgPanelGlass, border: "1px solid rgba(255,255,255,0.03)",
      borderRadius: 8, padding: 18, position: "relative"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon size={14} color={accent} />
        <span style={{ fontSize: 9, color: PALETTE.textMuted, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'Space Grotesk', sans-serif" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: PALETTE.textPrimary, letterSpacing: "-0.02em", fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: PALETTE.textMuted, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// Attacks listing Tab
function AttacksTab({ attacks, onDownloadReport, activeColors }) {
  if (attacks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0", color: PALETTE.textMuted }}>
        <ShieldCheck size={40} color={PALETTE.accentTeal} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: PALETTE.textPrimary }}>SYSTEM OPERATIONALLY HEALTHY</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>No ransomware encryptor threats isolated. Run simulator to trigger.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {attacks.map((atk, index) => (
        <div key={atk.attack_id || index} style={{
          background: PALETTE.bgPanelGlass, border: `1px solid ${activeColors.border}`,
          borderRadius: 8, padding: 16
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: PALETTE.accentRed, fontFamily: "'Space Grotesk', sans-serif" }}>
                THREAT INCIDENT ISOLATED (ID: #{atk.attack_id})
              </div>
              <div style={{ fontSize: 10, color: PALETTE.textMuted, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
                Timestamp: {new Date(atk.timestamp * 1000).toLocaleString()}
              </div>
            </div>
            <button onClick={() => onDownloadReport(atk.attack_id)} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "none",
              border: `1px solid ${PALETTE.accentTeal}`, color: PALETTE.accentTeal, cursor: "pointer", borderRadius: 4,
              fontSize: 10, fontFamily: "'Space Grotesk', sans-serif"
            }}>
              <Download size={12} /> EXPORT CRYPTO LOGS (PDF)
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
            <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: PALETTE.textMuted }}>TARGET VECTOR PATH</div>
              <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.textPrimary, wordBreak: "break-all" }}>
                {atk.filepath}
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: PALETTE.textMuted }}>MAX MEASURED ENTROPY (H)</div>
              <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.accentRed, fontWeight: 700 }}>
                {atk.entropy?.toFixed(4)} / 8.000
              </div>
            </div>
            <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: PALETTE.textMuted }}>THREAT ESTIMATE SCORE</div>
              <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.accentRed, fontWeight: 700 }}>
                {atk.threat_score} / 100
              </div>
            </div>
          </div>

          {/* Process Ancestry Kill-Chain Section */}
          {atk.pid_chain && atk.pid_chain.length > 0 && (
            <div style={{
              background: "rgba(0, 0, 0, 0.2)", padding: 12, borderRadius: 6, marginBottom: 12,
              border: "1px solid rgba(255, 255, 255, 0.05)"
            }}>
              <div style={{ fontSize: 10, color: PALETTE.textMuted, fontWeight: 700, marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif" }}>
                PROCESS ANCESTRY LOG (KILL-CHAIN VECTOR)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {atk.pid_chain.map((proc, pIdx) => (
                  <React.Fragment key={pIdx}>
                    <div style={{
                      background: pIdx === atk.pid_chain.length - 1 ? "rgba(255,59,78,0.15)" : "rgba(255,255,255,0.03)",
                      border: pIdx === atk.pid_chain.length - 1 ? `1px solid ${PALETTE.accentRed}` : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 4, padding: "4px 8px", fontSize: 11, fontFamily: "'JetBrains Mono', monospace"
                    }}>
                      <span style={{ color: pIdx === atk.pid_chain.length - 1 ? PALETTE.accentRed : PALETTE.accentTeal }}>
                        {proc.name || proc.cmd || "PID:" + proc.pid}
                      </span>
                      <span style={{ color: PALETTE.textMuted, fontSize: 9, marginLeft: 6 }}>
                        (PID: {proc.pid})
                      </span>
                    </div>
                    {pIdx < atk.pid_chain.length - 1 && (
                      <span style={{ color: PALETTE.textMuted, fontSize: 12 }}>&rarr;</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {atk.rollback && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px",
              background: "rgba(25, 227, 194, 0.04)", border: `1px solid ${PALETTE.borderTeal}`, borderRadius: 6
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                <CheckCircle size={14} color={PALETTE.accentTeal} />
                <span style={{ color: PALETTE.accentTeal, fontWeight: 700 }}>
                  Automated Rollback Complete: Restored {atk.rollback.files_restored} files from [{atk.rollback.snapshot_name}] in {atk.rollback.duration_seconds?.toFixed(3)}s.
                </span>
              </div>
              
              {atk.rollback.integrity && (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 4,
                  borderTop: "1px solid rgba(25, 227, 194, 0.1)", paddingTop: 8,
                  fontSize: 10, fontFamily: "'JetBrains Mono', monospace"
                }}>
                  <div>
                    <span style={{ color: PALETTE.textMuted }}>SHA-256 VERIFIED:</span>{" "}
                    <span style={{ color: PALETTE.accentTeal }}>{atk.rollback.integrity.verified}</span>
                  </div>
                  <div>
                    <span style={{ color: PALETTE.textMuted }}>MISSED:</span>{" "}
                    <span style={{ color: atk.rollback.integrity.missing > 0 ? PALETTE.accentRed : PALETTE.textPrimary }}>
                      {atk.rollback.integrity.missing}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: PALETTE.textMuted }}>MISMATCH:</span>{" "}
                    <span style={{ color: atk.rollback.integrity.mismatch > 0 ? PALETTE.accentRed : PALETTE.textPrimary }}>
                      {atk.rollback.integrity.mismatch}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: PALETTE.textMuted }}>EXTRA:</span>{" "}
                    <span style={{ color: PALETTE.textPrimary }}>{atk.rollback.integrity.extra}</span>
                  </div>
                  <div>
                    <span style={{ color: PALETTE.textMuted }}>STATUS:</span>{" "}
                    <span style={{ color: atk.rollback.integrity.ok ? PALETTE.accentTeal : PALETTE.accentRed, fontWeight: 700 }}>
                      {atk.rollback.integrity.ok ? "PASS" : "FAIL"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Snapshot list tab
function SnapshotsTab({ snapshots, onManualSnapshot, activeColors }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, color: PALETTE.textMuted }}>
          Incremental Snapshot Backups (Interval: 30s)
        </div>
        <button onClick={onManualSnapshot} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
          background: "none", border: `1px solid ${PALETTE.accentTeal}`, color: PALETTE.accentTeal,
          borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Space Grotesk', sans-serif"
        }}>
          <Camera size={12} /> TAKE SNAPSHOT NOW
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: PALETTE.textMuted }}>
          Awaiting backup initialization trigger.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {snapshots.map((snap) => (
            <div key={snap.name} style={{
              background: PALETTE.bgPanelGlass, border: "1px solid rgba(255,255,255,0.03)",
              borderRadius: 6, padding: 14, fontFamily: "'JetBrains Mono', monospace"
            }}>
              <div style={{ fontSize: 11, color: PALETTE.accentTeal, fontWeight: 700, marginBottom: 8 }}>
                {snap.name}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                <span style={{ color: PALETTE.textMuted }}>FILE COUNT</span>
                <span style={{ color: PALETTE.textPrimary }}>{snap.file_count}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 6 }}>
                <span style={{ color: PALETTE.textMuted }}>DISK SIZE</span>
                <span style={{ color: PALETTE.textPrimary }}>{(snap.size_bytes / 1024).toFixed(2)} KB</span>
              </div>
              <div style={{ fontSize: 9, color: PALETTE.textMuted }}>
                Timestamp: {fmtTime(snap.timestamp)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Live telemetry log Tab
function LiveLogTab({ fileChanges, logRef }) {
  return (
    <div style={{
      background: PALETTE.bgPanel, border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 8, padding: 20, fontFamily: "'JetBrains Mono', monospace"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: PALETTE.accentTeal }}>
          $ tail -f /var/log/ransomshield/telemetry.stream
        </div>
        <Radio size={14} color={PALETTE.accentTeal} style={{ animation: "pulseGlow 2s infinite" }} />
      </div>
      <div ref={logRef} style={{ maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {fileChanges.length === 0 ? (
          <div style={{ color: PALETTE.textMuted, fontSize: 11 }}>
            Awaiting active telemetry flow input...
          </div>
        ) : (
          fileChanges.map((change) => (
            <div key={change.id} style={{
              display: "flex", gap: 12, padding: "3px 0", fontSize: 11,
              borderBottom: "1px solid rgba(255,255,255,0.01)"
            }}>
              <span style={{ color: PALETTE.textMuted }}>
                {new Date(change.ts).toLocaleTimeString()}
              </span>
              <span style={{
                color: change.entropy >= 7.2 ? PALETTE.accentRed : PALETTE.accentTeal,
                fontWeight: 700
              }}>
                [{change.entropy >= 7.2 ? "TRIGGER" : "OK"}]
              </span>
              <span style={{ flex: 1, color: PALETTE.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {change.filepath}
              </span>
              <span style={{ color: PALETTE.accentAmber }}>
                H={change.entropy?.toFixed(4)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Persistent Metrics Summary strip
function MetricsStrip({ attacks, attackCount, network, activeColors }) {
  const contained = attacks.filter((a) =>
    (a.freeze_results || []).some((f) => f && f.success)
  ).length;
  const recovered = attacks.filter((a) => a.rollback?.success).length;
  const protectedHospitals = (network?.nodes || []).filter(
    (n) => (n.intel_count || 0) > 0
  ).length;

  const items = [
    { label: "THREATS ISOLATED", value: String(attackCount || 0), icon: Zap, color: PALETTE.accentRed },
    { label: "PROCESS CONTAINMENTS", value: String(contained), icon: ShieldCheck, color: PALETTE.accentTeal },
    { label: "ROLLBACK RECOVERIES", value: String(recovered), icon: RefreshCw, color: PALETTE.accentAmber },
    { label: "ARMED NETWORK MESH NODES", value: network ? String(protectedHospitals) : "0", icon: Network, color: PALETTE.accentTeal }
  ];

  return (
    <div style={{
      display: "flex", background: "rgba(13, 18, 31, 0.4)",
      borderBottom: `1px solid ${activeColors.border}`
    }}>
      {items.map((it, i) => (
        <div key={it.label} style={{
          flex: 1, display: "flex", alignItems: "center", gap: 10,
          padding: "10px 20px", borderRight: i < items.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none"
        }}>
          <it.icon size={14} color={it.color} />
          <div>
            <div style={{ fontSize: 8, color: PALETTE.textMuted, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "'Space Grotesk', sans-serif" }}>
              {it.label}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: PALETTE.textPrimary }}>
              {it.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
