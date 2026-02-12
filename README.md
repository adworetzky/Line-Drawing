# Line Drawing Studio

A browser-based application that converts photographs into stylized line drawings using contour detection, line optimization, and vector rendering. All processing runs client-side — no server required.

## Example Output

**Portrait** — contour lines with Catmull-Rom smoothing on paper texture:

![Portrait line drawing](output/download%20(5).png)

**Architecture** — Bradbury Building rendered with brightness threshold detection:

![Architecture line drawing](output/download.png)

## Getting Started

### Prerequisites

A modern web browser with WebGL support (Chrome, Firefox, Edge, Safari).

### Running the App

1. Clone the repository:
   ```bash
   git clone https://github.com/adworetzky/Line-Drawing.git
   cd Line-Drawing
   ```

2. Serve the files with any static HTTP server:
   ```bash
   # Python
   python3 -m http.server 8000

   # Node.js (npx)
   npx serve .

   # VS Code — use the "Live Server" extension
   ```

3. Open `http://localhost:8000` in your browser.

> **Note:** Opening `index.html` directly via `file://` will not work due to browser CORS restrictions on the OpenCV WASM module.

### Basic Workflow

1. **Load an image** — Drag and drop onto the source panel, or click to browse.
2. **Adjust settings** — Tweak processing, line optimization, and style controls in the left sidebar.
3. **Generate** — Click the blue **Generate Line Drawing** button.
4. **Edit** — Use the toolbar to select, move, or erase individual paths.
5. **Export** — Save as PNG or SVG using the buttons in the top-right corner.

## Features

### Image Processing

| Feature | Description |
|---------|-------------|
| **Brightness Threshold** | Generates iso-brightness contour lines at multiple levels |
| **Canny Edge Detection** | Uses OpenCV's Canny algorithm for sharp edge detection |
| **Adaptive Threshold** | Applies locally adaptive thresholding for uneven lighting |
| **GPU Acceleration** | WebGL shaders handle grayscale conversion, thresholding, Sobel edge detection, and Gaussian blur on the GPU. Falls back to CPU automatically if WebGL is unavailable. |

### Line Optimization

Three simplification algorithms to control output complexity:

- **Ramer-Douglas-Peucker** — Classic recursive simplification that removes points deviating less than a tolerance from a line segment. Good general-purpose choice.
- **Visvalingam-Whyatt** — Area-based simplification that removes points contributing the least triangle area. Produces smoother results on organic shapes.
- **Radial Distance** — Fast distance-based filtering that collapses nearby points. Best for reducing density without altering overall shape.

Adjustable tolerance controls how aggressively points are removed (0 = no simplification, 20 = maximum).

### Smoothing

Four smoothing modes applied after simplification via Paper.js:

- **Catmull-Rom** — Spline interpolation that passes through all control points. Adjustable tension from -1 to 1.
- **Geometric** — Smoothing based on geometric relationships between segments.
- **Continuous** — Ensures continuous curvature across the path.
- **None (Angular)** — Keeps simplified points as-is with straight segments.

### Interactive Editor

| Tool | Shortcut | Description |
|------|----------|-------------|
| **Select** | `V` | Click to select paths. Drag to move them. Press `Delete` to remove. |
| **Pan** | `H` | Click and drag to pan the canvas view. |
| **Eraser** | `E` | Click or drag over paths to delete them. |
| **Undo** | `Ctrl+Z` | Revert the last editing action (up to 50 steps). |
| **Redo** | `Ctrl+Y` | Reapply a reverted action. |
| **Zoom In** | `+` | Zoom into the canvas. |
| **Zoom Out** | `-` | Zoom out of the canvas. |
| **Fit to View** | `0` | Reset zoom to fit the drawing in the viewport. |

### Style Controls

- **Stroke width** — 0.1px to 5px
- **Stroke color** — Any color via the color picker
- **Background** — Paper texture, white, transparent, or a custom color
- **Canvas size** — 1080x1080, 2048x2048, or 4096x4096

### Layer Management

Each contour threshold level is rendered as a separate layer. The right sidebar shows all layers with:

- Visibility toggles (click the circle icon to show/hide a level)
- Selection highlighting
- Live statistics (total paths, total points, render time, GPU status)

### Export

- **PNG** — Rasterized export at full canvas resolution with a timestamped filename.
- **SVG** — Vector export using Blob URLs for reliable downloads of large files.

## Project Structure

```
Line-Drawing/
├── index.html            # Application layout
├── styles.css            # Dark-themed UI styles
├── js/
│   ├── script.js         # Main application controller
│   ├── LineRender.js     # Processing pipeline (contours, simplification, rendering)
│   ├── editor.js         # Interactive editing tools and undo/redo
│   ├── gpu.js            # WebGL shader-based GPU processing
│   ├── simplify.js       # Ramer-Douglas-Peucker algorithm (third-party)
│   └── opencv.js         # OpenCV.js WASM module
├── assets/               # Sample images and paper texture
└── output/               # Example output images
```

## Technology Stack

- **[Paper.js](http://paperjs.org/)** — Vector graphics rendering and SVG export
- **[OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)** — Image processing and contour detection (compiled to WebAssembly)
- **[Simplify.js](https://mourner.github.io/simplify-js/)** — High-performance polyline simplification
- **WebGL** — GPU-accelerated image processing via custom GLSL shaders
- **Vanilla JS/HTML/CSS** — No build tools or frameworks required

## Browser Support

| Browser | Status |
|---------|--------|
| Chrome 90+ | Fully supported |
| Firefox 90+ | Fully supported |
| Edge 90+ | Fully supported |
| Safari 15+ | Supported (WebGL may vary) |

## License

This project is provided as-is for educational and personal use.
