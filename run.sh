#!/bin/bash
cd "$(dirname "$0")"

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r requirements.txt

echo "Starting CIR app on http://0.0.0.0:8080"
python app.py
