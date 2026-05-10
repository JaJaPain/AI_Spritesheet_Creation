import os
import time
import uuid
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import shutil

# --- CONFIGURATION ---
COMFY_ADDR = "127.0.0.1:8188" # Assuming same Comfy instance but different workflow
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "temp_uploads")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared progress state
progress_state = {
    "status": "Idle",
    "progress": 0,
    "identity": "video-forge-rapid",
    "latest_video": None
}

@app.get("/status")
async def get_status():
    return progress_state

@app.post("/forge")
async def forge_video(
    image: UploadFile = File(None),
    image_url: str = Form(None),
    prompt: str = Form(...),
    num_frames: int = Form(24),
    seed: int = Form(-1)
):
    """
    Rapid Forge: Optimized for Wan 2.2 4-step generation.
    """
    global progress_state
    if seed == -1:
        seed = int(time.time()) % 1000000
        
    try:
        progress_state["status"] = "Preparing Assets..."
        progress_state["progress"] = 5
        
        # 1. Handle Input Image
        temp_filename = f"rapid_{int(time.time())}.png"
        temp_path = os.path.join(UPLOAD_DIR, temp_filename)
        
        if image:
            with open(temp_path, "wb") as buffer:
                shutil.copyfileobj(image.file, buffer)
        elif image_url:
            # For now, we assume local path or full URL
            # In a real setup, we'd download it
            pass
        else:
            raise HTTPException(status_code=400, detail="No image provided")

        # --- ADVANCED COMPOSITING (Sea Green & Square Frame) ---
        img = Image.open(temp_path).convert("RGBA")
        target_size = 720
        sea_green = (46, 139, 87, 255) 
        
        w, h = img.size
        scale = min(target_size / w, target_size / h) * 0.85
        new_w, new_h = int(w * scale), int(h * scale)
        img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        canvas = Image.new("RGBA", (target_size, target_size), sea_green)
        paste_x = (target_size - new_w) // 2
        paste_y = (target_size - new_h) // 2
        canvas.alpha_composite(img_resized, (paste_x, paste_y))
        canvas.convert("RGB").save(temp_path, "PNG")
        
        # 2. Trigger Workflow (Mocking the wrapper call for now)
        progress_state["status"] = "Forging (4-step Rapid Cycle)..."
        progress_state["progress"] = 20
        
        # Logic to call ComfyUI with wan2.2_rapid_workflow.json would go here
        # For now, we are setting up the structure
        
        return {"status": "success", "message": "Rapid generation started (Simulated)"}

    except Exception as e:
        progress_state["status"] = f"Error: {str(e)}"
        progress_state["progress"] = 0
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002) # Different port for Rapid lab
