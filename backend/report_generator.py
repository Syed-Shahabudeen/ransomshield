import os
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, Image
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT

# Brand colors
RED = colors.HexColor("#EF4444")
DARK = colors.HexColor("#0F172A")
SLATE = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
ACCENT = colors.HexColor("#F97316")
WHITE = colors.white
LIGHT_BG = colors.HexColor("#F8FAFC")


def generate_pdf_report(attack_event: dict, ai_summary: str, hospital_name: str = "AIIMS Delhi", audit_status: dict | None = None) -> bytes:
    """Generate a professional PDF incident report. Returns bytes."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    elements = []

    # ── Header ────────────────────────────────────────────────────────────
    header_style = ParagraphStyle(
        "Header",
        fontSize=22,
        textColor=WHITE,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "Sub",
        fontSize=10,
        textColor=colors.HexColor("#CBD5E1"),
        fontName="Helvetica",
        alignment=TA_CENTER,
    )

    header_table = Table(
        [[
            Paragraph("🛡 RANSOMSHIELD", header_style),
            Paragraph(f"INCIDENT REPORT #{attack_event.get('attack_id', 1):03d}", header_style),
        ]],
        colWidths=["50%", "50%"],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("ROUNDEDCORNERS", (0, 0), (-1, -1), 8),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 0.3 * cm))

    ts = datetime.now().strftime("%d %B %Y, %H:%M:%S IST")
    elements.append(Paragraph(
        f"Generated: {ts} &nbsp;&nbsp;|&nbsp;&nbsp; Facility: {hospital_name} &nbsp;&nbsp;|&nbsp;&nbsp; Confidential",
        sub_style,
    ))
    elements.append(Spacer(1, 0.6 * cm))

    # ── Section helper ────────────────────────────────────────────────────
    def section_title(text):
        return Paragraph(
            f"<font color='#EF4444'>▌</font>&nbsp;<b>{text}</b>",
            ParagraphStyle("SecTitle", fontSize=13, textColor=DARK, fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=6),
        )

    def kv_table(rows, col_widths=None):
        """Renders a key-value table."""
        data = [[Paragraph(f"<b>{k}</b>", ParagraphStyle("K", fontSize=9, fontName="Helvetica-Bold", textColor=MUTED)),
                 Paragraph(str(v), ParagraphStyle("V", fontSize=10, fontName="Helvetica", textColor=DARK))]
                for k, v in rows]
        t = Table(data, colWidths=col_widths or ["35%", "65%"])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), LIGHT_BG),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("ROUNDEDCORNERS", (0, 0), (-1, -1), 4),
        ]))
        return t

    # ── Threat Summary ────────────────────────────────────────────────────
    elements.append(section_title("THREAT DETECTION SUMMARY"))
    rollback = attack_event.get("rollback", {})
    raw_path = attack_event.get("filepath", "N/A")
    if raw_path != "N/A":
        filename = os.path.basename(raw_path.replace("\\", "/"))
        sanitized_path = f"C:\\Hospital\\Records\\Patient_Data\\{filename}"
    else:
        sanitized_path = "N/A"

    threat_rows = [
        ("Attack ID", f"#{attack_event.get('attack_id', 1):03d}"),
        ("Affected File", sanitized_path),
        ("File Entropy", f"{attack_event.get('entropy', 0):.4f} / 8.0000"),
        ("Threat Score", f"{attack_event.get('threat_score', 0)} / 100"),
        ("Detection Time", ts),
        ("Detection Triggers", " | ".join(attack_event.get("reasons", []))),
    ]
    if attack_event.get("canary_triggered"):
        threat_rows.insert(1, (
            "Canary Triggered",
            f"Decoy file '{attack_event['canary_triggered']}' touched — first signal, before real data",
        ))
    elements.append(kv_table(threat_rows))
    elements.append(Spacer(1, 0.4 * cm))

    # ── Response Actions ──────────────────────────────────────────────────
    elements.append(section_title("AUTOMATED RESPONSE ACTIONS"))
    freeze_results = attack_event.get("freeze_results", [])
    freeze_text = (
        " | ".join([f"PID {f['pid']} ({f.get('name','?')}) — {f.get('message','')}" for f in freeze_results])
        if freeze_results else "No processes identified / auto-frozen"
    )
    response_rows = [
        ("Processes Frozen", freeze_text),
        ("Rollback Status", "✅ SUCCESS" if rollback.get("success") else "❌ FAILED"),
        ("Snapshot Restored", rollback.get("snapshot_name", "N/A")),
        ("Snapshot Timestamp", rollback.get("snapshot_timestamp", "N/A")),
        ("Files Restored", str(rollback.get("files_restored", 0))),
        ("Recovery Time", f"{rollback.get('duration_seconds', 0):.2f} seconds"),
        ("SLA Compliance", "✅ Met (<60s)" if rollback.get("duration_seconds", 999) < 60 else "⚠️ Exceeded"),
        ("Forensic Backup", rollback.get("infected_backup", "N/A")),
    ]
    elements.append(kv_table(response_rows))
    elements.append(Spacer(1, 0.4 * cm))

    # ── Ransom note intelligence ─────────────────────────────────────────
    note = attack_event.get("ransom_note") or {}
    if any(note.get(k) for k in ("gang", "btc_address", "amount_btc", "deadline_hours", "contact")):
        elements.append(section_title("RANSOM NOTE INTELLIGENCE"))
        note_rows = []
        if note.get("gang"):
            note_rows.append(("Attributed Group", note["gang"]))
        if note.get("btc_address"):
            note_rows.append(("BTC Wallet", note["btc_address"]))
        if note.get("amount_btc"):
            note_rows.append(("Ransom Demand", f"{note['amount_btc']} BTC"))
        if note.get("deadline_hours"):
            note_rows.append(("Payment Deadline", f"{note['deadline_hours']} hours from infection"))
        if note.get("contact"):
            note_rows.append(("Contact Channel", note["contact"]))
        if note.get("file"):
            note_rows.append(("Note File", note["file"]))
        elements.append(kv_table(note_rows))
        elements.append(Paragraph(
            "Extracted automatically from the attacker's demand note on the monitored "
            "filesystem. Only attacker-authored content is captured — no patient data "
            "is read or transmitted.",
            ParagraphStyle("NoteIntelNote", fontSize=8, textColor=MUTED, fontName="Helvetica", spaceBefore=6),
        ))
        elements.append(Spacer(1, 0.4 * cm))

    # ── Automated Narrative ───────────────────────────────────────────────
    elements.append(section_title("AUTOMATED INCIDENT ANALYSIS"))
    elements.append(Spacer(1, 0.2 * cm))
    elements.append(Paragraph(
        ai_summary.replace("\n", "<br/>"),
        ParagraphStyle("Narr", fontSize=10, fontName="Helvetica", textColor=DARK, leading=15),
    ))
    elements.append(Spacer(1, 0.4 * cm))

    # ── Threat intelligence dissemination ────────────────────────────────
    intel = attack_event.get("threat_intel")
    if intel:
        elements.append(section_title("THREAT INTELLIGENCE & GEOSPATIAL IMPACT"))
        targets = intel.get("target_names") or intel.get("targets") or []
        intel_rows = [
            ("Anonymized Fingerprint", intel.get("short", "—")),
            ("Full SHA-256 (indicators only)", intel.get("fingerprint", "")),
            ("Nodes Reached", f"{intel.get('nodes_reached', 0)} healthcare facilities nationwide"),
            ("Nodes Auto-Quarantined", ", ".join(targets) if targets else "None"),
            ("Campaign Match", "Known fingerprint — previously broadcast" if intel.get("known") else "New fingerprint — first seen"),
        ]
        elements.append(kv_table(intel_rows))
        
        elements.append(Spacer(1, 0.3 * cm))
        
        map_path = os.path.join(os.path.dirname(__file__), "map_placeholder.png")
        if os.path.exists(map_path):
            img = Image(map_path, width=15*cm, height=9*cm)
            elements.append(img)
            elements.append(Spacer(1, 0.1 * cm))
            elements.append(Paragraph(
                "<i>Fig 1.</i> National threat propagation vector map. Glowing red nodes indicate compromised regional endpoints isolated from the core network. Teal/Green nodes confirm localized integrity retention following automated cryptographic quarantine measures.",
                ParagraphStyle("MapCaption", fontSize=8, textColor=MUTED, fontName="Helvetica-Oblique", alignment=TA_CENTER)
            ))
        
        elements.append(Paragraph(
            "Fingerprint is derived from observable indicators (entropy bucket, ransom extension, decoy signal) — no file contents or patient data leaves the facility.",
            ParagraphStyle("IntelNote", fontSize=8, textColor=MUTED, fontName="Helvetica", spaceBefore=10),
        ))
        elements.append(Spacer(1, 0.4 * cm))

    # ── Forensic integrity ─────────────────────────────────────────────────
    elements.append(section_title("FORENSIC INTEGRITY — HASH-CHAIN AUDIT LOG"))
    audit_valid = bool(audit_status and audit_status.get("valid"))
    audit_rows = [
        ("Audit Chain Status", "✅ VALID — no tampering detected" if audit_valid else "❌ INVALID — chain broken"),
        ("Chain Entries", str(audit_status.get("entries", 0))),
    ]
    if audit_valid:
        audit_rows.append(("Chain Head Hash (SHA-256)", audit_status.get("last_hash", "")))
    else:
        audit_rows.append(("First Bad Entry", f"#{audit_status.get('first_bad_seq', '?')}"))
    elements.append(kv_table(audit_rows))
    elements.append(Spacer(1, 0.4 * cm))

    # ── Footer ─────────────────────────────────────────────────────────────
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#E2E8F0")))
    elements.append(Spacer(1, 0.2 * cm))
    elements.append(Paragraph(
        "This report was generated automatically by RansomShield v2.0 | Confidential — For Authorized Personnel Only | Comply with DISHA & CERT-In Regulations",
        ParagraphStyle("Footer", fontSize=7.5, textColor=MUTED, alignment=TA_CENTER),
    ))

    doc.build(elements)
    return buffer.getvalue()
