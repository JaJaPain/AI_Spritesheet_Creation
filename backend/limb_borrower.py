import cv2
import numpy as np
from PIL import Image
import math

def borrow_and_warp_limb(src_img: Image.Image, src_joints: dict, dst_joints: dict, limb_name: str):
    """
    Takes a limb from a source image and warps it to fit the target joints.
    Used for borrowing clean limbs from Front/Back views into Side views.
    """
    src_arr = np.array(src_img.convert("RGBA"))
    h, w = src_arr.shape[:2]
    
    # Define the reference bone for this limb to calculate rotation/scale
    # e.g., for 'arm_l', use shoulder_l -> elbow_l
    bone_map = {
        "upper_arm_l": ("shoulder_l", "elbow_l"),
        "lower_arm_l": ("elbow_l", "wrist_l"),
        "upper_arm_r": ("shoulder_r", "elbow_r"),
        "lower_arm_r": ("elbow_r", "wrist_r"),
        "thigh_l": ("hip_l", "knee_l"),
        "calf_l": ("knee_l", "ankle_l"),
        "thigh_r": ("hip_r", "knee_r"),
        "calf_r": ("knee_r", "ankle_r"),
        "torso": ("shoulder_l", "shoulder_r"),
        "head": ("nose", "nose") # Static
    }
    
    if limb_name not in bone_map:
        return src_img # Fallback
        
    j1_n, j2_n = bone_map[limb_name]
    
    # Get src and dst bone vectors
    try:
        s1 = np.array([src_joints[j1_n]["x"] * w, src_joints[j1_n]["y"] * h])
        s2 = np.array([src_joints[j2_n]["x"] * w, src_joints[j2_n]["y"] * h])
        
        d1 = np.array([dst_joints[j1_n]["x"] * w, dst_joints[j1_n]["y"] * h])
        d2 = np.array([dst_joints[j2_n]["x"] * w, dst_joints[j2_n]["y"] * h])
    except KeyError:
        return src_img # Missing joints
        
    # Calculate transform
    # We want d1 to match s1, and vector (d2-d1) to match scaled/rotated (s2-s1)
    src_vec = s2 - s1
    dst_vec = d2 - d1
    
    src_len = np.linalg.norm(src_vec)
    dst_len = np.linalg.norm(dst_vec)
    
    if src_len < 1e-5: return src_img
    
    scale = dst_len / src_len
    angle_src = math.atan2(src_vec[1], src_vec[0])
    angle_dst = math.atan2(dst_vec[1], dst_vec[0])
    angle_diff = math.degrees(angle_dst - angle_src)
    
    # Construct affine matrix for rotation and scaling around s1
    M = cv2.getRotationMatrix2D(tuple(s1), angle_diff, scale)
    
    # Add translation to move s1 to d1
    M[0, 2] += (d1[0] - s1[0])
    M[1, 2] += (d1[1] - s1[1])
    
    # Warp
    warped = cv2.warpAffine(src_arr, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0,0,0,0))
    
    return Image.fromarray(warped)
