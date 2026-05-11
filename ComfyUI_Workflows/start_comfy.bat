@echo off
set "VENV_DIR=%~dp0venv"
if not exist "%VENV_DIR%" (
    echo Virtual environment not found. Please run installation first.
    pause
    exit /b
)
echo Starting ComfyUI for Wan 2.1...
echo GPU: RTX 5060 Ti 16GB VRAM
echo System RAM: 32GB
call "%VENV_DIR%\Scripts\activate"
python main.py --normalvram --preview-method auto --fp8_e4m3fn-text-enc --cuda-malloc --dont-upcast-attention
pause
