import React, { useState, useEffect, useRef, useCallback } from "react";
import Dashboard from "./components/Dashboard";
import { unlockAudio, playAlarm, playCorruptionTick, playDetectionStinger, playRecoveryChime, playCompletionSound } from "./audio";
import { dummyPatients } from "./data/dummyPatients";
import { initialDemoNetwork, createDemoCampaign } from "./data/dummyNetwork";

const WS_URL = process.env.REACT_APP_WS_URL || "ws://localhost:8000/ws";
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("protected");
  const [attacks, setAttacks] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [eventCount, setEventCount] = useState(0);
  const [attackCount, setAttackCount] = useState(0);
  const [uptimeSeconds, setUptimeSeconds] = useState(0);
  const [hospital, setHospital] = useState("Hospital System");
  const [activeAttack, setActiveAttack] = useState(null);
  const [recoveryTimer, setRecoveryTimer] = useState(null);
  const [fileChanges, setFileChanges] = useState([]);
  const [auditStatus, setAuditStatus] = useState(null);
  const [network, setNetwork] = useState(initialDemoNetwork);
  const [forcedTab, setForcedTab] = useState(null);
  
  // Phase 8: Pure Frontend Demo State
  const [demoPatients, setDemoPatients] = useState(dummyPatients);
  const [demoState, setDemoState] = useState("protected"); // protected -> under_attack -> detecting -> recovering -> complete
  const demoTimersRef = useRef([]);
  const stopAlarmRef = useRef(null);
  // Dashboard settings — persisted; driven from the header Settings popover.
  const SETTING_DEFAULTS = {
    impactFx: true,        // impact cue: screen shake + static-map freeze
    sound: true,           // global audio (the impact blip)
    animDensity: "full",   // "full" | "reduced" | "off" map motion
  };
  const [settings, setSettings] = useState(() => {
    // Respect the OS-level "reduce motion" preference as the starting point:
    // first-time visitors who request it start in the "Static" FX preset —
    // map static and shake-free, sound still on — instead of the demo
    // default "Full" motion. Explicit choices made in the Settings popover
    // override this and persist like any other setting.
    const reducedMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const s = reducedMotion
      ? { ...SETTING_DEFAULTS, impactFx: false, animDensity: "off" }
      : { ...SETTING_DEFAULTS };
    try {
      const raw = JSON.parse(localStorage.getItem("rs.settings") || "{}");
      for (const k of Object.keys(SETTING_DEFAULTS)) {
        if (typeof raw[k] !== "undefined") s[k] = raw[k];
      }
    } catch { /* corrupt storage — fall back to defaults */ }
    // Migrate the pre-popover key ("impactCue") into impactFx.
    const legacy = localStorage.getItem("impactCue");
    if (legacy !== null && s.impactFx) s.impactFx = legacy !== "off";
    return s;
  });
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const recoveryIntervalRef = useRef(null);
  const fileChangeIdRef = useRef(0);

  const refreshAudit = useCallback(async () => {
    if (demoState !== "protected" || !connected) {
      // Mock audit chain validation
      setAuditStatus({
        valid: true,
        entries: 42,
        last_hash: "a8f3...b9c0"
      });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/audit`);
      if (res.ok) setAuditStatus(await res.json());
    } catch {
      // backend unreachable — keep previous status
    }
  }, [demoState, connected]);

  const refreshNetwork = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/network`);
      if (res.ok) setNetwork(await res.json());
    } catch {
      // backend unreachable — keep previous state
    }
  }, []);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      console.log(`[WS] Connecting to ${WS_URL}…`);

      ws.onopen = () => {
        setConnected(true);
        clearTimeout(reconnectRef.current);
        console.log("[WS] ✅ Connected to RansomShield backend");
      };

      ws.onclose = (e) => {
        setConnected(false);
        console.warn(`[WS] ❌ Disconnected (code=${e.code}) — retrying in 3s`);
        reconnectRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (e) => {
        console.error("[WS] Error:", e);
        ws.close();
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          // Log every message type; suppress heartbeat verbosity after first 3
          if (msg.type !== "heartbeat") {
            console.log(`[WS ▶ ${msg.type}]`, msg);
          }
          handleMessage(msg);
        } catch (err) {
          console.error("[WS] Failed to parse message:", e.data, err);
        }
      };
    } catch (err) {
      console.error("[WS] Failed to create WebSocket:", err);
      reconnectRef.current = setTimeout(connect, 3000);
    }
  }, []);

  const handleMessage = (msg) => {
    switch (msg.type) {
      case "init":
        console.log(`[WS init] status=${msg.status} events=${msg.event_count} hospital=${msg.hospital}`);
        setStatus(msg.status || "protected");
        setAttacks(msg.attack_log || []);
        setSnapshots(msg.snapshots || []);
        setEventCount(msg.event_count || 0);
        setHospital(msg.hospital || "Hospital System");
        setUptimeSeconds(msg.uptime_seconds || 0);
        break;

      case "heartbeat":
        setEventCount(msg.event_count || 0);
        setAttackCount(msg.attack_count || 0);
        setUptimeSeconds(msg.uptime_seconds || 0);
        break;

      case "file_change":
        console.log(`[WS file_change] #${msg.event_count} H=${msg.entropy?.toFixed(3)} score=${msg.threat_score} → ${msg.filepath?.split(/[/\\]/).pop()}`);
        setEventCount(msg.event_count || 0);
        // Date.now() collides when an attack/rollback floods events within
        // the same millisecond, producing duplicate React keys; use a
        // monotonic counter for the key and keep the wall-clock time in a
        // separate field for display.
        const ts = Date.now();
        const nextId = ++fileChangeIdRef.current;
        setFileChanges((prev) => [
          { ...msg, id: nextId, ts },
          ...prev.slice(0, 49),
        ]);
        break;

      case "attack_detected":
        console.warn(`[WS attack_detected] #${msg.attack_id} score=${msg.threat_score} entropy=${msg.entropy}`);
        setStatus("under_attack");
        setAttacks((prev) => [msg, ...prev]);
        setActiveAttack(msg);
        setAttackCount((c) => c + 1);
        refreshAudit();
        refreshNetwork();
        // Start recovery countdown. Always clear the previous timer so a
        // second attack can't stack intervals, and always terminate the
        // countdown — a falsy/missing rollback duration previously left the
        // timer running and the dashboard stuck on "under attack" forever.
        if (recoveryIntervalRef.current) {
          clearInterval(recoveryIntervalRef.current);
        }
        const start = Date.now();
        const rollbackDuration = msg.rollback?.duration_seconds;
        // Bounded window: measured rollback time + margin, or a sane cap
        // when rollback data is missing/failed.
        const bound = rollbackDuration > 0 ? rollbackDuration + 1 : 15;
        recoveryIntervalRef.current = setInterval(() => {
          const elapsed = (Date.now() - start) / 1000;
          setRecoveryTimer(elapsed);
          if (elapsed >= bound) {
            clearInterval(recoveryIntervalRef.current);
            recoveryIntervalRef.current = null;
            setStatus("protected");
            setTimeout(() => setActiveAttack(null), 8000);
          }
        }, 100);
        break;

      case "rollback_complete":
        console.log("[WS rollback_complete]", msg.rollback);
        setStatus("protected");
        break;

      case "network_update":
        setNetwork(prev => (prev && prev.campaign) ? prev : msg.network);
        break;

      case "snapshot_taken":
        console.log("[WS snapshot_taken]", msg.snapshot?.name);
        setSnapshots((prev) => [msg.snapshot, ...prev].slice(0, 10));
        break;

      case "demo_started":
        setForcedTab("livelog");
        break;

      case "demo_reset":
        setForcedTab("dashboard");
        break;

      default:
        console.log(`[WS unknown type: ${msg.type}]`, msg);
        break;
    }
  };

  useEffect(() => {
    connect();
    refreshAudit();
    refreshNetwork();
    return () => {
      clearTimeout(reconnectRef.current);
      if (recoveryIntervalRef.current) {
        clearInterval(recoveryIntervalRef.current);
      }
      wsRef.current?.close();
      demoTimersRef.current.forEach(clearTimeout);
      if (stopAlarmRef.current) stopAlarmRef.current();
    };
  }, [connect]);

  // Unlock the shared AudioContext on the first pointer/key interaction so
  // campaign-impact sounds play even when the campaign was started via the
  // API (run_demo.sh) rather than a dashboard button. `once` keeps it to a
  // single gesture; a later resume() attempt in the impact handler is a
  // harmless no-op if the context is already running.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("rs.settings", JSON.stringify(settings));
  }, [settings]);

  // Phase 8: Constant low-level telemetry heartbeat for "Liveliness"
  useEffect(() => {
    if (demoState !== "protected" && status === "under_attack") return;

    const interval = setInterval(() => {
      setFileChanges(prev => {
        const ts = Date.now();
        const baseEntropy = 1.0 + Math.random() * 1.5;
        const fakeFile = `sys_log_${Math.floor(Math.random()*1000)}.dat`;
        return [
          {
            id: ts + Math.random(),
            ts,
            filepath: `C:\\Windows\\System32\\logs\\${fakeFile}`,
            entropy: baseEntropy,
            threat_score: 0,
          },
          ...prev.slice(0, 49)
        ];
      });
      // Optionally increment event count for liveliness
      setEventCount(c => c + 1);
    }, 1200);

    return () => clearInterval(interval);
  }, [demoState, status]);

  const triggerManualSnapshot = async () => {
    if (demoState !== "protected" || !connected) {
      // Mock snapshot for demo
      const snap = {
        name: `snap_${Date.now()}`,
        file_count: 1420,
        size_bytes: 45000000 + Math.random() * 5000000,
        timestamp: Date.now() / 1000
      };
      setSnapshots(prev => [snap, ...prev]);
      return;
    }
    try {
      await fetch(`${API_URL}/snapshot/manual`, { method: "POST" });
    } catch {}
  };

  const triggerManualRollback = async () => {
    if (demoState !== "protected" || !connected) {
      setDemoState("recovering");
      setTimeout(() => {
        setDemoState("protected");
        setDemoPatients(dummyPatients.map(p => ({ ...p, status: "protected" })));
      }, 3000);
      return;
    }
    try {
      await fetch(`${API_URL}/rollback/manual`, { method: "POST" });
    } catch {}
  };


  const startCampaign = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/network/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: 42 }), // deterministic replay for the demo
      });
      if (res.ok) refreshNetwork();
    } catch {
      // backend unreachable — keep previous state
    }
  }, [refreshNetwork]);

  const stopCampaign = useCallback(async () => {
    // 1. Cancel frontend demo if running
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    if (stopAlarmRef.current) {
      stopAlarmRef.current();
      stopAlarmRef.current = null;
    }
    setDemoState("protected");
    setDemoPatients(dummyPatients);
    setNetwork(initialDemoNetwork);
    setForcedTab(null);
    setFileChanges([]);

    // 2. Try to stop live backend campaign if connected
    try {
      await fetch(`${API_URL}/network/campaign/stop`, { method: "POST" });
      refreshNetwork();
    } catch {
      // backend unreachable — keep previous state
    }
  }, [refreshNetwork]);


  const startDemo = async () => {
    // Pure frontend simulation for Phase 8
    setForcedTab("datacorr");
    setDemoState("under_attack");
    
    // Inject Mock Network for Map Visualization
    const campaignData = createDemoCampaign();
    let currentMockNetwork = { ...initialDemoNetwork, campaign: campaignData };
    setNetwork(currentMockNetwork);

    // Schedule Network Campaign progression
    campaignData.acts.forEach(act => {
      const actTimer = setTimeout(() => {
        setNetwork(prev => {
          if (!prev || !prev.campaign || !prev.campaign.acts) return prev;
          const newActs = prev.campaign.acts.map(a => a.index === act.index ? { ...a, fired: true } : a);
          const newNodes = (prev.nodes || []).map(n => 
            (act.hits || []).includes(n.id) ? { ...n, status: "attacked" } : n
          );
          const counts = { protected: 0, attacked: 0, quarantined: 0, recovered: 0 };
          newNodes.forEach(n => counts[n.status || "protected"]++);
          return { ...prev, nodes: newNodes, counts, campaign: { ...prev.campaign, acts: newActs } };
        });

        // Queue Quarantine transition
        const qTimer = setTimeout(() => {
           setNetwork(prev => {
              if (!prev || !prev.campaign) return prev;
              const newNodes = (prev.nodes || []).map(n => 
                (act.hits || []).includes(n.id) ? { ...n, status: "quarantined" } : n
              );
              const counts = { protected: 0, attacked: 0, quarantined: 0, recovered: 0 };
              newNodes.forEach(n => counts[n.status || "protected"]++);
              return { ...prev, nodes: newNodes, counts };
           });
        }, 3500);
        demoTimersRef.current.push(qTimer);

        // Queue Recovery transition
        const rTimer = setTimeout(() => {
           setNetwork(prev => {
              if (!prev || !prev.campaign) return prev;
              const newNodes = (prev.nodes || []).map(n => 
                (act.hits || []).includes(n.id) ? { ...n, status: "recovered" } : n
              );
              const counts = { protected: 0, attacked: 0, quarantined: 0, recovered: 0 };
              newNodes.forEach(n => counts[n.status || "protected"]++);
              return { ...prev, nodes: newNodes, counts };
           });
        }, 11000);
        demoTimersRef.current.push(rTimer);

      }, act.at * 1000);
      demoTimersRef.current.push(actTimer);
    });
    
    // Stop any existing alarm before starting a new one
    if (stopAlarmRef.current) stopAlarmRef.current();
    stopAlarmRef.current = playAlarm(settings);

    // Prepare patient dataset
    setDemoPatients(dummyPatients.map(p => ({ ...p, status: "protected" })));
    
    let corruptedCount = 0;
    const targetCorruption = Math.floor(dummyPatients.length * 0.7); // 70% gets encrypted

    const corruptNext = (index) => {
      if (index >= targetCorruption) {
        // Halt corruption -> Detection fires
        setDemoState("detecting");
        if (stopAlarmRef.current) {
          stopAlarmRef.current();
          stopAlarmRef.current = null;
        }
        playDetectionStinger(settings);

        // Wait a beat before recovery
        const t = setTimeout(() => {
          setDemoState("recovering");
          recoverNext(targetCorruption - 1, 0);
        }, 1500);
        demoTimersRef.current.push(t);
        return;
      }

      setDemoPatients(prev => {
        const next = [...prev];
        if (next[index]) next[index] = { ...next[index], status: "corrupted" };
        return next;
      });
      playCorruptionTick(settings);
      
      // Inject mock file change
      const ts = Date.now();
      const patient = dummyPatients[index];
      setFileChanges(prev => [
        {
          id: ts + Math.random(),
          ts,
          filepath: `C:\\Hospital\\Records\\${patient?.name?.replace(/ /g, "_") || "Unknown"}.pdf`,
          entropy: 7.5 + Math.random() * 0.4,
          threat_score: 85 + Math.random() * 15,
        },
        ...prev.slice(0, 49)
      ]);
      setEventCount(c => c + 1);
      
      const delay = Math.random() * 70 + 80; // 80-150ms staggered
      const t = setTimeout(() => corruptNext(index + 1), delay);
      demoTimersRef.current.push(t);
    };

    const recoverNext = (index, restoredCount) => {
      if (index < 0) {
        // Complete
        setDemoState("complete");
        playCompletionSound(settings);
        
        // Auto-return to Overview after 6 seconds
        const t = setTimeout(() => {
          setForcedTab("dashboard");
          setDemoState("protected");
          setDemoPatients(dummyPatients.map(p => ({ ...p, status: "protected" })));
        }, 6000);
        demoTimersRef.current.push(t);
        return;
      }

      setDemoPatients(prev => {
        const next = [...prev];
        if (next[index]) next[index] = { ...next[index], status: "restored" };
        return next;
      });
      playRecoveryChime(settings, restoredCount);
      
      // Inject mock file recovery
      const ts = Date.now();
      const patient = dummyPatients[index];
      setFileChanges(prev => [
        {
          id: ts + Math.random(),
          ts,
          filepath: `C:\\Hospital\\Records\\${patient?.name?.replace(/ /g, "_") || "Unknown"}.pdf [RESTORED]`,
          entropy: 3.5 + Math.random() * 1.5,
          threat_score: 0,
        },
        ...prev.slice(0, 49)
      ]);
      setEventCount(c => c + 1);
      
      const delay = Math.random() * 50 + 100;
      const t = setTimeout(() => recoverNext(index - 1, restoredCount + 1), delay);
      demoTimersRef.current.push(t);
    };

    // Kick off attack sequence after short delay
    const t = setTimeout(() => corruptNext(0), 500);
    demoTimersRef.current.push(t);
  };

  const resetDemo = async () => {
    // Pure frontend simulation reset
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    if (stopAlarmRef.current) {
      stopAlarmRef.current();
      stopAlarmRef.current = null;
    }
    setDemoState("protected");
    setDemoPatients(dummyPatients.map(p => ({ ...p, status: "protected" })));
    setNetwork(null); // Reset network back to API-driven logic
    setFileChanges([]);
    setEventCount(0);
    setAttackCount(0);
    setAttacks([]);
    setForcedTab("dashboard");
  };

  const downloadReport = async (attackId) => {
    const id = attackId || 1;
    const url = attackId
      ? `${API_URL}/report/${id}`
      : `${API_URL}/report/demo`;
    // /report/{id} is a POST endpoint; the demo report is a GET endpoint.
    const res = await fetch(url, attackId ? { method: "POST" } : undefined);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `RansomShield_Incident_${String(id).padStart(3, "0")}.pdf`;
    a.click();
  };

  return (
    <Dashboard
      connected={connected}
      status={demoState === "under_attack" ? "under_attack" : status}
      attacks={attacks}
      snapshots={snapshots}
      eventCount={eventCount}
      attackCount={attackCount}
      uptimeSeconds={uptimeSeconds}
      hospital={hospital}
      activeAttack={activeAttack}
      recoveryTimer={recoveryTimer}
      fileChanges={fileChanges}
      auditStatus={auditStatus}
      network={network}
      onManualSnapshot={triggerManualSnapshot}
      onManualRollback={triggerManualRollback}
      onDownloadReport={downloadReport}
      onVerifyAudit={refreshAudit}
      forcedTab={forcedTab}
      onDemoStart={startDemo}
      onDemoReset={resetDemo}
      demoPatients={demoPatients}
      demoState={demoState}
      settings={settings}
      onSettingsChange={(patch) => setSettings(s => ({ ...s, ...patch }))}
      onRefreshNetwork={refreshNetwork}
      onCampaignStart={startCampaign}
      onCampaignStop={stopCampaign}
    />
  );
}
