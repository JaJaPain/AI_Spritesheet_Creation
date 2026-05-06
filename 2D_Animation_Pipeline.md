# 2D Skeletal Animation Pipeline: Turnaround to Walk-Cycle

This document outlines the technical architecture for slicing a character turnaround, rigging it with a skeletal system, and generating a deformable walk cycle.

## Phase 1: Sprite Segmentation (The Slicer)
**Input:** Single image containing multiple views (turnaround).
**Process:**
- Use **OpenCV** to perform thresholding and contour detection.
- Map the bounding boxes of each character view.
- Convert the solid black background to an Alpha channel (Transparency) to allow for clean layering.
- **Data Output:** `List[SpriteSlice]` containing the cropped image and its global coordinates.

## Phase 2: Rigging & Mesh Generation
**Concept:** Turn a flat 2D slice into a flexible "skin" over a bone hierarchy.
- **Mesh Creation:** Generate a **Delaunay Triangulation** mesh over the silhouette. Vertices are placed at the edges and strategically at joint areas (knees, elbows, hips).
- **Bone Hierarchy:**
    - Root (Hips) -> Torso -> Neck/Head
    - Root (Hips) -> Thigh -> Shin -> Foot
- **Weighting:** Each vertex in the mesh is assigned an "influence" value based on its distance to the nearest bones.

## Phase 3: The Rigging GUI (Manual Adjustment)
**Purpose:** Since "Auto-Rigging" is rarely perfect, the user needs a visual interface.
- **Interface:** A window (using `Pygame` or `Tkinter` integrated with `Matplotlib`) showing the sprite slice.
- **Interaction:**
    - Click to place "Joints."
    - Drag joints to adjust bone lengths and rest angles.
    - Save the configuration to a `rig_config.json` file.

## Phase 4: Animation & Deformable Walk Cycle
**Mechanism:** Use **Inverse Kinematics (IK)** for leg placement and **Linear Blend Skinning** for pixel deformation.
- **The Walk Cycle Loop:**
    - **Contact Phase:** Both feet on ground.
    - **Passing Phase:** One leg swinging forward.
    - **Variables:** Step height, stride length, and "bounce" (vertical hip movement).
- **Deformation:** As bones move, the `cv2.getAffineTransform` or a custom shader warps the triangle mesh, bending the sprite pixels accordingly.

## Phase 5: Live Animation Tuner
**Purpose:** Allow the user to "feel" the walk and tweak it in real-time.
- **Sliders for:**
    - **Speed:** Time-scale of the loop.
    - **Stride:** How far the legs reach.
    - **Lean:** Forward/backward tilt of the torso.
- **Live Preview:** The character walks in place on the screen, updating instantly as sliders move.

---
*Generated for the Antigravity Workflow*
