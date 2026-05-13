@echo off
echo Starting VIDEO FORGE (Wan 2.1 WanVideoWrapper)...
:: Set the port for the Video Forge bridge
set PORT=8002

:: 1. Start Headless ComfyUI from ComfyTestFolder in a new window (minimized)
echo Starting ComfyUI Engine (Wan 2.1 - 14B GGUF 720p)...
start /min "ComfyUI_Engine" cmd /k "cd ..\ComfyTestFolder && venv\Scripts\python main.py --listen 127.0.0.1 --port 8188 --normalvram --preview-method auto --fp8_e4m3fn-text-enc --cuda-malloc --dont-upcast-attention"

:: 2. Wait for ComfyUI to initialize (larger model needs more time)
echo Waiting for ComfyUI to load models...
timeout /t 15 /nobreak > nul

:: 3. Launch the bridge server minimized (uses ComfyTestFolder venv for deps)
echo Starting Forge API Bridge on Port %PORT%...
start /min "VideoForge_API" cmd /k "..\ComfyTestFolder\venv\Scripts\python server.py"
echo Video Forge is warming up on Port %PORT%...
