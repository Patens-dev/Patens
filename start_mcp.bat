@echo off
REM STREAMING_CHUNK:Environment boot script
REM Move into the directory where this .bat file is located
cd /d "%~dp0"

REM Activate the virtual environment
call .venv\Scripts\activate

REM Run the new unified server
python server\unified_server.py