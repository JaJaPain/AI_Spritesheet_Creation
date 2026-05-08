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
import base64
import io
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
    FluxFillPipeline,
)
from transformers import BitsAndBytesConfig
from diffusers.utils import load_image
from rembg import remove, new_session
import gc
from animator import AffineMeshAnimator, create_walk_cycle, LIMB_HIERARCHY, pad_image_for_outpaint
from limb_borrower import borrow_and_warp_limb

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

# Custom StaticFiles to ensure CORS headers are sent for canvas loading
class CORSStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        return response

# Enable global CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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

# Serve generated images and saves with CORS enabled
app.mount("/output", CORSStaticFiles(directory="output"), name="output")
app.mount("/saves", CORSStaticFiles(directory="saves"), name="saves")
app.mount("/output_saves", CORSStaticFiles(directory="Output_Saves"), name="output_saves")

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

    def load_flux_fill(self):
        """Load FLUX.1-Fill-dev pipeline for inpainting/outpainting."""
        key = "flux_fill"
        if key in self.pipelines:
            return self.pipelines[key]
        
        self.unload_all()
        logger.info("Loading FLUX.1-Fill-dev for surgery...")
        
        try:
            nf4_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16
            )
            
            # Load Transformer in 4-bit
            transformer = FluxTransformer2DModel.from_pretrained(
                "black-forest-labs/FLUX.1-Fill-dev",
                subfolder="transformer",
                quantization_config=nf4_config,
                torch_dtype=torch.bfloat16
            )
            
            # Load T5 in 4-bit to save VRAM and prevent device mismatch
            from transformers import T5EncoderModel
            text_encoder_2 = T5EncoderModel.from_pretrained(
                "black-forest-labs/FLUX.1-Fill-dev",
                subfolder="text_encoder_2",
                quantization_config=nf4_config,
                torch_dtype=torch.bfloat16
            )
            
            pipe = FluxFillPipeline.from_pretrained(
                "black-forest-labs/FLUX.1-Fill-dev",
                transformer=transformer,
                text_encoder_2=text_encoder_2,
                torch_dtype=torch.bfloat16
            )
            
            # Explicitly move to cuda before offloading to ensure hooks are initialized on the right device
            pipe.to("cuda")
            pipe.enable_model_cpu_offload()
            pipe.vae.enable_tiling()
            
            """
            # Load the turnaround LoRA if it exists (for style consistency)
            lora_path = os.path.join("loras", "turnaround.safetensors")
            if os.path.exists(lora_path):
                pipe.load_lora_weights(lora_path)
                logger.info("  LoRA loaded for style consistency in Fill pipeline.")
            """
                
            self.pipelines[key] = pipe
            return pipe
        except Exception as e:
            logger.error(f"FAILED to load FLUX Fill: {e}")
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
                
                # Save the slice
                if req.project_id:
                    save_path = os.path.join(project_dir, filename)
                    isolated.save(save_path)
                    logger.info(f"    Saved slice {i+1} to {save_path}")
            
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
        base_prompt = f"{prompt}, game sprite, full body, solid bright green background, consistent character design, arms visible"
        
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
        tech_prefix = "character turnaround sheet, 5 views: front view, side view, back view, front-quarter view, back-quarter view. no shadows, same proportions, consistent detailing, white background"
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
    force_reslice: Optional[bool] = False
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
        # 0. Initialize Project if needed
        pid = req.project_id
        is_new_project = False
        if not pid:
            pid = get_next_project_id()
            is_new_project = True
            logger.info(f"Auto-initializing project {pid} for slicing.")
            
        # Determine output directory
        output_dir = os.path.join("Output_Saves", pid)
        os.makedirs(output_dir, exist_ok=True)
            
        # Robust URL handling using helper
        sheet_path = resolve_image_path(req.image_url)
        
        if not os.path.exists(sheet_path):
            raise HTTPException(status_code=404, detail=f"Sheet not found at {sheet_path}")
            
        image = Image.open(sheet_path).convert("RGB")
        w, h = image.size
        
        num_poses = 5
        slice_width = w / num_poses
        
        sliced_urls = []
        logger.info(f"Slicing turnaround sheet ({w}x{h}) into {num_poses} poses for project {pid}...")
        
        # Save a copy of the turnaround sheet to the project if it's not already there
        project_sheet_name = f"{pid}_turnaround.png"
        project_sheet_path = os.path.join(output_dir, project_sheet_name)
        if not os.path.exists(project_sheet_path):
            shutil.copy2(sheet_path, project_sheet_path)
            
        # Ensure metadata exists
        meta_path = os.path.join(output_dir, "metadata.json")
        if not os.path.exists(meta_path):
            with open(meta_path, "w") as f:
                json.dump({"id": pid, "created_at": time.time(), "image_url": f"/output_saves/{pid}/{project_sheet_name}"}, f)
            
        # Smart Cache: Only reuse if files exist AND sheet hasn't changed AND we aren't forcing
        if not is_new_project and not getattr(req, 'force_reslice', False):
            if os.path.exists(output_dir):
                pose_files = [os.path.join(output_dir, f) for f in os.listdir(output_dir) if f.startswith(f"{pid}_pose_")]
                if len(pose_files) >= num_poses:
                    sheet_mtime = os.path.getmtime(sheet_path)
                    newest_slice = max(os.path.getmtime(f) for f in pose_files)
                    if sheet_mtime < newest_slice:
                        logger.info(f"Reusing existing slices for project {pid}")
                        sliced_urls = [f"/output_saves/{pid}/{os.path.basename(f)}" for f in sorted(pose_files)]
                        return {"status": "success", "urls": sliced_urls[:num_poses], "project_id": pid}
            
        # Dynamic Detection: Use horizontal projection to find gaps and isolate characters
        num_poses = 5
        
        # 1. Prepare mask for detection (ignore background)
        detection_img = image.convert("RGBA")
        data = np.array(detection_img)
        r, g, b, a = data.T
        
        corners = [data[0,0], data[0,-1], data[-1,0], data[-1,-1]]
        avg_corner = np.mean(corners, axis=0)
        is_white_bg = np.mean(avg_corner[:3]) > 128
        
        # Use a slightly stricter threshold for DYNAMIC DETECTION to find gaps
        # We want to ignore near-white/near-black noise in the gaps
        if is_white_bg:
            detect_thresh = min(220, (req.foreground_threshold or 240) - 20)
            mask = (r < detect_thresh) | (g < detect_thresh) | (b < detect_thresh)
        else:
            detect_thresh = max(35, (req.foreground_threshold or 15) + 20)
            mask = (r > detect_thresh) | (g > detect_thresh) | (b > detect_thresh)
            
        # 2. Horizontal Projection (sum along Y axis)
        projection = np.sum(mask, axis=0)
        
        # 3. Find segments (islands of pixels)
        # Use a higher threshold to ignore tiny noise specks in gaps
        min_pixels_in_col = 15 
        segments = []
        in_segment = False
        start_x = 0
        
        for x, val in enumerate(projection):
            if val > min_pixels_in_col and not in_segment:
                in_segment = True
                start_x = x
            elif val <= min_pixels_in_col and in_segment:
                in_segment = False
                segments.append((start_x, x))
        if in_segment:
            segments.append((start_x, len(projection)-1))
            
        # 4. Refine segments (merge small gaps, filter noise)
        min_gap = 50 # Slightly wider gap requirement
        refined = []
        if segments:
            curr_s, curr_e = segments[0]
            for next_s, next_e in segments[1:]:
                # Merge if gap is tiny OR if segments are tiny (likely noise)
                if next_s - curr_e < min_gap:
                    curr_e = next_e
                else:
                    refined.append((curr_s, curr_e))
                    curr_s, curr_e = next_s, next_e
            refined.append((curr_s, curr_e))
            
        # Filter out very narrow segments (likely noise)
        refined = [s for s in refined if (s[1] - s[0]) > 40]
            
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
                    
                    # Use user threshold if available
                    thresh = req.foreground_threshold or (240 if is_white_bg else 15)
                    
                    if is_white_bg:
                        # Character is not background (be sensitive)
                        binary_mask = ((r.T < thresh) | (g.T < thresh) | (b.T < thresh)).astype(np.uint8)
                    else:
                        # Character is not background (be VERY sensitive for dark outfits)
                        binary_mask = ((r.T > (thresh//2)) | (g.T > (thresh//2)) | (b.T > (thresh//2))).astype(np.uint8)
                
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
                    
                    target_labels = []
                    if len(unique) > 0:
                        # Find the dominant label (the one with most pixels in center)
                        dominant_idx = np.argmax(counts)
                        dominant_label = unique[dominant_idx]
                        dominant_count = counts[dominant_idx]
                        
                        # Keep any label that has at least 15% of the dominant label's presence in the center
                        # This catches detached limbs/accessories while still excluding neighbor bleed-in
                        threshold = dominant_count * 0.15
                        for label, count in zip(unique, counts):
                            if count >= threshold:
                                target_labels.append(label)
                    else:
                        # CENTER SCAN FAILED: Fallback to largest island
                        labels_list, island_counts = np.unique(labels[labels > 0], return_counts=True)
                        if len(labels_list) > 0:
                            target_labels = [labels_list[np.argmax(island_counts)]]
                            logger.info(f"    Center scan failed for slice {i+1}, falling back to largest island")                    
                    
                    if target_labels:
                        # Prepare final output data
                        if no_bg.mode != 'RGBA':
                            no_bg = no_bg.convert('RGBA')
                            iso_data = np.array(no_bg)
                            
                        # Create a mask of all allowed labels
                        final_mask = np.isin(labels, target_labels)
                        
                        # Set alpha to 0 for all pixels NOT in our target list
                        iso_data[..., 3][~final_mask] = 0
                        no_bg = Image.fromarray(iso_data)
                        logger.info(f"    Isolated character parts in slice {i+1} (Labels: {target_labels})")
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
            
            out_name = f"{pid}_pose_{i}.png"
            url_prefix = f"/output_saves/{pid}/"
            sliced_urls.append(f"{url_prefix}{out_name}")
            
            # Save the slice
            save_path = os.path.join(output_dir, out_name)
            canvas.save(save_path)
            logger.info(f"    Saved slice {i+1} to {save_path}")
            
        if not sliced_urls:
            raise HTTPException(status_code=400, detail="Could not isolate any characters.")
            
        return {"status": "success", "urls": sliced_urls, "project_id": pid}
    except HTTPException:
        raise
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
                        
                    # Generate mesh for this pose
                    with Image.open(img_path).convert("RGBA") as img:
                        animator = AffineMeshAnimator(img, joints)
                        triangles = animator.triangles.tolist() # Convert to list for JSON
                    
                    rig_data.append({
                        "pose_index": i, 
                        "url": url, 
                        "joints": joints, 
                        "triangles": triangles,
                        "method": "ai"
                    })
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
                # Use a dummy triangulation for fallback (simple grid)
                rig_data.append({
                    "pose_index": i, 
                    "url": url, 
                    "joints": fallback_joints, 
                    "triangles": [], # Empty for now
                    "method": "fallback"
                })
                
        # PERSIST RIGS TO METADATA
        if req.project_id:
            project_dir = os.path.join("Output_Saves", req.project_id)
            meta_path = os.path.join(project_dir, "metadata.json")
            if os.path.exists(meta_path):
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                meta["rigs"] = rig_data
                with open(meta_path, "w") as f:
                    json.dump(meta, f)
                logger.info(f"  Saved {len(rig_data)} rigs to project {req.project_id} metadata.")
                
        return {"status": "success", "rigs": rig_data}
        
    except Exception as e:
        logger.error(f"Critical error in rigging endpoint: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class SetPoseLabelRequest(BaseModel):
    project_id: str
    pose_index: int
    label: str

@app.post("/set-pose-label")
async def set_pose_label(req: SetPoseLabelRequest):
    """Assigns a semantic label (e.g., 'front', 'back') to a specific pose index."""
    try:
        project_dir = os.path.join("Output_Saves", req.project_id)
        meta_path = os.path.join(project_dir, "metadata.json")
        if not os.path.exists(meta_path):
             raise HTTPException(status_code=404, detail="Project metadata not found")
        
        with open(meta_path, "r") as f:
            meta = json.load(f)
            
        for rig in meta.get("rigs", []):
            if rig["pose_index"] == req.pose_index:
                rig["label"] = req.label
                break
                
        with open(meta_path, "w") as f:
            json.dump(meta, f)
            
        return {"status": "success", "label": req.label}
    except Exception as e:
        logger.error(f"Failed to set pose label: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ExtractLimbsRequest(BaseModel):
    project_id: str
    pose_index: int
    source_pose_index: Optional[int] = 0 # Default to Front view
    label: Optional[str] = None # e.g. "front", "back"

@app.post("/extract-limbs")
async def extract_limbs(req: ExtractLimbsRequest):
    try:
        project_dir = os.path.join("Output_Saves", req.project_id)
        if not os.path.exists(project_dir):
            raise HTTPException(status_code=404, detail="Project not found")
            
        # 1. Load target pose and joints
        # (Assuming we have a way to get joints for a specific pose)
        # For now, we'll look for saved metadata
        metadata_path = os.path.join(project_dir, "metadata.json")
        if not os.path.exists(metadata_path):
             raise HTTPException(status_code=404, detail="Metadata not found")
             
        with open(metadata_path, "r") as f:
            metadata = json.load(f)
            
        target_rig = next((r for r in metadata.get("rigs", []) if r["pose_index"] == req.pose_index), None)
        if not target_rig:
             raise HTTPException(status_code=404, detail="Rig not found for pose")
             
        img_path = resolve_image_path(target_rig["url"])
        img = Image.open(img_path).convert("RGBA")
        animator = AffineMeshAnimator(img, target_rig["joints"])
        # 3. Industry Standard Advanced Segmentation
        logger.info("  Running Advanced Silhouette-Aware Segmentation...")
        limbs = animator.extract_limbs_advanced(overlap_padding=15)
        
        # 3. Borrow limbs if needed
        # We check confidence 'v' of joints in the target rig
        # If back arm is occluded, borrow from source
        source_rig = next((r for r in metadata.get("rigs", []) if r["pose_index"] == req.source_pose_index), None)
        
        if source_rig:
            src_img_path = resolve_image_path(source_rig["url"])
            src_img = Image.open(src_img_path).convert("RGBA")
            
            for limb_name, joint_names in LIMB_HIERARCHY.items():
                # Check if this limb is "bad" in the target
                avg_v = sum(target_rig["joints"][j].get("v", 1.0) for j in joint_names if j in target_rig["joints"]) / len(joint_names)
                
                if avg_v < 0.6: # OCLLUDED! Borrow it
                    logger.info(f"Limb {limb_name} is occluded in pose {req.pose_index}. Borrowing from pose {req.source_pose_index}...")
                    borrowed = borrow_and_warp_limb(src_img, source_rig["joints"], target_rig["joints"], limb_name)
                    limbs[limb_name] = borrowed

        # 4. Save limb pack
        # Use semantic label for folder name if provided, else fallback to pose index
        folder_name = req.label if req.label else f"limbs_pose_{req.pose_index}"
        limb_pack_dir = os.path.join(project_dir, folder_name)
        os.makedirs(limb_pack_dir, exist_ok=True)
        
        urls = {}
        for name, limb_img in limbs.items():
            filename = f"{name}.png"
            limb_img.save(os.path.join(limb_pack_dir, filename))
            urls[name] = f"/output_saves/{req.project_id}/{folder_name}/{filename}"
            
        return {"status": "success", "limb_urls": urls, "folder": folder_name}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting limbs: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


class GenerateAnimationRequest(BaseModel):
    frame_url: str
    joints: dict
    project_id: Optional[str] = None
    anim_type: str = "walk"
    stride: float = 0.2
    bounce: float = 0.05
    num_frames: int = 12
    limb_pack: Optional[dict] = None # New: dict of limb_name -> url

@app.post("/generate-animation")
async def generate_animation(req: GenerateAnimationRequest):
    try:
        logger.info(f"Generating {req.anim_type} animation for {req.frame_url}...")
        
        img_path = resolve_image_path(req.frame_url)
        if not os.path.exists(img_path):
            raise HTTPException(status_code=404, detail="Frame not found")
            
        img = Image.open(img_path).convert("RGBA")
        animator = AffineMeshAnimator(img, req.joints)
        
        # Determine if we are doing layered animation
        frames = []
        if req.limb_pack:
            logger.info("  Using Hierarchical Paper-Doll Rig (Industry Standard)...")
            limb_images = {}
            for name, url in req.limb_pack.items():
                l_path = resolve_image_path(url)
                if os.path.exists(l_path):
                    limb_images[name] = Image.open(l_path).convert("RGBA")
            
            from animator import HierarchicalAnimator, create_animation_hierarchical
            h_animator = HierarchicalAnimator(limb_images, req.joints)
            frames = create_animation_hierarchical(
                h_animator, 
                anim_type=req.anim_type, 
                stride=req.stride, 
                bounce=req.bounce, 
                num_frames=req.num_frames,
                direction="S" # Default to South/Front for now
            )
        else:
            # Standard single-mesh animation
            if req.anim_type == "walk":
                frames = create_walk_cycle(animator, stride=req.stride, bounce=req.bounce, num_frames=req.num_frames)
            elif req.anim_type == "jump":
                from animator import create_jump_cycle
                frames = create_jump_cycle(animator, height=req.bounce * 5, num_frames=req.num_frames)
            elif req.anim_type == "attack":
                from animator import create_attack_cycle
                frames = create_attack_cycle(animator, reach=req.stride, num_frames=req.num_frames)
            else:
                frames = [img] * req.num_frames
            
        # Save frames
        urls = []
        project_dir = os.path.join("Output_Saves", req.project_id) if req.project_id else "output"
        os.makedirs(project_dir, exist_ok=True)
        
        anim_id = f"{req.anim_type}_{int(time.time())}"
        anim_subdir = os.path.join(project_dir, "animations", anim_id)
        os.makedirs(anim_subdir, exist_ok=True)
        
        for i, f in enumerate(frames):
            filename = f"frame_{i:03d}.png"
            filepath = os.path.join(anim_subdir, filename)
            f.save(filepath)
            
            # Relative URL
            rel_url = f"/output_saves/{req.project_id}/animations/{anim_id}/{filename}" if req.project_id else f"/output/{filename}"
            urls.append(rel_url)
            
        return {"status": "success", "urls": urls, "anim_id": anim_id}
    except Exception as e:
        logger.error(f"Error generating animation: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

class BuildIndexRequest(BaseModel):
    project_id: str

@app.post("/build-character-index")
async def build_character_index(req: BuildIndexRequest):
    try:
        project_dir = os.path.join("Output_Saves", req.project_id)
        if not os.path.exists(project_dir):
            raise HTTPException(status_code=404, detail="Project not found")
            
        # Scan for animations
        anims_dir = os.path.join(project_dir, "animations")
        if not os.path.exists(anims_dir):
             return {"status": "success", "index": {"id": req.project_id, "animations": {}}}
             
        index = {
            "id": req.project_id,
            "animations": {}
        }
        
        # Each subfolder in animations/ is a sequence
        for anim_id in os.listdir(anims_dir):
            anim_path = os.path.join(anims_dir, anim_id)
            if not os.path.isdir(anim_path): continue
            
            frames = sorted([f for f in os.listdir(anim_path) if f.endswith(".png")])
            index["animations"][anim_id] = {
                "frames": [f"/output_saves/{req.project_id}/animations/{anim_id}/{f}" for f in frames]
            }
            
        # Save index.json
        index_path = os.path.join(project_dir, "character_index.json")
        with open(index_path, "w") as f:
            json.dump(index, f, indent=2)
            
        return {"status": "success", "index_url": f"/output_saves/{req.project_id}/character_index.json"}
    except Exception as e:
        logger.error(f"Error building character index: {e}")
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


class CorrectPoseRequest(BaseModel):
    project_id: str
    sheet_url: str
    mask_image: str # Base64 mask
    target_rotation: str # e.g. "front-quarter"
    prompt_override: Optional[str] = None

@app.post("/correct-pose")
async def correct_pose(req: CorrectPoseRequest):
    """Surgically correct a specific pose on the turnaround sheet using FLUX Fill."""
    try:
        logger.info(f"Correcting pose on sheet {req.sheet_url} for project {req.project_id}")
        
        # 1. Resolve images
        sheet_path = resolve_image_path(req.sheet_url)
        if not os.path.exists(sheet_path):
            raise HTTPException(status_code=404, detail="Sheet not found")
            
        sheet_img = Image.open(sheet_path).convert("RGB")
        
        # Decode mask
        import base64
        import io
        mask_data = base64.b64decode(req.mask_image.split(",")[-1])
        mask_img = Image.open(io.BytesIO(mask_data)).convert("L")
        
        # 2. Get Metadata for style consistency
        project_dir = os.path.join("Output_Saves", req.project_id)
        meta_path = os.path.join(project_dir, "metadata.json")
        anchor_prompt = ""
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
                anchor_prompt = meta.get("prompt", "")
        
        # 3. Prepare Prompt
        style_ref = f", consistent character design, {anchor_prompt}" if anchor_prompt else ""
        full_prompt = f"{req.target_rotation} view of the character, {req.prompt_override or ''}{style_ref}, flat 2d game asset, high resolution, white background"
        
        # 4. Load FLUX Fill
        pipe = manager.load_flux_fill()
        
        # DEBUG: Save mask
        debug_mask_path = os.path.join(project_dir, f"debug_mask_{uuid.uuid4().hex[:4]}.png")
        mask_img.save(debug_mask_path)
        logger.info(f"  Debug mask saved: {debug_mask_path}")
        
        def do_fill():
            return pipe(
                prompt=full_prompt,
                image=sheet_img,
                mask_image=mask_img,
                num_inference_steps=50, # Higher steps for better structural change
                guidance_scale=4.5, # Stronger guidance for rotation changes
                width=sheet_img.width,
                height=sheet_img.height,
            ).images[0]
            
        image = await run_in_threadpool(do_fill)
        
        # 5. Clean up the corrected area to prevent background artifacts
        # We run rembg on the corrected image to isolate the character
        logger.info("  Cleaning background of corrected pose...")
        image_no_bg = await run_in_threadpool(
            remove, 
            image, 
            session=rembg_session
        )
        
        # 6. Composite the clean character back onto the original sheet
        # First, prepare a "clean" original sheet by wiping the masked area to the background color
        # Detect background color from corners of original sheet
        sheet_arr = np.array(sheet_img)
        corners = [sheet_arr[0,0], sheet_arr[0,-1], sheet_arr[-1,0], sheet_arr[-1,-1]]
        avg_bg = tuple(np.mean(corners, axis=0).astype(int))
        
        # Create a "clean" background by filling the masked area with avg_bg
        clean_bg = sheet_img.copy()
        wipe_mask = mask_img.point(lambda p: 255 if p > 128 else 0)
        bg_fill = Image.new("RGB", sheet_img.size, avg_bg)
        clean_bg.paste(bg_fill, (0, 0), wipe_mask)
        
        # Now paste the isolated character from the corrected image
        # We only want to paste where the character actually is in the corrected image
        final_image = clean_bg.copy()
        final_image.paste(image_no_bg, (0, 0), image_no_bg)
        
        # Save the result
        filename = f"corrected_{uuid.uuid4().hex[:8]}.png"
        filepath = os.path.join(project_dir, filename)
        final_image.save(filepath)
        
        # PERSIST NEW SHEET TO METADATA
        meta_path = os.path.join(project_dir, "metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
            meta["image_url"] = f"/output_saves/{req.project_id}/{filename}"
            with open(meta_path, "w") as f:
                json.dump(meta, f)
            logger.info(f"  Updated project metadata with corrected sheet: {filename}")
            
        return {"status": "success", "url": f"/output_saves/{req.project_id}/{filename}"}
    except Exception as e:
        logger.error(f"Error correcting pose: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
            
class ExplodeLimbRequest(BaseModel):
    project_id: str
    limb_name: str # e.g. "left arm"
    anchor_url: Optional[str] = None
    mask_image: Optional[str] = None # Base64 mask from user

@app.post("/generate-isolated-limb")
async def generate_isolated_limb(req: ExplodeLimbRequest):
    """Asset Exploder: Generate a brand new isolated limb for a character."""
    try:
        logger.info(f"Exploding limb '{req.limb_name}' for project {req.project_id}")
        
        project_dir = os.path.join("Output_Saves", req.project_id)
        if not os.path.exists(project_dir):
            raise HTTPException(status_code=404, detail="Project not found")
            
        # 1. Resolve Anchor Image
        anchor_url = req.anchor_url
        meta_path = os.path.join(project_dir, "metadata.json")
        anchor_prompt = ""
        
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                meta = json.load(f)
                anchor_prompt = meta.get("prompt", "")
                if not anchor_url:
                    # Fallback to Front view if available
                    front_rig = next((r for r in meta.get("rigs", []) if r["pose_index"] == 0), None)
                    if front_rig:
                        anchor_url = front_rig["url"]
                    else:
                        # Fallback to turnaround sheet
                        anchor_url = meta.get("image_url")

        if not anchor_url:
             raise HTTPException(status_code=400, detail="Could not determine anchor image for style reference")

        anchor_path = resolve_image_path(anchor_url)
        if not os.path.exists(anchor_path):
             raise HTTPException(status_code=404, detail=f"Anchor image not found at {anchor_path}")
             
        anchor_img = Image.open(anchor_path).convert("RGB")
        
        # 2. In-Place Reconstruction Canvas
        # Use Neutral Gray (128,128,128) to prevent background color bleed/washout
        canvas = Image.new("RGB", (1024, 1024), (128, 128, 128))
        
        # Fit character into the center (Zoom in to 950px for max detail density)
        # Handle transparency by compositing onto neutral gray first
        anchor_rgba = Image.open(anchor_path).convert("RGBA")
        a_w, a_h = anchor_rgba.size
        scale = min(950 / a_w, 950 / a_h)
        new_w, new_h = int(a_w * scale), int(a_h * scale)
        anchor_scaled = anchor_rgba.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        offset_x = (1024 - new_w) // 2
        offset_y = (1024 - new_h) // 2
        
        # Composite onto a temporary gray background to avoid sharp edges
        temp_bg = Image.new("RGBA", anchor_scaled.size, (128, 128, 128, 255))
        temp_bg.paste(anchor_scaled, (0, 0), anchor_scaled)
        canvas.paste(temp_bg.convert("RGB"), (offset_x, offset_y))
        
        # 3. Targeted Mask & Surgical Erasure
        mask_data = np.zeros((1024, 1024), dtype=np.uint8)
        canvas_arr = np.array(canvas)
        
        # Find the rig for this anchor to get joint positions
        target_rig = next((r for r in meta.get("rigs", []) if r["url"] in anchor_url or anchor_url in r["url"]), None)
        
        if target_rig:
            # ERASURE: Paint non-target limbs Neutral Gray to prevent context conflict
            for limb_name, joint_list in LIMB_HIERARCHY.items():
                if limb_name.lower() == req.limb_name.lower():
                    continue # This is our target, don't erase!
                
                # Draw a thick gray line/polygon over the "other" limb
                other_points = []
                for jn in joint_list:
                    if jn in target_rig["joints"]:
                        j = target_rig["joints"][jn]
                        px = int(j["x"] * new_w) + offset_x
                        py = int(j["y"] * new_h) + offset_y
                        other_points.append([px, py])
                
                if len(other_points) >= 2:
                    pts = np.array(other_points, np.int32)
                    # Use a thick line to ensure the limb is fully "deleted" from the context
                    cv2.polylines(canvas_arr, [pts], False, (128, 128, 128), thickness=60)
                elif len(other_points) == 1:
                    # Single joint limbs (like Head or Hands)
                    center = tuple(other_points[0])
                    # Draw a large circle to cover head/hair or hands
                    cv2.circle(canvas_arr, center, 85, (128, 128, 128), -1)
            
            # Update canvas with erased parts
            canvas = Image.fromarray(canvas_arr)
            
            # Define joint-based points for automatic fallback
            joint_names = LIMB_HIERARCHY.get(req.limb_name, [])
            points = []
            for jn in joint_names:
                if jn in target_rig["joints"]:
                    j = target_rig["joints"][jn]
                    px = int(j["x"] * new_w) + offset_x
                    py = int(j["y"] * new_h) + offset_y
                    points.append([px, py])

            if req.mask_image:
                # User provided a manual mask. Decode, resize and offset to match canvas.
                header, encoded = req.mask_image.split(",", 1)
                mask_bytes = base64.b64decode(encoded)
                user_mask = Image.open(io.BytesIO(mask_bytes))
                if user_mask.mode == "RGBA":
                    # Convert transparent mask to black/white for FLUX
                    new_mask = Image.new("L", user_mask.size, 0)
                    # Use alpha channel or anything non-transparent as mask
                    alpha = user_mask.split()[-1]
                    new_mask.paste(255, (0, 0), alpha)
                    user_mask = new_mask
                else:
                    user_mask = user_mask.convert("L")

                # Resize and offset user mask same as character
                user_mask_scaled = user_mask.resize((new_w, new_h), Image.Resampling.NEAREST)
                mask_img_temp = Image.new("L", (1024, 1024), 0)
                mask_img_temp.paste(user_mask_scaled, (offset_x, offset_y))
                mask_data = np.array(mask_img_temp)
            elif len(points) >= 2:
                pts = np.array(points, np.int32)
                x, y, w, h = cv2.boundingRect(pts)
                pad = 30 # Increased padding for better structural context
                cv2.rectangle(mask_data, (x-pad, y-pad), (x+w+pad, y+h+pad), 255, -1)
            else:
                mask_data[256:768, 256:768] = 255
        else:
            mask_data[256:768, 256:768] = 255
            
        mask_img = Image.fromarray(mask_data)
        
        # 4. Refined Prompt (Strict Isolation & Directional Accuracy)
        style_ref = f"matching {anchor_prompt}" if anchor_prompt else "high quality character"
        
        isolation = ""
        if "torso" in req.limb_name.lower():
            isolation = ", professional game asset, isolated character body, solid opaque skin and clothing, clean 2D sprite textures, no limbs, no face, no eyes, detached torso only, clean background"
        else:
            isolation = ", professional game asset, isolated character limb, solid opaque textures, clean background, detached part"

        full_prompt = f"a professional game asset of a {req.limb_name}{isolation}, {style_ref}, vibrant bold colors, solid character textures, high contrast, sharp focus, masterpiece, high fidelity, neutral grey background"
        
        # 5. Run FLUX Fill
        pipe = manager.load_flux_fill()
        
        def do_explode():
            return pipe(
                prompt=full_prompt,
                image=canvas, 
                mask_image=mask_img,
                num_inference_steps=50, 
                guidance_scale=5.0, # Higher guidance for more solid character colors
                width=1024,
                height=1024,
            ).images[0]
            
        result = await run_in_threadpool(do_explode)
        
        # 6. Surgical Extraction (Use the mask as Alpha)
        # Instead of AI background removal (rembg), which can be too aggressive,
        # we use the user's own mask to define the transparency.
        
        # Convert mask_img to Alpha
        mask_alpha = mask_img.convert("L")
        
        # Composite: Result pixels where mask is white, transparent elsewhere
        final_limb = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        final_limb.paste(result.convert("RGBA"), (0, 0), mask_alpha)
        
        # Crop to the mask area
        if target_rig and len(points) >= 2:
            pts = np.array(points, np.int32)
            x, y, w, h = cv2.boundingRect(pts)
            pad = 120
            crop_box = (max(0, x-pad), max(0, y-pad), min(1024, x+w+pad), min(1024, y+h+pad))
        else:
            crop_box = (128, 128, 896, 896)
            
        final_limb = final_limb.crop(crop_box)
        
        # Auto-crop to content
        bbox = final_limb.getbbox()
        if bbox:
            final_limb = final_limb.crop(bbox)
        
        # Save
        clean_name = req.limb_name.replace(" ", "_").lower()
        filename = f"exploded_{clean_name}_{uuid.uuid4().hex[:4]}.png"
        save_dir = os.path.join(project_dir, "exploded_limbs")
        os.makedirs(save_dir, exist_ok=True)
        filepath = os.path.join(save_dir, filename)
        final_limb.save(filepath)
        
        return {"status": "success", "url": f"/output_saves/{req.project_id}/exploded_limbs/{filename}", "limb_name": req.limb_name}
    except HTTPException:
        raise
class CompleteSocketRequest(BaseModel):
    project_id: str
    limb_url: str
    limb_name: str
    torso_url: str # Contextual anchor

@app.post("/complete-limb-socket")
async def complete_limb_socket(req: CompleteSocketRequest):
    """Industry Standard: Rounds out the joint area using Torso as a style anchor."""
    try:
        logger.info(f"Completing socket for {req.limb_name} with Torso context")
        
        project_dir = os.path.join("Output_Saves", req.project_id)
        limb_path = resolve_image_path(req.limb_url)
        torso_path = resolve_image_path(req.torso_url)
        
        if not os.path.exists(limb_path) or not os.path.exists(torso_path):
            raise HTTPException(status_code=404, detail="Required assets (limb or torso) missing")
            
        # 1. Load Assets
        limb_img = Image.open(limb_path).convert("RGBA")
        torso_img = Image.open(torso_path).convert("RGBA")
        
        # 2. Create 1024x1024 Contextual Canvas
        canvas_size = 1024
        canvas = Image.new("RGB", (canvas_size, canvas_size), (128, 128, 128))
        
        # Position them relative to each other
        t_w, t_h = torso_img.size
        l_w, l_h = limb_img.size
        t_pos = (canvas_size // 2 - t_w // 2, canvas_size // 2 - t_h // 2)
        canvas.paste(torso_img, t_pos, torso_img)
        
        # Paste Limb touching the torso
        l_pos = (t_pos[0] + t_w // 2 - l_w // 2, t_pos[1] + t_h // 2 - l_h // 2)
        canvas.paste(limb_img, l_pos, limb_img)
        
        # 3. Targeted Mask (The "Socket")
        limb_alpha = np.array(limb_img)[:, :, 3]
        kernel = np.ones((150, 150), np.uint8)
        dilated = cv2.dilate(limb_alpha, kernel, iterations=1)
        socket_mask_local = (dilated > 0) & (limb_alpha == 0)
        
        mask_full = Image.new("L", (canvas_size, canvas_size), 0)
        mask_local_img = Image.fromarray((socket_mask_local * 255).astype(np.uint8))
        mask_full.paste(mask_local_img, l_pos)
        
        # 4. Refined Prompt
        meta_path = os.path.join(project_dir, "metadata.json")
        style = "character sprite"
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                style = json.load(f).get("prompt", "character sprite")[:100]

        full_prompt = f"joint socket for {req.limb_name}, matching {style}, studio lighting, soft shadows, neutral studio background, game asset, high fidelity, 2d digital painting"
        
        # 5. Run FLUX Fill
        pipe = manager.load_flux_fill()
        
        def do_fill():
            return pipe(
                prompt=full_prompt,
                image=canvas,
                mask_image=mask_full,
                num_inference_steps=30,
                guidance_scale=4.5,
                width=1024,
                height=1024,
            ).images[0]
            
        result = await run_in_threadpool(do_fill)
        
        # 6. Extraction
        crop_box = (l_pos[0] - 20, l_pos[1] - 20, l_pos[0] + l_w + 20, l_pos[1] + l_h + 20)
        final_limb_patch = result.crop(crop_box)
        final_no_bg = remove(final_limb_patch, session=rembg_session)
        
        filename = f"fixed_{req.limb_name}_{uuid.uuid4().hex[:4]}.png"
        save_path = os.path.join(project_dir, "exploded_limbs", filename)
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        final_no_bg.save(save_path)
        
        return {"status": "success", "url": f"/output_saves/{req.project_id}/exploded_limbs/{filename}"}
        
    except Exception as e:
        logger.error(f"Socket completion failed: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

class DirectionalPoseRequest(BaseModel):
    project_id: str
    target_direction: str # "SE", "SW", "NE", "NW"

@app.post("/generate-directional-poses")
async def generate_directional_poses(req: DirectionalPoseRequest):
    """Industry Standard: Interpolates 45-degree angles from cardinal views."""
    try:
        logger.info(f"Interpolating {req.target_direction} pose for project {req.project_id}")
        
        project_dir = os.path.join("Output_Saves", req.project_id)
        meta_path = os.path.join(project_dir, "metadata.json")
        if not os.path.exists(meta_path):
             raise HTTPException(status_code=404, detail="Project metadata not found")
             
        with open(meta_path, "r") as f:
            meta = json.load(f)
            
        # cardinal views: Front=0, Side=2, Back=4
        rigs = meta.get("rigs", [])
        front = next((r["url"] for r in rigs if r["pose_index"] == 0), None)
        side = next((r["url"] for r in rigs if r["pose_index"] == 2), None)
        back = next((r["url"] for r in rigs if r["pose_index"] == 4), None)
        
        # Determine references based on target
        ref1_url, ref2_url = None, None
        if req.target_direction == "SE":
            ref1_url, ref2_url = front, side
        elif req.target_direction == "SW":
            ref1_url, ref2_url = front, side # Side will be flipped in logic if needed
        elif req.target_direction == "NE":
            ref1_url, ref2_url = back, side
        elif req.target_direction == "NW":
            ref1_url, ref2_url = back, side
            
        if not ref1_url or not ref2_url:
             raise HTTPException(status_code=400, detail="Missing cardinal views (Front/Side/Back) required for interpolation")

        # Load and resize refs
        ref1 = Image.open(resolve_image_path(ref1_url)).convert("RGB").resize((341, 512))
        ref2 = Image.open(resolve_image_path(ref2_url)).convert("RGB").resize((341, 512))
        
        # Create triple-width canvas (1024px width total)
        # Layout: [Ref 1] [Ref 2] [Empty Space for Target]
        canvas = Image.new("RGB", (1024, 512), (255, 255, 255))
        canvas.paste(ref1, (0, 0))
        canvas.paste(ref2, (341, 0))
        
        # Mask for the target area (rightmost 342px)
        mask_data = np.zeros((512, 1024), dtype=np.uint8)
        mask_data[:, 682:] = 255
        mask_img = Image.fromarray(mask_data)
        
        # 3. Prompt
        dir_name = {
            "SE": "front-right three-quarter",
            "SW": "front-left three-quarter",
            "NE": "back-right three-quarter",
            "NW": "back-left three-quarter"
        }[req.target_direction]
        
        full_prompt = f"a {dir_name} view of the character, matching character design, {meta.get('prompt', '')}, flat 2d game asset, high resolution, white background"
        
        # 4. Run FLUX Fill
        pipe = manager.load_flux_fill()
        
        def do_fill():
            return pipe(
                prompt=full_prompt,
                image=canvas,
                mask_image=mask_img,
                num_inference_steps=50,
                guidance_scale=5.0,
                width=1024,
                height=512,
            ).images[0]
            
        result = await run_in_threadpool(do_fill)
        
        # Crop target
        target_img = result.crop((682, 0, 1024, 512))
        
        # Background removal
        target_no_bg = remove(target_img, session=rembg_session)
        
        # Save
        filename = f"pose_{req.target_direction}_{uuid.uuid4().hex[:4]}.png"
        filepath = os.path.join(project_dir, filename)
        target_no_bg.save(filepath)
        
        # Update metadata
        if "directional_poses" not in meta: meta["directional_poses"] = {}
        meta["directional_poses"][req.target_direction] = f"/output_saves/{req.project_id}/{filename}"
        with open(meta_path, "w") as f:
            json.dump(meta, f)
            
        return {"status": "success", "url": meta["directional_poses"][req.target_direction]}
        
    except Exception as e:
        logger.error(f"Error generating directional pose: {e}")
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
