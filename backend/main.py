import os
import torch
import uuid
import sys
import traceback
import logging
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
from transformers import CLIPVisionModelWithProjection
from diffusers.utils import load_image, export_to_video
from rembg import remove
from controlnet_aux import OpenposeDetector
import gc
import io

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("backend.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

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
        logger.info(f"--- ModelManager Initialized on {self.device} ---")

    def unload_all(self):
        """Clear VRAM before loading a new heavy model."""
        logger.info("Unloading all models to clear VRAM...")
        for key in list(self.pipelines.keys()):
            del self.pipelines[key]
        if self.device == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()

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

    def load_ltx(self):
        if "ltx" in self.pipelines:
            return self.pipelines["ltx"]
        
        self.unload_all()
        logger.info("Loading LTX-Video...")
        
        try:
            pipe = LTXImageToVideoPipeline.from_pretrained(
                "Lightricks/LTX-Video", 
                torch_dtype=torch.bfloat16
            )
            logger.info("Enabling sequential CPU offload for LTX-Video...")
            pipe.enable_sequential_cpu_offload()
            self.pipelines["ltx"] = pipe
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load LTX-Video: {e}")
            raise e

    def load_sdxl_openpose(self):
        """Load SDXL with OpenPose ControlNet for pose-guided generation."""
        if "sdxl_openpose" in self.pipelines:
            return self.pipelines["sdxl_openpose"]
        
        self.unload_all()
        logger.info("Loading SDXL + OpenPose ControlNet...")
        
        try:
            controlnet = ControlNetModel.from_pretrained(
                "thibaud/controlnet-openpose-sdxl-1.0", 
                torch_dtype=torch.float16
            )
            # Load the CLIP image encoder explicitly so CPU offload handles it
            image_encoder = CLIPVisionModelWithProjection.from_pretrained(
                "h94/IP-Adapter",
                subfolder="models/image_encoder",
                torch_dtype=torch.float16
            )
            pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0",
                controlnet=controlnet,
                image_encoder=image_encoder,
                torch_dtype=torch.float16,
                use_safetensors=True
            )
            # Load IP-Adapter Plus (matches ViT-H encoder, better character fidelity)
            logger.info("Loading IP-Adapter Plus for character identity preservation...")
            pipe.load_ip_adapter(
                "h94/IP-Adapter", 
                subfolder="sdxl_models", 
                weight_name="ip-adapter-plus_sdxl_vit-h.safetensors"
            )
            pipe.set_ip_adapter_scale(0.6)
            pipe.enable_model_cpu_offload()
            self.pipelines["sdxl_openpose"] = pipe
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load SDXL+OpenPose: {e}")
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
        if not os.path.exists(template_path):
            template_path = "templates/default.png"
        
        control_image = load_image(template_path)
        full_prompt = f"{prompt}, pixel art style, high quality, 8-bit, game sprite, solid dark gray background"
        negative_prompt = "photorealistic, 3d render, blurry, deformed, messy, complex background"

        urls = []
        for i in range(num_variants):
            logger.info(f"Generating variant {i+1}/{num_variants}...")
            image = pipe(
                full_prompt,
                negative_prompt=negative_prompt,
                image=control_image,
                controlnet_conditioning_scale=0.6,
                num_inference_steps=30
            ).images[0]

            logger.info(f"  Removing background for variant {i+1}...")
            image = remove(image)

            filename = f"anchor_{uuid.uuid4()}.png"
            filepath = os.path.join("output", filename)
            image.save(filepath)
            urls.append(f"/output/{filename}")

        return {"status": "success", "urls": urls}
    except Exception as e:
        logger.error(f"Error during anchor generation: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/animate")
async def animate(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True)
):
    try:
        logger.info(f"Animation request received for {image_url}")
        pipe = manager.load_ltx()
        
        image_name = os.path.basename(image_url)
        image_path = os.path.join("output", image_name)
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Image not found")
            
        logger.info("Preparing init image...")
        init_image = load_image(image_path).resize((704, 480))
        
        logger.info("Starting LTX-Video inference...")
        video_output = pipe(
            image=init_image,
            prompt=f"{prompt}, pixel art style, high quality, smooth motion",
            negative_prompt="worst quality, blurry, distorted, realistic",
            width=704,
            height=480,
            num_frames=25,
            num_inference_steps=25,
        ).frames[0]

        logger.info("Inference complete. Exporting video...")
        filename = f"anim_{uuid.uuid4()}.mp4"
        filepath = os.path.join("output", filename)
        export_to_video(video_output, filepath, fps=8)
        
        logger.info(f"Animation saved to {filepath}")
        return {"status": "success", "url": f"/output/{filename}"}
    except Exception as e:
        logger.error(f"CRITICAL Error during animation: {e}")
        logger.error(traceback.format_exc())
        manager.unload_all()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/animate-openpose")
async def animate_openpose(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True),
    reference_video: str = Body("ref_front.mp4", embed=True),
    num_frames: int = Body(8, embed=True)
):
    """Generate a walk/attack/death cycle using OpenPose skeletons from any reference video."""
    try:
        logger.info(f"OpenPose animation requested for {image_url} using ref={reference_video}")
        
        # Create a session ID to group all files from this walk cycle
        session_id = str(uuid.uuid4())[:8]
        
        # Find the reference video
        ref_path = None
        for candidate in [f"output/{reference_video}", f"backend/output/{reference_video}"]:
            if os.path.exists(candidate):
                ref_path = candidate
                break
        if not ref_path:
            raise HTTPException(status_code=404, detail=f"Reference video {reference_video} not found in output/")
        
        # Step 1: Extract evenly-spaced frames from the reference video
        logger.info("Step 1/4: Extracting reference frames...")
        cap = cv2.VideoCapture(ref_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        num_target = num_frames
        step = max(1, total_frames // num_target)
        
        ref_frames = []
        for i in range(num_target):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i * step)
            ret, frame = cap.read()
            if ret:
                ref_frames.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        cap.release()
        logger.info(f"  Extracted {len(ref_frames)} reference frames.")
        
        # Step 2: Generate OpenPose skeletons and SAVE them
        logger.info("Step 2/4: Generating OpenPose skeletons...")
        openpose = OpenposeDetector.from_pretrained("lllyasviel/ControlNet")
        skeleton_urls = []
        for i, ref in enumerate(ref_frames):
            pose = openpose(ref)
            skel_filename = f"skel_{session_id}_{i}.png"
            skel_path = os.path.join("output", skel_filename)
            pose.save(skel_path)
            skeleton_urls.append(f"/output/{skel_filename}")
            logger.info(f"  Skeleton {i+1}/{len(ref_frames)} done.")
        
        # Step 3: Load SDXL + OpenPose ControlNet and generate character in each pose
        logger.info("Step 3/4: Loading SDXL + OpenPose ControlNet...")
        pipe = manager.load_sdxl_openpose()
        
        # Load the anchor image for IP-Adapter reference
        anchor_name = os.path.basename(image_url)
        anchor_path = os.path.join("output", anchor_name)
        if not os.path.exists(anchor_path):
            raise HTTPException(status_code=404, detail="Anchor image not found")
        anchor_image = load_image(anchor_path).convert("RGB")
        logger.info(f"  Loaded anchor image: {anchor_path}")
        
        # Precompute IP-Adapter image embeddings ONCE
        logger.info("  Precomputing IP-Adapter embeddings from anchor...")
        image_embeds = pipe.prepare_ip_adapter_image_embeds(
            ip_adapter_image=anchor_image,
            ip_adapter_image_embeds=None,
            device=manager.device,
            num_images_per_prompt=1,
            do_classifier_free_guidance=True
        )
        
        full_prompt = f"{prompt}, pixel art style, game sprite, full body, solid dark gray background"
        negative_prompt = "photorealistic, 3d render, blurry, deformed, messy background, multiple characters"
        
        seed = 42
        frame_urls = []
        for i in range(len(ref_frames)):
            logger.info(f"  Generating frame {i+1}/{len(ref_frames)}...")
            
            skeleton = load_image(os.path.join("output", f"skel_{session_id}_{i}.png"))
            
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
            
            image = pipe(
                full_prompt,
                negative_prompt=negative_prompt,
                image=skeleton,
                ip_adapter_image_embeds=image_embeds,
                controlnet_conditioning_scale=0.8,
                num_inference_steps=25,
                generator=torch.Generator(device="cpu").manual_seed(seed)
            ).images[0]
            
            image = remove(image)
            
            # Save individual frame
            frame_filename = f"frame_{session_id}_{i}.png"
            frame_path = os.path.join("output", frame_filename)
            image.save(frame_path)
            frame_urls.append(f"/output/{frame_filename}")
        
        logger.info("Step 4/4: All frames generated.")
        
        return {
            "status": "success",
            "session_id": session_id,
            "frame_urls": frame_urls,
            "skeleton_urls": skeleton_urls,
            "anchor_url": image_url
        }
    except Exception as e:
        logger.error(f"Error during OpenPose walk cycle: {e}")
        logger.error(traceback.format_exc())
        manager.unload_all()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/regenerate-frame")
async def regenerate_frame(
    frame_index: int = Body(..., embed=True),
    skeleton_url: str = Body(..., embed=True),
    anchor_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True),
    session_id: str = Body(..., embed=True)
):
    """Regenerate a single frame using a new random seed."""
    try:
        logger.info(f"Regenerating frame {frame_index} for session {session_id}")
        
        pipe = manager.load_sdxl_openpose()
        
        # Load skeleton
        skel_name = os.path.basename(skeleton_url)
        skeleton = load_image(os.path.join("output", skel_name))
        
        # Load anchor and precompute embeddings
        anchor_name = os.path.basename(anchor_url)
        anchor_path = os.path.join("output", anchor_name)
        anchor_image = load_image(anchor_path).convert("RGB")
        
        image_embeds = pipe.prepare_ip_adapter_image_embeds(
            ip_adapter_image=anchor_image,
            ip_adapter_image_embeds=None,
            device=manager.device,
            num_images_per_prompt=1,
            do_classifier_free_guidance=True
        )
        
        full_prompt = f"{prompt}, pixel art style, game sprite, full body, solid dark gray background"
        negative_prompt = "photorealistic, 3d render, blurry, deformed, messy background, multiple characters"
        
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
        
        # Use a random seed for variation
        import random
        seed = random.randint(0, 2**32 - 1)
        logger.info(f"  Using seed {seed}")
        
        image = pipe(
            full_prompt,
            negative_prompt=negative_prompt,
            image=skeleton,
            ip_adapter_image_embeds=image_embeds,
            controlnet_conditioning_scale=0.8,
            num_inference_steps=25,
            generator=torch.Generator(device="cpu").manual_seed(seed)
        ).images[0]
        
        image = remove(image)
        
        # Overwrite the frame file
        frame_filename = f"frame_{session_id}_{frame_index}.png"
        frame_path = os.path.join("output", frame_filename)
        image.save(frame_path)
        logger.info(f"  Frame {frame_index} regenerated: {frame_path}")
        
        return {"status": "success", "url": f"/output/{frame_filename}"}
    except Exception as e:
        logger.error(f"Error regenerating frame: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stitch-frames")
async def stitch_frames(
    frame_urls: list = Body(..., embed=True)
):
    """Stitch individual frames into a final sprite sheet."""
    try:
        logger.info(f"Stitching {len(frame_urls)} frames into sprite sheet...")
        
        frames = []
        max_w, max_h = 0, 0
        for url in frame_urls:
            name = os.path.basename(url)
            img = load_image(os.path.join("output", name))
            bbox = img.getbbox()
            if bbox:
                c = img.crop(bbox)
                frames.append(c)
                max_w = max(max_w, c.width)
                max_h = max(max_h, c.height)
            else:
                frames.append(img)
                max_w = max(max_w, img.width)
                max_h = max(max_h, img.height)
        
        sheet = Image.new("RGBA", (max_w * len(frames), max_h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            x = i * max_w + (max_w - f.width) // 2
            y = (max_h - f.height) // 2
            sheet.paste(f, (x, y), f)
        
        filename = f"spritesheet_{uuid.uuid4()}.png"
        filepath = os.path.join("output", filename)
        sheet.save(filepath)
        logger.info(f"Sprite sheet saved: {filepath}")
        
        return {"status": "success", "url": f"/output/{filename}"}
    except Exception as e:
        logger.error(f"Error stitching frames: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-spritesheet")
async def generate_spritesheet(
    video_url: str = Body(..., embed=True)
):
    try:
        video_name = os.path.basename(video_url)
        video_path = os.path.join("output", video_name)
        
        if not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail="Video not found")
            
        logger.info(f"Extracting frames from {video_path}...")
        cap = cv2.VideoCapture(video_path)
        frames = []
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(Image.fromarray(frame_rgb))
        cap.release()
        
        if not frames:
            raise HTTPException(status_code=500, detail="Failed to extract frames from video")
            
        num_target_frames = 8
        step = max(1, len(frames) // num_target_frames)
        selected_frames = frames[::step][:num_target_frames]
        
        processed_frames = []
        max_w, max_h = 0, 0
        for i, f in enumerate(selected_frames):
            f_clean = remove(f)
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

        sheet_w = max_w * len(processed_frames)
        sheet_h = max_h
        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
        for i, f in enumerate(processed_frames):
            x_offset = i * max_w + (max_w - f.width) // 2
            y_offset = (max_h - f.height) // 2
            sheet.paste(f, (x_offset, y_offset), f)
            
        filename = f"spritesheet_{uuid.uuid4()}.png"
        filepath = os.path.join("output", filename)
        sheet.save(filepath)
        return {"status": "success", "url": f"/output/{filename}"}
    except Exception as e:
        logger.error(f"Error during spritesheet generation: {e}")
        logger.error(traceback.format_exc())
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
    logger.info(f"Starting server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
