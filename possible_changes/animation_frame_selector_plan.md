# Plan: Animation Frame Selector & Spritesheet Export

This plan outlines the system for extracting individual frames from Video Forge generations, selecting the best frames, and compiling them into production-ready spritesheets.

## 1. Folder Structure & Organization
Animations will be stored within their parent project folders to maintain a clean hierarchy:
`projects/[ProjectID]/Animations/[AnimationName]_[Timestamp]/`
- `frames/`: Contains individual `.png` extracts (A_001.png, A_002.png, etc.)
- `preview.mp4`: The original generation.
- `spritesheet.png`: The final compiled asset.
- `metadata.json`: Stores which frames were selected and at what FPS.

## 2. Frame Extraction Logic (Backend)
- **Tooling**: Use `ffmpeg` to extract the 16 (or more) generated frames from the output MP4 with 100% fidelity.
- **Auto-Cleanup**: Background removal will be applied to each frame during extraction using the existing `LimbMasker` or `Rembg` logic, ensuring they are ready for game engines.

## 3. Frame Selection Studio (Frontend)
- **Interactive Strips**: A horizontal scroll of all extracted frames with checkboxes to "Keep" or "Discard".
- **Real-time Previewer**:
  - A dedicated preview window that loops only the *selected* frames.
  - **Speed Control**: A slider to adjust the loop speed (FPS) from 1fps to 60fps.
  - **Zoom/Onion Skin**: Optional toggle to see the previous frame as a ghost to check for "jitter".

## 4. Spritesheet Compilation
- **"Bake Spritesheet" Button**: Triggers the backend to stitch the selected frames into a grid.
- **Metadata Tagging**: The final sheet will be saved with the animation name (e.g., `SideWalk_8frames.png`).

## 5. Implementation Steps
1.  **ffmpeg Bridge**: Add a python utility to handle MP4 -> PNG extraction.
2.  **Animation UI Stage**: Create a new `stage === 'animation-editing'` in `App.jsx`.
3.  **Project Integration**: Update `main.py` to support the `/Animations` sub-folder structure during project loads/saves.
