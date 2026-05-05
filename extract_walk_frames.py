"""
Extract the 'Front' row from walkingCycles.png into 12 individual reference frames.
Upscale to 512px tall for reliable OpenPose detection.
"""
from PIL import Image
import os

img = Image.open("walkingCycles.png")
w, h = img.size
print(f"Image size: {w}x{h}")

# More careful grid analysis:
# The image is 1956x894
# The grid has labels on the left (~150px) and a big character on the right (~350px)
# The grid area for the 12 columns is roughly 150 to ~1606
# There are 5 rows with labels: Front, Front 3/4, Side, Back 3/4, Back
# Bottom bar with numbers starts at ~800
# Let me look at each row boundary more carefully

# Row boundaries (estimated from image):
# Front row: y=30 to y=170
# Front 3/4: y=170 to y=330  
# Side: y=330 to y=495
# Back 3/4: y=495 to y=650
# Back: y=650 to y=800

# Column boundaries: 12 columns from x=155 to x=1600
# Column width: (1600-155)/12 = ~120.4

rows = {
    "front": (30, 170),
    "front34": (170, 330),
    "side": (330, 495),
    "back34": (495, 650),
    "back": (650, 800),
}

col_left = 155
col_right = 1600
num_cols = 12
col_w = (col_right - col_left) / num_cols

os.makedirs("output/ref_frames", exist_ok=True)

target_height = 512  # Upscale for reliable OpenPose detection

for row_name, (y1, y2) in rows.items():
    for col in range(num_cols):
        x1 = int(col_left + col * col_w)
        x2 = int(col_left + (col + 1) * col_w)
        
        frame = img.crop((x1, y1, x2, y2))
        
        # Upscale proportionally
        scale = target_height / frame.height
        new_w = int(frame.width * scale)
        frame = frame.resize((new_w, target_height), Image.LANCZOS)
        
        frame_path = f"output/ref_frames/walk_{row_name}_{col:02d}.png"
        frame.save(frame_path)
    
    print(f"  Extracted 12 {row_name} frames (upscaled to {target_height}px tall)")

print("\nDone! Reference frames saved to output/ref_frames/")
