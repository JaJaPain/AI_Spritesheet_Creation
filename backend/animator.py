import cv2
import numpy as np
from PIL import Image
import os
import math
from scipy.spatial import Delaunay

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
                # Get transformation
                affine_mat = cv2.getAffineTransform(src_tri_cropped, dst_tri_cropped)
                
                # Warp
                src_crop = self.base_image[src_rect[1]:src_rect[1]+src_rect[3], src_rect[0]:src_rect[0]+src_rect[2]]
                if src_crop.size == 0: continue
                
                warped_crop = cv2.warpAffine(src_crop, affine_mat, (dst_rect[2], dst_rect[3]), 
                                            None, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
                
                # Mask the triangle
                mask = np.zeros((dst_rect[3], dst_rect[2]), dtype=np.uint8)
                cv2.fillConvexPoly(mask, dst_tri_cropped.astype(np.int32), 255)
                
                # Combine onto output
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
