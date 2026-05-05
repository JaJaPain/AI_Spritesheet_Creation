import os
import torch
import uuid
import sys
import traceback
import logging
import json
import random
from fastapi import FastAPI, Body, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
import numpy as np
import cv2
from diffusers import (
    FluxControlNetPipeline,
    FluxControlNetModel,
    FluxMultiControlNetModel,
)
from diffusers.utils import load_image
from rembg import remove
import gc

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

# Serve generated images
app.mount("/output", StaticFiles(directory="output"), name="output")


class ModelManager:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.pipelines = {}
        logger.info(f"--- ModelManager Initialized on {self.device} ---")
        logger.info(f"    VRAM: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GB" if self.device == "cuda" else "    CPU mode")

    def unload_all(self):
        """Clear VRAM before loading a new heavy model."""
        logger.info("Unloading all models to clear VRAM...")
        for key in list(self.pipelines.keys()):
            del self.pipelines[key]
        self.pipelines = {}
        if self.device == "cuda":
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        gc.collect()

    def load_flux(self):
        """Load FLUX.1-dev + ControlNet-Union-Pro pipeline."""
        if "flux" in self.pipelines:
            return self.pipelines["flux"]
        
        self.unload_all()
        logger.info("Loading FLUX.1-dev + ControlNet-Union-Pro...")
        
        try:
            # Load the Union ControlNet (supports Canny=0, Tile=1, Depth=2, Blur=3, Pose=4, Gray=5)
            logger.info("  Loading ControlNet-Union-Pro...")
            controlnet_union = FluxControlNetModel.from_pretrained(
                "Shakker-Labs/FLUX.1-dev-ControlNet-Union-Pro",
                torch_dtype=torch.bfloat16
            )
            controlnet = FluxMultiControlNetModel([controlnet_union])
            
            # Load the FLUX pipeline
            logger.info("  Loading FLUX.1-dev base model (bfloat16)...")
            pipe = FluxControlNetPipeline.from_pretrained(
                "black-forest-labs/FLUX.1-dev",
                controlnet=controlnet,
                torch_dtype=torch.bfloat16
            )
            
            # Memory optimizations for 16GB VRAM
            logger.info("  Enabling Tiled VAE + CPU offload...")
            pipe.vae.enable_tiling()
            pipe.enable_model_cpu_offload()
            
            self.pipelines["flux"] = pipe
            logger.info("  FLUX pipeline loaded successfully!")
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load FLUX: {e}")
            logger.error(traceback.format_exc())
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
    """Generate anchor character variants using FLUX + Canny ControlNet."""
    try:
        pipe = manager.load_flux()
        
        # Load template for Canny edge guidance
        template_path = f"templates/{template_id}.png"
        if not os.path.exists(template_path):
            template_path = "templates/default.png"
        
        if os.path.exists(template_path):
            template_image = load_image(template_path).resize((768, 768))
            # Generate Canny edges from template
            template_np = np.array(template_image.convert("RGB"))
            canny_edges = cv2.Canny(template_np, 50, 150)
            control_image = Image.fromarray(np.stack([canny_edges]*3, axis=-1))
            use_controlnet = True
            logger.info(f"  Using template Canny edges from: {template_path}")
        else:
            use_controlnet = False
            logger.info("  No template found, generating without ControlNet guidance")
        
        full_prompt = f"{prompt}, pixel art style, high quality, 8-bit, game sprite, solid dark gray background, full body, front facing, neutral standing pose"

        urls = []
        for i in range(num_variants):
            logger.info(f"Generating variant {i+1}/{num_variants}...")
            
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
            
            gen_kwargs = {
                "prompt": full_prompt,
                "num_inference_steps": 20,
                "guidance_scale": 3.5,
                "height": 768,
                "width": 768,
                "generator": torch.Generator(device="cpu").manual_seed(random.randint(0, 2**32 - 1))
            }
            
            if use_controlnet:
                gen_kwargs["control_image"] = [control_image]
                gen_kwargs["control_mode"] = [0]  # Canny mode
                gen_kwargs["controlnet_conditioning_scale"] = [0.5]
            
            image = pipe(**gen_kwargs).images[0]

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


@app.post("/save-anchor")
async def save_anchor(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True)
):
    """Save an anchor image + prompt for quick reloading later."""
    try:
        anchor_name = os.path.basename(image_url)
        save_data = {"image_url": f"/output/{anchor_name}", "prompt": prompt}
        save_path = os.path.join("output", "saved_anchor.json")
        with open(save_path, "w") as f:
            json.dump(save_data, f)
        logger.info(f"Saved anchor: {anchor_name} with prompt: {prompt[:50]}...")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Error saving anchor: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/load-anchor")
async def load_anchor():
    """Load a previously saved anchor image + prompt."""
    try:
        save_path = os.path.join("output", "saved_anchor.json")
        if not os.path.exists(save_path):
            raise HTTPException(status_code=404, detail="No saved anchor found")
        with open(save_path, "r") as f:
            data = json.load(f)
        logger.info(f"Loaded saved anchor: {data['image_url']}")
        return {"status": "success", **data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error loading anchor: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/animate-openpose")
async def animate_openpose(
    image_url: str = Body(..., embed=True),
    prompt: str = Body(..., embed=True),
    reference_video: str = Body("ref_front.mp4", embed=True),
    num_frames: int = Body(12, embed=True)
):
    """Generate a walk cycle using FLUX + ControlNet-Union Pose mode."""
    try:
        logger.info(f"FLUX walk cycle requested for {image_url} ({num_frames} frames)")
        
        session_id = str(uuid.uuid4())[:8]
        
        # Step 1: Load pre-made skeleton images
        logger.info("Step 1/3: Loading pre-made walk cycle skeletons...")
        skeleton_dir = os.path.join("output", "ref_skeletons")
        skeleton_urls = []
        
        available = sorted([f for f in os.listdir(skeleton_dir) if f.startswith("walk_front_")])
        if len(available) > num_frames:
            step = len(available) / num_frames
            selected = [available[int(i * step)] for i in range(num_frames)]
        else:
            selected = available
        
        # Copy skeletons to session folder for redo tracking
        for i, skel_file in enumerate(selected):
            src = os.path.join(skeleton_dir, skel_file)
            dst_name = f"skel_{session_id}_{i}.png"
            dst = os.path.join("output", dst_name)
            Image.open(src).save(dst)
            skeleton_urls.append(f"/output/{dst_name}")
        
        logger.info(f"  Using {len(selected)} skeleton frames from pre-made set.")
        
        # Step 2: Load FLUX + ControlNet-Union and generate
        logger.info("Step 2/3: Loading FLUX + ControlNet-Union...")
        pipe = manager.load_flux()
        
        # Load anchor image (used in prompt description, not IP-Adapter)
        anchor_name = os.path.basename(image_url)
        anchor_path = os.path.join("output", anchor_name)
        if not os.path.exists(anchor_path):
            raise HTTPException(status_code=404, detail="Anchor image not found")
        logger.info(f"  Anchor image: {anchor_path}")
        
        full_prompt = f"{prompt}, walking pose, pixel art style, game sprite, full body, solid dark gray background, consistent character design"
        
        seed = 42
        frame_urls = []
        generated_frames = []
        
        for i in range(len(selected)):
            logger.info(f"  Generating frame {i+1}/{len(selected)}...")
            
            # Load skeleton and resize to generation resolution
            skeleton = load_image(os.path.join("output", f"skel_{session_id}_{i}.png")).resize((768, 768))
            
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
            
            # Use ControlNet-Union in Pose mode (mode=4)
            image = pipe(
                prompt=full_prompt,
                control_image=[skeleton],
                control_mode=[4],  # 4 = Pose mode in Union-Pro
                controlnet_conditioning_scale=[0.8],
                num_inference_steps=20,
                guidance_scale=3.5,
                height=768,
                width=768,
                generator=torch.Generator(device="cpu").manual_seed(seed)
            ).images[0]
            
            image = remove(image)
            generated_frames.append(image)
        
        # Post-processing: Align all frames to consistent center
        logger.info("  Aligning frames...")
        max_w, max_h = 0, 0
        bboxes = []
        for img in generated_frames:
            bbox = img.getbbox()
            if bbox:
                bboxes.append(bbox)
                cw = bbox[2] - bbox[0]
                ch = bbox[3] - bbox[1]
                max_w = max(max_w, cw)
                max_h = max(max_h, ch)
            else:
                bboxes.append((0, 0, img.width, img.height))
                max_w = max(max_w, img.width)
                max_h = max(max_h, img.height)
        
        # Add padding
        pad = 10
        canvas_w = max_w + pad * 2
        canvas_h = max_h + pad * 2
        
        for i, (img, bbox) in enumerate(zip(generated_frames, bboxes)):
            cropped = img.crop(bbox)
            aligned = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            x = (canvas_w - cropped.width) // 2
            y = canvas_h - cropped.height - pad  # Anchor to bottom (feet alignment)
            aligned.paste(cropped, (x, y), cropped)
            
            frame_filename = f"frame_{session_id}_{i}.png"
            frame_path = os.path.join("output", frame_filename)
            aligned.save(frame_path)
            frame_urls.append(f"/output/{frame_filename}")
        
        logger.info("Step 3/3: All frames generated.")
        
        return {
            "status": "success",
            "session_id": session_id,
            "frame_urls": frame_urls,
            "skeleton_urls": skeleton_urls,
            "anchor_url": image_url
        }
    except Exception as e:
        logger.error(f"Error during FLUX walk cycle: {e}")
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
    """Regenerate a single frame using FLUX + ControlNet-Union Pose mode."""
    try:
        logger.info(f"Regenerating frame {frame_index} for session {session_id}")
        
        pipe = manager.load_flux()
        
        # Load skeleton
        skel_name = os.path.basename(skeleton_url)
        skeleton = load_image(os.path.join("output", skel_name)).resize((768, 768))
        
        full_prompt = f"{prompt}, walking pose, pixel art style, game sprite, full body, solid dark gray background, consistent character design"
        
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
        
        seed = random.randint(0, 2**32 - 1)
        logger.info(f"  Using seed {seed}")
        
        # Use ControlNet-Union in Pose mode (mode=4)
        image = pipe(
            prompt=full_prompt,
            control_image=[skeleton],
            control_mode=[4],  # Pose mode
            controlnet_conditioning_scale=[0.8],
            num_inference_steps=20,
            guidance_scale=3.5,
            height=768,
            width=768,
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
    logger.info(f"Starting FLUX SpriteForge server on port {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
