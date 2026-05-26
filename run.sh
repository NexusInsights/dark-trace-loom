#!/bin/bash
echo "DARK TRACE LOOM - Enterprise OSINT Platform"
pip install -r requirements.txt --quiet --break-system-packages 2>/dev/null || pip install -r requirements.txt --quiet
echo "Starting on http://localhost:8900"
python3 app.py
