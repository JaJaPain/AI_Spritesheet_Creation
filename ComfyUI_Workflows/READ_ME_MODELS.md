# Wan 2.1 Model Setup Guide

To use the Wan 2.1 Image-to-Video workflow, you need to download and place the following models in their respective folders within `ComfyUI/models/`.

### 1. Diffusion Model (The main brain)
Place the Wan 2.1 I2V model in `models/diffusion_models/`.
- **Downloaded:** `wan2.1-i2v-14b-720p-Q4_K_M.gguf`

### 2. VAE (The image/video decoder)
Place in `models/vae/`.
- **Downloaded:** `Wan2_1_VAE_bf16.safetensors`

### 3. Text Encoder (T5)
Place in `models/text_encoders/`.
- **Downloaded:** `umt5-xxl-enc-fp8_e4m3fn.safetensors`

### 4. CLIP Vision (For Image-to-Video context)
Place in `models/clip_vision/`.
- **Downloaded:** `open-clip-xlm-roberta-large-vit-huge-14_visual_fp16.safetensors`


---

## Performance Notes for RTX 5060 Ti (16GB)
- Use **GGUF** versions of the main model if you experience "Out of Memory" errors.
- The `start_comfy.bat` is configured with `--highvram` and `--fp8_e4m3fn-text-enc` to prioritize speed while keeping the text encoder memory usage low.
- For 720p 1-3 second videos, this setup should be very stable.
