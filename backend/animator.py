import cv2
import numpy as np
from PIL import Image
import os
import math
from scipy.spatial import Delaunay

EXPANDED_HIERARCHY = {
    "head": ["nose"],
    "torso": ["shoulder_l", "shoulder_r", "hip_l", "hip_r"],
    "upper_arm_l": ["shoulder_l", "elbow_l"],
    "lower_arm_l": ["elbow_l", "wrist_l"],
    "hand_l": ["wrist_l"],
    "upper_arm_r": ["shoulder_r", "elbow_r"],
    "lower_arm_r": ["elbow_r", "wrist_r"],
    "hand_r": ["wrist_r"],
    "thigh_l": ["hip_l", "knee_l"],
    "calf_l": ["knee_l", "ankle_l"],
    "foot_l": ["ankle_l", "foot_l"],
    "thigh_r": ["hip_r", "knee_r"],
    "calf_r": ["knee_r", "ankle_r"],
    "foot_r": ["ankle_r", "foot_r"]
}

LIMB_HIERARCHY = EXPANDED_HIERARCHY # Transitioning to expanded standard

class HierarchicalAnimator:
    """
    Industry Standard: Paper Doll Animator.
    Uses discrete sprite segments and a bone hierarchy with rigid weighting.
    """
    def __init__(self, segments: dict, joints: dict):
        """
        segments: {limb_name: PIL.Image}
        joints: {joint_name: {"x": normalized_x, "y": normalized_y}}
        """
        self.segments = segments
        self.joints = joints
        
        # Parent-Child Hierarchy (The "Paper Doll" structure)
        self.hierarchy = {
            "torso": {"parent": None, "pivot": "hip_l"}, # Heuristic pivot
            "head": {"parent": "torso", "pivot": "nose"},
            "upper_arm_l": {"parent": "torso", "pivot": "shoulder_l"},
            "lower_arm_l": {"parent": "upper_arm_l", "pivot": "elbow_l"},
            "hand_l": {"parent": "lower_arm_l", "pivot": "wrist_l"},
            "upper_arm_r": {"parent": "torso", "pivot": "shoulder_r"},
            "lower_arm_r": {"parent": "upper_arm_r", "pivot": "elbow_r"},
            "hand_r": {"parent": "lower_arm_r", "pivot": "wrist_r"},
            "thigh_l": {"parent": None, "pivot": "hip_l"},
            "calf_l": {"parent": "thigh_l", "pivot": "knee_l"},
            "foot_l": {"parent": "calf_l", "pivot": "ankle_l"},
            "thigh_r": {"parent": None, "pivot": "hip_r"},
            "calf_r": {"parent": "thigh_r", "pivot": "knee_r"},
            "foot_r": {"parent": "calf_r", "pivot": "ankle_r"}
        }

    def render(self, pose_joints: dict, direction: str = "S"):
        """
        Renders the character in a specific pose and direction.
        direction: "N", "NE", "E", "SE", "S", "SW", "W", "NW"
        """
        # 1. Determine Z-Order based on direction
        z_order = self._get_z_order(direction)
        
        # Determine canvas size (use torso as anchor)
        w, h = 1024, 1024 # Standard working canvas
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        
        # 2. Render each segment
        for segment_name in z_order:
            if segment_name not in self.segments: continue
            
            img = self.segments[segment_name]
            pivot_name = self.hierarchy[segment_name]["pivot"]
            
            if pivot_name not in pose_joints: continue
            
            # Target pivot location (normalized to pixels)
            target_p = pose_joints[pivot_name]
            tx = target_p["x"] * w
            ty = target_p["y"] * h
            
            # Determine rotation
            angle = self._calculate_segment_angle(segment_name, pose_joints)
            
            rotated = img.rotate(-angle, resample=Image.BICUBIC, expand=True)
            canvas.alpha_composite(rotated, (int(tx - rotated.width//2), int(ty - rotated.height//2)))
            
        return canvas

    def _get_z_order(self, direction):
        """Returns segment names from back to front."""
        full = ["hand_l", "lower_arm_l", "upper_arm_l", "foot_l", "calf_l", "thigh_l", "torso", "head", "thigh_r", "calf_r", "foot_r", "upper_arm_r", "lower_arm_r", "hand_r"]
        if "N" in direction: return full
        if "E" in direction: return [s for s in full if "_l" in s] + ["torso", "head"] + [s for s in full if "_r" in s]
        if "W" in direction: return [s for s in full if "_r" in s] + ["torso", "head"] + [s for s in full if "_l" in s]
        return full

    def _calculate_segment_angle(self, segment_name, joints):
        hierarchy_entry = LIMB_HIERARCHY.get(segment_name, [])
        if len(hierarchy_entry) < 2: return 0
        p1, p2 = joints.get(hierarchy_entry[0]), joints.get(hierarchy_entry[1])
        if not p1 or not p2: return 0
        return math.degrees(math.atan2(p2["y"] - p1["y"], p2["x"] - p1["x"])) - 90


class AffineMeshAnimator:
    def __init__(self, image: Image.Image, joints: dict):
        """
        Initializes the animator with a sprite image and its rest-pose joints.
        joints: dict of {name: {"x": normalized_x, "y": normalized_y}}
        """
        self.base_image = np.array(image.convert("RGBA"))
        self.h, self.w = self.base_image.shape[:2]
        
        # Convert normalized joints to pixel coordinates
        self.rest_joints = {
            name: np.array([j["x"] * self.w, j["y"] * self.h])
            for name, j in joints.items()
        }
        
        self.rest_joints_raw = joints # Save for layered recursion
        
        self.mesh_points = None
        self.triangles = None
        self.vertex_weights = None # Weights for each vertex relative to joints/bones
        
        self._generate_mesh()
        self._calculate_weights()

    def _generate_mesh(self, grid_size=32):
        """Generates a triangular mesh over the character silhouette."""
        # 1. Create a grid of points
        x = np.linspace(0, self.w, self.w // grid_size + 2)
        y = np.linspace(0, self.h, self.h // grid_size + 2)
        xv, yv = np.meshgrid(x, y)
        points = np.vstack([xv.ravel(), yv.ravel()]).T
        
        # 2. Add joint positions as specific vertices to ensure they move accurately
        joint_points = np.array(list(self.rest_joints.values()))
        all_points = np.vstack([points, joint_points])
        
        # 3. Triangulate
        tri = Delaunay(all_points)
        self.mesh_points = all_points
        self.triangles = tri.simplices

    def _calculate_weights(self):
        """Assigns vertex weights based on proximity to joints."""
        # Simple Inverse Distance Weighting (IDW) for now
        # Future: Real skeletal weighting with bone segments
        num_vertices = len(self.mesh_points)
        joint_names = list(self.rest_joints.keys())
        num_joints = len(joint_names)
        
        weights = np.zeros((num_vertices, num_joints))
        
        for i, v in enumerate(self.mesh_points):
            distances = []
            for name in joint_names:
                dist = np.linalg.norm(v - self.rest_joints[name])
                distances.append(max(0.1, dist)) # Avoid div by zero
            
            # Inverse distance
            inv_dist = 1.0 / np.power(distances, 2)
            weights[i] = inv_dist / np.sum(inv_dist)
            
        self.vertex_weights = weights

    def deform_layered(self, limb_images: dict, target_joints: dict):
        """
        Deforms multiple limb layers separately and stacks them.
        limb_images: {limb_name: PIL.Image}
        """
        # Z-Order for 2D animation
        z_order = ["arm_l", "leg_l", "torso", "leg_r", "arm_r"]
        
        # Check if we should flip Z-order for side views (depending on orientation)
        # For now, stick to standard: Back limbs first
        
        final_canvas = Image.new("RGBA", (self.w, self.h), (0,0,0,0))
        
        for limb_name in z_order:
            if limb_name not in limb_images: continue
            
            # Create a sub-animator for this specific limb
            # We use the same rest_joints but only the limb image
            sub_anim = AffineMeshAnimator(limb_images[limb_name], self.rest_joints_raw)
            warped_limb = sub_anim.deform(target_joints)
            
            final_canvas.alpha_composite(warped_limb)
            
        return final_canvas

    def deform(self, target_joints: dict):
        """
        Warps the base image to match new joint positions.
        target_joints: dict of {name: [px_x, px_y]} or normalized
        """
        # 1. Calculate new vertex positions
        new_points = np.zeros_like(self.mesh_points)
        joint_names = list(self.rest_joints.keys())
        
        # Determine if targets are normalized or pixels
        first_val = list(target_joints.values())[0]
        is_normalized = (isinstance(first_val, dict) and first_val["x"] <= 1.0) or \
                        (isinstance(first_val, (list, np.ndarray)) and first_val[0] <= 1.0)

        t_joints = {}
        for name in joint_names:
            val = target_joints.get(name, self.rest_joints[name])
            if is_normalized:
                if isinstance(val, dict):
                    t_joints[name] = np.array([val["x"] * self.w, val["y"] * self.h])
                else:
                    t_joints[name] = np.array([val[0] * self.w, val[1] * self.h])
            else:
                t_joints[name] = np.array(val)

        # Move vertices based on weights
        for i in range(len(self.mesh_points)):
            offset = np.zeros(2)
            for j_idx, name in enumerate(joint_names):
                j_move = t_joints[name] - self.rest_joints[name]
                offset += self.vertex_weights[i, j_idx] * j_move
            new_points[i] = self.mesh_points[i] + offset

        # 2. Warp image triangles
        # We'll use a canvas and draw the warped triangles
        out_image = np.zeros_like(self.base_image)
        
        for tri in self.triangles:
            # Ensure we have exactly 3 points
            if len(tri) != 3: continue
            
            src_tri = self.mesh_points[tri].astype(np.float32)
            dst_tri = new_points[tri].astype(np.float32)
            
            # Bounding box of the triangle to speed up
            src_rect = cv2.boundingRect(src_tri)
            dst_rect = cv2.boundingRect(dst_tri)
            
            if src_rect[2] <= 0 or src_rect[3] <= 0 or dst_rect[2] <= 0 or dst_rect[3] <= 0:
                continue

            # Crop to bounding box
            src_tri_cropped = (src_tri - (src_rect[0], src_rect[1])).astype(np.float32)
            dst_tri_cropped = (dst_tri - (dst_rect[0], dst_rect[1])).astype(np.float32)
            
            try:
                src_crop = self.base_image[src_rect[1]:src_rect[1]+src_rect[3], src_rect[0]:src_rect[0]+src_rect[2]]
                if src_crop.size == 0: continue
                
                affine_mat = cv2.getAffineTransform(src_tri_cropped.astype(np.float32)[:3], dst_tri_cropped.astype(np.float32)[:3])
                warped_crop = cv2.warpAffine(src_crop, affine_mat, (dst_rect[2], dst_rect[3]), None, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
                
                # Mask the warped triangle
                mask = np.zeros((dst_rect[3], dst_rect[2]), dtype=np.uint8)
                cv2.fillConvexPoly(mask, dst_tri_cropped.astype(np.int32), 255)
                
                # Copy to output
                mask_float = mask.astype(float) / 255.0
                y1, y2 = dst_rect[1], dst_rect[1] + dst_rect[3]
                x1, x2 = dst_rect[0], dst_rect[0] + dst_rect[2]
                
                # Clip to image size
                y1_c, y2_c = max(0, y1), min(self.h, y2)
                x1_c, x2_c = max(0, x1), min(self.w, x2)
                
                if y2_c > y1_c and x2_c > x1_c:
                    mask_c = mask[y1_c-y1:y2_c-y1, x1_c-x1:x2_c-x1]
                    warped_c = warped_crop[y1_c-y1:y2_c-y1, x1_c-x1:x2_c-x1]
                    
                    # Apply mask (RGBA)
                    m = mask_c > 0
                    out_image[y1_c:y2_c, x1_c:x2_c][m] = warped_c[m]
            except Exception:
                continue # Skip degenerate or problematic triangles
                    
        return Image.fromarray(out_image)

    def extract_limbs_advanced(self, overlap_padding=15):
        """
        Industry Standard: Partitions the silhouette into discrete, non-overlapping segments.
        Uses the distance transform to find the nearest bone for every pixel in the character.
        """
        # 1. Prepare shared data
        alpha_mask = self.base_image[:, :, 3]
        num_segments = len(LIMB_HIERARCHY)
        segment_names = list(LIMB_HIERARCHY.keys())
        
        # 2. Create "Bone Seeds"
        # We create a map where each pixel value is the distance to the nearest bone of that type
        # Initializing with a large distance
        distance_maps = np.full((num_segments, self.h, self.w), 1e6, dtype=np.float32)
        
        for idx, (limb_name, joint_list) in enumerate(LIMB_HIERARCHY.items()):
            # Create a mask for this bone
            bone_mask = np.zeros((self.h, self.w), dtype=np.uint8)
            
            # Special case for torso (polygon)
            if limb_name == "torso":
                core_joints = ["shoulder_l", "shoulder_r", "hip_r", "hip_l"]
                pts = [self.rest_joints[name].astype(np.int32) for name in core_joints if name in self.rest_joints]
                if len(pts) >= 3:
                    cv2.fillPoly(bone_mask, [np.array(pts)], 255)
            else:
                # Draw lines between joints for this segment
                for i in range(len(joint_list) - 1):
                    j1, j2 = joint_list[i], joint_list[i+1]
                    if j1 in self.rest_joints and j2 in self.rest_joints:
                        p1 = tuple(self.rest_joints[j1].astype(np.int32))
                        p2 = tuple(self.rest_joints[j2].astype(np.int32))
                        cv2.line(bone_mask, p1, p2, 255, 1)
                
                # Single joint segments (like head or hands)
                if len(joint_list) == 1:
                    j = joint_list[0]
                    if j in self.rest_joints:
                        p = tuple(self.rest_joints[j].astype(np.int32))
                        cv2.circle(bone_mask, p, 5, 255, -1)
            
            # Distance Transform: Get distance from every pixel to this bone
            # Note: distTransform works on inverted binary images (0=target, 255=background)
            inv_bone_mask = cv2.bitwise_not(bone_mask)
            dist = cv2.distanceTransform(inv_bone_mask, cv2.DIST_L2, 5)
            distance_maps[idx] = dist

        # 3. Partitioning: Assign each pixel to the nearest bone
        # Find the index of the minimum distance for each pixel
        partition_labels = np.argmin(distance_maps, axis=0)
        
        # 4. Extract Limbs
        limbs = {}
        for idx, name in enumerate(segment_names):
            # Create mask for this segment
            seg_mask = (partition_labels == idx).astype(np.uint8) * 255
            
            # Constrain to the character silhouette
            seg_mask = cv2.bitwise_and(seg_mask, alpha_mask)
            
            # Add padding/overlap for joint completion
            # This ensures segments overlap slightly to prevent gaps during rotation
            if overlap_padding > 0:
                kernel = np.ones((overlap_padding, overlap_padding), np.uint8)
                seg_mask = cv2.dilate(seg_mask, kernel, iterations=1)
                # Re-constrain to character silhouette (optional, but keeps it clean)
                seg_mask = cv2.bitwise_and(seg_mask, alpha_mask)

            # Create the sprite
            limb_img = np.zeros_like(self.base_image)
            limb_img[:, :, :3] = self.base_image[:, :, :3]
            limb_img[:, :, 3] = seg_mask
            
            # Crop to content for efficiency
            img_pil = Image.fromarray(limb_img)
            bbox = img_pil.getbbox()
            if bbox:
                limbs[name] = img_pil.crop(bbox)
            else:
                # Fallback if segment is empty
                limbs[name] = img_pil
                
        return limbs

    def extract_limbs(self, thickness=40):
        # Keeping for backward compatibility, but routing to advanced
        return self.extract_limbs_advanced()

def create_walk_cycle(animator: AffineMeshAnimator, stride=0.2, bounce=0.05, num_frames=12):
    """Generates a series of walk cycle frames."""
    frames = []
    
    # Base joints from the animator
    base_joints = {name: pos.copy() for name, pos in animator.rest_joints.items()}
    
    for f in range(num_frames):
        phase = 2 * math.pi * (f / num_frames)
        
        t_joints = {}
        for name, pos in base_joints.items():
            new_pos = pos.copy()
            
            # Leg movement (Opposing phases)
            if "knee_l" in name or "ankle_l" in name or "foot_l" in name:
                new_pos[0] += math.sin(phase) * stride * animator.w
                new_pos[1] += max(0, math.cos(phase)) * bounce * animator.h
            elif "knee_r" in name or "ankle_r" in name or "foot_r" in name:
                new_pos[0] += math.sin(phase + math.pi) * stride * animator.w
                new_pos[1] += max(0, math.cos(phase + math.pi)) * bounce * animator.h
            
            # Hip bounce
            if "hip" in name or "torso" in name or "shoulder" in name or "nose" in name:
                new_pos[1] += abs(math.sin(phase * 2)) * (bounce * 0.5) * animator.h
            
            # Arm swing
            if "wrist_l" in name or "elbow_l" in name:
                new_pos[0] += math.sin(phase + math.pi) * (stride * 0.5) * animator.w
            elif "wrist_r" in name or "elbow_r" in name:
                new_pos[0] += math.sin(phase) * (stride * 0.5) * animator.w
                
            t_joints[name] = new_pos
            
        frames.append(animator.deform(t_joints))
        
    return frames

def create_walk_cycle_layered(animator: AffineMeshAnimator, limb_images: dict, stride=0.2, bounce=0.05, num_frames=12):
    """Generates a series of walk cycle frames using separate limb layers."""
    frames = []
    base_joints = {name: pos.copy() for name, pos in animator.rest_joints.items()}
    for f in range(num_frames):
        phase = 2 * math.pi * (f / num_frames)
        t_joints = {}
        for name, pos in base_joints.items():
            new_pos = pos.copy()
            if "knee_l" in name or "ankle_l" in name or "foot_l" in name:
                new_pos[0] += math.sin(phase) * stride * animator.w
                new_pos[1] += max(0, math.cos(phase)) * bounce * animator.h
            elif "knee_r" in name or "ankle_r" in name or "foot_r" in name:
                new_pos[0] += math.sin(phase + math.pi) * stride * animator.w
                new_pos[1] += max(0, math.cos(phase + math.pi)) * bounce * animator.h
            if "hip" in name or "torso" in name or "shoulder" in name or "nose" in name:
                new_pos[1] += abs(math.sin(phase * 2)) * (bounce * 0.5) * animator.h
            if "wrist_l" in name or "elbow_l" in name:
                new_pos[0] += math.sin(phase + math.pi) * (stride * 0.5) * animator.w
            elif "wrist_r" in name or "elbow_r" in name:
                new_pos[0] += math.sin(phase) * (stride * 0.5) * animator.w
            t_joints[name] = new_pos
        frames.append(animator.deform_layered(limb_images, t_joints))
    return frames

def create_jump_cycle(animator: AffineMeshAnimator, height=0.3, num_frames=12):
    """Generates a jumping animation."""
    frames = []
    base_joints = {name: pos.copy() for name, pos in animator.rest_joints.items()}
    for f in range(num_frames):
        phase = 2 * math.pi * (f / num_frames)
        # Vertical arc: 0 to 1 back to 0
        jump_factor = max(0, math.sin(phase / 2 * math.pi)) # Simple jump arc
        # Wait, for a loop, maybe just sin(phase) but clamped?
        # A loop jump: crouch -> launch -> peak -> land
        t = f / num_frames
        if t < 0.2: # Crouch
            v_off = 0.1 * (t/0.2)
            leg_bend = 0.1 * (t/0.2)
        elif t < 0.6: # Air
            v_off = -height * math.sin((t-0.2)/0.4 * math.pi)
            leg_bend = -0.05
        else: # Land
            v_off = 0.1 * (1.0 - (t-0.6)/0.4)
            leg_bend = 0.1 * (1.0 - (t-0.6)/0.4)
            
        t_joints = {}
        for name, pos in base_joints.items():
            new_pos = pos.copy()
            new_pos[1] += v_off * animator.h
            if "knee" in name or "ankle" in name:
                new_pos[1] -= leg_bend * animator.h
            if "wrist" in name:
                new_pos[1] -= abs(v_off) * 0.5 * animator.h # Arms fly up
            t_joints[name] = new_pos
        frames.append(animator.deform(t_joints))
    return frames

def create_attack_cycle(animator: AffineMeshAnimator, reach=0.3, num_frames=12):
    """Generates a slashing/thrusting attack."""
    frames = []
    base_joints = {name: pos.copy() for name, pos in animator.rest_joints.items()}
    for f in range(num_frames):
        t = f / num_frames
        # Wind up (0-0.3) -> Strike (0.3-0.5) -> Recover (0.5-1.0)
        if t < 0.3:
            thrust = -0.1 * (t/0.3)
            arm_y = -0.1 * (t/0.3)
        elif t < 0.5:
            thrust = reach * ((t-0.3)/0.2)
            arm_y = 0
        else:
            thrust = reach * (1.0 - (t-0.5)/0.5)
            arm_y = 0
            
        t_joints = {}
        for name, pos in base_joints.items():
            new_pos = pos.copy()
            if "wrist_r" in name or "elbow_r" in name:
                new_pos[0] += thrust * animator.w
                new_pos[1] += arm_y * animator.h
            if "hip" in name or "torso" in name:
                new_pos[0] += thrust * 0.2 * animator.w # Lean into it
            t_joints[name] = new_pos
        frames.append(animator.deform(t_joints))
    return frames
def create_animation_hierarchical(animator: HierarchicalAnimator, anim_type="walk", stride=0.2, bounce=0.05, num_frames=12, direction="S"):
    """Generates an animation sequence using the hierarchical paper-doll rig."""
    frames = []
    
    # Base joints from the animator
    base_joints = {name: pos.copy() for name, pos in animator.joints.items()}
    
    for f in range(num_frames):
        phase = 2 * math.pi * (f / num_frames)
        t = f / num_frames
        t_joints = {}
        
        # Apply motion logic
        for name, pos in base_joints.items():
            new_pos = pos.copy()
            
            if anim_type == "walk":
                if "knee_l" in name or "ankle_l" in name or "foot_l" in name:
                    new_pos["x"] += math.sin(phase) * stride
                    new_pos["y"] += max(0, math.cos(phase)) * bounce
                elif "knee_r" in name or "ankle_r" in name or "foot_r" in name:
                    new_pos["x"] += math.sin(phase + math.pi) * stride
                    new_pos["y"] += max(0, math.cos(phase + math.pi)) * bounce
                if "hip" in name or "torso" in name or "shoulder" in name or "nose" in name:
                    new_pos["y"] += abs(math.sin(phase * 2)) * (bounce * 0.5)
                if "wrist_l" in name or "elbow_l" in name:
                    new_pos["x"] += math.sin(phase + math.pi) * (stride * 0.5)
                elif "wrist_r" in name or "elbow_r" in name:
                    new_pos["x"] += math.sin(phase) * (stride * 0.5)
            
            elif anim_type == "jump":
                # Same jump logic
                if t < 0.2: v_off, leg_bend = 0.1 * (t/0.2), 0.1 * (t/0.2)
                elif t < 0.6: v_off, leg_bend = -bounce * 5 * math.sin((t-0.2)/0.4 * math.pi), -0.05
                else: v_off, leg_bend = 0.1 * (1.0 - (t-0.6)/0.4), 0.1 * (1.0 - (t-0.6)/0.4)
                new_pos["y"] += v_off
                if "knee" in name or "ankle" in name: new_pos["y"] -= leg_bend
                if "wrist" in name: new_pos["y"] -= abs(v_off) * 0.5
            
            elif anim_type == "attack":
                if t < 0.3: thrust, arm_y = -0.1 * (t/0.3), -0.1 * (t/0.3)
                elif t < 0.5: thrust, arm_y = stride, 0
                else: thrust, arm_y = stride * (1.0 - (t-0.5)/0.5), 0
                if "wrist_r" in name or "elbow_r" in name:
                    new_pos["x"] += thrust
                    new_pos["y"] += arm_y
                if "hip" in name or "torso" in name:
                    new_pos["x"] += thrust * 0.2
                    
            t_joints[name] = new_pos
            
        frames.append(animator.render(t_joints, direction=direction))
        
    return frames

def pad_image_for_outpaint(img: Image.Image, direction: str = 'right', pixels: int = 512) -> Image.Image:
    """Expands the canvas in a specific direction with white/transparent space for outpainting."""
    w, h = img.size
    if direction == 'right':
        new_canvas = Image.new("RGBA", (w + pixels, h), (255, 255, 255, 0))
        new_canvas.paste(img, (0, 0))
    elif direction == 'bottom':
        new_canvas = Image.new("RGBA", (w, h + pixels), (255, 255, 255, 0))
        new_canvas.paste(img, (0, 0))
    elif direction == 'left':
        new_canvas = Image.new("RGBA", (w + pixels, h), (255, 255, 255, 0))
        new_canvas.paste(img, (pixels, 0))
    else:
        new_canvas = img
    return new_canvas
