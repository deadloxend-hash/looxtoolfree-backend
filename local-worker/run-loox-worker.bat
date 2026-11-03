@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 loox-worker.py
) else (
  python loox-worker.py
)
echo.
echo The worker has stopped. Read any error above.
pause
