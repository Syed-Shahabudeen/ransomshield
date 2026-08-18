import React, { useState, useEffect } from "react";
import { Lock, FileText, CheckCircle, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { playCorruptionTick, playRecoveryChime } from "../audio";

// Scramble text effect
const scramble = (text) => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  return text.split("").map(c => c === " " ? " " : chars[Math.floor(Math.random() * chars.length)]).join("");
};

const hexScramble = (length) => {
  const chars = "0123456789ABCDEF";
  return Array.from({ length }).map(() => chars[Math.floor(Math.random() * chars.length)]).join("");
};

function PatientCard({ data, demoState, settings }) {
  const [glitching, setGlitching] = useState(false);
  const [displayText, setDisplayText] = useState(data.name);
  const [displayDiag, setDisplayDiag] = useState(data.diagnosis);

  useEffect(() => {
    if (data.status === "corrupted") {
      setGlitching(true);
      let frames = 0;
      const interval = setInterval(() => {
        frames++;
        setDisplayText(scramble(data.name));
        setDisplayDiag(scramble(data.diagnosis));
        if (frames > 10) {
          clearInterval(interval);
          setGlitching(false);
          setDisplayText("0x" + hexScramble(data.name.length));
          setDisplayDiag("0x" + hexScramble(data.diagnosis.length));
        }
      }, 30);
      return () => clearInterval(interval);
    } else if (data.status === "restored" || data.status === "protected") {
      if (displayText !== data.name) {
        setGlitching(true);
        let frames = 0;
        const interval = setInterval(() => {
          frames++;
          setDisplayText(scramble(data.name));
          setDisplayDiag(scramble(data.diagnosis));
          if (frames > 10) {
            clearInterval(interval);
            setGlitching(false);
            setDisplayText(data.name);
            setDisplayDiag(data.diagnosis);
          }
        }, 30);
        return () => clearInterval(interval);
      }
    }
  }, [data.status, data.name, data.diagnosis]);

  const isCorrupted = data.status === "corrupted" || data.status === "encrypting";
  const isRecovering = data.status === "recovering";
  const isRestored = data.status === "restored";

  const borderColor = isCorrupted ? "rgba(239,68,68,0.5)" : isRecovering ? "rgba(249,115,22,0.5)" : isRestored ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.05)";
  const bg = isCorrupted ? "rgba(239,68,68,0.05)" : isRecovering ? "rgba(249,115,22,0.05)" : isRestored ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.02)";
  const shakeClass = glitching ? "card-shake" : "";

  return (
    <div className={shakeClass} style={{
      background: bg, border: `1px solid ${borderColor}`, borderRadius: 8, padding: 12,
      display: "flex", flexDirection: "column", gap: 6, position: "relative",
      transition: "all 0.3s ease", overflow: "hidden"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono', monospace" }}>{data.id}</div>
        <div style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "#CBD5E1" }}>
          {data.department}
        </div>
      </div>
      
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <div style={{ position: "relative" }}>
          <FileText size={18} color={isCorrupted ? "#EF4444" : "#64748B"} />
          {isCorrupted && <Lock size={10} color="#EF4444" style={{ position: "absolute", bottom: -2, right: -2, background: "#080B10", borderRadius: 2 }} />}
          {isRestored && <CheckCircle size={10} color="#22C55E" style={{ position: "absolute", bottom: -2, right: -2, background: "#080B10", borderRadius: 2 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: isCorrupted ? "#FCA5A5" : "#F1F5F9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: isCorrupted ? "'JetBrains Mono', monospace" : "inherit" }}>
            {displayText}
          </div>
          <div style={{ fontSize: 11, color: isCorrupted ? "#EF4444" : "#94A3B8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: isCorrupted ? "'JetBrains Mono', monospace" : "inherit" }}>
            {displayDiag}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div style={{ fontSize: 9, color: "#64748B" }}>{data.fileSizeKB} KB • {data.fileType}</div>
        <div style={{ 
          fontSize: 9, fontWeight: 800, textTransform: "uppercase",
          color: isCorrupted ? "#EF4444" : isRecovering ? "#F97316" : isRestored ? "#22C55E" : "#64748B"
        }}>
          {data.status}
        </div>
      </div>

      {isRestored && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 16, background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, borderTop: "1px solid rgba(34,197,94,0.2)" }}>
          <ShieldCheck size={9} color="#22C55E" />
          <span style={{ fontSize: 8, color: "#4ADE80", fontWeight: 700, letterSpacing: "0.05em" }}>INTEGRITY VERIFIED</span>
        </div>
      )}
    </div>
  );
}

// ShieldCheck and Database are now imported at the top

export default function DataCorruptionPanel({ patients, demoState, settings }) {
  const corruptedCount = patients.filter(p => p.status === "corrupted" || p.status === "encrypting").length;
  const restoredCount = patients.filter(p => p.status === "restored").length;
  const total = patients.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16 }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: "#E2E8F0", display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={18} color="#0EA5E9" /> Patient Records Database
          </h2>
          <div style={{ fontSize: 11, color: "#64748B", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={12} color="#F59E0B" /> Synthetic demo data — no real patient records.
          </div>
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          {(demoState === "under_attack" || demoState === "detecting" || demoState === "recovering" || demoState === "complete") && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "8px 12px", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <Lock size={14} color="#EF4444" />
              <span style={{ color: "#FCA5A5", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {corruptedCount} / {total} RECORDS ENCRYPTED
              </span>
            </div>
          )}
          {(demoState === "recovering" || demoState === "complete") && (
            <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", padding: "8px 12px", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle size={14} color="#22C55E" />
              <span style={{ color: "#86EFAC", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                {restoredCount} / {total} RECORDS RESTORED
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingRight: 8, paddingBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {patients.map(p => (
            <PatientCard key={p.id} data={p} demoState={demoState} settings={settings} />
          ))}
        </div>
      </div>

      {demoState === "complete" && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "rgba(2,6,14,0.95)", border: "1px solid rgba(34,197,94,0.4)", borderRadius: 12, padding: 32, textAlign: "center", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", zIndex: 10 }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <ShieldCheck size={32} color="#22C55E" />
          </div>
          <h3 style={{ margin: "0 0 8px 0", color: "#F8FAFC", fontSize: 20 }}>Incident Resolved</h3>
          <p style={{ margin: "0 0 16px 0", color: "#94A3B8", fontSize: 13, maxWidth: 300, lineHeight: 1.5 }}>
            {corruptedCount} records were encrypted before containment. All {restoredCount} have been fully restored. 0 data loss.
          </p>
          <div style={{ fontSize: 11, color: "#64748B" }}>Returning to overview...</div>
        </div>
      )}

      <style>{`
        @keyframes cardShake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-2px); }
          50% { transform: translateX(2px); }
          75% { transform: translateX(-2px); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .card-shake {
            animation: cardShake 0.2s ease-in-out infinite;
          }
        }
      `}</style>
    </div>
  );
}
