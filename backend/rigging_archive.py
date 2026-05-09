import os
import torch
import uuid
import json
import logging
import traceback
import base64
import io
import cv2
import numpy as np
from typing import Optional, List
from fastapi import FastAPI, Body, HTTPException, Request
from pydantic import BaseModel
from PIL import Image
from diffusers.utils import load_image
from rembg import remove
from fastapi.concurrency import run_in_threadpool

# Note: This is an ARCHIVE of the legacy rigging system.
# It is not currently active but preserved for future use.

class ExplodeLimbRequest(BaseModel):
    project_id: str
    limb_name: str # e.g. "left arm"
    anchor_url: Optional[str] = None
    mask_image: Optional[str] = None # Base64 mask from user

# To re-activate, move these endpoints back to main.py
# @app.post("/generate-isolated-limb")
# async def generate_isolated_limb(req: ExplodeLimbRequest):
#     ...

class CompleteSocketRequest(BaseModel):
    project_id: str
    limb_url: str
    limb_name: str
    torso_url: str # Contextual anchor

# @app.post("/complete-limb-socket")
# async def complete_limb_socket(req: CompleteSocketRequest):
#     ...

class DirectionalPoseRequest(BaseModel):
    project_id: str
    target_direction: str # "SE", "SW", "NE", "NW"

# @app.post("/generate-directional-poses")
# async def generate_directional_poses(req: DirectionalPoseRequest):
#     ...
