# 🛡️ RansomShield
**Zero-Trust, Behavior-Based Ransomware Defense & Auto-Remediation System**

RansomShield is a next-generation cybersecurity platform designed specifically for critical infrastructure like healthcare. Instead of relying on outdated signature-based antivirus, RansomShield acts as a real-time behavioral monitor, instantly detecting zero-day ransomware attacks, freezing malicious processes, and automatically healing damaged data without human intervention.

---

## ⚡ Core Features

*   **Real-Time Entropy Monitoring:** Continuously calculates the Shannon Entropy of file modifications. Because encrypted files have extreme randomness (entropy near 8.0), the system instantly detects ransomware behavior, even if the malware is completely new (zero-day).
*   **Canary Decoy System:** Deploys invisible "decoy" files in sensitive directories. If a malicious process touches a decoy, the system trips a silent alarm before real patient data is compromised.
*   **Automated Process Quarantine:** Traces malicious file operations directly back to the offending Process ID (PID) and forcefully isolates/suspends the process at the OS level in milliseconds.
*   **Cryptographic Snapshot & Auto-Rollback:** Maintains lightweight, continuous cryptographic snapshots of critical directories. Upon attack detection, RansomShield instantly self-heals by rolling back any encrypted files to their exact pre-attack state.
*   **Nationwide Threat Propagation Map:** A dynamic, geospatial UI visualizing the spread of an attack across a simulated hospital network, demonstrating real-time isolation and recovery at scale.
*   **Automated Incident Reporting:** Automatically compiles deep telemetry data (attack vectors, entropy scores, quarantine success) into professional, forensic PDF reports.

## 🛠️ Technology Stack

*   **Frontend UI:** React, Vite, Recharts, `react-simple-maps` (Geospatial Threat Map)
*   **Backend Engine:** Python, FastAPI (WebSockets for real-time telemetry)
*   **Forensic Engine:** `watchdog` (File monitoring), `reportlab` (Automated PDF Generation)
*   **Design System:** Custom Dark-mode Cyber-Intelligence Theme (Lucide Icons)

## 🚀 How to Run Locally

### 1. Start the Python Backend
Ensure you have Python installed. Navigate to the root directory and set up a virtual environment.
```bash
python -m venv .venv
# Activate the environment
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies
pip install fastapi uvicorn websockets watchdog reportlab

# Run the server
python -m uvicorn main:app --port 8000 --app-dir backend
```

### 2. Start the React Frontend
Open a new terminal window.
```bash
cd frontend
npm install
npm start
```
The dashboard will open automatically at `http://localhost:3000`.

## 🖥️ Using the Dashboard

1.  **Overview Dashboard:** Watch real-time file entropy telemetry and monitor the overall health of the protected directories.
2.  **Live Demo Mode:** Click the **Start Live Demo** button to simulate a live ransomware attack. You will visually see:
    *   Dummy patient data being corrupted.
    *   The Threat Propagation map tracking the spread across regional hospitals.
    *   The system intercepting the attack, quarantining nodes (Orange), and automatically recovering the data (Blue).
3.  **Generate Report:** Click **Generate Incident Report** to compile a professional post-mortem PDF containing forensic data and the geospatial map.

## ⚠️ Disclaimer
This project is an advanced simulation and proof-of-concept for educational and demonstration purposes. It is designed to illustrate modern concepts in behavioral threat detection and automated remediation.
"# decentralized-app" 
