import torch
import torch.nn as nn
import torchvision.models as models
import onnx
import os

print("Downloading MobileNetV2 architecture...")
# Create a MobileNetV2 model
model = models.mobilenet_v2(weights=None)

# Replace the classifier head to output 13 classes
# The LABELS array in labels.ts has exactly 13 entries.
model.classifier[1] = nn.Linear(model.last_channel, 13)

# Set model to evaluation mode
model.eval()

# Create a dummy input tensor matching the expected shape:
# NCHW float32, 1x3x224x224
dummy_input = torch.randn(1, 3, 224, 224, dtype=torch.float32)

print("Exporting model to ONNX...")
output_path = "public/models/skin-classifier.onnx"

# Ensure the directory exists
os.makedirs(os.path.dirname(output_path), exist_ok=True)

torch.onnx.export(
    model, 
    dummy_input, 
    output_path, 
    export_params=True,
    opset_version=14,          # ONNX opset version
    do_constant_folding=True,  # fold constants to optimize
    input_names=['input'],     # input tensor name
    output_names=['output'],   # output tensor name
    dynamic_axes={
        'input': {0: 'batch_size'},
        'output': {0: 'batch_size'}
    }
)

print(f"✅ Successfully exported dummy ONNX model to {output_path}")
