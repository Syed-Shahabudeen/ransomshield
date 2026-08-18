#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  RansomShield — ONE-COMMAND LIVE DEMO
# ═══════════════════════════════════════════════════════════════════════════
#  Builds the Java detection engine, starts engine + backend + frontend,
#  verifies health of all three, fires the attack simulator, scripts a
#  deterministic nationwide campaign spread on the network map, then prints
#  the detection / containment / recovery / network-spread / integrity
#  metrics — the full cycle, no multiple terminals.
#
#  Usage:    bash run_demo.sh
#  Requires: Java 17+ on PATH, Python 3.11+ venv at .venv
#            (frontend/node_modules — run `npm install` once if missing;
#            the script does it automatically).
#  Maven:    used from PATH if present, else auto-downloaded on first run.
#
#  Notes:  - The attack simulator is FROZEN (not killed) mid-run by design,
#            so this script terminates the frozen attacker processes after
#            printing metrics and leaves the three servers running.
#          - The demo tree is reset and the audit chain is rotated to a
#            fresh state before the run, so every demo starts clean.
#          - Stale servers on :7000 / :8000 / :3000 are stopped first, so
#            re-running the script is safe.
# ═══════════════════════════════════════════════════════════════════════════

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; CYAN=$'\e[36m'; RESET=$'\e[0m'

say()  { printf '%s%s%s\n' "$CYAN"  "$*" "$RESET"; }
ok()   { printf '%s%s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$*" "$RESET"; }
die()  { printf '%s✖  %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

wait_http() {  # url  tries  label
  local url=$1 tries=${2:-30} label=$3 i
  for i in $(seq 1 "$tries"); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  warn "  $label did not answer at $url after ${tries}s"
  return 1
}

kill_port() {  # stop whatever listens on a port (stale server from a prior run)
  local port=$1 pids p
  pids=$(netstat -ano 2>/dev/null | grep ":$port " | grep -i listening | awk '{print $NF}' | sort -u)
  for p in $pids; do
    [ -n "$p" ] && [ "$p" != "0" ] && taskkill //F //PID "$p" >/dev/null 2>&1 \
      && warn "  stopped stale process $p on :$port"
  done
}

kill_simulators() {  # terminate leftover (frozen) attack simulator processes
  .venv/Scripts/python -X utf8 - <<'PY'
import os, psutil
killed = []
for p in psutil.process_iter(["pid", "name", "cmdline"]):
    if p.pid == os.getpid():
        continue
    try:
        cl = " ".join(p.info["cmdline"] or [])
    except Exception:
        continue
    if "simulate_ransomware" in cl:
        try:
            p.kill(); killed.append(p.pid)
        except Exception:
            pass
if killed:
    print("  terminated stale simulator process(es): " + ", ".join(map(str, killed)))
PY
}

# NOTE: no EXIT trap here. A trap-time psutil scan (kill_simulators) can
# hang for minutes on Windows after `exit`, leaving the finished script
# alive. The explicit kill_simulators call at the end covers the normal
# path, and the next run's STEP 0 cleans up any Ctrl+C leftovers.

say ""
say "═══════════════════════════════════════════════════════════"
say "   🛡  RANSOMSHIELD — FULL DEMO CYCLE (one command)"
say "═══════════════════════════════════════════════════════════"
say ""

# ── STEP 0 — clean slate ────────────────────────────────────────────────────
say "STEP 0/7 — Clean slate (stop stale servers + frozen simulators)"
kill_port 7000; kill_port 8000; kill_port 3000
kill_simulators
ok "  done"

# ── STEP 1 — build the Java engine ──────────────────────────────────────────
say "STEP 1/7 — Build the Java detection engine"

command -v java >/dev/null 2>&1 || die "Java not found on PATH (Java 17+ required)"
JVER=$(java -version 2>&1 | awk -F'"' '/version/ {print $2}')
MAJOR=$(echo "$JVER" | awk -F'[._]' '{print $1}')
[ "$MAJOR" = "1" ] && MAJOR=$(echo "$JVER" | awk -F'[._]' '{print $2}')
if [ "${MAJOR:-0}" -lt 17 ] 2>/dev/null; then die "Java 17+ required — found $JVER"; fi
ok "  Java ${JVER}"

MVN=""
if command -v mvn >/dev/null 2>&1; then MVN=$(command -v mvn)
elif [ -x /tmp/apache-maven-3.9.6/bin/mvn ]; then MVN=/tmp/apache-maven-3.9.6/bin/mvn
elif [ -x "$HOME/apache-maven-3.9.6/bin/mvn" ]; then MVN="$HOME/apache-maven-3.9.6/bin/mvn"
else
  warn "  Maven not found — downloading locally (first run only)..."
  for URL in \
    "https://dlcdn.apache.org/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.zip" \
    "https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.zip"; do
    if curl -fsSL -m 120 -o /tmp/maven.zip "$URL"; then break; fi
  done
  [ -s /tmp/maven.zip ] || die "Failed to download Maven"
  (cd /tmp && unzip -qo maven.zip) || die "Failed to extract Maven"
  MVN=/tmp/apache-maven-3.9.6/bin/mvn
fi

echo "  building with: $MVN  (8 unit tests run as part of the build)"
(cd java-engine && "$MVN" -q package 2>&1 | tail -20)
JAR=java-engine/target/ransomshield-java-engine.jar
[ -f "$JAR" ] || die "Build failed — $JAR was not produced"
ok "  engine jar ready ($(du -h "$JAR" | cut -f1))"

# ── STEP 2 — clean demo state ───────────────────────────────────────────────
say "STEP 2/7 — Prepare clean demo state"
[ -d demo/sample_hospital_files ] || .venv/Scripts/python demo/simulate_ransomware.py --setup >/dev/null
.venv/Scripts/python demo/simulate_ransomware.py --reset >/dev/null 2>&1
TS=$(date +%Y%m%d_%H%M%S)
if [ -f audit/chain.jsonl ]; then
  mv audit/chain.jsonl "audit/chain.previous_${TS}.jsonl"
  warn "  audit chain rotated → audit/chain.previous_${TS}.jsonl (fresh chain for this demo)"
fi
if [ -d snapshots ]; then rm -rf snapshots/*; fi
ok "  demo tree reset — $(find demo/sample_hospital_files -type f 2>/dev/null | wc -l | tr -d ' ') files, snapshots cleared"

# ── STEP 3 — Java engine ────────────────────────────────────────────────────
say "STEP 3/7 — Start the Java detection engine (:7000)"
nohup java -jar "$JAR" --dir demo/sample_hospital_files --port 7000 \
     --backend http://127.0.0.1:8000 </dev/null > java-engine.log 2>&1 &
if ! wait_http http://127.0.0.1:7000/health 40 "Java engine"; then
  tail -15 java-engine.log; die "Java engine failed to start"
fi
echo "  $(curl -s -m 3 http://127.0.0.1:7000/health)"
ok "  engine healthy (WatchService + ProcessHandle monitor live)"

# ── STEP 4 — backend ────────────────────────────────────────────────────────
say "STEP 4/7 — Start the FastAPI backend (:8000)"
# Launch directly from this shell, NOT via a `(cd … && … &)` subshell: on
# MSYS2/Git Bash a subshell that forks a long-lived native console process
# (python.exe) gets stuck at its own exit and lingers forever. uvicorn's
# --app-dir points it at the backend package from here.
nohup "$ROOT/.venv/Scripts/python" -m uvicorn main:app --port 8000 \
     --app-dir "$ROOT/backend" </dev/null > "$ROOT/uvicorn.log" 2>&1 &
if ! wait_http http://127.0.0.1:8000/status 40 "Backend"; then
  tail -15 uvicorn.log; die "Backend failed to start"
fi
if grep -q "Java engine detected" uvicorn.log; then
  ok "  Java engine owns detection (Python watchdog stood down)"
else
  warn "  Java engine not detected by the backend — Python watchdog is primary"
fi
LS=$(curl -s -m 3 http://127.0.0.1:8000/status | grep -o '"name": *"snap_[^"]*"' | head -1)
if [ -z "$LS" ]; then
  curl -s -m 15 -X POST http://127.0.0.1:8000/snapshot/manual >/dev/null
  ok "  took a manual snapshot (startup snapshot pending)"
else
  ok "  snapshot ready: $LS"
fi

# ── STEP 5 — frontend ───────────────────────────────────────────────────────
say "STEP 5/7 — Start the React dashboard (:3000)"
if [ ! -d frontend/node_modules ]; then
  warn "  frontend/node_modules missing — running npm install (first run)..."
  (cd frontend && npm install --no-audit --no-fund > ../frontend.log 2>&1) || die "npm install failed"
fi
# Direct launch again (no subshell) — npm --prefix runs the script with cwd
# = the frontend package, so react-scripts finds its config here.
nohup npm --prefix "$ROOT/frontend" start </dev/null > "$ROOT/frontend.log" 2>&1 &
if ! wait_http http://127.0.0.1:3000 150 "Dashboard"; then
  tail -15 frontend.log; die "Dashboard failed to start"
fi
if grep -q "Failed to compile" frontend.log; then
  warn "  dashboard reports a compile error — check frontend.log"
elif grep -q "Compiled successfully" frontend.log; then
  ok "  dashboard compiled & serving"
fi

# ── STEP 6 — attack ─────────────────────────────────────────────────────────
say "STEP 6/7 — Fire the attack simulator"
BASE=$(curl -s -m 3 http://127.0.0.1:8000/attacks | grep -o '"attack_id"' | wc -l | tr -d ' ')
BASE=${BASE:-0}
START=$(date +%s)
.venv/Scripts/python demo/simulate_ransomware.py </dev/null > simulator_run.log 2>&1 &

DETECTED=0
for i in $(seq 1 45); do
  COUNT=$(curl -s -m 3 http://127.0.0.1:8000/attacks | grep -o '"attack_id"' | wc -l | tr -d ' ')
  if [ "${COUNT:-0}" -gt "$BASE" ]; then DETECTED=1; break; fi
  sleep 1
done
DETECT_S=$(awk "BEGIN{printf \"%.1f\", $(date +%s) - $START}")
if [ "$DETECTED" != "1" ]; then
  tail -12 simulator_run.log; tail -12 uvicorn.log; die "No incident detected within 45s"
fi
ok "  ⚡  ATTACK DETECTED in ${DETECT_S}s — auto-response (freeze → rollback → audit) complete"

say "  → scripting the nationwide spread (deterministic campaign act)…"
# One scripted act, firing ~1s after start, hitting hospitals the incident
# broadcast did NOT pick (the broadcast always takes the 3 highest-security
# nodes; these stay protected, so the act is never skipped on a fresh sim).
curl -s -m 5 -X POST http://127.0.0.1:8000/network/campaign \
     -H "Content-Type: application/json" \
     -d '{"acts": [{"at": 1, "targets": ["fortis-noida", "sms-jaipur", "sskm-kolkata"]}]}' >/dev/null
ACT_FIRED=0
for i in $(seq 1 15); do
  FIRED=$(curl -s -m 3 http://127.0.0.1:8000/network | grep -c '"fired":true')
  if [ "${FIRED:-0}" -ge 1 ]; then ACT_FIRED=1; break; fi
  sleep 1
done
if [ "$ACT_FIRED" = "1" ]; then
  ok "  campaign act fired — scripted spread underway (map now quarantining the targets)"
else
  warn "  campaign act did not register within 15s — continuing (check /network)"
fi

# ── STEP 7 — metrics ────────────────────────────────────────────────────────
say "STEP 7/7 — Incident metrics"
LEFTOVERS=$(find demo/sample_hospital_files -name "*.encrypted" 2>/dev/null | wc -l | tr -d ' ')
.venv/Scripts/python -X utf8 - "$DETECT_S" "$LEFTOVERS" <<'PY'
import json, sys, urllib.request

detect_s, leftovers = sys.argv[1], sys.argv[2]

def get(p):
    with urllib.request.urlopen("http://127.0.0.1:8000" + p, timeout=5) as r:
        return json.load(r)

ev = get("/attacks")["attacks"][-1]
roll = ev.get("rollback", {})
freeze = ev.get("freeze_results", [])
chain = ev.get("pid_chain", [])
audit = get("/audit")
net = get("/network")
ti = ev.get("threat_intel") or {}
fired_acts = [a for a in ((net.get("campaign") or {}).get("acts") or []) if a.get("fired")]
by_id = {n["id"]: n["name"] for n in net.get("nodes", [])}
campaign_hits = [by_id.get(h, h) for a in fired_acts for h in a.get("hits", [])]

OK, BAD = "\u2705", "\u274c"
freeze_txt = ", ".join(f"{f.get('name','?')} (PID {f.get('pid')})" for f in freeze if f.get("success")) or "none matched"
chain_txt = " \u2192 ".join(c.get("name", "?") for c in chain) if chain else "(unavailable on this host)"
chain_txt += f"  [{len(chain)} links]"

print()
print("  \u250c\u2500 DETECTION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
print(f"  \u2502 detected in : {detect_s}s (incident #{ev.get('attack_id')})")
print(f"  \u2502 trigger     : {ev.get('canary_triggered') or 'heuristics (no decoy signal)'}")
print(f"  \u2502 threat score: {ev.get('threat_score')}/100      entropy: {ev.get('entropy')}/8.0")
for r in ev.get("reasons", []):
    print(f"  \u2502 reason      : {r}")
print("  \u251c\u2500 CONTAINMENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
print(f"  \u2502 processes   : {len(freeze)} frozen \u2014 {freeze_txt}")
print(f"  \u2502 kill chain  : {chain_txt}")
print("  \u251c\u2500 RECOVERY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
if roll.get("success"):
    print(f"  \u2502 files       : {roll.get('files_restored')} restored from {roll.get('snapshot_name')}")
    print(f"  \u2502 rollback    : {roll.get('duration_seconds')}s  {OK}")
else:
    print(f"  \u2502 rollback    : FAILED \u2014 {roll.get('message')}  {BAD}")
print(f"  \u2502 leftovers   : {leftovers} encrypted file(s) after rollback")
print("  \u251c\u2500 NETWORK SPREAD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
print(f"  \u2502 fingerprint : {ti.get('short', '\u2014')} broadcast to {ti.get('nodes_reached', 0)} hospitals [{'KNOWN' if ti.get('known') else 'NEW'} campaign]")
print(f"  \u2502 auto-quar   : {', '.join(ti.get('target_names') or []) or 'none'}")
if campaign_hits:
    print(f"  \u2502 campaign    : scripted act hit {len(campaign_hits)} hospital(s) \u2014 {', '.join(campaign_hits)}")
else:
    print("  \u2502 campaign    : scripted act fired, no hospitals hit (targets busy?)")
print("  \u251c\u2500 INTEGRITY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
print(f"  \u2502 audit chain : {'VALID' if audit.get('valid') else 'TAMPERED'} {OK if audit.get('valid') else BAD} \u2014 {audit.get('entries')} entries")
iv = roll.get("integrity") or {}
if iv:
    iv_total = iv.get("verified", 0) + iv.get("missing", 0) + iv.get("mismatch", 0)
    iv_ok = bool(iv.get("ok"))
    print(f"  \u2502 restore     : {iv.get('verified', 0)}/{iv_total} files re-hashed vs snapshot manifest  {OK if iv_ok else BAD}")
    if iv.get("missing") or iv.get("mismatch") or iv.get("extra"):
        print(f"  \u2502             : {iv.get('missing')} missing \u00b7 {iv.get('mismatch')} mismatched \u00b7 {iv.get('extra')} extra")
print("  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
print()
PY

# ── finish ──────────────────────────────────────────────────────────────────
say "Cleaning up frozen attacker processes (the freeze containment, now done)..."
kill_simulators

echo ""
say "═══════════════════════════════════════════════════════════"
ok "  DEMO CYCLE COMPLETE — services left running for inspection"
echo ""
echo "   🖥  Dashboard : http://localhost:3000"
echo "   ⚙️   API       : http://localhost:8000/status"
echo "   🔍  Engine    : http://127.0.0.1:7000/health"
echo "   📄  Report    : curl -X POST http://localhost:8000/report/1 -o incident.pdf"
echo ""
say "═══════════════════════════════════════════════════════════"

# Best-effort: pop open the dashboard for the judges.
command -v cmd >/dev/null 2>&1 && cmd //c start "" "http://localhost:3000" >/dev/null 2>&1

# Terminate our own shell. On MSYS2/Git Bash, a bash whose children include
# native console processes (java.exe / python.exe / cmd.exe from the servers)
# blocks forever at `exit`: the MSYS2 runtime waits for those children to
# release the console. The servers are nohup'd independent processes, so they
# keep running either way — this just lets the script actually end so the
# terminal prompt returns. (Verified empirically: `</dev/null`, `disown`, and
# removing traps do NOT release the exit block; killing the servers does.)
kill -9 $$

exit 0
