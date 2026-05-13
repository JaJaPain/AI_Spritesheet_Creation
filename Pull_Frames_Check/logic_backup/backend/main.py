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

@app.middleware("http")
async def add_cors_headers(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    return response

# Directories
UPLOAD_DIR = "uploads"
FRAMES_DIR = "frames"
PROCESSED_DIR = "processed"

for d in [UPLOAD_DIR, FRAMES_DIR, PROCESSED_DIR]:
    os.makedirs(d, exist_ok=True)

# Custom StaticFiles to ensure CORS headers are always present
class CORSStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

# Mount static files for serving images and videos
app.mount("/frames", CORSStaticFiles(directory=FRAMES_DIR), name="frames")
app.mount("/processed", CORSStaticFiles(directory=PROCESSED_DIR), name="processed")
app.mount("/outputs", CORSStaticFiles(directory=UPLOAD_DIR), name="outputs")

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

@app.post("/save-manual-edit")
async def save_manual_edit(
    project_id: str = Form(...),
    frame_name: str = Form(...),
    image_data: str = Form(...) # Base64 data
):
    import base64
    project_processed_dir = os.path.join(PROCESSED_DIR, project_id)
    os.makedirs(project_processed_dir, exist_ok=True)
    
    file_path = os.path.join(project_processed_dir, frame_name)
    
    # Remove header if present (data:image/png;base64,)
    if "," in image_data:
        image_data = image_data.split(",")[1]
        
    with open(file_path, "wb") as f:
        f.write(base64.b64decode(image_data))
        
    return {"status": "success", "url": f"/processed/{project_id}/{frame_name}"}

@app.post("/dehalo")
async def dehalo_image(
    image_data: str = Form(...) # Base64 data
):
    import base64
    import cv2
    import numpy as np
    from io import BytesIO
    from PIL import Image

    # Remove header if present
    if "," in image_data:
        image_data = image_data.split(",")[1]
    
    img_bytes = base64.b64decode(image_data)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_UNCHANGED) # Should be RGBA

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image data")

    if img.shape[2] < 4:
        # Not an alpha-capable image, nothing to de-halo
        return {"image_data": f"data:image/png;base64,{image_data}"}

    # Extract Alpha channel
    alpha = img[:, :, 3]
    
    # Erode alpha
    # User requested "removes 2 pixels"
    kernel = np.ones((3, 3), np.uint8)
    eroded_alpha = cv2.erode(alpha, kernel, iterations=2)
    
    # Replace alpha
    img[:, :, 3] = eroded_alpha
    
    # Convert back to base64
    _, buffer = cv2.imencode(".png", img)
    encoded_image = base64.b64encode(buffer).decode("utf-8")
    
    return {"image_data": f"data:image/png;base64,{encoded_image}"}

@app.post("/remove-bg")
async def remove_background(project_id: str = Form(...), frame_name: str = Form(...)):
    frame_path = os.path.join(FRAMES_DIR, project_id, frame_name)
    if not os.path.exists(frame_path):
        raise HTTPException(status_code=404, detail="Frame not found")
    
    processed_url = bg_remover.remove_background(project_id, frame_name, frame_path)
    return {"processed_url": processed_url}

import json

@app.get("/get-project-frames/{project_id}")
async def get_project_frames(project_id: str):
    project_dir = os.path.join(FRAMES_DIR, project_id)
    if not os.path.exists(project_dir):
        raise HTTPException(status_code=404, detail="Project not found")
        
    frames = []
    for f in sorted(os.listdir(project_dir)):
        if f.startswith("frame_"):
            frames.append({
                "index": int(f.split("_")[1].split(".")[0]),
                "path": f"/frames/{project_id}/{f}",
                "name": f
            })
    return {"frames": frames}

@app.get("/list-projects")
async def list_projects():
    projects = []
    if not os.path.exists(FRAMES_DIR):
        return {"projects": []}
        
    for pid in os.listdir(FRAMES_DIR):
        project_path = os.path.join(FRAMES_DIR, pid)
        state_path = os.path.join(project_path, "project_state.json")
        
        if os.path.isdir(project_path) and os.path.exists(state_path):
            # Find a thumbnail (first frame)
            frames = [f for f in os.listdir(project_path) if f.startswith("frame_")]
            thumbnail = None
            if frames:
                thumbnail = f"/frames/{pid}/{sorted(frames)[0]}"
            
            # Get last modified time
            mtime = os.path.getmtime(state_path)
            
            projects.append({
                "id": pid,
                "thumbnail": thumbnail,
                "updated": mtime
            })
    
    # Sort by most recent
    projects.sort(key=lambda x: x["updated"], reverse=True)
    return {"projects": projects}

@app.post("/save-state")
async def save_state(
    project_id: str = Form(...),
    state_json: str = Form(...)
):
    project_dir = os.path.join(FRAMES_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)
    
    state_path = os.path.join(project_dir, "project_state.json")
    state_data = json.loads(state_json)
    
    with open(state_path, "w") as f:
        json.dump(state_data, f, indent=2)
    
    return {"status": "success"}

@app.get("/load-state/{project_id}")
async def load_state(project_id: str):
    state_path = os.path.join(FRAMES_DIR, project_id, "project_state.json")
    if not os.path.exists(state_path):
        return {"status": "no_state"}
    
    with open(state_path, "r") as f:
        data = json.load(f)
    
    return {"status": "success", "state": data}

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
