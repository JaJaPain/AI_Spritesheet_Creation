# Wan 2.2 Rapid Upgrade Guide

This guide explains how to set up the high-speed "Shadow Lab" for Wan 2.2 14B Rapid generation.

## 1. Download the Model
You need the All-In-One (AIO) checkpoint. This contains the Model, VAE, and CLIP in a single file.

- **Model Name**: `wan2.1-i2v-14b-720p-topo-aio-rapid-4step.safetensors` (or similar Rapid AIO version)
- **Source**: [HuggingFace / CivitAI - WanVideo 2.2 Rapid]
- **Placement**: Put this file in `VideoCreation/ComfyUI_Backend/models/checkpoints/`.

## 2. Running the Rapid Forge
The Rapid Forge runs as a separate service on **Port 8002**.

1. Open a new terminal.
2. Navigate to `VideoForge_Rapid`.
3. Run `python server.py`.

## 3. Benefits of this Workflow
- **Steps**: 4 (instead of 30).
- **CFG**: 1.0 (prevents color shifting).
- **VAE**: Integrated (eliminates the "Purple Haze").
- **Speed**: Expected ~20-30 seconds per generation on high-end hardware.

## 4. Next Steps
Once the model is downloaded, we will update `VideoForge_Rapid/workflow_api.json` to point to the new AIO node structure shown in the YouTube guide.
