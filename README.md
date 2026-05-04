# SpriteForge: AI-Powered Sprite Creation Pipeline

SpriteForge is an end-to-end tool designed to turn text descriptions into fully animated, transparent, game-ready sprite sheets using local AI models.

## Features
- **Prompt-to-Anchor**: Generate a base character sprite using SDXL and ControlNet.
- **AI Animation**: Create walk cycles and motion using LTX-Video.
- **Automated Background Removal**: Instant transparency using `rembg`.
- **Sprite Sheet Forging**: Automatically extracts frames and stitches them into a horizontal PNG.

## Prerequisites
- **Python 3.10+** (with `pip` and `venv`)
- **Node.js 18+**
- **NVIDIA GPU** (Minimum 12GB VRAM recommended; 16GB+ preferred for SDXL/LTX)

## Installation

### 1. Backend Setup
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Frontend Setup
```bash
npm install
```

## Running the App
The easiest way to start both the frontend and backend is using the included batch script:
```bash
start.bat
```

## AI Models Information
This project utilizes the following models from Hugging Face:
- **SDXL Base 1.0**: For base image generation.
- **SDXL ControlNet (Canny)**: For structural guidance based on templates.
- **LTX-Video**: For generating high-quality animation frames.
- **U2Net (Rembg)**: For background removal.

### How to obtain the models:
You **do not** need to download the models manually. The backend uses the `diffusers` library, which will automatically download the required weights from Hugging Face on the first run.
- **First Run**: Ensure you have an active internet connection. The first generation may take several minutes as it downloads approximately 10-15GB of model weights.
- **Storage**: Models are cached locally in your Hugging Face cache directory (usually `~/.cache/huggingface`).
- **Offline Use**: Once the first run is complete, the app can be used offline.

## License
MIT
