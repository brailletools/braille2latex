# Braille OCR Model Setup Guide

This guide explains how to set up the Braille OCR functionality using the BRL-Slate-Reader model for the braille2latex application.

## Overview

The OCR system runs entirely in the browser using:
- **TensorFlow.js** for model inference
- **Canvas API** for image preprocessing (no external image libraries needed!)
- Works perfectly with GitHub Pages deployment without requiring a backend server

## Current Implementation

The image processing pipeline is fully implemented using native browser APIs:
- ✅ Image loading from files, URLs, or data URIs
- ✅ Grayscale conversion
- ✅ Contrast enhancement
- ✅ Grid-based character segmentation
- ✅ Ready for TensorFlow.js model integration

**What's still needed:** The actual Braille recognition model (see conversion steps below).

## Model Conversion

The BRL-Slate-Reader uses a PyTorch-based deep learning model trained on Perkins Brailler text. To use it in the browser, the model needs to be converted to TensorFlow.js format.

### Step 1: Obtain the Model

Download the Perkins Brailler model from:
- **Google Drive**: https://drive.google.com/drive/folders/1RNGUoBJOSamYOaO7ElFBeWIRVpHtlQpd?usp=sharing
- Look for: `Model_Perkins_Brailler_acc9997` or similar

### Step 2: Convert PyTorch to ONNX

Use the following Python script to convert the PyTorch model to ONNX:

```python
import torch
import torch.onnx

# Load the PyTorch model
model = torch.load('Model_Perkins_Brailler_acc9997.pth')
model.eval()

# Export to ONNX
dummy_input = torch.randn(1, 1, 28, 28)  # Adjust dimensions as needed
torch.onnx.export(
    model, 
    dummy_input, 
    'braille_ocr.onnx',
    export_params=True,
    opset_version=12,
    input_names=['input'],
    output_names=['output'],
    dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
)
```

### Step 3: Convert ONNX to TensorFlow.js

Use the ONNX.js or TensorFlow converter tools:

**Option A: Using ONNX.js**
```bash
npm install -g onnx-converter-common onnxjs
# Requires manual conversion, complex process
```

**Option B: Using TensorFlow.js Converter (Recommended)**

First convert ONNX to SavedModel format:
```bash
pip install onnx tensorflow onnx-tf

# Convert ONNX → SavedModel
python -m onnxruntime.transformers.onnx_model_bert --onnx_model braille_ocr.onnx --saved_model_path ./braille_ocr_saved_model
```

Then convert SavedModel to TensorFlow.js:
```bash
pip install tensorflowjs

pythonm tensorflowjs_converter \
  --input_format tf_saved_model \
  --output_format tfjs_graph_model \
  ./braille_ocr_saved_model \
  ./public/models/braille_ocr
```

### Step 4: Alternative - Use Existing Model in Browser

If model conversion is complex, consider these alternatives:

1. **Use ONNX Runtime JS** with the ONNX model directly:
   ```bash
   npm install onnxruntime-web
   ```

2. **Use WebAssembly port** of the original model

3. **Train a new model using TensorFlow.js** specifically for this use case

## File Structure

Once converted, place model files in:
```
public/
├── models/
│   └── braille_ocr/
│       ├── model.json
│       ├── weights.bin
│       └── weights.*.bin (if multiple weight files)
```

## Model Details

- **Input**: 28×28 grayscale images of individual Braille cells
- **Output**: Classification score for each of 64 Braille dot patterns (or 256 if 8-dot cells supported)
- **Format**: Modern CNN architecture from BRL-Slate-Reader

## Braille Character Mapping

The model outputs indices that map to Unicode Braille characters:
- U+2800 to U+28FF: 6-dot Braille Unicode range
- U+2800 to U+29FF: 8-dot Braille Unicode range

## Usage in Application

Once the model is set up:

1. **Upload** a Braille image via the "Image" tab in the web interface
2. **Click** "Recognize Text" to run OCR
3. **Results** automatically populate the text input field
4. **Convert** to LaTeX using the existing pipeline

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Model not ready" | Ensure model files are in `public/models/braille_ocr/` |
| Poor recognition | Verify image is 300 dpi, landscape, properly lit |
| Large file size | Consider quantization to reduce model size |
| Slow processing | May need model optimization or web worker implementation |

## Performance Optimization

For production deployment to GitHub Pages:

1. **Quantize the model** to reduce size:
   ```bash
   tensorflowjs_converter \
     --quantization_dtype uint8 \
     ...
   ```

2. **Use Web Workers** for browser responsiveness (see `src/lib/ocrWorker.js` when created)

3. **Optimize image preprocessing** in JavaScript

## Resources

- [TensorFlow.js Model Conversion Guide](https://www.tensorflow.org/js/guide/conversion)
- [BRL-Slate-Reader Repository](https://github.com/LPBeaulieu/Braille-OCR-BRL-Slate-Reader)
- [ONNX.js Documentation](https://github.com/microsoft/onnxjs)
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/master/js)
- [Canvas API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API)

## Implementation Benefits

### Browser-Native Approach
The current implementation uses **Canvas API** for all image processing:
- ✅ **Zero Dependencies**: No external image libraries (no Jimp, Pillow, OpenCV, etc.)
- ✅ **Smaller Bundle**: Reduced JavaScript bundle size for faster loading
- ✅ **Better Compatibility**: Works in all modern browsers without polyfills
- ✅ **GitHub Pages Ready**: Pure client-side implementation, no backend needed

### Image Processing Pipeline
1. **Load**: Upload image from file, URL, or drag-and-drop
2. **Preprocess**: Grayscale conversion, contrast enhancement via Canvas API
3. **Segment**: Grid-based character detection (configurable for different slate sizes)
4. **Recognize**: TensorFlow.js model inference (once model is added)
5. **Output**: Unicode Braille text → LaTeX conversion pipeline

## Next Steps

1. Obtain and convert the model (see conversion steps above)
2. Place model files in `public/models/braille_ocr/`
3. Update `src/lib/brailleOCR.js` model path if needed
4. Test with sample Braille images
5. Fine-tune segmentation parameters for your specific slate dimensions
6. Consider quantization for smaller model size
7. Optimize for deployment to GitHub Pages
