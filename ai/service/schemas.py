"""Pydantic mirror of shared/contract.ts ClassificationResult — keep field names identical."""
from pydantic import BaseModel, Field

class TopPrediction(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)

class Quality(BaseModel):
    ok: bool
    issues: list[str]

class ModelInfo(BaseModel):
    name: str
    version: str

class ClassificationResult(BaseModel):
    prediction: str
    confidence: float = Field(ge=0, le=1)
    topPredictions: list[TopPrediction]
    abstain: bool
    quality: Quality
    model: ModelInfo
