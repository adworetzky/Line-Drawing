# Performance Optimization Implementation Guide

This document provides specific code changes to address the issues identified in PERFORMANCE_REVIEW.md.

---

## Fix #1: Event Listener Cleanup (Critical)

### Problem Location: `js/script.js` and `js/editor.js`

**Current Issue**:
```javascript
// setupCanvas() called on every dimension change
Editor.init({
    onSelectionChange: updateSelectionInfo,
    onHistoryChange: updateHistoryButtons,
    onZoomChange: updateZoomLabel
});
```

**Solution**:
```javascript
// Add initialization guard to Editor.init()
init: function (callbacks) {
    // Only initialize once
    if (_initialized) {
        // Just update callbacks if already initialized
        if (callbacks) {
            onSelectionChange = callbacks.onSelectionChange || onSelectionChange;
            onHistoryChange = callbacks.onHistoryChange || onHistoryChange;
            onZoomChange = callbacks.onZoomChange || onZoomChange;
        }
        return;
    }

    // ... rest of init code
    initTools();
    _initialized = true;
    this.setTool('select');
}
```

**Files to modify**: `js/editor.js` (line 154-163)

---

## Fix #2: Image Size Validation (Critical)

### Add to `js/script.js` before `loadImage()`

**Insert after line 160**:
```javascript
function validateImageSize(file, imgElement) {
    return new Promise((resolve, reject) => {
        // Check file size first (before loading)
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (file && file.size > MAX_FILE_SIZE) {
            reject({
                type: 'file_size',
                message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum: 10MB`,
                size: file.size
            });
            return;
        }

        // Check dimensions after image loads
        const MAX_DIMENSION = 4000;
        const MAX_PIXELS = 4000 * 4000;

        const tempImg = new Image();
        tempImg.onload = function() {
            const pixels = tempImg.naturalWidth * tempImg.naturalHeight;
            const maxDim = Math.max(tempImg.naturalWidth, tempImg.naturalHeight);

            if (pixels > MAX_PIXELS || maxDim > MAX_DIMENSION) {
                reject({
                    type: 'dimensions',
                    message: `Image too large (${tempImg.naturalWidth}x${tempImg.naturalHeight}). Maximum: ${MAX_DIMENSION}px per side or ${(MAX_PIXELS / 1000000).toFixed(1)}MP total`,
                    width: tempImg.naturalWidth,
                    height: tempImg.naturalHeight
                });
                return;
            }

            resolve(imgElement);
        };
        tempImg.onerror = () => reject({ type: 'load_error', message: 'Failed to load image' });
        tempImg.src = imgElement.src;
    });
}

// Update loadImage to use validation
function loadImage(src, file) {
    var img = $('source-img');
    img.src = src;

    validateImageSize(file, img)
        .then(() => {
            img.onload = function () {
                imageLoaded = true;
                $('preview-img').src = img.src;
                show($('source-preview'));
                hide($('drop-zone'));
                hide($('empty-state'));
                show($('canvas-wrapper'));
                setupCanvas();
            };
            img.onerror = function () {
                console.error('Failed to load image');
                imageLoaded = false;
            };
        })
        .catch((error) => {
            alert('⚠️ Image Error\n\n' + error.message + '\n\nPlease use a smaller image.');
            imageLoaded = false;
        });
}

// Update file input handlers (lines 483-486 and 499-501)
fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) {
        loadImage(URL.createObjectURL(fileInput.files[0]), fileInput.files[0]);
    }
});

// ... and in drop handler
dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        loadImage(URL.createObjectURL(e.dataTransfer.files[0]), e.dataTransfer.files[0]);
    }
});
```

**Files to modify**: `js/script.js` (insert after line 160, modify lines 483-501)

---

## Fix #3: Use requestAnimationFrame Instead of setTimeout (Medium)

### Location: `js/LineRender.js`

**Current code (line 462)**:
```javascript
setTimeout(function () {
    processLevel(idx + 1);
}, 0);
```

**Improved code**:
```javascript
requestAnimationFrame(function () {
    processLevel(idx + 1);
});
```

**Files to modify**: `js/LineRender.js` (line 462)

---

## Fix #4: WebGL Context Loss Handling (Critical)

### Location: `js/gpu.js`

**Add after line 228**:
```javascript
// Add context loss recovery
canvas.addEventListener('webglcontextlost', function(event) {
    event.preventDefault();
    console.warn('WebGL context lost, disabling GPU acceleration');
    _available = false;
}, false);

canvas.addEventListener('webglcontextrestored', function() {
    console.log('WebGL context restored, re-initializing GPU');
    // Re-initialize all programs
    programs.grayscale = createProgram(FRAG_GRAYSCALE);
    programs.threshold = createProgram(FRAG_THRESHOLD);
    programs.sobel = createProgram(FRAG_SOBEL);
    programs.blurH = createProgram(FRAG_BLUR_H);
    programs.blurV = createProgram(FRAG_BLUR_V);
    _available = Object.values(programs).every(Boolean);

    if (_available) {
        console.log('GPU re-initialized successfully');
    }
}, false);
```

**Files to modify**: `js/gpu.js` (add after line 228 in init())

---

## Fix #5: Cache GPU Source Texture (Performance)

### Location: `js/LineRender.js`

**Current approach**: Uploads source canvas N times for N threshold levels

**Optimized approach**:

```javascript
// In render() function, after line 408
var gpuSourceTexture = null; // Cache texture across levels
var gray = null;
if (!useGPU || !GPUProcessor.available) {
    var src = cv.imread(inputCanvas);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    src.delete();
} else {
    // Upload source once and cache
    gpuSourceTexture = GPUProcessor.uploadSourceTexture(inputCanvas);
}

function processLevel(idx) {
    if (idx >= thresholds.length) {
        if (gray) gray.delete();
        if (gpuSourceTexture) GPUProcessor.deleteTexture(gpuSourceTexture);
        finalize();
        return;
    }

    var threshVal = thresholds[idx];
    if (onProgress) {
        onProgress(Math.round(((idx + 1) / thresholds.length) * 80));
    }

    var rawContours;
    if (useGPU && GPUProcessor.available) {
        // Use cached texture instead of re-uploading
        var imageData = GPUProcessor.thresholdCached(gpuSourceTexture, threshVal, inputCanvas.width, inputCanvas.height);
        rawContours = extractContoursGPU(imageData, minPoints);
    } else {
        rawContours = extractContoursFromGray(gray, threshVal, minPoints, edgeMethod);
    }
    // ... rest
}
```

**Also add to gpu.js**:
```javascript
uploadSourceTexture: function(sourceCanvas) {
    if (!_available) return null;
    return uploadTexture(sourceCanvas);
},

deleteTexture: function(texture) {
    if (texture) gl.deleteTexture(texture);
},

thresholdCached: function(sourceTexture, thresholdValue, width, height) {
    if (!_available || !sourceTexture) return null;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);

    const prog = programs.threshold;
    gl.useProgram(prog);
    setupGeometry(prog);

    gl.bindTexture(gl.TEXTURE_2D, sourceTexture); // Use cached texture
    gl.uniform1f(gl.getUniformLocation(prog, 'u_threshold'), thresholdValue / 255.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // Don't delete texture - it's cached

    // Flip vertically
    const flipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const srcOff = (height - 1 - y) * width * 4;
        const dstOff = y * width * 4;
        flipped.set(pixels.subarray(srcOff, srcOff + width * 4), dstOff);
    }

    return new ImageData(new Uint8ClampedArray(flipped.buffer), width, height);
}
```

**Files to modify**: `js/LineRender.js` (lines 408-434), `js/gpu.js` (add new methods)

---

## Fix #6: Remove Redundant paper.view.draw() Calls

### Location: Multiple files

**Locations with redundant draws**:
1. `js/script.js` line 625 - Inside weight variation loop (worst offender)
2. `js/editor.js` lines 100, 136, 148, 277

**Strategy**:
- Remove draw() calls INSIDE loops
- Add single draw() call AFTER batch operations complete

**Example fix for weight variation** (js/script.js:606-626):
```javascript
function applyWeightVariation(result, inputCanvas, baseWidth, variation) {
    var w = inputCanvas.width;
    var h = inputCanvas.height;
    var ctx = inputCanvas.getContext('2d');
    var imageData = ctx.getImageData(0, 0, w, h);
    var pixels = imageData.data;

    result.groups.forEach(function (group) {
        for (var i = 0; i < group.children.length; i++) {
            var path = group.children[i];
            if (!path.bounds || path.bounds.width === 0) continue;
            var cx = Math.round(Math.max(0, Math.min(w - 1, path.bounds.center.x)));
            var cy = Math.round(Math.max(0, Math.min(h - 1, path.bounds.center.y)));
            var idx = (cy * w + cx) * 4;
            var b = pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
            // Darker areas → thicker strokes
            path.strokeWidth = baseWidth * (1 + variation * (1 - b / 255));
        }
    });
    // MOVED: Single draw after all paths updated
    paper.view.draw();
}
```

**Files to modify**: `js/script.js` (line 625), `js/editor.js` (lines 100, 136, 148, 277)

---

## Fix #7: Improve Auto-Generate Responsiveness (Polish)

### Location: `js/script.js`

**Current** (line 671):
```javascript
autoGenTimer = setTimeout(generate, 600);
```

**Improved with exponential backoff**:
```javascript
let autoGenDelay = 300; // Start responsive

function scheduleAutoGenerate() {
    if (!readOption('opt-auto-generate') || !imageLoaded || processing) return;
    clearTimeout(autoGenTimer);

    // Use shorter delay for rapid adjustments, longer for stability
    autoGenTimer = setTimeout(function() {
        generate();
        autoGenDelay = 300; // Reset after generation
    }, autoGenDelay);

    // Increase delay if user keeps adjusting (max 600ms)
    autoGenDelay = Math.min(600, autoGenDelay + 100);
}
```

**Files to modify**: `js/script.js` (lines 667-672)

---

## Implementation Checklist

- [ ] **Fix #1**: Event listener cleanup (CRITICAL)
- [ ] **Fix #2**: Image size validation (CRITICAL)
- [ ] **Fix #3**: requestAnimationFrame (MEDIUM)
- [ ] **Fix #4**: WebGL context recovery (CRITICAL)
- [ ] **Fix #5**: Cache GPU textures (PERFORMANCE)
- [ ] **Fix #6**: Remove redundant draws (PERFORMANCE)
- [ ] **Fix #7**: Auto-generate tuning (POLISH)

---

## Testing Plan

After each fix:

1. **Fix #1**: Change dimensions 10x rapidly → check DevTools Memory tab
2. **Fix #2**: Try loading 8000x8000px image → should show error
3. **Fix #3**: Monitor FPS during generation with DevTools Performance
4. **Fix #4**: Simulate context loss in Chrome DevTools → should recover
5. **Fix #5**: Profile GPU memory usage with `about:gpu`
6. **Fix #6**: Count draw calls with Paper.js debug mode
7. **Fix #7**: Adjust slider rapidly → feel should be snappier

---

## Risk Assessment

| Fix | Risk | Complexity | Impact |
|-----|------|------------|--------|
| #1  | Low  | Medium     | High   |
| #2  | Low  | Low        | High   |
| #3  | Low  | Low        | Medium |
| #4  | Low  | Medium     | High   |
| #5  | Medium | High     | Medium |
| #6  | Low  | Low        | Medium |
| #7  | Low  | Low        | Low    |

**Recommendation**: Implement in order listed, test thoroughly after #1-#4 before proceeding to #5-#7.
