"""
Generate clean OpenPose skeleton images for a 12-frame front-facing walk cycle.
EXAGGERATED poses for clear ControlNet guidance.
"""
from PIL import Image, ImageDraw
import os, math

os.makedirs("output/ref_skeletons", exist_ok=True)
# Also create in backend output
os.makedirs("backend/output/ref_skeletons", exist_ok=True)

WIDTH, HEIGHT = 512, 512

BONE_COLORS = {
    'torso': (255, 0, 0),
    'right_arm': (255, 170, 0),
    'left_arm': (0, 255, 0),
    'right_leg': (0, 170, 255),
    'left_leg': (255, 0, 170),
    'head': (255, 255, 0),
}

def draw_skeleton(draw, joints, thickness=8):
    """Draw OpenPose-style skeleton from joint positions."""
    # Head
    draw.ellipse([joints['nose'][0]-10, joints['nose'][1]-10, joints['nose'][0]+10, joints['nose'][1]+10], fill=BONE_COLORS['head'])
    
    # Neck to nose
    draw.line([joints['neck'], joints['nose']], fill=BONE_COLORS['head'], width=thickness)
    
    # Torso
    hip_center = ((joints['r_hip'][0] + joints['l_hip'][0])//2, (joints['r_hip'][1] + joints['l_hip'][1])//2)
    draw.line([joints['neck'], hip_center], fill=BONE_COLORS['torso'], width=thickness)
    
    # Shoulders
    draw.line([joints['neck'], joints['r_shoulder']], fill=BONE_COLORS['right_arm'], width=thickness)
    draw.line([joints['neck'], joints['l_shoulder']], fill=BONE_COLORS['left_arm'], width=thickness)
    
    # Right arm
    draw.line([joints['r_shoulder'], joints['r_elbow']], fill=BONE_COLORS['right_arm'], width=thickness)
    draw.line([joints['r_elbow'], joints['r_wrist']], fill=BONE_COLORS['right_arm'], width=thickness)
    
    # Left arm
    draw.line([joints['l_shoulder'], joints['l_elbow']], fill=BONE_COLORS['left_arm'], width=thickness)
    draw.line([joints['l_elbow'], joints['l_wrist']], fill=BONE_COLORS['left_arm'], width=thickness)
    
    # Hips
    draw.line([hip_center, joints['r_hip']], fill=BONE_COLORS['right_leg'], width=thickness)
    draw.line([hip_center, joints['l_hip']], fill=BONE_COLORS['left_leg'], width=thickness)
    
    # Right leg
    draw.line([joints['r_hip'], joints['r_knee']], fill=BONE_COLORS['right_leg'], width=thickness)
    draw.line([joints['r_knee'], joints['r_ankle']], fill=BONE_COLORS['right_leg'], width=thickness)
    
    # Left leg
    draw.line([joints['l_hip'], joints['l_knee']], fill=BONE_COLORS['left_leg'], width=thickness)
    draw.line([joints['l_knee'], joints['l_ankle']], fill=BONE_COLORS['left_leg'], width=thickness)
    
    # Joint circles
    for name, pos in joints.items():
        r = 6
        draw.ellipse([pos[0]-r, pos[1]-r, pos[0]+r, pos[1]+r], fill=(255, 255, 255))


def generate_walk_frame(frame_index, total_frames=12):
    """
    Generate a walk cycle frame with EXAGGERATED movement.
    Front-facing view: legs swing left/right visibly, arms counter-swing.
    """
    t = frame_index / total_frames
    angle = t * 2 * math.pi
    
    cx = WIDTH // 2
    
    # Base positions
    head_y = 90
    neck_y = 130
    hip_y = 270
    knee_y = 360
    ankle_y = 445
    
    # Stronger vertical bob
    bob = math.sin(angle * 2) * 12
    
    # --- RIGHT LEG --- (EXAGGERATED swing: 50px instead of 30px)
    r_leg_swing = math.sin(angle) * 50
    r_knee_bend = abs(math.sin(angle)) * 25
    
    r_hip = (cx + 30, int(hip_y + bob))
    r_knee = (int(cx + 30 + r_leg_swing * 0.5), int(knee_y + bob - r_knee_bend))
    r_ankle = (int(cx + 30 + r_leg_swing), int(ankle_y + bob))
    
    # --- LEFT LEG (180° out of phase) ---
    l_leg_swing = math.sin(angle + math.pi) * 50
    l_knee_bend = abs(math.sin(angle + math.pi)) * 25
    
    l_hip = (cx - 30, int(hip_y + bob))
    l_knee = (int(cx - 30 + l_leg_swing * 0.5), int(knee_y + bob - l_knee_bend))
    l_ankle = (int(cx - 30 + l_leg_swing), int(ankle_y + bob))
    
    # --- ARMS (opposite to legs, EXAGGERATED: 35px swing) ---
    r_arm_swing = math.sin(angle + math.pi) * 35
    l_arm_swing = math.sin(angle) * 35
    
    shoulder_y = int(neck_y + 20 + bob)
    r_shoulder = (cx + 50, shoulder_y)
    l_shoulder = (cx - 50, shoulder_y)
    
    r_elbow = (int(cx + 55 + r_arm_swing * 0.5), int(shoulder_y + 50))
    r_wrist = (int(cx + 50 + r_arm_swing), int(shoulder_y + 100))
    
    l_elbow = (int(cx - 55 + l_arm_swing * 0.5), int(shoulder_y + 50))
    l_wrist = (int(cx - 50 + l_arm_swing), int(shoulder_y + 100))
    
    # Head & Neck
    nose = (cx, int(head_y + bob))
    neck = (cx, int(neck_y + bob))
    
    return {
        'nose': nose, 'neck': neck,
        'r_shoulder': r_shoulder, 'r_elbow': r_elbow, 'r_wrist': r_wrist,
        'l_shoulder': l_shoulder, 'l_elbow': l_elbow, 'l_wrist': l_wrist,
        'r_hip': r_hip, 'r_knee': r_knee, 'r_ankle': r_ankle,
        'l_hip': l_hip, 'l_knee': l_knee, 'l_ankle': l_ankle,
    }


# Generate all 12 frames and save to BOTH locations
for i in range(12):
    img = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    joints = generate_walk_frame(i, 12)
    draw_skeleton(draw, joints)
    
    for dest_dir in ["output/ref_skeletons", "backend/output/ref_skeletons"]:
        path = f"{dest_dir}/walk_front_{i:02d}.png"
        img.save(path)
    
    print(f"Generated skeleton frame {i+1}/12")

print("\nDone! Exaggerated walk cycle skeletons saved to both output directories.")
