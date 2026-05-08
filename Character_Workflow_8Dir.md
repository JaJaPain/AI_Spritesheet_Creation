# Workflow: Automated Character Splitting and Rigging for 8-Directional Animation

This document outlines a professional pipeline for transforming a character turnaround sheet into a fully rigged, 8-directional animated sprite system using Flux Fill and automated rigging standards.

## Phase 1: Segmentation and Flux Fill (The "Explosion")

To avoid mesh twinning and ensure clean deforms, the character must be "exploded" into discrete components. Using Flux Fill, we fill the gaps left behind by overlapping limbs.

### 1.1 Automated Layer Extraction
Standard practice involves using Segment Anything Model (SAM) or GroundingDINO to identify and isolate:
* **Torso:** The central anchor.
* **Limbs:** Upper Arm, Lower Arm, and Hand (L/R separately).
* **Legs:** Thigh, Calf, and Foot (L/R separately).
* **Head/Neck:** Kept as a separate floating mesh.

### 1.2 Flux Fill Inpainting
For each extracted limb, a mask is generated for the area previously hidden by the body. 
* **The Process:** Use Flux Fill to generate the "hidden" side of the joint.
* **Prompting:** Use neutral, descriptive prompts: `[limb], matching [character style], flat lighting, texture consistent with turnaround`.
* **Standard:** Use a denoising strength of 0.45–0.6 to maintain consistency while filling in the missing textures.

## Phase 2: 8-Directional Asset Mapping

For 8-directional movement (N, NE, E, SE, S, SW, W, NW), you need consistent perspectives.

1.  **Reference Rotation:** Use the turnaround to provide the Front (S), Side (E/W), and Back (N) views.
2.  **Flux Interpolation:** Use Flux Fill to generate the 45-degree angles (NE, SE, SW, NW) by providing the Front and Side views as reference context.
3.  **Mesh Separation:** Ensure each direction has its own unique set of 4-limb meshes to prevent "twinning" where movements look mirrored or unnatural.

## Phase 3: Rigging Standards

### 3.1 Discrete Mesh Construction
* **Unique IDs:** Every limb segment (e.g., Left_Thigh_N, Left_Thigh_NE) must be an independent mesh.
* **Pivot Points:** Align pivots exactly at the joints (shoulder, elbow, hip, knee) before exporting to the engine.

### 3.2 Bone Weighting
* **Rigid Weighting:** For 2D sprite systems, assign 100% weight of a limb mesh to its corresponding bone. This prevents the "rubbery" texture stretching that occurs with soft weighting.
* **Parenting Hierarchy:** Pelvis (Root) -> Torso -> Shoulders -> Arms.

## Phase 4: Fixes and Optimization

### Known Working Standards (GitHub/Workflow)
* **ComfyUI-Image-Inpainting:** Utilize nodes that support Flux.1 [fill] for seam-less joint completion.
* **LayerDivider-WS:** A popular method on GitHub for splitting character sheets into PSD layers automatically.
* **Cozy-Auto-Rig:** A known standard for assigning bone structures to 2D segmented parts.

### Fix Checklist for Current Solutions
* **Avoid Mesh Twinning:** Ensure the Left and Right limbs are not sharing vertex data.
* **Directional Z-Sorting:** Ensure the "Back" arm moves behind the torso in 3/4 views.
* **Texture Padding:** Use Flux Fill to add 2-3 pixels of "over-paint" at the joints to prevent gaps during extreme rotations.

---
*Note: Use this MD file as a reference for fixing limb deformation and automated splitting issues.*
