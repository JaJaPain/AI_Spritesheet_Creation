import os
from rembg import remove
from PIL import Image
import io

class BackgroundRemover:
    def __init__(self, processed_dir="processed"):
        self.processed_dir = processed_dir
        os.makedirs(processed_dir, exist_ok=True)

    def remove_background(self, project_id, frame_name, frame_path):
        project_processed_dir = os.path.join(self.processed_dir, project_id)
        os.makedirs(project_processed_dir, exist_ok=True)
        
        output_path = os.path.join(project_processed_dir, frame_name)
        
        # Non-destructive check: if already processed, just return the path
        if os.path.exists(output_path):
            return f"/processed/{project_id}/{frame_name}"

        with open(frame_path, 'rb') as i:
            input_data = i.read()
            output_data = remove(input_data)
            
            with open(output_path, 'wb') as o:
                o.write(output_data)
        
        return f"/processed/{project_id}/{frame_name}"
