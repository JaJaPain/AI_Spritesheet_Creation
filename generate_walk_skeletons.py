"""
Generate clean OpenPose skeleton images for a 12-frame front-facing walk cycle.
These are programmatically drawn stick figures with the correct joint positions
for each phase of a walk cycle, matching standard animation reference sheets.

Walk cycle phases (12 frames):
  1-2: Right foot contact & weight shift
  3-4: Right leg passing, left push-off
  5-6: Right leg swing forward, left contact
  7-8: Left foot contact & weight shift
  9-10: Left leg passing, right push-off
  11-12: Left leg swing forward, right contact (loop back to 1)
"""
from PIL import Image, ImageDraw
import os, math

os.makedirs("output/ref_skeletons", exist_ok=True)

WIDTH, HEIGHT = 512, 512

# OpenPose format: draw colored lines between keypoints on black background
# Colors match OpenPose convention
BONE_COLORS = {
    'torso': (255, 0, 0),        # Red
    'right_arm': (255, 170, 0),  # Orange
    'left_arm': (0, 255, 0),     # Green
    'right_leg': (0, 170, 255),  # Light blue
    'left_leg': (255, 0, 170),   # Pink
    'head': (255, 255, 0),       # Yellow
}

def lerp(a, b, t):
    return a + (b - a) * t

def draw_skeleton(draw, joints, thickness=6):
    """Draw OpenPose-style skeleton from joint positions."""
    # Head
    draw.ellipse([joints['nose'][0]-8, joints['nose'][1]-8, joints['nose'][0]+8, joints['nose'][1]+8], fill=BONE_COLORS['head'])
    
    # Neck to nose
    draw.line([joints['neck'], joints['nose']], fill=BONE_COLORS['head'], width=thickness)
    
    # Torso (neck to hip center)
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
    
    # Draw joint circles
    for name, pos in joints.items():
        r = 5
        draw.ellipse([pos[0]-r, pos[1]-r, pos[0]+r, pos[1]+r], fill=(255, 255, 255))


def generate_walk_frame(frame_index, total_frames=12):
    """
    Generate a single walk cycle frame.
    For a front-facing walk, the main movement is:
    - Legs swing left/right (knee spread)
    - Arms swing opposite to legs
    - Slight torso bob up/down
    - Subtle shoulder rotation
    """
    t = frame_index / total_frames  # 0.0 to ~0.917
    angle = t * 2 * math.pi  # Full cycle
    
    cx = WIDTH // 2  # Center x
    
    # Base positions
    head_y = 100
    neck_y = 135
    hip_y = 280
    knee_y = 370
    ankle_y = 450
    
    # Vertical bob (body goes up when legs pass, down at contact)
    bob = math.sin(angle * 2) * 8
    
    # --- RIGHT LEG ---
    # Right leg swings forward (appears to go RIGHT from camera view when stepping)
    r_leg_swing = math.sin(angle) * 30  # horizontal swing
    r_knee_bend = abs(math.sin(angle)) * 15  # knee bends more during swing
    
    r_hip = (cx + 25, int(hip_y + bob))
    r_knee = (int(cx + 25 + r_leg_swing * 0.6), int(knee_y + bob - r_knee_bend))
    r_ankle = (int(cx + 25 + r_leg_swing), int(ankle_y + bob))
    
    # --- LEFT LEG (180 degrees out of phase) ---
    l_leg_swing = math.sin(angle + math.pi) * 30
    l_knee_bend = abs(math.sin(angle + math.pi)) * 15
    
    l_hip = (cx - 25, int(hip_y + bob))
    l_knee = (int(cx - 25 + l_leg_swing * 0.6), int(knee_y + bob - l_knee_bend))
    l_ankle = (int(cx - 25 + l_leg_swing), int(ankle_y + bob))
    
    # --- ARMS (opposite to legs) ---
    r_arm_swing = math.sin(angle + math.pi) * 20  # opposite to right leg
    l_arm_swing = math.sin(angle) * 20  # opposite to left leg
    
    shoulder_y = int(neck_y + 15 + bob)
    r_shoulder = (cx + 45, shoulder_y)
    l_shoulder = (cx - 45, shoulder_y)
    
    r_elbow = (int(cx + 50 + r_arm_swing * 0.4), int(shoulder_y + 50))
    r_wrist = (int(cx + 48 + r_arm_swing), int(shoulder_y + 95))
    
    l_elbow = (int(cx - 50 + l_arm_swing * 0.4), int(shoulder_y + 50))
    l_wrist = (int(cx - 48 + l_arm_swing), int(shoulder_y + 95))
    
    # --- HEAD & NECK ---
    nose = (cx, int(head_y + bob))
    neck = (cx, int(neck_y + bob))
    
    joints = {
        'nose': nose, 'neck': neck,
        'r_shoulder': r_shoulder, 'r_elbow': r_elbow, 'r_wrist': r_wrist,
        'l_shoulder': l_shoulder, 'l_elbow': l_elbow, 'l_wrist': l_wrist,
        'r_hip': r_hip, 'r_knee': r_knee, 'r_ankle': r_ankle,
        'l_hip': l_hip, 'l_knee': l_knee, 'l_ankle': l_ankle,
    }
    
    return joints


# Generate all 12 frames
for i in range(12):
    img = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    joints = generate_walk_frame(i, 12)
    draw_skeleton(draw, joints)
    
    path = f"output/ref_skeletons/walk_front_{i:02d}.png"
    img.save(path)
    print(f"Generated skeleton frame {i+1}/12: {path}")

print("\nDone! 12 walk cycle skeleton frames saved to output/ref_skeletons/")
print("These can be used directly as ControlNet input (no OpenPose detection needed).")
