# Plan: AI Spritesheet Detail Upscaler

This plan outlines the integration of an AI-powered upscaler to enhance the final "Master Spritesheet" with high-fidelity detail and sharpening using ComfyUI.

## 1. Objective
Enhance the final stitched turnaround sheet after all "Quick Fixes" are complete, providing a high-resolution version suitable for production-grade assets.

## 2. Infrastructure Changes
- **New Workflow**: Create `VideoCreation/upscale_workflow.json` using:
  - **Model**: Stable Diffusion XL or 1.5 with a "Realistic" or "Digital Art" LoRA.
  - **Upscale Node**: `Ultimate SD Upscale` or `4x-UltraSharp` for crisp edges.
  - **ControlNet**: Use `ControlNet Tile` or `Canny` to ensure the character's pose and silhouette do not shift during the upscale.

## 3. Backend Integration (main.py / animator.py)
- **New Endpoint**: `POST /upscale-sheet`
  - Accepts the `project_id`.
  - Locates the `turnaround.png` (or the last fixed version).
  - Sends it to the Video Forge bridge for processing.
- **Processing logic**:
  - Tiled upscaling to handle large spritesheets without running out of VRAM.
  - Denoise strength set low (0.3 - 0.4) to add texture without changing the design.

## 4. Frontend Integration (App.jsx)
- **"Enhance Sheet" Button**: Add a magic wand icon next to the final download button.
- **Progress Monitoring**: Use a similar heartbeat system to the Video Forge to show upscale progress.
- **Comparison View**: Allow the user to toggle between "Original" and "AI Enhanced" versions before saving.

## 5. Potential Challenges
- **Seam Issues**: Tiled upscaling can sometimes create faint lines between tiles; requires careful "Seam Overlap" settings in the workflow.
- **VRAM**: High-res upscales of large sheets (e.g. 4096x4096+) will require efficient tiling strategies.
