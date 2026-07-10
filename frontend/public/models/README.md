# Classifier model

Place the ONNX skin-condition classifier here as `skin-classifier.onnx`.

Requirements:
- Output vector length MUST equal the number of entries in
  `src/features/skin-analysis/ml/labels.ts` (`LABELS`), in the same order.
- Input: NCHW float32, 1×3×224×224, RGB normalised to 0..1.

Source options: a DermNet/HAM10000-class model exported to ONNX
(`torch.onnx.export`). Override the path with `VITE_CLASSIFIER_MODEL_URL`.

The `.onnx` binary is gitignored — it is an asset, not source.
