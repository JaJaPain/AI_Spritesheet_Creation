"""
Generate proper front-facing walk cycle skeleton images.

A front-facing walk cycle has subtle but important movements:
- Legs alternate stepping forward (from front view: slight lateral spread)
- Arms swing opposite to legs (slight swing forward/back shown as lateral movement)
- Slight torso bob (up during passing, down during contact)
- Feet stay grounded — no splits or exaggerated poses

12-frame cycle: Contact(L) → Down → Passing → Up → Contact(R) → Down → Passing → Up → repeat
"""

import numpy as np
from PIL import Image, ImageDraw
import os
import math

# Canvas settings
W, H = 512, 512
JOINT_RADIUS = 6
LINE_WIDTH = 5

# OpenPose color convention
COLORS = {
    'spine': (255, 0, 0),        # Red - torso/spine
    'right_arm': (255, 165, 0),  # Orange
    'left_arm': (0, 128, 0),     # Green  
    'right_leg': (0, 150, 255),  # Blue
    'left_leg': (255, 0, 255),   # Magenta
    'head': (255, 255, 0),       # Yellow
    'joint': (255, 255, 255),    # White dots
}

def draw_skeleton(joints, draw):
    """Draw an OpenPose-style skeleton from joint positions."""
    
    # Define connections: (joint1, joint2, color_key)
    connections = [
        # Spine
        ('head', 'neck', 'head'),
        ('neck', 'mid_spine', 'spine'),
        ('mid_spine', 'hip_center', 'spine'),
        
        # Right arm (orange)
        ('neck', 'r_shoulder', 'right_arm'),
        ('r_shoulder', 'r_elbow', 'right_arm'),
        ('r_elbow', 'r_wrist', 'right_arm'),
        
        # Left arm (green)
        ('neck', 'l_shoulder', 'left_arm'),
        ('l_shoulder', 'l_elbow', 'left_arm'),
        ('l_elbow', 'l_wrist', 'left_arm'),
        
        # Right leg (blue)
        ('hip_center', 'r_hip', 'right_leg'),
        ('r_hip', 'r_knee', 'right_leg'),
        ('r_knee', 'r_ankle', 'right_leg'),
        
        # Left leg (magenta)
        ('hip_center', 'l_hip', 'left_leg'),
        ('l_hip', 'l_knee', 'left_leg'),
        ('l_knee', 'l_ankle', 'left_leg'),
    ]
    
    # Draw limb connections
    for j1, j2, color_key in connections:
        if j1 in joints and j2 in joints:
            x1, y1 = joints[j1]
            x2, y2 = joints[j2]
            draw.line([(x1, y1), (x2, y2)], fill=COLORS[color_key], width=LINE_WIDTH)
    
    # Draw joint dots
    for name, (x, y) in joints.items():
        r = JOINT_RADIUS if name != 'head' else JOINT_RADIUS + 4
        color = COLORS['head'] if name == 'head' else COLORS['joint']
        draw.ellipse([x-r, y-r, x+r, y+r], fill=color)


def generate_walk_frame(frame_index, total_frames=12):
    """
    Generate a single walk cycle frame.
    
    Front-facing walk cycle key poses:
    - Contact: One leg forward, one back (from front: slight lateral offset)
    - Passing: Legs together, body at highest point
    - The motion is SUBTLE from the front view
    """
    img = Image.new('RGB', (W, H), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Phase through the walk cycle (0 to 2*pi)
    phase = (frame_index / total_frames) * 2 * math.pi
    
    # Center of the figure
    cx = W // 2
    
    # --- Vertical bob (body goes up during passing, down during contact) ---
    bob = math.sin(2 * phase) * 4  # Subtle 4px bob
    
    # Base Y positions (from top to bottom)
    head_y = 95 - bob
    neck_y = 130 - bob
    mid_spine_y = 190 - bob
    hip_y = 250 - bob
    
    # --- Head and spine (stays mostly centered) ---
    # Slight torso sway
    torso_sway = math.sin(phase) * 3
    
    joints = {}
    joints['head'] = (cx + torso_sway, head_y)
    joints['neck'] = (cx + torso_sway, neck_y)
    joints['mid_spine'] = (cx + torso_sway * 0.5, mid_spine_y)
    joints['hip_center'] = (cx, hip_y)
    
    # --- Shoulders (slight rotation with walk) ---
    shoulder_width = 45
    shoulder_twist = math.sin(phase) * 5  # Shoulders rotate opposite to hips
    
    joints['r_shoulder'] = (cx + shoulder_width + shoulder_twist, neck_y + 5)
    joints['l_shoulder'] = (cx - shoulder_width + shoulder_twist, neck_y + 5)
    
    # --- Arms swing opposite to legs ---
    # Right arm swings forward when left leg is forward (and vice versa)
    r_arm_swing = math.sin(phase) * 15  # Lateral swing (from front view)
    l_arm_swing = math.sin(phase + math.pi) * 15
    
    # Right arm
    r_elbow_x = cx + shoulder_width + 10 + r_arm_swing * 0.6
    r_elbow_y = neck_y + 60 - bob
    joints['r_elbow'] = (r_elbow_x, r_elbow_y)
    joints['r_wrist'] = (r_elbow_x + r_arm_swing * 0.4, r_elbow_y + 50)
    
    # Left arm
    l_elbow_x = cx - shoulder_width - 10 + l_arm_swing * 0.6
    l_elbow_y = neck_y + 60 - bob
    joints['l_elbow'] = (l_elbow_x, l_elbow_y)
    joints['l_wrist'] = (l_elbow_x + l_arm_swing * 0.4, l_elbow_y + 50)
    
    # --- Hips (slight rotation) ---
    hip_width = 25
    hip_twist = math.sin(phase) * 4  # Opposite to shoulders
    
    joints['r_hip'] = (cx + hip_width - hip_twist, hip_y + 5)
    joints['l_hip'] = (cx - hip_width - hip_twist, hip_y + 5)
    
    # --- Legs ---
    # Front-facing walk: each leg alternates stepping forward
    # From the front, "forward" = slightly outward + foot lifts
    # "Back" = slightly inward + foot planted
    
    foot_y = 430  # Ground level
    
    # Right leg phase: forward at phase=0, back at phase=pi
    r_phase = phase
    # When stepping forward (sin > 0): knee goes out, foot lifts
    # When planted (sin < 0): knee stays straight, foot down
    r_sin = math.sin(r_phase)
    
    r_knee_out = r_sin * 15  # Positive = outward, negative = inward
    r_knee_up = max(0, r_sin) * 18  # Only lifts when swinging forward
    r_foot_out = r_sin * 10
    r_foot_up = max(0, r_sin) * 10
    
    joints['r_knee'] = (cx + 25 + r_knee_out, hip_y + 80 - r_knee_up)
    joints['r_ankle'] = (cx + 18 + r_foot_out, foot_y - r_foot_up)
    
    # Left leg: exactly mirrored (opposite phase, mirrored X)
    l_phase = phase + math.pi
    l_sin = math.sin(l_phase)
    
    l_knee_out = l_sin * 15  # Positive here = leftward (outward for left leg)
    l_knee_up = max(0, l_sin) * 18
    l_foot_out = l_sin * 10
    l_foot_up = max(0, l_sin) * 10
    
    joints['l_knee'] = (cx - 25 - l_knee_out, hip_y + 80 - l_knee_up)
    joints['l_ankle'] = (cx - 18 - l_foot_out, foot_y - l_foot_up)
    
    # Draw the skeleton
    draw_skeleton(joints, draw)
    
    return img


def main():
    out_dir = os.path.join("output", "ref_skeletons")
    os.makedirs(out_dir, exist_ok=True)
    
    total_frames = 12
    
    for i in range(total_frames):
        img = generate_walk_frame(i, total_frames)
        path = os.path.join(out_dir, f"walk_front_{i:02d}.png")
        img.save(path)
        print(f"Generated: {path}")
    
    print(f"\nDone! Generated {total_frames} walk cycle skeleton frames.")


if __name__ == "__main__":
    main()
