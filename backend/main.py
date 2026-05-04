import os
import torch
import uuid
from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
import numpy as np
import cv2
from diffusers import (
    StableDiffusionXLControlNetPipeline, 
    ControlNetModel, 
    LTXImageToVideoPipeline,
    AutoencoderKL
)
from diffusers.utils import load_image, export_to_video
from rembg import remove
import io

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure directories exist
os.makedirs("output", exist_ok=True)
os.makedirs("templates", exist_ok=True)

# Serve generated images and videos
app.mount("/output", StaticFiles(directory="output"), name="output")

class ModelManager:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.pipelines = {}
        print(f"--- ModelManager Initialized on {self.device} ---")

    def unload_all(self):
        """Clear VRAM before loading a new heavy model."""
        for key in list(self.pipelines.keys()):
            del self.pipelines[key]
        if self.device == "cuda":
            torch.cuda.empty_cache()

    def load_sdxl(self):
        if "sdxl" in self.pipelines:
            return self.pipelines["sdxl"]
        
        self.unload_all()
        print("Loading SDXL + ControlNet (this may take a minute)...")
        
        controlnet = ControlNetModel.from_pretrained(
            "diffusers/controlnet-canny-sdxl-1.0", 
            torch_dtype=torch.float16
        )
        pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
            "stabilityai/stable-diffusion-xl-base-1.0",
            controlnet=controlnet,
            torch_dtype=torch.float16,
            use_safetensors=True
        )
        
        # Enable efficient memory usage for 16GB VRAM
        pipe.enable_model_cpu_offload()
        
        self.pipelines["sdxl"] = pipe
        return pipe

    def load_ltx(self):
        if "ltx" in self.pipelines:
            return self.pipelines["ltx"]
        
        self.unload_all()
        print("Loading LTX-Video (this will take a minute)...")
        
        pipe = LTXImageToVideoPipeline.from_pretrained(
            "Lightricks/LTX-Video", 
            torch_dtype=torch.bfloat16
        )
        
        # Enable efficient memory usage
        pipe.enable_model_cpu_offload()
        
        self.pipelines["ltx"] = pipe
        return pipe

manager = ModelManager()

@app.get("/")
async def root():
    return {"status": "active", "device": manager.device}

@app.post("/generate-anchor")
async def generate_anchor(
    prompt: str = Body(..., embed=True),
    template_id: str = Body("default", embed=True)
):
    try:
        pipe = manager.load_sdxl()
        
        # Load the template (Canny image)
        template_path = f"templates/{template_id}.png"
        if not os.path.exists(template_path):
            # Fallback to default if template missing
            template_path = "templates/default.png"
        
        control_image = load_image(template_path)
        
        # Enhanced prompt for pixel art aesthetic
        full_prompt = f"{prompt}, pixel art style, high quality, 8-bit, game sprite, solid dark gray background"
        negative_prompt = "photorealistic, 3d render, blurry, deformed, messy, complex background"

        image = pipe(
            full_prompt,
            negative_prompt=negative_prompt,
            image=control_image,
            controlnet_conditioning_scale=0.6,
            num_inference_steps=30
        ).images[0]

        # Remove background
        print("Removing background from anchor...")
        image = remove(image)

        # Process image (e.g., auto-crop or transparency)
        filename = f"anchor_{uuid.uuid4()}.png"
        filepath = os.path.join("output", filename)
        image.save(filepath)

        return {"status": "success", "url": f"/output/{filename}"}
    
    except Exception as e:
        print(f"Error during generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/animate")
async def animate(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True)
):
    try:
        pipe = manager.load_ltx()
        
        # Resolve the local path of the image
        image_name = os.path.basename(image_url)
        image_path = os.path.join("output", image_name)
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image not found")
            
        init_image = load_image(image_path).resize((704, 480))
        
        # Generate the video using the anchor as the seed
        video_output = pipe(
            image=init_image,
            prompt=f"{prompt}, pixel art style, high quality, smooth motion",
            negative_prompt="worst quality, blurry, distorted, realistic",
            width=704,
            height=480,
            num_frames=25, # Shorter sequence for speed
            num_inference_steps=25,
        ).frames[0]

        filename = f"anim_{uuid.uuid4()}.mp4"
        filepath = os.path.join("output", filename)
        export_to_video(video_output, filepath, fps=8) # Lower FPS for 'choppy' pixel look
        
        return {"status": "success", "url": f"/output/{filename}"}
    
    except Exception as e:
        print(f"Error during animation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-spritesheet")
async def generate_spritesheet(
    video_url: str = Body(..., embed=True)
):
    try:
        # Resolve the local path of the video
        video_name = os.path.basename(video_url)
        video_path = os.path.join("output", video_name)
        
        if not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail="Video not found")
            
        print(f"Extracting frames from {video_path}...")
        cap = cv2.VideoCapture(video_path)
        frames = []
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            # Convert BGR (OpenCV) to RGB (PIL)
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(frame_rgb))
        cap.release()
        
        if not frames:
            raise HTTPException(status_code=500, detail="Failed to extract frames from video")
            
        # Select 8 evenly spaced frames for the sprite sheet
        num_target_frames = 8
        step = max(1, len(frames) // num_target_frames)
        selected_frames = frames[::step][:num_target_frames]
        
        print(f"Processing {len(selected_frames)} frames for spritesheet...")
        processed_frames = []
        max_w, max_h = 0, 0
        
        for i, f in enumerate(selected_frames):
            print(f"  Removing background from frame {i+1}...")
            f_clean = remove(f)
            # Find the bounding box of the non-transparent area to 'tighten' the sprite
            bbox = f_clean.getbbox()
            if bbox:
                f_cropped = f_clean.crop(bbox)
                processed_frames.append(f_cropped)
                max_w = max(max_w, f_cropped.width)
                max_h = max(max_h, f_cropped.height)
            else:
                processed_frames.append(f_clean)
                max_w = max(max_w, f_clean.width)
                max_h = max(max_h, f_clean.height)

        # Create a horizontal sprite sheet with uniform frame sizes
        sheet_w = max_w * len(processed_frames)
        sheet_h = max_h
        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
        
        for i, f in enumerate(processed_frames):
            # Center each sprite in its allocated frame slot
            x_offset = i * max_w + (max_w - f.width) // 2
            y_offset = (max_h - f.height) // 2
            sheet.paste(f, (x_offset, y_offset), f)
            
        filename = f"spritesheet_{uuid.uuid4()}.png"
        filepath = os.path.join("output", filename)
        sheet.save(filepath)
        
        print(f"Spritesheet saved to {filepath}")
        return {"status": "success", "url": f"/output/{filename}"}
    
    except Exception as e:
        print(f"Error during spritesheet generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def find_free_port(start_port):
    import socket
    port = start_port
    while port < start_port + 10:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                return port
            port += 1
    return start_port

if __name__ == "__main__":
    import uvicorn
    port = find_free_port(8000)
    print(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
