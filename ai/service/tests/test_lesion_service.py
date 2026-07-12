import base64
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from ai.service.lesion_service import app, get_pipeline
from ai.inference.pipeline import LesionPipeline

client = TestClient(app)


def _b64_png(w=32, h=32) -> str:
    buf = BytesIO()
    Image.new("RGB", (w, h), (150, 120, 110)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _fake_pipeline() -> LesionPipeline:
    # Real pipeline, fake models → no weights loaded, deterministic.
    return LesionPipeline(
        detect_fn=lambda img: [],
        classify_fn=lambda crop: {"MEL": 0.7, "NEV": 0.2, "BCC": 0.1},
    )


def setup_function() -> None:
    app.dependency_overrides[get_pipeline] = _fake_pipeline


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_classify_returns_pipeline_shape():
    r = client.post("/v1/lesion", json={"image": _b64_png(), "mime": "image/png"})
    assert r.status_code == 200
    body = r.json()
    assert body["whole_image_fallback"] is True
    assert body["lesions"][0]["classification"]["predicted"] == "MEL"
    assert body["model"]["classifier"] == "efficientnet_b1-isic2019"


def test_invalid_base64_400():
    r = client.post("/v1/lesion", json={"image": "!!!notb64!!!", "mime": "image/png"})
    assert r.status_code == 400


def test_undecodable_image_400():
    r = client.post("/v1/lesion", json={"image": base64.b64encode(b"nope").decode(), "mime": "image/png"})
    assert r.status_code == 400
