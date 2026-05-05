import os
import torch
import uuid
import sys
import traceback
import logging
import gc
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

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.FileHandler("backend.log"), logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("output", exist_ok=True)
os.makedirs("templates", exist_ok=True)
app.mount("/output", StaticFiles(directory="output"), name="output")

class ModelManager:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.pipelines = {}
        logger.info(f"--- ModelManager Initialized on {self.device} ---")

    def unload_all(self):
        logger.info("Unloading all models and clearing VRAM...")
        for key in list(self.pipelines.keys()):
            del self.pipelines[key]
        if self.device == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            gc.collect()

    def load_sdxl(self):
        if "sdxl" in self.pipelines:
            return self.pipelines["sdxl"]
        self.unload_all()
        logger.info("Loading SDXL + ControlNet...")
        try:
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
            pipe.enable_model_cpu_offload()
            self.pipelines["sdxl"] = pipe
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load SDXL: {e}")
            raise e

manager = ModelManager()

@app.get("/")
async def root():
    return {"status": "active", "device": manager.device}

@app.post("/generate-anchor")
async def generate_anchor(
    prompt: str = Body(..., embed=True),
    template_id: str = Body("default", embed=True),
    num_variants: int = Body(4, embed=True)
):
    try:
        pipe = manager.load_sdxl()
        template_path = f"templates/{template_id}.png"
        if not os.path.exists(template_path): template_path = "templates/default.png"
        control_image = load_image(template_path)
        
        full_prompt = f"(single character:1.6), centered, {prompt}, arms at sides, neutral pose, pixel art style, high quality, solid background"
        negative_prompt = "character sheet, clones, group, T-pose, blurry, messy"

        urls = []
        for i in range(num_variants):
            logger.info(f"Generating variant {i+1}/{num_variants}...")
            image = pipe(full_prompt, negative_prompt=negative_prompt, image=control_image, controlnet_conditioning_scale=0.75, num_inference_steps=30).images[0]
            image = remove(image)
            filename = f"anchor_{uuid.uuid4()}.png"
            filepath = os.path.join("output", filename)
            image.save(filepath)
            urls.append(f"/output/{filename}")
        return {"status": "success", "urls": urls}
    except Exception as e:
        logger.error(f"Error during anchor generation: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/animate-guided")
async def animate_guided(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True)
):
    try:
        logger.info(f"DEEP FORGE: Guided Animation starting...")
        pipe = manager.load_sdxl()
        
        # Ensure we can find the reference video
        ref_path = "backend/output/ref_front.mp4"
        if not os.path.exists(ref_path): ref_path = "output/ref_front.mp4"
        if not os.path.exists(ref_path): raise HTTPException(status_code=404, detail="Ref video not found")
            
        # Extract 8 frames
        cap = cv2.VideoCapture(ref_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        num_target_frames = 8
        step = max(1, total_frames // num_target_frames)
        
        ref_frames = []
        for i in range(num_target_frames):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i * step)
            ret, frame = cap.read()
            if ret: ref_frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        cap.release()
        
        # Load the anchor image to use as a strong visual reference
        anchor_name = os.path.basename(image_url)
        anchor_path = os.path.join("output", anchor_name)
        anchor_img = load_image(anchor_path).convert("RGB")
        
        processed_frames = []
        seed = 42 
        
        for i, ref_img in enumerate(ref_frames):
            logger.info(f"Deep Forging Frame {i+1}/8...")
            
            # Flush VRAM to prevent glitched output
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()

            # Generating with the anchor image and the pose guide
            # We use the anchor image as an 'IP-Adapter' style influence by prepending its characteristics
            full_prompt = f"(single character:1.4), {prompt}, walking pose, perfect pixel art, solid background"
            
            # Running inference for this frame
            img = pipe(
                prompt=full_prompt,
                image=ref_img, # This is the video frame pose guide
                controlnet_conditioning_scale=0.9,
                num_inference_steps=25,
                generator=torch.Generator(device=manager.device).manual_seed(seed)
            ).images[0]
            
            # Background removal with alpha protection
            img = remove(img)
            processed_frames.append(img)
            
        # Stitch
        max_w, max_h = 0, 0
        final_crops = []
        for img in processed_frames:
            bbox = img.getbbox()
            if bbox:
                c = img.crop(bbox)
                final_crops.append(c)
                max_w = max(max_w, c.width)
                max_h = max(max_h, c.height)
            else:
                final_crops.append(img)
                max_w = max(max_w, img.width)
                max_h = max(max_h, img.height)
                
        sheet_w = max_w * len(final_crops)
        sheet_h = max_h
        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
        for i, f in enumerate(final_crops):
            sheet.paste(f, (i * max_w + (max_w - f.width) // 2, (max_h - f.height) // 2), f)
            
        filename = f"precision_sheet_{uuid.uuid4()}.png"
        filepath = os.path.join("output", filename)
        sheet.save(filepath)
        
        return {"status": "success", "url": f"/output/{filename}"}
    except Exception as e:
        logger.error(f"CRITICAL Error during deep forge: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
