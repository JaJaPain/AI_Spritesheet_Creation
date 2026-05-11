import os
import time
import uuid
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
import shutil

# --- CONFIGURATION ---
COMFY_ADDR = "127.0.0.1:8188" # Assuming same Comfy instance but different workflow
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "temp_uploads")
PROJECT_SAVES_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "Output_Saves")

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
    num_frames: int = Form(25),
    steps: int = Form(10),
    seed: int = Form(-1),
    character_id: str = Form("unknown"),
    view_id: str = Form("side_view")
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
            import requests as req
            # Resolve local paths to full URLs on the main backend
            actual_url = image_url
            if image_url.startswith("/"):
                main_port = os.getenv("MAIN_PORT", "8000")
                actual_url = f"http://localhost:{main_port}{image_url}"
            
            print(f"Downloading sprite from: {actual_url}")
            resp = req.get(actual_url, timeout=15)
            if resp.status_code != 200:
                raise HTTPException(status_code=400, detail=f"Failed to download image from {actual_url} (status {resp.status_code})")
            with open(temp_path, "wb") as buffer:
                buffer.write(resp.content)
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
        
        # 2. Call ComfyUI via our wrapper
        from comfy_wrapper import ComfyWrapper
        wrapper = ComfyWrapper(COMFY_ADDR)
        
        # Load the rapid workflow
        workflow_path = os.path.join(os.path.dirname(__file__), "workflow_api.json")
        with open(workflow_path, 'r') as f:
            workflow = json.load(f)
            
        # Update workflow with our specific run data
        workflow["58"]["inputs"]["image"] = temp_path # Load Image Node
        workflow["35"]["inputs"]["seed"] = seed # Sampler Node
        workflow["35"]["inputs"]["steps"] = steps
        workflow["63"]["inputs"]["num_frames"] = num_frames # Encode Node
        
        # Override the text prompt
        workflow["16"]["inputs"]["positive_prompt"] = prompt
        
        print(f"Requesting RAPID generation for: {prompt} (Seed: {seed})")
        video_path = wrapper.run_workflow(workflow)
        
        if video_path:
            # Save to project folder
            anim_dir = os.path.join(PROJECT_SAVES_DIR, character_id, "animations", view_id)
            os.makedirs(anim_dir, exist_ok=True)
            final_filename = f"single_{int(time.time())}.mp4"
            final_path = os.path.join(anim_dir, final_filename)
            shutil.copy(video_path, final_path)
            
            # Also keep a copy in outputs for the video URL response
            out_path = os.path.join(OUTPUT_DIR, final_filename)
            shutil.copy(video_path, out_path)
            
            progress_state["status"] = "Success"
            progress_state["progress"] = 100
            progress_state["latest_video"] = final_filename
            return {"status": "success", "video_url": f"/outputs/{final_filename}"}
        else:
            raise Exception("ComfyUI failed to generate video")

    except Exception as e:
        progress_state["status"] = f"Error: {str(e)}"
        progress_state["progress"] = 0
        raise HTTPException(status_code=500, detail=str(e))

# ─── Batch Processing System ──────────────────────────────────────────
import threading
import random as rand_mod

batch_state = {
    "running": False,
    "cancelled": False,
    "total": 0,
    "completed": 0,
    "current_name": "",
    "current_progress": 0,
    "results": [],        # List of {name, status, video_url, duration}
    "error": None
}

def run_batch_worker(image_path, animations, character_id, view_id):
    """Background worker that processes animations sequentially."""
    global batch_state
    batch_state["running"] = True
    batch_state["cancelled"] = False
    batch_state["total"] = len(animations)
    batch_state["completed"] = 0
    batch_state["results"] = []
    batch_state["error"] = None
    
    # Save into the character's project folder
    batch_output_dir = os.path.join(PROJECT_SAVES_DIR, character_id, "animations", view_id)
    os.makedirs(batch_output_dir, exist_ok=True)
    
    from comfy_wrapper import ComfyWrapper
    wrapper = ComfyWrapper(COMFY_ADDR)
    
    for i, anim in enumerate(animations):
        if batch_state["cancelled"]:
            batch_state["results"].append({
                "name": anim["display_name"],
                "id": anim["id"],
                "status": "cancelled"
            })
            continue
        
        start_time = time.time()
        batch_state["current_name"] = anim["display_name"]
        batch_state["current_progress"] = 0
        
        try:
            # Load workflow
            workflow_path = os.path.join(os.path.dirname(__file__), "workflow_api.json")
            with open(workflow_path, 'r') as f:
                workflow = json.load(f)
            
            # Configure workflow for this animation
            workflow["58"]["inputs"]["image"] = image_path
            seed = anim.get("seed", -1)
            if seed == -1:
                seed = rand_mod.randint(0, 2**32 - 1)
            workflow["35"]["inputs"]["seed"] = seed
            workflow["35"]["inputs"]["steps"] = anim.get("steps", 10)
            workflow["63"]["inputs"]["num_frames"] = anim.get("num_frames", 25)
            workflow["16"]["inputs"]["positive_prompt"] = anim["prompt"]
            
            print(f"[BATCH {i+1}/{len(animations)}] Generating: {anim['display_name']}")
            video_path = wrapper.run_workflow(workflow)
            
            if video_path:
                final_filename = f"{anim['id']}.mp4"
                final_path = os.path.join(batch_output_dir, final_filename)
                shutil.copy(video_path, final_path)
                
                duration = round(time.time() - start_time, 1)
                batch_state["results"].append({
                    "name": anim["display_name"],
                    "id": anim["id"],
                    "status": "success",
                    "video_path": final_path,
                    "video_url": f"/api/project-files/{character_id}/animations/{view_id}/{final_filename}",
                    "duration": duration
                })
                print(f"[BATCH {i+1}/{len(animations)}] ✓ {anim['display_name']} ({duration}s)")
            else:
                batch_state["results"].append({
                    "name": anim["display_name"],
                    "id": anim["id"],
                    "status": "failed",
                    "error": "ComfyUI returned no output"
                })
                
        except Exception as e:
            batch_state["results"].append({
                "name": anim["display_name"],
                "id": anim["id"],
                "status": "error",
                "error": str(e)
            })
            print(f"[BATCH {i+1}/{len(animations)}] ✗ {anim['display_name']}: {e}")
        
        batch_state["completed"] = i + 1
    
    batch_state["running"] = False
    batch_state["current_name"] = ""
    print(f"[BATCH] Complete: {sum(1 for r in batch_state['results'] if r['status']=='success')}/{len(animations)} succeeded")

@app.post("/batch")
async def start_batch(
    image: UploadFile = File(None),
    image_url: str = Form(None),
    animations_json: str = Form(...),
    character_id: str = Form("unknown"),
    view_id: str = Form("side_view")
):
    """Start a batch of animations for a single sprite slice."""
    if batch_state["running"]:
        raise HTTPException(status_code=409, detail="A batch is already running")
    
    animations = json.loads(animations_json)
    if not animations:
        raise HTTPException(status_code=400, detail="No animations provided")
    
    # Save uploaded image
    temp_path = os.path.join(UPLOAD_DIR, f"batch_{int(time.time())}.png")
    
    if image and image.filename:
        contents = await image.read()
        with open(temp_path, "wb") as f:
            f.write(contents)
    elif image_url:
        import requests as req
        if image_url.startswith("http"):
            r = req.get(image_url)
            with open(temp_path, "wb") as f:
                f.write(r.content)
        elif image_url.startswith("/"):
            r = req.get(f"http://127.0.0.1:8000{image_url}")
            with open(temp_path, "wb") as f:
                f.write(r.content)
    else:
        raise HTTPException(status_code=400, detail="No image provided")
    
    # Prepare image (same as single forge)
    img = Image.open(temp_path).convert("RGBA")
    target_size = 480
    sea_green = (0, 250, 154, 255)
    w, h = img.size
    scale = min(target_size / w, target_size / h)
    new_w, new_h = int(w * scale), int(h * scale)
    img_resized = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (target_size, target_size), sea_green)
    paste_x = (target_size - new_w) // 2
    paste_y = (target_size - new_h) // 2
    canvas.alpha_composite(img_resized, (paste_x, paste_y))
    canvas.convert("RGB").save(temp_path, "PNG")
    
    # Start background worker
    thread = threading.Thread(
        target=run_batch_worker,
        args=(temp_path, animations, character_id, view_id),
        daemon=True
    )
    thread.start()
    
    return {
        "status": "started",
        "total": len(animations),
        "message": f"Batch started with {len(animations)} animations"
    }

@app.get("/batch/status")
async def get_batch_status():
    """Get current batch processing status."""
    return {
        "running": batch_state["running"],
        "total": batch_state["total"],
        "completed": batch_state["completed"],
        "current_name": batch_state["current_name"],
        "results": batch_state["results"],
        "error": batch_state["error"]
    }

@app.post("/batch/cancel")
async def cancel_batch():
    """Cancel the running batch after current animation finishes."""
    if not batch_state["running"]:
        raise HTTPException(status_code=400, detail="No batch is running")
    batch_state["cancelled"] = True
    return {"status": "cancelling", "message": "Batch will stop after current animation completes"}

# Mount batch outputs as static files (nested directories)
from starlette.staticfiles import StaticFiles as StarletteStatic
# Re-mount outputs to support nested paths
app.mount("/outputs", StarletteStatic(directory=OUTPUT_DIR), name="outputs_nested")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
