# Classifier model

Place the ONNX skin-condition classifier here as `skin-classifier.onnx`.

Requirements:
- Output vector length MUST equal the number of entries in
  `src/features/skin-analysis/ml/labels.ts` (`LABELS`), in the same order.
- Input: NCHW float32, 1×3×224×224, RGB normalised to 0..1.

Source options: a DermNet/HAM10000-class model exported to ONNX
(`torch.onnx.export`). Override the path with `VITE_CLASSIFIER_MODEL_URL`.

The `.onnx` binary is gitignored — it is an asset, not source.

# Face parsing model

Place the quantized SegFormer face-parsing ONNX here:

    face-parsing/model_quantized.onnx

Fetch with:

    .venv/bin/python -m ai.models.fetch_models face-parsing

Input: NCHW float32, 1×3×512×512, ImageNet-normalised RGB.
Output: logits `[1, 19, H, W]` (CelebAMask-HQ classes). Override with
`VITE_FACE_PARSING_MODEL_URL`.

License: jonathandinu/face-parsing is non-commercial research/education only.

Model distribution (Plan 13):

- Server exposes a model registry at /api/models/manifest and admin endpoints to register, upload, promote, and rollback model versions under /api/models.
- Admin upload: POST /api/models/:modelId/upload (multipart/form-data field `file`). The endpoint requires an authenticated session (admin).
- Promote: POST /api/models/:modelId/promote/:versionId (auth required).
- Rollback: POST /api/models/:modelId/rollback (auth required).
- Browser clients auto-check the manifest (production only) and will download verified model blobs into IndexedDB. The frontend prefers cached blobs for the classifier and face landmarker when available.

Security and deployment notes:
- The upload/promote/rollback endpoints are protected by session authentication — ensure the server is run behind the usual auth configuration before enabling uploads in production.
- Uploaded files are stored under backend/public/models so they are served at /models/*. Ensure the deployment includes this directory or the upload process is run as part of your CI/CD.

