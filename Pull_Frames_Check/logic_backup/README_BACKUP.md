# SpriteForge Logic Backup
Created: 2026-05-11

This directory contains a backup of the core logic files for the SpriteForge project, including the finalized Surgical Studio with its CORS and centering fixes.

## Backend Files
- `backend/main.py`: FastAPI server with custom `CORSStaticFiles` and manual edit endpoints.
- `backend/processor.py`: Core frame extraction and spritesheet generation logic.
- `backend/bg_remover.py`: AI-based background removal utility.

## Frontend Files
- `frontend/src/App.jsx`: Main React application containing the `SurgicalStudio` component and project state management.
- `frontend/src/index.css`: Global styles and design system.
