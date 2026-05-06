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
    StableDiffusionXLControlNetPipeline,
    ControlNetModel,
)
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

# Ensure directories exist
os.makedirs("output", exist_ok=True)
os.makedirs("templates", exist_ok=True)

# Serve generated images
app.mount("/output", StaticFiles(directory="output"), name="output")


# Create anime-optimized bg removal session (loaded once, reused)
rembg_session = new_session("isnet-anime")

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
            else:  # pose/softedge
                controlnet = ControlNetModel.from_pretrained(
                    "SargeZT/controlnet-sd-xl-1.0-softedge-dexined",
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
                pipe.set_ip_adapter_scale(0.5)
                logger.info("  IP-Adapter Plus loaded.")
            
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
                # Multiple side-by-side characters make the content wider than tall
                if passed and content_width > 0 and content_height > 0:
                    aspect = content_width / content_height
                    if aspect > 0.85:
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
        image_path = os.path.join("output", name)
        
        if not os.path.exists(image_path):
            raise HTTPException(status_code=404, detail="Anchor image not found")
        
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
        
        full_prompt = f"{prompt}, high quality, game sprite, solid bright green background, full body, front facing, neutral standing pose, arms visible at sides"
        
        # Track which slots still need a good variant
        # Each slot: { 'url': str, 'filepath': str, 'passed': bool }
        slots = [None] * num_variants
        max_retries = 3
        
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
                    "negative_prompt": "blurry, low quality, deformed, ugly, bad anatomy, extra limbs, cape, cloak, flowing fabric, wings",
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
        anchor_path = os.path.join("output", anchor_name)
        if not os.path.exists(anchor_path):
            raise HTTPException(status_code=404, detail="Anchor image not found")
        logger.info(f"  Anchor image: {anchor_path}")
        
        full_prompt = f"{prompt}, walking pose, front-facing, facing the viewer, game sprite, full body, solid bright green background, consistent character design, arms visible"
        
        seed = 42
        frame_urls = []
        generated_frames = []
        
        for i in range(len(selected)):
            logger.info(f"  Generating frame {i+1}/{len(selected)}...")
            
            # Load skeleton, convert to soft edge, resize to 1024
            skel_img = load_image(os.path.join("output", f"skel_{session_id}_{i}.png"))
            skel_gray = np.array(skel_img.convert("L"))
            skel_soft = cv2.GaussianBlur(skel_gray, (5, 5), 0)
            skeleton = Image.fromarray(skel_soft).convert("RGB").resize((1024, 1024))
            
            if manager.device == "cuda":
                torch.cuda.empty_cache()
                gc.collect()
            
            # Use SoftEdge ControlNet + IP-Adapter (anchor as reference)
            anchor_image = load_image(anchor_path).resize((1024, 1024))
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
        
        # Load skeleton and convert to soft edge
        skel_name = os.path.basename(skeleton_url)
        skel_img = load_image(os.path.join("output", skel_name))
        skel_gray = np.array(skel_img.convert("L"))
        skel_soft = cv2.GaussianBlur(skel_gray, (5, 5), 0)
        skeleton = Image.fromarray(skel_soft).convert("RGB").resize((1024, 1024))
        
        full_prompt = f"{prompt}, walking pose, front-facing, facing the viewer, game sprite, full body, solid bright green background, consistent character design, arms visible"
        
        if manager.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
        
        seed = random.randint(0, 2**32 - 1)
        logger.info(f"  Using seed {seed}")
        
        # Use SoftEdge ControlNet + IP-Adapter (anchor as reference)
        anchor_name_ref = os.path.basename(anchor_url)
        anchor_path_ref = os.path.join("output", anchor_name_ref)
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
        
        # Scale character to fit canvas height (matching original frame proportions)
        target_h = canvas_h - 20  # Leave 10px padding top and bottom
        if cropped.height > 0:
            scale = target_h / cropped.height
            new_w = int(cropped.width * scale)
            new_h = int(cropped.height * scale)
            cropped = cropped.resize((new_w, new_h), Image.LANCZOS)
        
        # Center on canvas, anchor feet to bottom (same as walk cycle)
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
            f = f.convert("RGBA")  # Ensure RGBA for mask compatibility
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
