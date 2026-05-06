# SpriteForge AI — Full Handoff Document (May 5, 2026)

## What This Project Is
A **local AI sprite sheet generator** for game characters. You type a character description, it generates 4 anchor variants, you pick one, then it creates a 12-frame walk cycle sprite sheet. Built with **React (Vite)** frontend and **FastAPI + diffusers** backend on an **RTX 5060 Ti (16GB VRAM)**.

## How to Run

```bash
# Terminal 1: Backend
cd C:\CodingProjects\AISpriteCreation\backend
.\venv\Scripts\python.exe main.py
# Runs on http://localhost:8000

# Terminal 2: Frontend
cd C:\CodingProjects\AISpriteCreation
npm run dev
# Runs on http://localhost:5173
```

---

## Architecture

### Backend (`backend/main.py`)
- **FastAPI** server with these key endpoints:
  - `POST /generate-anchor` — Generates 4 character variants with SDXL + Canny ControlNet at 512x512, with BLIP quality gate
  - `POST /describe-anchor` — Uses BLIP-large to auto-describe the selected anchor image
  - `POST /animate-openpose` — Generates 12-frame walk cycle using SDXL + SoftEdge ControlNet + IP-Adapter Plus at 1024x1024
  - `POST /regenerate-frame` — Redoes a single frame
  - `POST /stitch-frames` — Combines frames into a horizontal sprite sheet
  - `POST /save-anchor` / `GET /load-anchor` — Persist/load a selected anchor

### Frontend (`src/App.jsx`)
- React + Framer Motion UI with stages: `prompt` → `selecting-anchor` → `animating` → `editing`
- Lucide React icons, glass-card design system

### Models in Use
| Model | Purpose | VRAM | Notes |
|---|---|---|---|
| SDXL Base 1.0 | Image generation | ~9-11GB | Uses `enable_model_cpu_offload()` |
| ControlNet (Canny) | Anchor pose guidance | Loaded with SDXL | `diffusers/controlnet-canny-sdxl-1.0` |
| ControlNet (SoftEdge) | Walk frame pose guidance | Loaded with SDXL | `SargeZT/controlnet-sd-xl-1.0-softedge-dexined` |
| IP-Adapter Plus | Character consistency | Loaded with SDXL | `h94/IP-Adapter`, `ip-adapter-plus_sdxl_vit-h` |
| BLIP-large (captioning) | Auto-describe anchor + quality gate | ~1.5GB | `Salesforce/blip-image-captioning-large` |
| rembg (isnet-anime) | Background removal | CPU | Anime-optimized model |

---

## What Was Accomplished This Session

### 1. VRAM Stabilization
- **Problem**: CUDA "unknown error" crashes at 16GB during 1024x1024 frame generation
- **Fix**: Replaced manual CLIP encoder offloading with `pipe.enable_model_cpu_offload()` 
- **Result**: Stable ~11GB VRAM during walk cycle generation

### 2. BLIP Vision Auto-Prompt System (NEW)
- **Problem**: User types "witch" → selects a variant WITHOUT a hat → walk cycle adds witch hats because it uses the original "witch" prompt
- **Fix**: After selecting an anchor (or loading a saved one), BLIP-large analyzes the image and generates a description of what's ACTUALLY visible
- **How it works**:
  - 7 targeted caption passes (overall, hair, top, bottom, feet, accessories, art style)
  - Deduplication removes repeated phrases
  - Editable textarea shown to user BEFORE walk cycle generation
  - User can edit/remove unwanted details (e.g., delete "hat" from the prompt)
- **Both walk cycle AND redo use the auto-prompt** (`autoPrompt || prompt` fallback)
- **Key files**: `selectAnchor()` and `handleLoadAnchor()` in App.jsx, `describe_anchor()` in main.py

### 3. BLIP Quality Gate for Anchor Variants (NEW)
- **Problem**: SDXL generates garbage variants (slivers, multi-characters, missing limbs, no faces)
- **Fix**: After generating 4 variants, run pixel analysis + BLIP captioning to reject bad ones, then regenerate only the failures
- **Quality checks (7 total)**:

| # | Check | Method | Catches |
|---|---|---|---|
| 1 | Fill ratio < 5% | Alpha channel | Empty/garbage |
| 2 | Fill ratio > 85% | Alpha channel | Background not removed |
| 3 | Content width < 15% | Column analysis | Slivers |
| 4 | Content height < 40% | Row analysis | Cut-off characters |
| 5 | Horizontal gap > 15% | Gap detection | Separated multi-char |
| 6 | Aspect ratio > 0.85 | Width/height ratio | Packed multi-char |
| 7 | Torso/leg width ratio < 1.25 | Zone analysis | Missing arms |
| 8 | BLIP "two people" | Captioning | Extra multi-char check |
| 9 | BLIP no face words | Captioning | Blank/featureless heads |

- **Architecture**: SDXL stays loaded alongside BLIP (~9GB + 1.5GB = fits in 16GB). No expensive model swapping needed at 512x512.
- **Retry loop**: Up to 3 attempts. Only regenerates failed slots.
- **BLIP sees composited image**: Sprites are composited onto solid gray background before BLIP analysis (no alpha confusion)

### 4. Background Removal: isnet-anime (NEW — just applied)
- **Problem**: Default `u2net` model in rembg is trained on photographs, eats anime-style arms/legs
- **Fix**: Switched to `isnet-anime` model via `new_session("isnet-anime")`
- **Session created once** at startup, reused for all `remove()` calls
- **NEEDS TESTING** — this was the last change applied

### 5. Frame Exclusion Checkboxes
- Per-frame "Exclude" checkbox in the editing UI
- Excluded frames: dimmed opacity, skipped in animation preview, filtered from sprite sheet
- Counter shows "X included" out of total

### 6. Finalize Sprite Sheet Fix
- "Finalize Sprite Sheet" button was broken — fixed to properly stitch included frames

---

## What Still Needs Work

### Priority 1: Test isnet-anime bg removal
- Just switched from `u2net` → `isnet-anime`. Restart backend and test.
- If arms are still eaten, implement the **before/after comparison** approach:
  1. Check image BEFORE bg removal (on green background, BLIP sees clearly)
  2. Remove background
  3. Compare silhouettes — if significant content lost, try fallback model (`u2net_human_seg`)
  4. If still bad, regenerate with new seed

### Priority 2: Face detection needs improvement
- BLIP face check works but isn't reliable enough — sometimes passes blank heads
- Consider: crop just the head region (top 20% of character) and run a dedicated face detection check on that crop
- Alternative: add "detailed face, eyes, mouth" to the SDXL negative prompt exclusions for blank faces

### Priority 3: Walk cycle frame consistency
- Some frames still come back facing the wrong direction (backward-facing)
- IP-Adapter + the auto-prompt help, but not 100%
- Future option: AnimateDiff temporal consistency module

### Priority 4: Smart bg-removal fallback (user's idea)
- Compare before/after bg removal
- If arms/legs are lost, try different rembg models in order:
  1. `isnet-anime` (current default)
  2. `u2net_human_seg`  
  3. `u2net` (original default)
- Only regenerate with SDXL if all bg models fail

---

## Key Technical Details

### VRAM Management
- Walk cycle (1024x1024): Uses `enable_model_cpu_offload()` — ~11GB stable
- Anchor gen (512x512): ~9GB, can run BLIP alongside (~1.5GB)
- BLIP loads/unloads separately from SDXL for the describe step (needs full unload before walk cycle)

### File Locations
- **Backend**: `backend/main.py` (single file, ~840 lines)
- **Frontend**: `src/App.jsx` (single file, ~680 lines)
- **Walk skeletons**: `backend/templates/walk_skeleton_*.png` (12 OpenPose references)
- **Generated output**: `backend/output/`
- **Saved anchor**: `backend/output/saved_anchor.json`

### Python venv
```
C:\CodingProjects\AISpriteCreation\backend\venv\
```
Key packages: `torch`, `diffusers`, `transformers`, `rembg`, `fastapi`, `uvicorn`, `opencv-python`, `Pillow`

### GPU
- NVIDIA RTX 5060 Ti, 16GB VRAM
- CUDA 12.8, Compute 12.0 (Blackwell)
