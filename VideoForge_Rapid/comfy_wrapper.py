import json
import urllib.request
import urllib.parse
import urllib.error
import uuid
import os
import time
import requests

class ComfyWrapper:
    """
    A low-level bridge to the ComfyUI API.
    Handles image uploads, workflow injection, prompt queueing, and result retrieval.
    Includes a heartbeat system to monitor real-time generation progress.
    """
    def __init__(self, server_address="127.0.0.1:8188"):
        self.server_address = server_address
        self.client_id = str(uuid.uuid4())
        # Heartbeat state
        self.current_status = "Idle"
        self.current_progress = 0
        self.last_update = time.time()

    def get_status(self):
        """Returns the current heartbeat status and progress (0-100)."""
        return {
            "status": self.current_status,
            "progress": self.current_progress,
            "last_update": self.last_update
        }

    def queue_prompt(self, prompt):
        """Sends a JSON workflow to the ComfyUI prompt queue."""
        p = {"prompt": prompt, "client_id": self.client_id}
        data = json.dumps(p).encode('utf-8')
        req = urllib.request.Request(f"http://{self.server_address}/prompt", data=data)
        try:
            return json.loads(urllib.request.urlopen(req).read())
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='replace')
            print(f"ComfyUI rejected the workflow (HTTP {e.code}): {error_body}")
            raise Exception(f"ComfyUI rejected workflow (HTTP {e.code}): {error_body[:500]}")

    def get_history(self, prompt_id):
        """Retrieves the execution history for a specific prompt ID."""
        with urllib.request.urlopen(f"http://{self.server_address}/history/{prompt_id}") as response:
            return json.loads(response.read())

    def upload_image(self, image_path):
        """Uploads a PNG/JPG to ComfyUI's input directory for processing."""
        url = f"http://{self.server_address}/upload/image"
        with open(image_path, "rb") as f:
            files = {"image": (os.path.basename(image_path), f)}
            response = requests.post(url, files=files)
            return response.json()

    def generate_video(self, image_path, prompt_text, num_frames=16, seed=42, workflow_path="workflow_api.json"):
        """
        Executes the full Video Forge pipeline:
        1. Uploads source sprite
        2. Injects prompt and settings into the API workflow
        3. Queues the generation
        4. Polls ComfyUI for progress heartbeats
        5. Downloads the final MP4
        """
        # 1. Upload the reference image
        self.current_status = "Uploading Image..."
        self.current_progress = 5
        self.last_update = time.time()
        
        print(f"Uploading image {image_path} to ComfyUI...")
        upload_resp = self.upload_image(image_path)
        comfy_filename = upload_resp['name']

        # 2. Load and prepare the workflow
        with open(workflow_path, 'r') as f:
            workflow = json.load(f)

        # Update prompt (Node 16)
        workflow["16"]["inputs"]["positive_prompt"] = prompt_text
        # Update image (Node 58)
        workflow["58"]["inputs"]["image"] = comfy_filename
        # Update num_frames (Node 63)
        workflow["63"]["inputs"]["num_frames"] = num_frames
        # Update seed (Node 35)
        workflow["35"]["inputs"]["seed"] = seed

        # 3. Queue the prompt
        self.current_status = "Queueing in ComfyUI..."
        self.current_progress = 10
        self.last_update = time.time()
        
        print("Queueing generation...")
        prompt_resp = self.queue_prompt(workflow)
        prompt_id = prompt_resp['prompt_id']

        # 4. Wait for completion (The Heartbeat Loop)
        print(f"Waiting for prompt {prompt_id} to complete...")
        start_wait = time.time()
        
        while True:
            history = self.get_history(prompt_id)
            
            # Check if it's done
            if prompt_id in history and history[prompt_id].get('outputs'):
                break
            
            # Update Heartbeat
            elapsed = time.time() - start_wait
            # Ballpark progress based on typical 9-minute run (540 seconds)
            # This provides a 'crawling' progress between 10% and 90%
            pseudo_progress = 10 + min(80, int((elapsed / 540) * 80))
            self.current_progress = pseudo_progress
            self.current_status = "ComfyUI is forging video frames..."
            self.last_update = time.time()
            
            time.sleep(5) # Poll every 5 seconds

        # 5. Extract the output filename
        self.current_status = "Finalizing Video..."
        self.current_progress = 95
        self.last_update = time.time()
        
        outputs = history[prompt_id]['outputs']
        # Node 30 is Video Combine (VHS) which uses 'gifs' key
        if 'gifs' in outputs['30']:
            video_output = outputs['30']['gifs'][0]
        else:
            # Fallback for other video nodes
            video_output = outputs['30'].get('filenames', [{}])[0]
            
        video_filename = video_output.get('filename')
        
        # 6. Download the result
        print(f"Downloading result: {video_filename}")
        video_url = f"http://{self.server_address}/view?filename={video_filename}&type=output"
        output_local_path = os.path.abspath(os.path.join("outputs", f"gen_{int(time.time())}.mp4"))
        os.makedirs("outputs", exist_ok=True)
        
        with urllib.request.urlopen(video_url) as response, open(output_local_path, 'wb') as out_file:
            out_file.write(response.read())

        self.current_status = "Idle"
        self.current_progress = 0
        return output_local_path

    def run_workflow(self, workflow):
        """
        Executes a pre-built workflow (used by the Rapid Forge).
        Handles image upload, queueing, polling, and video download.
        """
        # 1. Upload the image referenced in the LoadImage node (58)
        image_path = workflow.get("58", {}).get("inputs", {}).get("image", "")
        if image_path and os.path.exists(image_path):
            self.current_status = "Uploading Image..."
            self.current_progress = 5
            self.last_update = time.time()
            
            print(f"Uploading image {image_path} to ComfyUI...")
            upload_resp = self.upload_image(image_path)
            comfy_filename = upload_resp['name']
            workflow["58"]["inputs"]["image"] = comfy_filename
        
        # 2. Queue the prompt
        self.current_status = "Queueing in ComfyUI..."
        self.current_progress = 10
        self.last_update = time.time()
        
        print("Queueing RAPID generation...")
        prompt_resp = self.queue_prompt(workflow)
        prompt_id = prompt_resp['prompt_id']
        
        # 3. Wait for completion (The Heartbeat Loop)
        print(f"Waiting for prompt {prompt_id} to complete...")
        start_wait = time.time()
        
        while True:
            history = self.get_history(prompt_id)
            
            if prompt_id in history and history[prompt_id].get('outputs'):
                break
            
            # Update Heartbeat (Rapid is ~2 min with 4-step)
            elapsed = time.time() - start_wait
            pseudo_progress = 10 + min(80, int((elapsed / 120) * 80))
            self.current_progress = pseudo_progress
            self.current_status = "ComfyUI is forging video frames (Rapid)..."
            self.last_update = time.time()
            
            time.sleep(3)
        
        # 4. Extract the output filename
        self.current_status = "Finalizing Video..."
        self.current_progress = 95
        self.last_update = time.time()
        
        outputs = history[prompt_id]['outputs']
        # Node 30 is Video Combine (VHS)
        if '30' in outputs and 'gifs' in outputs['30']:
            video_output = outputs['30']['gifs'][0]
        elif '30' in outputs:
            video_output = outputs['30'].get('filenames', [{}])[0]
        else:
            print(f"WARNING: Unexpected output structure: {list(outputs.keys())}")
            self.current_status = "Idle"
            self.current_progress = 0
            return None
            
        video_filename = video_output.get('filename')
        
        # 5. Download the result
        print(f"Downloading result: {video_filename}")
        video_url = f"http://{self.server_address}/view?filename={video_filename}&type=output"
        output_local_path = os.path.abspath(os.path.join("outputs", f"rapid_{int(time.time())}.mp4"))
        os.makedirs("outputs", exist_ok=True)
        
        with urllib.request.urlopen(video_url) as response, open(output_local_path, 'wb') as out_file:
            out_file.write(response.read())

        self.current_status = "Idle"
        self.current_progress = 0
        return output_local_path

    def upscale_image(self, image_path, workflow_path="upscale_workflow_api.json"):
        """Utility to upscale sprites using ComfyUI's internal upscalers."""
        # 1. Upload
        self.current_status = "Upscaling..."
        upload_resp = self.upload_image(image_path)
        comfy_filename = upload_resp['name']

        # 2. Prepare workflow
        with open(workflow_path, 'r') as f:
            workflow = json.load(f)
        
        workflow["1"]["inputs"]["image"] = comfy_filename

        # 3. Queue
        prompt_resp = self.queue_prompt(workflow)
        prompt_id = prompt_resp['prompt_id']

        # 4. Wait
        while True:
            history = self.get_history(prompt_id)
            if prompt_id in history and history[prompt_id].get('outputs'):
                break
            time.sleep(1)

        # 5. Extract output (Node 4)
        outputs = history[prompt_id]['outputs']
        image_output = outputs['4']['images'][0]
        image_filename = image_output['filename']

        # 6. Download
        image_url = f"http://{self.server_address}/view?filename={image_filename}&type=output"
        output_local_path = os.path.abspath(os.path.join("outputs", f"upscale_{int(time.time())}.png"))
        os.makedirs("outputs", exist_ok=True)

        with urllib.request.urlopen(image_url) as response, open(output_local_path, 'wb') as out_file:
            out_file.write(response.read())

        self.current_status = "Idle"
        return output_local_path

if __name__ == "__main__":
    wrapper = ComfyWrapper()
    # This assumes ComfyUI is already running
    # wrapper.generate_video("test_image.png", "A character walking loop")
