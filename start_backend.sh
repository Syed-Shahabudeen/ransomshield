#!/bin/bash
# RansomShield startup script
echo "🛡  Starting RansomShield..."

# Setup demo files if they don't exist
if [ ! -d "demo/sample_hospital_files" ] || [ -z "$(ls -A demo/sample_hospital_files 2>/dev/null)" ]; then
    echo "📁 Creating sample hospital files..."
    python demo/simulate_ransomware.py --setup
fi

echo "🚀 Starting FastAPI backend on http://localhost:8000"
cd backend
uvicorn main:app --reload --port 8000
