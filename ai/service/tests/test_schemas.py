import pytest
from pydantic import ValidationError
from ai.service.schemas import ClassificationResult, TopPrediction, Quality, ModelInfo

def _result(conf=0.9):
    return ClassificationResult(
        prediction="Melanoma", confidence=conf,
        topPredictions=[TopPrediction(label="Melanoma", confidence=conf)],
        abstain=False, quality=Quality(ok=True, issues=[]),
        model=ModelInfo(name="efficientnet-b0", version="0.0.0-dev"),
    )

def test_valid_result_roundtrips():
    assert _result().model_dump()["prediction"] == "Melanoma"

def test_confidence_bounds_enforced():
    with pytest.raises(ValidationError):
        _result(conf=1.5)
