from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uuid
import os
import shutil
from typing import List
from processor import FrameProcessor
from bg_remover import BackgroundRemover

app = FastAPI()

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories
UPLOAD_DIR = "uploads"
FRAMES_DIR = "frames"
PROCESSED_DIR = "processed"

for d in [UPLOAD_DIR, FRAMES_DIR, PROCESSED_DIR]:
    os.makedirs(d, exist_ok=True)

# Mount static files for serving images and videos
app.mount("/frames", StaticFiles(directory=FRAMES_DIR), name="frames")
app.mount("/processed", StaticFiles(directory=PROCESSED_DIR), name="processed")
app.mount("/outputs", StaticFiles(directory=UPLOAD_DIR), name="outputs")

processor = FrameProcessor(UPLOAD_DIR, FRAMES_DIR)
bg_remover = BackgroundRemover(PROCESSED_DIR)

@app.post("/upload-video")
async def upload_video(file: UploadFile = File(...)):
    project_id = str(uuid.uuid4())[:8]
    video_path = os.path.join(UPLOAD_DIR, f"{project_id}_{file.filename}")
    
    with open(video_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    frames = processor.extract_frames(video_path, project_id)
    return {"project_id": project_id, "frames": frames}

@app.post("/remove-bg")
async def remove_background(project_id: str = Form(...), frame_name: str = Form(...)):
    frame_path = os.path.join(FRAMES_DIR, project_id, frame_name)
    if not os.path.exists(frame_path):
        raise HTTPException(status_code=404, detail="Frame not found")
    
    processed_url = bg_remover.remove_background(project_id, frame_name, frame_path)
    return {"processed_url": processed_url}

@app.post("/export-spritesheet")
async def export_spritesheet(
    project_id: str = Form(...), 
    frame_names: str = Form(...), 
    use_processed: bool = Form(...),
    offsets: str = Form(None) # JSON string mapping frame_name -> {x, y}
):
    import json
    names = json.loads(frame_names)
    offset_dict = json.loads(offsets) if offsets else None
    
    output_path = processor.create_spritesheet(project_id, names, use_processed, offset_dict)
    
    if not output_path:
        raise HTTPException(status_code=500, detail="Failed to create spritesheet")
    
    filename = os.path.basename(output_path)
    return {"url": f"/outputs/{filename}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
