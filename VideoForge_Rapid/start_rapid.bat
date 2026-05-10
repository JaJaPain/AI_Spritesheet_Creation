@echo off
echo Starting RAPID VIDEO FORGE (Wan 2.2 AIO)...
:: Set the port for the Rapid Lab
set PORT=8002

:: 1. Start Headless ComfyUI in a new window (minimized)
echo Starting ComfyUI Engine...
start /min "ComfyUI_Engine" cmd /k "cd ..\\VideoCreation\\ComfyUI_Backend && ..\\venv_comfy\\Scripts\\python main.py --listen 127.0.0.1 --port 8188 --lowvram"

:: 2. Wait for ComfyUI to initialize
timeout /t 5 /nobreak > nul

:: 3. Launch the bridge server minimized
echo Starting Rapid API Bridge...
start /min "RapidForge_API" cmd /k "..\\VideoCreation\\venv_comfy\\Scripts\\python server.py"
echo Rapid Forge is warming up on Port 8002...
