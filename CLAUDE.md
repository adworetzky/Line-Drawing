# CLAUDE.md — Project Context for Claude Code

## Project Overview

Line Drawing Studio is a browser-based application that converts photographs into stylized
line drawings using contour detection, line optimization, and vector rendering. Designed for
pen plotters and digital art. All processing runs client-side with no server or build step.

## Tech Stack

- **Vanilla JavaScript** (ES6, no framework, no build tools)
- **HTML5 / CSS3** — single-page app in `index.html` + `styles.css`
- **Paper.js 0.12.15** — vector graphics rendering & SVG export (loaded via CDN)
- **OpenCV.js** — image processing via WebAssembly (loaded from `js/opencv.js`)
- **Simplify.js** — polyline simplification (third-party, `js/simplify.js`)
- **WebGL** — GPU-accelerated image processing with GLSL shaders (`js/gpu.js`)

## File Structure

```
index.html          — Full application layout and UI
styles.css          — Dark-themed responsive CSS (custom properties, media queries)
js/
  script.js         — Main app controller: UI wiring, presets, image loading, export
  LineRender.js     — Processing pipeline: contour extraction, simplification, hatching, rendering
  editor.js         — Interactive editing: select/pan/erase tools, undo/redo history
  gpu.js            — WebGL shader programs (grayscale, threshold, Sobel, blur) with CPU fallback
  simplify.js       — Third-party RDP simplification algorithm (do not modify)
  opencv.js         — OpenCV WASM loader (do not modify)
assets/             — Sample images and paper texture
output/             — Example output images
```

## Architecture

All JS modules use the IIFE (Immediately Invoked Function Expression) pattern:
- `script.js` is the main controller wrapped in `(function() { ... })()` (anonymous)
- `LineRender` is exposed as `const LineRender = (function() { ... })()`
- `Editor` is exposed as `const Editor = (function() { ... })()`
- `GPUProcessor` is exposed as `const GPUProcessor = (function() { ... })()`

Global dependencies available at runtime: `paper` (Paper.js), `cv` (OpenCV), `simplify` (Simplify.js).

Script load order matters — see `<script>` tags in `index.html`.

## Running Locally

Must be served over HTTP (not `file://`) due to OpenCV WASM CORS restrictions:

```bash
npx serve .            # or: python3 -m http.server 8000
# then open http://localhost:8000
```

## Development Commands

```bash
npm install            # Install dev dependencies (ESLint, Prettier)
npm run lint           # Run ESLint on js/ files (excludes opencv.js and simplify.js)
npm run lint:fix       # Auto-fix ESLint issues
npm run format         # Run Prettier on all source files
npm run format:check   # Check formatting without writing
npm run serve          # Start local dev server on port 8000
```

## Linting & Formatting

- **ESLint** validates JavaScript in `js/script.js`, `js/LineRender.js`, `js/editor.js`, `js/gpu.js`
- **Prettier** formats JS, CSS, and HTML
- `js/opencv.js` and `js/simplify.js` are third-party and excluded from linting/formatting
- Run `npm run lint` to verify changes before committing

## Key Conventions

- No build step — all files are served directly to the browser
- No module bundler — dependencies loaded via `<script>` tags
- CSS uses custom properties (variables) defined in `:root` in `styles.css`
- UI elements are referenced by ID using `document.getElementById()`
- Responsive breakpoints: 1100px (hide right sidebar), 768px (mobile drawer), 480px (full-width)
- The `assets/` and `output/` directories contain large binary files — avoid modifying

## Testing

No automated test suite. To manually verify changes:
1. Serve the app with `npm run serve`
2. Load a sample image from `assets/`
3. Try different presets (Sketch, Technical, Hatched, Minimal, Bold)
4. Adjust processing parameters and click Generate
5. Test editor tools (Select, Pan, Erase) and undo/redo
6. Export as PNG and SVG

## Browser Requirements

Chrome 90+, Firefox 90+, Edge 90+, Safari 15+. WebGL required for GPU acceleration
(falls back to CPU automatically).
