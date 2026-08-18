import os
import json
import logging
from datetime import datetime

logger = logging.getLogger("ransomshield.llm")

# Attempt to import Gemini; gracefully degrade if not installed
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    logger.warning("google-generativeai not installed. LLM features disabled.")


def generate_incident_summary(attack_event: dict, hospital_name: str = "AIIMS Delhi") -> str:
    """
    Generate a professional incident report narrative using Gemini.
    Falls back to a template-based report if API key is missing.
    """
    api_key = os.getenv("GEMINI_API_KEY", "")

    if not GEMINI_AVAILABLE or not api_key:
        return _template_summary(attack_event, hospital_name)

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")

        note_ctx = _ransom_note_context(attack_event)
        prompt = f"""
You are a senior cybersecurity analyst writing a formal ransomware incident report for {hospital_name}.

Attack Data:
- Attack ID: {attack_event.get('attack_id', 'N/A')}
- Detected File: {attack_event.get('filepath', 'Unknown')}
- File Entropy: {attack_event.get('entropy', 0):.2f}/8.0
- Threat Score: {attack_event.get('threat_score', 0)}/100
- Detection Reasons: {', '.join(attack_event.get('reasons', []))}
- Rollback Status: {'SUCCESS' if attack_event.get('rollback', {}).get('success') else 'FAILED'}
- Recovery Time: {attack_event.get('rollback', {}).get('duration_seconds', 0):.1f} seconds
- Files Restored: {attack_event.get('rollback', {}).get('files_restored', 0)}
- Frozen Processes: {len(attack_event.get('freeze_results', []))}
{note_ctx}
Write a concise, formal 3-paragraph incident summary:
1. Executive summary of the attack detected
2. Response actions taken (process freeze + rollback)
3. Current status, recommended next steps for hospital IT staff, and the attacker indicators recovered from the ransom note (if available)

Keep it under 250 words. Professional tone. No markdown headers.
"""
        response = model.generate_content(prompt)
        return response.text.strip()

    except Exception as e:
        logger.error(f"[LLM] Gemini error: {e}")
        return _template_summary(attack_event, hospital_name)


def _ransom_note_context(attack_event: dict) -> str:
    """One prompt line describing attacker intel recovered from the demand
    note, or an empty string when no note was captured."""
    note = attack_event.get("ransom_note") or {}
    if not any(note.get(k) for k in ("gang", "btc_address", "amount_btc", "deadline_hours")):
        return ""
    bits = []
    if note.get("gang"):
        bits.append(f"gang {note['gang']}")
    if note.get("btc_address"):
        bits.append(f"BTC wallet {note['btc_address']}")
    if note.get("amount_btc"):
        bits.append(f"{note['amount_btc']} BTC demand")
    if note.get("deadline_hours"):
        bits.append(f"{note['deadline_hours']}h payment deadline")
    return "- Ransom Note Intel: " + ", ".join(bits)


def _template_summary(attack_event: dict, hospital_name: str) -> str:
    """Fallback template if Gemini is unavailable."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rollback = attack_event.get("rollback", {})
    reasons = attack_event.get("reasons", ["Suspicious file activity detected"])

    note_sentence = ""
    note = attack_event.get("ransom_note") or {}
    if any(note.get(k) for k in ("gang", "btc_address", "amount_btc", "deadline_hours")):
        note_sentence = (
            f" The dropped ransom note attributes the attack to "
            f"{note.get('gang') or 'an unidentified group'} — a demand of "
            f"{note.get('amount_btc')} BTC to wallet {note.get('btc_address') or 'an unknown address'} "
            f"with a {note.get('deadline_hours')}h payment deadline."
        )

    return f"""INCIDENT REPORT — {hospital_name} | {ts}

RansomShield detected a ransomware attack on the hospital file system at {ts}. The threat was identified in file '{attack_event.get("filepath", "unknown")}' with an entropy score of {attack_event.get("entropy", 0):.2f}/8.0 and a composite threat score of {attack_event.get("threat_score", 0)}/100. Detection triggers: {"; ".join(reasons)}.

Automated response actions were executed immediately. {len(attack_event.get("freeze_results", []))} suspicious process(es) were suspended to halt further encryption. A rollback to the last clean snapshot was initiated — {'completing successfully' if rollback.get('success') else 'with errors'}. {rollback.get('files_restored', 0)} files were restored in {rollback.get('duration_seconds', 0):.1f} seconds, {'meeting' if rollback.get('duration_seconds', 999) < 60 else 'exceeding'} the 60-second recovery SLA.{note_sentence}

Current status: System integrity restored. Infected file copies preserved in forensic backup at {rollback.get('infected_backup', 'N/A')}. Recommended actions: (1) Review frozen process identities and report to CERT-In, (2) Change all system credentials, (3) Patch OS and antivirus signatures, (4) Notify hospital data protection officer as per DISHA regulations."""
