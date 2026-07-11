"""
FastAPI wrapper around LesionPipeline — the ONLY way the Node backend reaches
the Python lesion model. Localhost/compose-internal; never public.

    .venv/bin/python -m uvicorn ai.service.lesion_service:app --port 8000

POST /v1/lesion  {image: <base64>, mime: "image/jpeg"}  →  LesionPipeline.analyze output
GET  /healthz
"""
from __future__ import annotations

import base64
import binascii
from functools import lru_cache
from io import BytesIO

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from ai.inference.pipeline import LesionPipeline

app = FastAPI(title="lesion-inference")


@lru_cache(maxsize=1)
def get_pipeline() -> LesionPipeline:
    return LesionPipeline()  # loads real models lazily on first analyze


class LesionRequest(BaseModel):
    image: str  # base64-encoded image bytes
    mime: str = "image/jpeg"


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/v1/lesion")
def classify(req: LesionRequest, pipeline: LesionPipeline = Depends(get_pipeline)) -> dict:
    try:
        raw = base64.b64decode(req.image, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "invalid base64")
    try:
        image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "undecodable image")
    return pipeline.analyze(image)
