import os
import torch
import uuid
import sys
import traceback
import logging
import json
import random
import time
import shutil
from typing import Optional
from fastapi import FastAPI, Body, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image
import numpy as np
import cv2
import mediapipe as mp
from diffusers import (
    StableDiffusionXLControlNetPipeline,
    ControlNetModel,
    FluxPipeline,
    FluxTransformer2DModel,
)
from transformers import BitsAndBytesConfig
from diffusers.utils import load_image
from rembg import remove, new_session
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

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    error_details = exc.errors()
    logger.error(f"[422 Error Detail] Path: {request.url.path} | Errors: {error_details}")
    return JSONResponse(
        status_code=422,
        content={"status": "error", "message": "Validation Error", "details": error_details},
    )

# Ensure directories exist
os.makedirs("output", exist_ok=True)
os.makedirs("templates", exist_ok=True)
os.makedirs("saves", exist_ok=True)
os.makedirs("Output_Saves", exist_ok=True)

# Serve generated images and saves
app.mount("/output", StaticFiles(directory="output"), name="output")
app.mount("/saves", StaticFiles(directory="saves"), name="saves")
app.mount("/output_saves", StaticFiles(directory="Output_Saves"), name="output_saves")

def get_next_project_id():
    """Finds the highest AXXXXXX folder and returns the next ID."""
    existing = [d for d in os.listdir("Output_Saves") if d.startswith("A") and d[1:].isdigit()]
    if not existing:
        return "A00000"
    
    ids = [int(d[1:]) for d in existing]
    next_num = max(ids) + 1
    return f"A{next_num:05d}"


# Create anime-optimized bg removal session (loaded once, reused)
rembg_session = new_session("isnet-anime")

def resolve_image_path(url: str) -> str:
    """
    Robustly resolves a URL (local path, full URL, or Data URL) to a local filesystem path.
    If it's a Data URL, it saves it to a temporary file in 'output' and returns that path.
    """
    if not url:
        return ""
        
    # Handle Data URLs
    if url.startswith("data:image"):
        import base64
        import uuid
        try:
            header, encoded = url.split(",", 1)
            data = base64.b64decode(encoded)
            filename = f"temp_{uuid.uuid4()}.png"
            path = os.path.join("output", filename)
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as e:
            logger.error(f"Failed to decode Data URL: {e}")
            return ""

    # Strip base URL and query strings (?t=...) if provided
    if "http" in url:
        url = "/" + "/".join(url.split("/")[3:])
    
    if "?" in url:
        url = url.split("?")[0]
    
    # Resolve local paths
    # Handle /output/, /output_saves/, and /saves/
    path = url.replace("/output_saves/", "Output_Saves/").replace("/output/", "output/").replace("/saves/", "saves/").lstrip("/")
    
    # If path doesn't exist, try common locations as fallback
    if not os.path.exists(path):
        name = os.path.basename(url)
        for loc in ["output", "saves"]:
            fallback = os.path.join(loc, name)
            if os.path.exists(fallback):
                return fallback
                
    return path

class ModelManager:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.pipelines = {}
        logger.info(f"--- ModelManager Initialized on {self.device} ---")
        logger.info(f"    VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB" if self.device == "cuda" else "    CPU mode")

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

    def load_sdxl(self, controlnet_type="canny"):
        """Load SDXL + ControlNet pipeline.
        
        SDXL is 3.5B params — runs natively on 16GB in fp16:
        - UNet: ~5GB (fp16)
        - ControlNet: ~2.5GB (fp16)
        - CLIP + VAE: ~1GB (fp16)
        - Total: ~8.5GB → fits with room to spare
        
        Args:
            controlnet_type: 'canny' or 'pose'
        """
        key = f"sdxl_{controlnet_type}"
        if key in self.pipelines:
            return self.pipelines[key]
        
        self.unload_all()
        logger.info(f"Loading SDXL + ControlNet ({controlnet_type})...")
        
        try:
            # Load the appropriate ControlNet
            if controlnet_type == "canny":
                controlnet = ControlNetModel.from_pretrained(
                    "diffusers/controlnet-canny-sdxl-1.0",
                    torch_dtype=torch.float16,
                    variant="fp16",
                    use_safetensors=True
                )
            else:  # pose/openpose
                controlnet = ControlNetModel.from_pretrained(
                    "thibaud/controlnet-openpose-sdxl-1.0",
                    torch_dtype=torch.float16
                )
            
            logger.info(f"  ControlNet ({controlnet_type}) loaded.")
            
            # Load SDXL base pipeline
            pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
                "stabilityai/stable-diffusion-xl-base-1.0",
                controlnet=controlnet,
                torch_dtype=torch.float16,
                variant="fp16",
                use_safetensors=True
            )
            
            # For pose pipeline, add IP-Adapter for character consistency
            if controlnet_type == "pose":
                logger.info("  Loading IP-Adapter Plus for character consistency...")
                from transformers import CLIPVisionModelWithProjection
                image_encoder = CLIPVisionModelWithProjection.from_pretrained(
                    "h94/IP-Adapter",
                    subfolder="models/image_encoder",
                    torch_dtype=torch.float16
                )
                pipe.image_encoder = image_encoder
                pipe.load_ip_adapter(
                    "h94/IP-Adapter",
                    subfolder="sdxl_models",
                    weight_name="ip-adapter-plus_sdxl_vit-h.safetensors"
                )
                pipe.set_ip_adapter_scale(0.8)
                logger.info("  IP-Adapter Plus loaded with scale 0.8.")
            
            # Use automatic model offloading — each component moves to GPU only when
            # needed and back to CPU after. Keeps peak VRAM much lower than loading
            # everything to GPU at once. Critical for 16GB cards at 1024x1024.
            pipe.enable_model_cpu_offload()
            
            self.pipelines[key] = pipe
            logger.info(f"  SDXL + {controlnet_type} ControlNet loaded successfully!")
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load SDXL: {e}")
            logger.error(traceback.format_exc())
            raise e

    def describe_anchor(self, image_path: str) -> str:
        """Use BLIP to generate a detailed description of the anchor image.
        
        Loads the model, describes, then fully unloads to free VRAM for SDXL.
        """
        from transformers import BlipProcessor, BlipForConditionalGeneration
        
        logger.info("Loading BLIP-large for anchor description...")
        
        # Unload any existing models first
        self.unload_all()
        
        model_id = "Salesforce/blip-image-captioning-large"
        
        try:
            processor = BlipProcessor.from_pretrained(model_id)
            model = BlipForConditionalGeneration.from_pretrained(
                model_id,
                torch_dtype=torch.float16
            ).to("cuda")
            
            # Load and process the anchor image
            image = Image.open(image_path).convert("RGB")
            
            # Use conditional captioning with targeted starter prompts
            # Each pass focuses on a different aspect of the character
            captions = []
            prompts = [
                "this is a character with",
                "the character's hair is",
                "on top the character is wearing",
                "on the bottom the character is wearing",
                "on the feet the character is wearing",
                "the character's accessories include",
                "the art style is",
            ]
            
            for starter in prompts:
                inputs = processor(images=image, text=starter, return_tensors="pt").to("cuda", torch.float16)
                with torch.no_grad():
                    output = model.generate(**inputs, max_new_tokens=60)
                caption = processor.decode(output[0], skip_special_tokens=True)
                captions.append(caption)
            
            # Deduplicate: remove repeated phrases across captions
            seen = set()
            unique_parts = []
            for cap in captions:
                # Normalize and check if substantially new
                normalized = cap.strip().lower()
                if normalized not in seen:
                    seen.add(normalized)
                    unique_parts.append(cap.strip())
            
            combined = ". ".join(unique_parts)
            logger.info(f"  BLIP captions: {combined}")
            
            # Fully unload BLIP
            del model
            del processor
            if self.device == "cuda":
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            gc.collect()
            logger.info("  BLIP unloaded. VRAM freed for SDXL.")
            
            return combined
            
        except Exception as e:
            logger.error(f"BLIP description failed: {e}")
            logger.error(traceback.format_exc())
            if self.device == "cuda":
                torch.cuda.empty_cache()
            gc.collect()
            raise e

    def quality_check_variants(self, image_paths: list) -> list:
        """Check variant quality using BLIP captioning + pixel analysis.
        
        Returns list of booleans (True=pass).
        """
        from transformers import BlipProcessor, BlipForConditionalGeneration
        
        logger.info(f"Quality checking {len(image_paths)} variants...")
        
        model_id = "Salesforce/blip-image-captioning-large"
        
        try:
            processor = BlipProcessor.from_pretrained(model_id)
            model = BlipForConditionalGeneration.from_pretrained(
                model_id,
                torch_dtype=torch.float16
            ).to("cuda")
            
            results = []
            
            for idx, img_path in enumerate(image_paths):
                image = Image.open(img_path).convert("RGBA")
                passed = True
                reasons = []
                
                # Check 1: Image isn't mostly empty (sliver/artifact detection)
                # Count non-transparent pixels
                alpha = np.array(image)[:, :, 3]
                non_transparent = np.sum(alpha > 20)
                total_pixels = alpha.shape[0] * alpha.shape[1]
                fill_ratio = non_transparent / total_pixels
                
                if fill_ratio < 0.05:
                    passed = False
                    reasons.append(f"Too empty: {fill_ratio:.1%} fill")
                elif fill_ratio > 0.85:
                    passed = False
                    reasons.append(f"Background not removed: {fill_ratio:.1%} fill")
                
                # Check 2: Character isn't too narrow (sliver detection)
                col_has_content = np.any(alpha > 20, axis=0)
                content_width = np.sum(col_has_content)
                width_ratio = content_width / alpha.shape[1]
                
                if width_ratio < 0.15:
                    passed = False
                    reasons.append(f"Too narrow: {width_ratio:.1%} width")
                
                # Check 3: Character isn't too short (cut-off detection)
                row_has_content = np.any(alpha > 20, axis=1)
                content_height = np.sum(row_has_content)
                height_ratio = content_height / alpha.shape[0]
                
                if height_ratio < 0.4:
                    passed = False
                    reasons.append(f"Too short: {height_ratio:.1%} height")
                
                # Check 4: Multiple characters detection via gap analysis
                # Look for large transparent gaps in the middle of content
                if passed and col_has_content.any():
                    content_cols = np.where(col_has_content)[0]
                    gaps = np.diff(content_cols)
                    max_gap = np.max(gaps) if len(gaps) > 0 else 0
                    if max_gap > alpha.shape[1] * 0.15:
                        passed = False
                        reasons.append(f"Multiple figures detected (gap: {max_gap}px)")
                
                # Check 5: Aspect ratio — a standing character is ALWAYS taller than wide
                # A single human sprite has an aspect ratio around 0.35 - 0.45
                # Multiple side-by-side characters make the content wider than 0.55
                if passed and content_width > 0 and content_height > 0:
                    aspect = content_width / content_height
                    if aspect > 0.55:
                        passed = False
                        reasons.append(f"Too wide for single character (aspect: {aspect:.2f})")
                
                # Check 6: Arm detection via zone width comparison
                # Arms at sides make the torso zone wider than the leg zone
                if passed:
                    content_rows = np.where(row_has_content)[0]
                    if len(content_rows) > 10:
                        top_row = content_rows[0]
                        bot_row = content_rows[-1]
                        char_height = bot_row - top_row
                        
                        # Torso/arm zone: 25-50% of character height
                        torso_start = top_row + int(char_height * 0.25)
                        torso_end = top_row + int(char_height * 0.50)
                        torso_zone = alpha[torso_start:torso_end, :]
                        torso_width = np.sum(np.any(torso_zone > 20, axis=0))
                        
                        # Leg zone: 65-85% of character height
                        leg_start = top_row + int(char_height * 0.65)
                        leg_end = top_row + int(char_height * 0.85)
                        leg_zone = alpha[leg_start:leg_end, :]
                        leg_width = np.sum(np.any(leg_zone > 20, axis=0))
                        
                        if leg_width > 0:
                            arm_ratio = torso_width / leg_width
                            logger.info(f"    Arm check: torso={torso_width}px, legs={leg_width}px, ratio={arm_ratio:.2f}")
                            if arm_ratio < 1.25:
                                passed = False
                                reasons.append(f"Missing arms (torso/leg ratio: {arm_ratio:.2f})")
                
                # Check 6: BLIP caption sanity checks
                # Composite onto solid background so BLIP sees it like a game would render it
                if passed:
                    bg = Image.new("RGBA", image.size, (200, 200, 200, 255))
                    bg.paste(image, (0, 0), image)
                    rgb_image = bg.convert("RGB")
                    
                    # 6a: Multi-character check
                    inputs = processor(images=rgb_image, text="how many people", return_tensors="pt").to("cuda", torch.float16)
                    with torch.no_grad():
                        output = model.generate(**inputs, max_new_tokens=30)
                    caption = processor.decode(output[0], skip_special_tokens=True).strip().lower()
                    
                    multi_words = ["two people", "three people", "two characters", "group", "couple", "pair"]
                    if any(w in caption for w in multi_words):
                        passed = False
                        reasons.append(f"BLIP multi-char: {caption}")
                
                # 6b: Face check — reject blank/featureless heads
                if passed:
                    inputs = processor(images=rgb_image, text="the character's face has", return_tensors="pt").to("cuda", torch.float16)
                    with torch.no_grad():
                        output = model.generate(**inputs, max_new_tokens=30)
                    face_caption = processor.decode(output[0], skip_special_tokens=True).strip().lower()
                    
                    face_words = ["eyes", "eye", "mouth", "face", "smile", "nose", "expression"]
                    has_face = any(w in face_caption for w in face_words)
                    if not has_face:
                        passed = False
                        reasons.append(f"No face detected: {face_caption}")

                # 6c: Scenery/Background check — reject if it sees environmental objects
                if passed:
                    inputs = processor(images=rgb_image, text="describe the setting and background", return_tensors="pt").to("cuda", torch.float16)
                    with torch.no_grad():
                        output = model.generate(**inputs, max_new_tokens=30)
                    bg_caption = processor.decode(output[0], skip_special_tokens=True).strip().lower()
                    
                    bg_words = ["tree", "room", "wall", "landscape", "floor", "building", "scenery", "forest", "city", "street", "furniture"]
                    if any(w in bg_caption for w in bg_words):
                        passed = False
                        reasons.append(f"Background elements detected: {bg_caption}")
                
                if passed:
                    logger.info(f"  Variant {idx+1}: PASSED (fill:{fill_ratio:.0%} w:{width_ratio:.0%} h:{height_ratio:.0%})")
                else:
                    logger.info(f"  Variant {idx+1}: FAILED - {'; '.join(reasons)}")
                
                results.append(passed)
            
            # Unload BLIP
            del model
            del processor
            if self.device == "cuda":
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
            gc.collect()
            logger.info("  Quality checker unloaded.")
            
            return results
            
        except Exception as e:
            logger.error(f"Quality check failed: {e}")
            logger.error(traceback.format_exc())
            if self.device == "cuda":
                torch.cuda.empty_cache()
            gc.collect()
            return [True] * len(image_paths)


manager = ModelManager()


@app.get("/")
async def root():
    return {"status": "active", "device": manager.device}


@app.post("/describe-anchor")
async def describe_anchor(
    image_url: str = Body(..., embed=True)
):
    """Use BLIP vision model to auto-describe the selected anchor image."""
    try:
        # Resolve image path
        name = os.path.basename(image_url)
        
        # Determine if this is a temporary anchor or a permanently saved one
        if "/saves/" in image_url:
            image_path = os.path.join("saves", name)
        else:
            image_path = os.path.join("output", name)
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail=f"Anchor image not found at {image_path}")
        
        caption = manager.describe_anchor(image_path)
        
        return {"status": "success", "description": caption}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error describing anchor: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-anchor")
async def generate_anchor(
    prompt: str = Body(..., embed=True),
    template_id: str = Body("default", embed=True),
    num_variants: int = Body(4, embed=True)
):
    """Generate anchor character variants with BLIP VQA quality gate."""
    try:
        # Load template for Canny edge guidance
        template_path = f"templates/{template_id}.png"
        if not os.path.exists(template_path):
            template_path = "templates/default.png"
        
        use_controlnet = False
        control_image = None
        if os.path.exists(template_path):
            template_image = load_image(template_path).resize((512, 512))
            template_np = np.array(template_image.convert("RGB"))
            canny_edges = cv2.Canny(template_np, 50, 150)
            control_image = Image.fromarray(np.stack([canny_edges]*3, axis=-1))
            use_controlnet = True
            logger.info(f"  Using template Canny edges from: {template_path}")
        else:
            logger.info("  No template found, generating without ControlNet guidance")
        
        full_prompt = f"{prompt}, high quality, detailed face, visible eyes, highly detailed, concept art, game sprite, solid bright green background, full body, front facing, neutral standing pose, arms visible at sides"
        
        # Track which slots still need a good variant
        # Each slot: { 'url': str, 'filepath': str, 'passed': bool }
        slots = [None] * num_variants
        max_retries = 5
        
        # Load SDXL once — keep it loaded alongside BLIP (9GB + 1.5GB = fits in 16GB)
        pipe = manager.load_sdxl("canny")
        
        for attempt in range(max_retries):
            # Figure out which slots need generation
            slots_to_generate = [i for i in range(num_variants) if slots[i] is None or not slots[i]['passed']]
            
            if not slots_to_generate:
                logger.info("All variants passed quality check!")
                break
            
            logger.info(f"Quality gate attempt {attempt+1}/{max_retries}: generating {len(slots_to_generate)} variant(s)...")
            
            for i in slots_to_generate:
                logger.info(f"  Generating variant for slot {i+1}/{num_variants}...")
                
                if manager.device == "cuda":
                    torch.cuda.empty_cache()
                    gc.collect()
                
                gen_kwargs = {
                    "prompt": full_prompt,
                    "negative_prompt": "flat colors, vector art, clip art, silhouette, thick outline, faceless, blank face, missing eyes, missing mouth, blurry, low quality, deformed, ugly, bad anatomy, extra limbs, cape, cloak, flowing fabric, wings",
                    "num_inference_steps": 25,
                    "guidance_scale": 7.5,
                    "height": 512,
                    "width": 512,
                    "generator": torch.Generator(device="cpu").manual_seed(random.randint(0, 2**32 - 1))
                }
                
                if use_controlnet:
                    gen_kwargs["image"] = control_image
                    gen_kwargs["controlnet_conditioning_scale"] = 0.3
                
                image = pipe(**gen_kwargs).images[0]
                
                logger.info(f"  Removing background for variant {i+1}...")
                image = remove(image, session=rembg_session)
                
                filename = f"anchor_{uuid.uuid4()}.png"
                filepath = os.path.join("output", filename)
                image.save(filepath)
                slots[i] = {'url': f"/output/{filename}", 'filepath': filepath, 'passed': False}
            
            # Quality check WITHOUT unloading SDXL — both fit in VRAM at 512x512
            
            # Run BLIP VQA quality check on all pending variants
            paths_to_check = [slots[i]['filepath'] for i in slots_to_generate]
            results = manager.quality_check_variants(paths_to_check)
            
            for idx, slot_idx in enumerate(slots_to_generate):
                slots[slot_idx]['passed'] = results[idx]
            
            passed_count = sum(1 for s in slots if s and s['passed'])
            logger.info(f"  Quality gate: {passed_count}/{num_variants} passed")
            
            # If all passed or last attempt, break
            if passed_count == num_variants:
                break
        
        # Return all variants (passed or not on final attempt)
        urls = [s['url'] for s in slots if s]
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
    """Save an anchor image + prompt permanently."""
    try:
        anchor_name = os.path.basename(image_url)
        source_img_path = os.path.join("output", anchor_name)
        
        if not os.path.exists(source_img_path):
            raise HTTPException(status_code=404, detail="Anchor image not found")
            
        timestamp = int(time.time())
        save_id = f"save_{timestamp}"
        
        # Copy image to permanent saves folder
        ext = os.path.splitext(anchor_name)[1]
        dest_img_name = f"{save_id}{ext}"
        dest_img_path = os.path.join("saves", dest_img_name)
        shutil.copy2(source_img_path, dest_img_path)
        
        # Save metadata
        save_data = {
            "id": save_id,
            "image_url": f"/saves/{dest_img_name}", 
            "prompt": prompt,
            "timestamp": timestamp
        }
        
        save_json_path = os.path.join("saves", f"{save_id}.json")
        with open(save_json_path, "w") as f:
            json.dump(save_data, f)
            
        logger.info(f"Saved project: {save_id} with prompt: {prompt[:50]}...")
        return {"status": "success", "save_id": save_id}
    except Exception as e:
        logger.error(f"Error saving anchor: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/list-saves")
async def list_saves():
    """Returns a list of all saved projects."""
    try:
        saves = []
        for filename in os.listdir("saves"):
            if filename.endswith(".json"):
                with open(os.path.join("saves", filename), "r") as f:
                    try:
                        data = json.load(f)
                        saves.append(data)
                    except Exception as e:
                        logger.error(f"Error reading save {filename}: {e}")
                        
        # Sort newest first
        saves.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        return {"status": "success", "saves": saves}
    except Exception as e:
        logger.error(f"Error listing saves: {e}")
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
        logger.info(f"SDXL walk cycle requested for {image_url} ({num_frames} frames)")
        
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
        
        # Step 2: Load SDXL + OpenPose ControlNet and generate
        logger.info("Step 2/3: Loading SDXL + OpenPose ControlNet...")
        pipe = manager.load_sdxl("pose")
        
        # Load anchor image (used in prompt description, not IP-Adapter)
        anchor_name = os.path.basename(image_url)
        if "/saves/" in image_url:
            anchor_path = os.path.join("saves", anchor_name)
        else:
            anchor_path = os.path.join("output", anchor_name)
            
        if not os.path.exists(anchor_path):
            raise HTTPException(status_code=404, detail=f"Anchor image not found at {anchor_path}")
        logger.info(f"  Anchor image: {anchor_path}")
        
        # Base prompt includes user prompt + base styling
        base_styling = "game sprite, full body, solid bright green background, consistent character design, arms visible"
        base_prompt = f"{prompt}, {base_styling}"
        
        seed = 42
        frame_urls = []
        generated_frames = []
        
        for i in range(len(selected)):
            logger.info(f"  Generating frame {i+1}/{len(selected)}...")
            
            # Map the 12 frames to specific physical descriptions to reinforce the ControlNet
            # 0-5: Left leg forward cycle. 6-11: Right leg forward cycle.
            pose_prompts = [
                "left leg stepping forward, right arm swinging forward",  # 0: Contact L
                "left foot planted, body lowering",                       # 1: Down L
                "standing straight on left leg, right leg passing",       # 2: Passing L (early)
                "standing straight on left leg, right leg passing",       # 3: Passing L (mid)
                "right leg lifting, pushing up",                          # 4: Up L (early)
                "right leg high, reaching forward",                       # 5: Up L (late)
                "right leg stepping forward, left arm swinging forward",  # 6: Contact R
                "right foot planted, body lowering",                      # 7: Down R
                "standing straight on right leg, left leg passing",       # 8: Passing R (early)
                "standing straight on right leg, left leg passing",       # 9: Passing R (mid)
                "left leg lifting, pushing up",                           # 10: Up R (early)
                "left leg high, reaching forward"                         # 11: Up R (late)
            ]
            
            # Use the specific pose description for this frame, fallback if out of bounds
            frame_pose = pose_prompts[i] if i < len(pose_prompts) else "walking pose"
            
            # Put the critical pose information at the FRONT of the prompt so it isn't truncated
            frame_specific_prompt = f"{frame_pose}, walking pose, front-facing, facing the viewer, {base_prompt}"
            
            # Load OpenPose skeleton directly
            skel_img = load_image(os.path.join("output", f"skel_{session_id}_{i}.png"))
            skeleton = skel_img.convert("RGB").resize((1024, 1024))
            
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
            
            # Use SoftEdge ControlNet + IP-Adapter (anchor as reference)
            anchor_image = load_image(anchor_path).resize((1024, 1024))
            
            def do_sdxl():
                return pipe(
                    prompt=frame_specific_prompt,
                    negative_prompt="blurry, low quality, deformed, ugly, bad anatomy, extra limbs, cape, cloak, flowing fabric, wings, rear view, back view, from behind, turned away",
                    image=skeleton,
                    ip_adapter_image=anchor_image,
                    controlnet_conditioning_scale=0.8,
                    num_inference_steps=30,
                    guidance_scale=7.5,
                    height=1024,
                    width=1024,
                    generator=torch.Generator(device="cpu").manual_seed(seed)
                ).images[0]
                
            image = await run_in_threadpool(do_sdxl)
            image = remove(image, session=rembg_session)
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
        logger.error(f"Error during SDXL walk cycle: {e}")
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
    """Regenerate a single frame using SDXL + SoftEdge ControlNet."""
    try:
        logger.info(f"Regenerating frame {frame_index} for session {session_id}")
        
        pipe = manager.load_sdxl("pose")
        
        # Load OpenPose skeleton directly
        skel_name = os.path.basename(skeleton_url)
        skel_img = load_image(os.path.join("output", skel_name))
        skeleton = skel_img.convert("RGB").resize((1024, 1024))
        
        # Put critical pose info at the FRONT
        full_prompt = f"walking pose, front-facing, facing the viewer, {prompt}, game sprite, full body, solid bright green background, consistent character design, arms visible"
        
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
        
        seed = random.randint(0, 2**32 - 1)
        logger.info(f"  Using seed {seed}")
        
        # Use ControlNet + IP-Adapter (anchor as reference)
        anchor_name_ref = os.path.basename(anchor_url)
        if "/saves/" in anchor_url:
            anchor_path_ref = os.path.join("saves", anchor_name_ref)
        else:
            anchor_path_ref = os.path.join("output", anchor_name_ref)
            
        if not os.path.exists(anchor_path_ref):
             raise HTTPException(status_code=404, detail=f"Anchor image not found at {anchor_path_ref}")
        anchor_image = load_image(anchor_path_ref).resize((1024, 1024))
        
        image = pipe(
            prompt=full_prompt,
            negative_prompt="blurry, low quality, deformed, ugly, bad anatomy, extra limbs, cape, cloak, flowing fabric, wings, rear view, back view, from behind, turned away",
            image=skeleton,
            ip_adapter_image=anchor_image,
            controlnet_conditioning_scale=0.8,
            num_inference_steps=30,
            guidance_scale=7.5,
            height=1024,
            width=1024,
            generator=torch.Generator(device="cpu").manual_seed(seed)
        ).images[0]
        
        image = remove(image, session=rembg_session)
        
        # Post-processing: Match the same crop/align logic as walk cycle generation
        frame_filename = f"frame_{session_id}_{frame_index}.png"
        frame_path = os.path.join("output", frame_filename)
        
        # Get target canvas size from existing frame
        if os.path.exists(frame_path):
            existing = Image.open(frame_path)
            canvas_w, canvas_h = existing.size
            existing.close()
        else:
            canvas_w, canvas_h = 512, 512
        
        # Crop to bounding box (remove transparent border)
        bbox = image.getbbox()
        if bbox:
            cropped = image.crop(bbox)
        else:
            cropped = image
        
        # Center on canvas, anchor feet to bottom (same as walk cycle)
        # REMOVED the artificial stretching logic that was breaking scale and placement!
        pad = 10
        aligned = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        x = (canvas_w - cropped.width) // 2
        y = canvas_h - cropped.height - pad  # Feet alignment
        aligned.paste(cropped, (x, y), cropped)
        
        aligned.save(frame_path)
        logger.info(f"  Frame {frame_index} regenerated and aligned ({canvas_w}x{canvas_h}): {frame_path}")
        
        return {"status": "success", "url": f"/output/{frame_filename}"}
    except Exception as e:
        logger.error(f"Error regenerating frame: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class TurnaroundRequest(BaseModel):
    session_id: str
    prompt: str
    enforce_white: bool = True

@app.post("/generate-turnaround")
async def generate_turnaround(req: TurnaroundRequest):
    """Isolated FLUX experiment to generate a 5-point turnaround sheet."""
    try:
        logger.info(f"Generating experimental FLUX turnaround for session {req.session_id}")
        
        # 1. Unload SDXL to free VRAM
        manager.unload_all()
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
            
        # 3. Load FLUX Text-to-Image Pipeline with 4-bit Quantization
        logger.info("Loading FLUX.1-dev for Turnaround generation...")
        
        # Load the massive 24GB transformer in 4-bit precision to fit in 16GB VRAM without thrashing
        nf4_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16
        )
        
        logger.info("  Loading 4-bit Transformer...")
        transformer = FluxTransformer2DModel.from_pretrained(
            "black-forest-labs/FLUX.1-dev",
            subfolder="transformer",
            quantization_config=nf4_config,
            torch_dtype=torch.bfloat16
        )
        
        logger.info("  Loading Pipeline...")
        flux_pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-dev", 
            transformer=transformer,
            torch_dtype=torch.bfloat16
        )
        
        # Enable offloading and VAE optimizations to fit in 16GB VRAM
        flux_pipe.enable_model_cpu_offload()
        flux_pipe.vae.enable_tiling()
        flux_pipe.vae.enable_slicing()
        
        # 4. Load the LoRA
        lora_path = os.path.join("loras", "turnaround.safetensors")
        if not os.path.exists(lora_path):
             raise HTTPException(status_code=400, detail="Turnaround LoRA not found. Please manually download the .safetensors file from Civitai to backend/loras/turnaround.safetensors")
        
        flux_pipe.load_lora_weights(lora_path)
        logger.info("LoRA loaded successfully.")
        
        # 5. Inference - Slimmed down and reordered to prevent token truncation
        # Placing technical constraints at the front ensures they are seen by the CLIP tokenizer
        tech_prefix = "character turnaround sheet, 5 views, no shadows, same proportions, consistent detailing, white background"
        prompt_text = f"{tech_prefix}, {req.prompt}"
        
        logger.info(f"Starting FLUX generation (in threadpool)...")
        print(">>> [AI] Running FLUX.1-dev Inference...")
        def do_flux():
            return flux_pipe(
                prompt=prompt_text,
                num_inference_steps=30,
                guidance_scale=3.5,
                width=1536,
                height=768,
                joint_attention_kwargs={"scale": 1.0}
            ).images[0]
            
        # --- AUTO-RETRY LOOP ---
        max_attempts = 2 if req.enforce_white else 1
        last_image_url = None
        
        for attempt in range(max_attempts):
            logger.info(f"Generation Attempt {attempt+1}/{max_attempts}...")
            image = await run_in_threadpool(do_flux)
            
            # Save the result
            filename = f"turnaround_{uuid.uuid4().hex[:8]}.png"
            filepath = os.path.join("output", filename)
            image.save(filepath)
            last_image_url = f"/output/{filename}"
            
            if not req.enforce_white:
                break
                
            # Check corners for white background
            data = np.array(image)
            corners = [data[0,0], data[0,-1], data[-1,0], data[-1,-1]]
            avg_corner = np.mean(corners, axis=0)
            is_white = np.mean(avg_corner[:3]) > 180 # Threshold for "mostly white"
            
            if is_white:
                logger.info("  Validation Success: Found white background.")
                break
            else:
                logger.warning(f"  Validation Failed: Background is too dark (Avg: {np.mean(avg_corner[:3])}). Retrying...")
                # We continue the loop and overwrite last_image_url
        
        # Unload FLUX after we are done
        del flux_pipe
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
            
        return {"status": "success", "url": last_image_url}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during FLUX generation: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class DescribeRequest(BaseModel):
    image_url: str

class SaveProjectRequest(BaseModel):
    prompt: str
    image_url: str
    project_id: Optional[str] = None
    force_overwrite: Optional[bool] = False

class SliceRequest(BaseModel):
    image_url: str
    num_poses: Optional[int] = 5
    project_id: Optional[str] = None
    remover_type: Optional[str] = "ai" # "ai", "simple", or "none"
    alpha_matting: Optional[bool] = False
    foreground_threshold: Optional[int] = 240
    background_threshold: Optional[int] = 10

@app.get("/open-output-folder")
async def open_output_folder():
    """Opens the Output_Saves folder in Windows Explorer."""
    try:
        folder_path = os.path.abspath("Output_Saves")
        if not os.path.exists(folder_path):
            os.makedirs(folder_path, exist_ok=True)
        os.startfile(folder_path)
        return {"status": "success", "path": folder_path}
    except Exception as e:
        logger.error(f"Failed to open folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/list-projects")
async def list_projects():
    try:
        saves = []
        if not os.path.exists("Output_Saves"):
            return {"status": "success", "saves": []}
            
        for d in os.listdir("Output_Saves"):
            folder_path = os.path.join("Output_Saves", d)
            if not os.path.isdir(folder_path):
                continue
                
            meta_path = os.path.join(folder_path, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                    saves.append({
                        "id": d,
                        "prompt": meta.get("prompt", ""),
                        "image_url": f"/output_saves/{d}/{d}_turnaround.png",
                        "timestamp": os.path.getmtime(meta_path)
                    })
                    
        saves.sort(key=lambda x: x["timestamp"], reverse=True)
        return {"status": "success", "saves": saves}
    except Exception as e:
        logger.error(f"Error listing saves: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/save-project")
async def save_project(req: SaveProjectRequest):
    try:
        pid = req.project_id
        if not pid:
            pid = get_next_project_id()
            
        project_dir = os.path.join("Output_Saves", pid)
        os.makedirs(project_dir, exist_ok=True)
        
        target_filename = f"{pid}_turnaround.png"
        target_path = os.path.join(project_dir, target_filename)
        
        source_path = resolve_image_path(req.image_url)
        if os.path.exists(source_path):
            shutil.copy2(source_path, target_path)
        else:
            logger.warning(f"Could not resolve source image for saving: {req.image_url}")
                
        with open(os.path.join(project_dir, "metadata.json"), "w") as f:
            json.dump({"prompt": req.prompt, "id": pid, "updated_at": time.time()}, f)
            
        return {"status": "success", "project_id": pid, "image_url": f"/output_saves/{pid}/{target_filename}"}
    except Exception as e:
        logger.error(f"Error saving project: {e}")
        return {"status": "error", "message": str(e)}

@app.post("/slice-turnaround")
async def slice_turnaround(req: SliceRequest):
    try:
        # Robust URL handling using helper
        sheet_path = resolve_image_path(req.image_url)
        
        if not os.path.exists(sheet_path):
            raise HTTPException(status_code=404, detail=f"Sheet not found at {sheet_path}")
            
        image = Image.open(sheet_path).convert("RGB")
        w, h = image.size
        
        num_poses = 5
        slice_width = w / num_poses
        
        sliced_urls = []
        logger.info(f"Slicing turnaround sheet ({w}x{h}) into {num_poses} poses...")
        
        # Check for existing slices if project_id is provided
        if req.project_id:
            output_dir = os.path.join("Output_Saves", req.project_id, "slices")
            
            # Smart check: If slices exist and the sheet hasn't changed, skip re-slicing
            if os.path.exists(output_dir) and len(os.listdir(output_dir)) >= num_poses:
                sheet_mtime = os.path.getmtime(sheet_path)
                
                # Get the mtime of the newest slice file to be extra safe
                files = [os.path.join(output_dir, f) for f in os.listdir(output_dir) if f.endswith(".png")]
                if files:
                    newest_slice_mtime = max(os.path.getmtime(f) for f in files)
                    
                    # If the sheet is OLDER than the newest slice, it means the sheet 
                    # hasn't been touched since those slices were created.
                    if sheet_mtime < newest_slice_mtime and not getattr(req, 'force_reslice', False):
                        logger.info(f"Reusing existing slices for project {req.project_id} (Sheet: {sheet_mtime} < Newest Slice: {newest_slice_mtime})")
                        existing_files = sorted([f for f in os.listdir(output_dir) if f.endswith(".png")])
                        sliced_urls = [f"/output_saves/{req.project_id}/slices/{f}" for f in existing_files[:num_poses]]
                        return {"status": "success", "urls": sliced_urls}
            
            os.makedirs(output_dir, exist_ok=True)
        else:
            output_dir = "output"
            
        # Dynamic Detection: Use horizontal projection to find gaps and isolate characters
        num_poses = 5
        
        # 1. Prepare mask for detection (ignore background)
        # We'll use a grayscale version to find where the characters are
        detection_img = image.convert("RGBA")
        data = np.array(detection_img)
        r, g, b, a = data.T
        
        # Determine if background is likely white or black
        # Sample corners
        corners = [data[0,0], data[0,-1], data[-1,0], data[-1,-1]]
        avg_corner = np.mean(corners, axis=0)
        is_white_bg = np.mean(avg_corner[:3]) > 128
        
        if is_white_bg:
            mask = (r < 240) | (g < 240) | (b < 240)
        else:
            mask = (r > 15) | (g > 15) | (b > 15)
            
        # 2. Horizontal Projection (sum along Y axis)
        projection = np.sum(mask, axis=0)
        
        # 3. Find segments (islands of pixels)
        threshold = 5 # Minimum pixels in a column to be part of a character
        segments = []
        in_segment = False
        start_x = 0
        
        for x, val in enumerate(projection):
            if val > threshold and not in_segment:
                in_segment = True
                start_x = x
            elif val <= threshold and in_segment:
                in_segment = False
                segments.append((start_x, x))
        if in_segment:
            segments.append((start_x, len(projection)-1))
            
        # 4. Refine segments (merge small gaps, filter noise)
        min_gap = 20 # Minimum pixels to be considered a real gap between poses
        refined = []
        if segments:
            curr_s, curr_e = segments[0]
            for next_s, next_e in segments[1:]:
                if next_s - curr_e < min_gap:
                    curr_e = next_e
                else:
                    refined.append((curr_s, curr_e))
                    curr_s, curr_e = next_s, next_e
            refined.append((curr_s, curr_e))
            
        logger.info(f"Dynamic Slicer: Found {len(refined)} potential character islands.")
        
        # If we didn't find exactly 5, or detection failed, fallback to equal slices
        if len(refined) != num_poses:
            logger.warning(f"Dynamic detection found {len(refined)} segments instead of {num_poses}. Falling back to equal segments.")
            slice_width = w / num_poses
            pose_boxes = []
            for i in range(num_poses):
                center_x = (i * slice_width) + (slice_width / 2)
                crop_w = int(slice_width * 1.5)
                pose_boxes.append((max(0, int(center_x - crop_w/2)), min(w, int(center_x + crop_w/2))))
        else:
            # Use detected segments with some padding
            pose_boxes = []
            for s, e in refined:
                pad = int((e - s) * 0.2) # 20% padding
                pose_boxes.append((max(0, s - pad), min(w, e + pad)))

        for i in range(num_poses):
            x1, x2 = pose_boxes[i]
            
            logger.info(f"  Processing slice {i+1}/{num_poses} (x={x1} to {x2})...")
            crop = image.crop((x1, 0, x2, h))
            
            if req.remover_type == "none":
                # Do nothing, just use the raw crop
                no_bg = crop.convert("RGBA")
            elif req.remover_type == "simple":
                # Enhanced color-keying for white backgrounds
                no_bg = crop.convert("RGBA")
                data = np.array(no_bg)
                r, g, b, a = data.T
                # Use the provided sensitivity threshold
                thresh = req.foreground_threshold or 235
                white_mask = (r > thresh) & (g > thresh) & (b > thresh)
                data[..., 3][white_mask.T] = 0
                no_bg = Image.fromarray(data)
            else:
                # Use AI remover (rembg)
                no_bg = await run_in_threadpool(
                    remove, 
                    crop, 
                    session=rembg_session,
                    alpha_matting=req.alpha_matting,
                    alpha_matting_foreground_threshold=req.foreground_threshold,
                    alpha_matting_background_threshold=req.background_threshold
                )

            # --- AUTO-ISOLATION: Mask out neighbor character artifacts ---
            try:
                # 1. Create a mask of the character vs background
                iso_data = np.array(no_bg)
                r, g, b, a = iso_data.T
                
                # Check if we already have transparency
                has_alpha = np.max(a) > 0 and np.min(a) < 255
                
                if has_alpha:
                    # Use existing alpha channel
                    binary_mask = (a.T > 10).astype(np.uint8)
                else:
                    # No alpha? Detect background color from corners
                    corners = [iso_data[0,0], iso_data[0,-1], iso_data[-1,0], iso_data[-1,-1]]
                    avg_corner = np.mean(corners, axis=0)
                    is_white_bg = np.mean(avg_corner[:3]) > 128
                    
                    if is_white_bg:
                        # Character is not white (be sensitive)
                        binary_mask = ((r.T < 250) | (g.T < 250) | (b.T < 250)).astype(np.uint8)
                    else:
                        # Character is not black (be VERY sensitive for dark outfits)
                        binary_mask = ((r.T > 5) | (g.T > 5) | (b.T > 5)).astype(np.uint8)
                
                # 2. Find all connected components (islands)
                num_labels, labels = cv2.connectedComponents(binary_mask)
                
                if num_labels > 1: # 0 is background, 1+ are islands
                    # 3. Find the best island to keep
                    center_x = no_bg.width // 2
                    
                    # Check which labels are present in the central 40% of the slice (wider scan)
                    start_scan = center_x - (no_bg.width // 5)
                    end_scan = center_x + (no_bg.width // 5)
                    center_region = labels[:, int(max(0, start_scan)):int(min(no_bg.width, end_scan))]
                    
                    # Get unique labels and their counts in the center
                    unique, counts = np.unique(center_region[center_region > 0], return_counts=True)
                    
                    target_label = None
                    if len(unique) > 0:
                        # Pick the label with the most pixels in the center
                        target_label = unique[np.argmax(counts)]
                    elif num_labels == 2:
                        # Only one island found at all? Just keep it!
                        target_label = 1
                    
                    if target_label is not None:
                        # Prepare final output data
                        if no_bg.mode != 'RGBA':
                            no_bg = no_bg.convert('RGBA')
                            iso_data = np.array(no_bg)
                            
                        # Set alpha to 0 for all pixels NOT belonging to our target character
                        iso_data[..., 3][labels != target_label] = 0
                        no_bg = Image.fromarray(iso_data)
                        logger.info(f"    Isolated central character in slice {i+1} (Target Label: {target_label})")
            except Exception as iso_err:
                logger.warning(f"    Auto-isolation failed for slice {i+1}: {iso_err}")
            
            bbox = no_bg.getbbox()
            # If nothing detected, or the image is too transparent
            is_empty = not bbox
            if not is_empty:
                # Check if the detected area is actually meaningful (at least 1% of the crop)
                bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
                if bw < 20 or bh < 20:
                    is_empty = True
            
            if is_empty:
                logger.warning(f"    No character detected in slice {i+1}. Falling back to raw crop.")
                no_bg = crop.convert("RGBA")
                bbox = (0, 0, no_bg.width, no_bg.height)
                
            character_sprite = no_bg.crop(bbox)
            canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            
            sw, sh = character_sprite.size
            scale = 1.0
            if sh > 480: scale = 480 / sh
            if (sw * scale) > 480: scale = 480 / sw
                
            new_w, new_h = int(sw * scale), int(sh * scale)
            resized_sprite = character_sprite.resize((new_w, new_h), Image.Resampling.LANCZOS)
            
            paste_x = (512 - new_w) // 2
            paste_y = 512 - new_h - 10
            canvas.paste(resized_sprite, (paste_x, paste_y), resized_sprite)
            
            out_name = f"{req.project_id or 'temp'}_pose_{i}.png"
                
            out_path = os.path.join(output_dir, out_name)
            canvas.save(out_path)
            
            url_prefix = "/output/" if not req.project_id else f"/output_saves/{req.project_id}/slices/"
            sliced_urls.append(f"{url_prefix}{out_name}")
            
        if not sliced_urls:
            raise HTTPException(status_code=400, detail="Could not isolate any characters.")
            
        return {"status": "success", "urls": sliced_urls}
    except Exception as e:
        logger.error(f"Error slicing turnaround: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

class RigPosesRequest(BaseModel):
    frame_urls: list
    project_id: Optional[str] = None

@app.post("/rig-poses")
async def rig_poses(req: RigPosesRequest):
    try:
        rig_data = []
        try:
            from mediapipe.tasks import python
            from mediapipe.tasks.python import vision
            import urllib.request
            
            # Modern MediaPipe Tasks API requires a model file
            model_path = "pose_landmarker.task"
            if not os.path.exists(model_path):
                logger.info("Downloading MediaPipe Pose Landmarker model...")
                model_url = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
                urllib.request.urlretrieve(model_url, model_path)
                
            base_options = python.BaseOptions(model_asset_path=model_path)
            options = vision.PoseLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.IMAGE
            )
            
            with vision.PoseLandmarker.create_from_options(options) as landmarker:
                for i, url in enumerate(req.frame_urls):
                    img_path = resolve_image_path(url)
                    if not os.path.exists(img_path):
                        logger.warning(f"  Frame {i} not found at {img_path}")
                        continue
                        
                    mp_image = mp.Image.create_from_file(img_path)
                    result = landmarker.detect(mp_image)
                    
                    joints = {}
                    if result.pose_landmarks:
                        landmarks = result.pose_landmarks[0]
                        joint_map = {
                            "nose": 0, "shoulder_l": 11, "shoulder_r": 12,
                            "elbow_l": 13, "elbow_r": 14, "wrist_l": 15, "wrist_r": 16,
                            "hip_l": 23, "hip_r": 24, "knee_l": 25, "knee_r": 26,
                            "ankle_l": 27, "ankle_r": 28, "foot_l": 31, "foot_r": 32
                        }
                        for name, idx in joint_map.items():
                            lm = landmarks[idx]
                            joints[name] = {"x": lm.x, "y": lm.y, "v": getattr(lm, 'presence', 1.0) * getattr(lm, 'visibility', 1.0)}
                    
                    if not joints:
                        raise Exception("No joints detected by AI")
                        
                    rig_data.append({"pose_index": i, "url": url, "joints": joints, "method": "ai"})
        except Exception as ai_err:
            logger.warning(f"MediaPipe AI Rigging failed, using mathematical fallback: {ai_err}")
            # Fallback to standard human proportions if AI fails
            for i, url in enumerate(req.frame_urls):
                fallback_joints = {
                    "nose": {"x": 0.5, "y": 0.15, "v": 1.0},
                    "shoulder_l": {"x": 0.45, "y": 0.25, "v": 1.0}, "shoulder_r": {"x": 0.55, "y": 0.25, "v": 1.0},
                    "elbow_l": {"x": 0.42, "y": 0.4, "v": 1.0}, "elbow_r": {"x": 0.58, "y": 0.4, "v": 1.0},
                    "wrist_l": {"x": 0.4, "y": 0.55, "v": 1.0}, "wrist_r": {"x": 0.6, "y": 0.55, "v": 1.0},
                    "hip_l": {"x": 0.46, "y": 0.55, "v": 1.0}, "hip_r": {"x": 0.54, "y": 0.55, "v": 1.0},
                    "knee_l": {"x": 0.46, "y": 0.75, "v": 1.0}, "knee_r": {"x": 0.54, "y": 0.75, "v": 1.0},
                    "ankle_l": {"x": 0.46, "y": 0.9, "v": 1.0}, "ankle_r": {"x": 0.54, "y": 0.9, "v": 1.0},
                    "foot_l": {"x": 0.45, "y": 0.95, "v": 1.0}, "foot_r": {"x": 0.55, "y": 0.95, "v": 1.0}
                }
                rig_data.append({"pose_index": i, "url": url, "joints": fallback_joints, "method": "fallback"})
                
        return {"status": "success", "rigs": rig_data}
        
    except Exception as e:
        logger.error(f"Critical error in rigging endpoint: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class StitchFramesRequest(BaseModel):
    frame_urls: list
    project_id: Optional[str] = None

@app.post("/stitch-frames")
async def stitch_frames(req: StitchFramesRequest):
    """Stitch individual frames into a final sprite sheet."""
    try:
        logger.info(f"Stitching {len(req.frame_urls)} frames into sprite sheet...")
        
        frames = []
        max_w, max_h = 0, 0
        for url in req.frame_urls:
            img_path = resolve_image_path(url)
            if not os.path.exists(img_path):
                logger.warning(f"  Frame not found at {img_path}")
                continue
                
            img = Image.open(img_path).convert("RGBA")
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
        
        if not frames:
            raise HTTPException(status_code=400, detail="No valid frames to stitch")

        sheet = Image.new("RGBA", (max_w * len(frames), max_h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            x = i * max_w + (max_w - f.width) // 2
            y = (max_h - f.height) // 2
            sheet.paste(f, (x, y), f)
        
        filename = f"spritesheet_{uuid.uuid4()}.png"
        if req.project_id:
            filename = f"{req.project_id}_spritesheet.png"
            output_dir = os.path.join("Output_Saves", req.project_id)
            os.makedirs(output_dir, exist_ok=True)
            filepath = os.path.join(output_dir, filename)
        else:
            filepath = os.path.join("output", filename)
            
        sheet.save(filepath)
        logger.info(f"Sprite sheet saved: {filepath}")
        
        url_prefix = "/output/" if not req.project_id else f"/output_saves/{req.project_id}/"
        return {"status": "success", "url": f"{url_prefix}{filename}"}
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
