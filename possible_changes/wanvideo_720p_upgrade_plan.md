# Plan: WanVideo 720p High-Fidelity Upgrade

This plan outlines the steps required to transition the Video Forge from the 480p optimized model to the native 720p high-fidelity model.

## 1. Prerequisites
- **Model File**: Download `wan2.1-i2v-14b-720p-Q4_K_M.gguf` (approx. 10-12GB).
- **Placement**: Place the file in the ComfyUI models directory (usually `ComfyUI/models/diffusion_models/`).

## 2. Backend Changes (server.py)
The compositing logic must be updated to support the 16:9 aspect ratio instead of the 1:1 square.

- **Target Resolution**: Change `target_size` logic to handle 1280 (width) and 720 (height).
- **Padding**: Adjust `canvas` creation:
  ```python
  canvas = Image.new("RGBA", (1280, 720), digital_green)
  ```
- **Scaling**: Update `scale` to fit within the 1280x720 bounds.

## 3. Workflow Changes (workflow_api.json)
The hardcoded dimensions in the ComfyUI API request must be synchronized.

- **Node ID 63 (WanVideoImageToVideoEncode)**:
  - `"width": 1280`
  - `"height": 720`
- **Model Loader (Node ID 31)**:
  - Update `"model"` string to `"wan2.1-i2v-14b-720p-Q4_K_M.gguf"`.

## 4. Frontend Changes (App.jsx)
Update the template prompt to take advantage of the higher resolution.

- **Keywords**: Add `4k cinematic`, `ultra-detailed textures`, and `16:9 aspect ratio`.
- **Background**: Ensure the prompt explicitly mentions the digital green background to maintain consistency.

## 5. Performance Expectations
- **VRAM Usage**: ~14GB - 16GB (GGUF).
- **Generation Time**: 8 to 12 minutes per video (depending on GPU speed).
- **Visuals**: Native 16:9 widescreen output with significantly sharper edge definition and fluid motion.
