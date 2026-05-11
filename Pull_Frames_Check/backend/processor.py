import cv2
import os
from PIL import Image
import numpy as np

class FrameProcessor:
    def __init__(self, upload_dir="uploads", frames_dir="frames"):
        self.upload_dir = upload_dir
        self.frames_dir = frames_dir
        os.makedirs(upload_dir, exist_ok=True)
        os.makedirs(frames_dir, exist_ok=True)

    def extract_frames(self, video_path, project_id):
        project_frames_dir = os.path.join(self.frames_dir, project_id)
        os.makedirs(project_frames_dir, exist_ok=True)
        
        cap = cv2.VideoCapture(video_path)
        frame_count = 0
        extracted_paths = []

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_name = f"frame_{frame_count:04d}.png"
            frame_path = os.path.join(project_frames_dir, frame_name)
            cv2.imwrite(frame_path, frame)
            extracted_paths.append({
                "index": frame_count,
                "path": f"/frames/{project_id}/{frame_name}",
                "name": frame_name
            })
            frame_count += 1
        
        cap.release()
        return extracted_paths

    def create_spritesheet(self, project_id, frame_names, use_processed=False, offsets=None):
        """
        offsets: dict mapping frame_name -> {"x": int, "y": int}
        """
        source_dir = "processed" if use_processed else "frames"
        image_paths = [os.path.join(source_dir, project_id, name) for name in frame_names]
        
        images = []
        for name in frame_names:
            p = os.path.join(source_dir, project_id, name)
            if os.path.exists(p):
                img = Image.open(p).convert("RGBA")
                # Apply offset if provided
                if offsets and name in offsets:
                    off = offsets[name]
                    # Create a new transparent canvas of the same size
                    # and paste the image with the shift
                    shifted = Image.new("RGBA", img.size, (0, 0, 0, 0))
                    shifted.paste(img, (int(off.get("x", 0)), int(off.get("y", 0))))
                    images.append(shifted)
                else:
                    images.append(img)
        
        if not images:
            return None

        # Simple horizontal strip for spritesheet
        widths, heights = zip(*(i.size for i in images))
        total_width = sum(widths)
        max_height = max(heights)

        spritesheet = Image.new("RGBA", (total_width, max_height))
        x_offset = 0
        for im in images:
            spritesheet.paste(im, (x_offset, 0))
            x_offset += im.size[0]

        output_path = os.path.join(self.upload_dir, f"{project_id}_spritesheet.png")
        spritesheet.save(output_path)
        return output_path
