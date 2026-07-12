---
tags:
- image-classification
- skin-cancer
- dermatology
- pytorch
- timm
license: apache-2.0
---
# efficientnet_b1 - Skin Cancer Classification

Fine-tuned on ISIC 2019 for **6-class skin lesion classification**  
F1: **0.688** | Accuracy: **68.2%**

## Classes
| 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| ACK | BCC | MEL | NEV | SCC | SEK |

## Usage
```python
import torch, timm
from PIL import Image
from torchvision import transforms
from huggingface_hub import hf_hub_download

weights = hf_hub_download(repo_id="conan17970/efficientnet-b1-skin-cancer-isic2019", filename="best_weights.pth")
model = timm.create_model("efficientnet_b1", pretrained=False, num_classes=6)
model.load_state_dict(torch.load(weights, map_location="cpu"))
model.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225])
])
classes = ['ACK','BCC','MEL','NEV','SCC','SEK']
img = Image.open("skin.jpg").convert("RGB")
with torch.no_grad():
    logits = model(transform(img).unsqueeze(0))
    print(classes[logits.argmax().item()])
```
