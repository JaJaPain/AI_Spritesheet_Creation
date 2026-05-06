# Walk Cycle Experiments & Failures Log

This document logs the experimental attempts we made to fix the "tiny/pixelated walk cycle" issue, why they failed, and the final conclusion.

## The Core Problem
When passing a high-fidelity anchor sprite into the walk cycle generation pipeline, the resulting 12 frames produced characters that were incredibly tiny (taking up only ~30% of the 1024x1024 canvas). Because they were drawn so small, SDXL did not have enough pixels to render the facial details or armor geometry, resulting in a pixelated, 16-bit look that lost the characteristics of the base sprite.

---

## Attempt 1: Adjusting IP-Adapter & ControlNet Weights
*   **Action:** Decreased the `IP-Adapter` scale from `0.8` to `0.65` and increased the `ControlNet` conditioning scale from `0.8` to `1.0`.
*   **Hypothesis:** We assumed the IP-Adapter (style reference) was fighting the ControlNet (pose reference) and causing the pipeline to compress the character.
*   **Result (Failure):** The generated walk cycle frames were still tiny and pixelated.
*   **Takeaway:** The weights were not the root cause. The root cause was that SDXL was faithfully tracing the pre-made OpenPose skeleton, and the pre-made skeleton was physically tiny.

---

## Attempt 2: Dynamically Scaling the Skeleton (LANCZOS)
*   **Action:** Added Python logic to `animate_openpose` to find the bounding box of the skeleton, crop out the massive black margins, and scale the skeleton up to fill the 1024x1024 canvas using `Image.LANCZOS`.
*   **Hypothesis:** If we force the skeleton to be massive, SDXL will be forced to draw a massive, high-fidelity character to wrap around those bones.
*   **Result (Failure):** The AI hallucinated a horrifying "fractal totem pole" of multiple characters stacked on top of each other.
*   **Takeaway:** The `LANCZOS` algorithm uses anti-aliasing. When it scaled up the skeleton, it blurred the sharp, colored neon lines of the bones. ControlNet requires mathematically exact RGB colors for the joints. The blurry lines completely broke the ControlNet model, causing SDXL to panic and hallucinate multiple characters to fill the void.

---

## Attempt 3: Dynamically Scaling the Skeleton (NEAREST) + Negative Prompts
*   **Action:** Re-implemented the skeleton scaling, but this time using `Image.NEAREST` to prevent blurring and keep the RGB colors mathematically pure. We also injected aggressive negative prompts (`multiple characters, twins, clones, tiny people`).
*   **Hypothesis:** Nearest-neighbor scaling would keep the skeleton lines sharp enough for ControlNet to read, while the negative prompt would stop the fractal stacking.
*   **Result (Failure):** SDXL drew one large main character to satisfy the text prompt, but then hallucinated tiny "baby" versions of the character sitting on her knees/legs where the original skeleton lines used to be.
*   **Takeaway:** Even though the colors were pure, scaling up the image made the skeleton lines extremely thick and jagged. ControlNet is trained on standard, thin line weights. The massive, blocky lines still corrupted the guidance, causing SDXL to misinterpret the structure.

---

## The Final Conclusion
**The pre-made `walk_front_X.png` skeleton images in the `output/ref_skeletons` directory are fundamentally incompatible with high-fidelity SDXL generation.** 

Because the skeletons were drawn incredibly small in the center of a massive 1024x1024 canvas, strictly enforcing them forces the AI to draw tiny characters. We cannot mathematically scale them up using Python because modifying the structural line weights and pixel boundaries breaks the OpenPose ControlNet encoding. 

### Next Steps for a True Walk Cycle
To achieve a high-fidelity walk cycle, we must replace the pre-made skeletons. We need to generate or source proper, full-screen OpenPose skeleton templates where the skeletal lines naturally fill the 1024x1024 frame.
