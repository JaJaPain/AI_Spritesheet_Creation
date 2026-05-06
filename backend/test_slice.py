import cv2
import numpy as np
from PIL import Image

image_path = "output/turnaround_1778074515619_1778074669.png"
image = Image.open(image_path).convert("RGB")
img_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

h, w = gray.shape
gray_cropped = gray[0:h-50, :]

for thresh_val in [250, 240, 220, 200, 150]:
    _, thresh = cv2.threshold(gray_cropped, thresh_val, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    valid = [c for c in contours if cv2.contourArea(c) > 5000]
    print(f"Thresh {thresh_val}: {len(valid)} valid contours")
