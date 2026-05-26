@echo off
title Dark Trace Loom
echo.
echo  DARK TRACE LOOM - Enterprise OSINT Platform
echo.
python -m pip install -r requirements.txt --quiet
echo  Starting on http://localhost:8900
echo  API docs: http://localhost:8900/docs
python app.py
pause
