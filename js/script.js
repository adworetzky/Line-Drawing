/**
 * Line Drawing Studio — Main application controller.
 * Wires together UI, processing pipeline (LineRender), GPU module, and editor.
 */
(function () {
    'use strict';

    // ── State ──
    let imageLoaded = false;
    let processing = false;
    let lastRenderResult = null;
    let autoGenTimer = null;
    let autoGenDelay = 300; // Adaptive delay for auto-generate

    // ── Presets ──
    const PRESETS = {
        sketch: {
            'opt-levels': 4,
            'opt-thresh-low': 30,
            'opt-thresh-high': 160,
            'opt-simplify-method': 'rdp',
            'opt-tolerance': 3.5,
            'opt-smooth-type': 'catmull-rom',
            'opt-tension': -0.5,
            'opt-stroke-width': 0.7,
            'opt-edge-method': 'threshold',
            'opt-hatch-enable': false,
            'opt-weight-var': 0.4
        },
        technical: {
            'opt-levels': 10,
            'opt-thresh-low': 15,
            'opt-thresh-high': 200,
            'opt-simplify-method': 'rdp',
            'opt-tolerance': 1,
            'opt-smooth-type': 'none',
            'opt-tension': 0,
            'opt-stroke-width': 0.5,
            'opt-edge-method': 'canny',
            'opt-hatch-enable': false,
            'opt-weight-var': 0
        },
        hatched: {
            'opt-levels': 3,
            'opt-thresh-low': 30,
            'opt-thresh-high': 150,
            'opt-simplify-method': 'rdp',
            'opt-tolerance': 2,
            'opt-smooth-type': 'catmull-rom',
            'opt-tension': -0.8,
            'opt-stroke-width': 0.6,
            'opt-edge-method': 'threshold',
            'opt-hatch-enable': true,
            'opt-hatch-type': 'cross',
            'opt-hatch-spacing': 6,
            'opt-hatch-angle': 45,
            'opt-hatch-brightness': 170,
            'opt-weight-var': 0
        },
        minimal: {
            'opt-levels': 2,
            'opt-thresh-low': 40,
            'opt-thresh-high': 120,
            'opt-simplify-method': 'visvalingam',
            'opt-tolerance': 6,
            'opt-smooth-type': 'geometric',
            'opt-tension': 0.5,
            'opt-stroke-width': 1,
            'opt-edge-method': 'threshold',
            'opt-hatch-enable': false,
            'opt-weight-var': 0
        },
        bold: {
            'opt-levels': 8,
            'opt-thresh-low': 10,
            'opt-thresh-high': 220,
            'opt-simplify-method': 'rdp',
            'opt-tolerance': 1.5,
            'opt-smooth-type': 'catmull-rom',
            'opt-tension': -0.6,
            'opt-stroke-width': 1.5,
            'opt-edge-method': 'threshold',
            'opt-hatch-enable': false,
            'opt-weight-var': 0.8
        }
    };

    // ── DOM refs (populated in init) ──
    const $ = (id) => document.getElementById(id);

    // ── Helpers ──
    function show(el) {
        if (el) el.style.display = '';
    }
    function hide(el) {
        if (el) el.style.display = 'none';
    }

    function readOption(id) {
        const el = $(id);
        if (!el) return null;
        if (el.type === 'checkbox') return el.checked;
        if (el.type === 'range') return parseFloat(el.value);
        return el.value;
    }

    function setProgress(pct, text) {
        const bar = $('progress-bar');
        const fill = $('progress-fill');
        const label = $('progress-text');
        if (pct <= 0) {
            hide(bar);
            return;
        }
        show(bar);
        fill.style.width = pct + '%';
        if (text) label.textContent = text;
    }

    function setLoadingText(msg) {
        const el = $('loading-text');
        if (el) el.textContent = msg;
    }

    // ── Canvas dimensions (inches + DPI) ──
    function getCanvasDimensions() {
        var w = parseFloat($('opt-width-in').value) || 8.5;
        var h = parseFloat($('opt-height-in').value) || 11;
        var dpi = parseInt(readOption('opt-dpi')) || 96;
        return {
            widthIn: w,
            heightIn: h,
            dpi: dpi,
            widthPx: Math.round(w * dpi),
            heightPx: Math.round(h * dpi)
        };
    }

    function updatePixelReadout() {
        var dim = getCanvasDimensions();
        $('dim-pixel-readout').textContent = dim.widthPx + ' x ' + dim.heightPx;
    }

    // ── Image size validation ──
    function validateImageSize(imgElement, file) {
        return new Promise(function (resolve, reject) {
            // Check file size first (before full load)
            var MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (handles 48MP iPhone Pro photos)
            if (file && file.size > MAX_FILE_SIZE) {
                reject({
                    type: 'file_size',
                    message:
                        'File too large (' +
                        (file.size / 1024 / 1024).toFixed(1) +
                        'MB). Maximum: 25MB',
                    size: file.size
                });
                return;
            }

            // Check dimensions after image loads
            // Supports iPhone (3024x4032 = 12MP), iPhone Pro (8064x6048 = 48MP), and DSLRs
            var MAX_DIMENSION = 8192; // 8K images
            var MAX_PIXELS = 50 * 1000000; // 50 megapixels

            var checkDimensions = function () {
                var pixels = imgElement.naturalWidth * imgElement.naturalHeight;
                var maxDim = Math.max(imgElement.naturalWidth, imgElement.naturalHeight);

                if (pixels > MAX_PIXELS || maxDim > MAX_DIMENSION) {
                    reject({
                        type: 'dimensions',
                        message:
                            'Image too large (' +
                            imgElement.naturalWidth +
                            'x' +
                            imgElement.naturalHeight +
                            'px). Maximum: ' +
                            MAX_DIMENSION +
                            'px per side or ' +
                            (MAX_PIXELS / 1000000).toFixed(1) +
                            ' megapixels total.',
                        width: imgElement.naturalWidth,
                        height: imgElement.naturalHeight
                    });
                    return;
                }

                resolve();
            };

            // If image already loaded, check immediately
            if (imgElement.complete && imgElement.naturalWidth > 0) {
                checkDimensions();
            } else {
                // Otherwise wait for load
                imgElement.addEventListener('load', checkDimensions, { once: true });
            }
        });
    }

    // ── Image loading ──
    function loadImage(src, file) {
        var img = $('source-img');
        img.src = src;

        validateImageSize(img, file)
            .then(function () {
                imageLoaded = true;
                $('preview-img').src = img.src;
                show($('source-preview'));
                hide($('drop-zone'));
                hide($('empty-state'));
                show($('canvas-wrapper'));
                setupCanvas();
            })
            .catch(function (error) {
                alert('⚠️ Image Error\n\n' + error.message + '\n\nPlease use a smaller image.');
                console.error('Image validation failed:', error);
                imageLoaded = false;
                // Reset to allow trying again
                img.src = '';
            });

        img.onerror = function () {
            console.error('Failed to load image');
            alert('Failed to load image. Please try a different file.');
            imageLoaded = false;
        };
    }

    // ── Canvas setup (called on load AND on dimension/margin changes) ──
    function setupCanvas() {
        var img = $('source-img');
        if (!img.naturalWidth) return;

        var dim = getCanvasDimensions();

        // Draw to input canvas (contain-fit with optional margin)
        var cInput = $('c-input');
        cInput.width = dim.widthPx;
        cInput.height = dim.heightPx;
        var ctx = cInput.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dim.widthPx, dim.heightPx);
        var margin = (readOption('opt-margin') || 0) * dim.dpi;
        var drawW = dim.widthPx - margin * 2;
        var drawH = dim.heightPx - margin * 2;
        var scale = Math.min(drawW / img.naturalWidth, drawH / img.naturalHeight);
        var x = margin + (drawW - img.naturalWidth * scale) / 2;
        var y = margin + (drawH - img.naturalHeight * scale) / 2;
        ctx.drawImage(img, x, y, img.naturalWidth * scale, img.naturalHeight * scale);

        // Setup output canvas
        var cOutput = $('c-output');
        cOutput.width = dim.widthPx;
        cOutput.height = dim.heightPx;

        // Setup Paper.js on the output canvas
        paper.setup(cOutput);

        // Sync c-input CSS size with c-output (Paper.js may adjust for HiDPI)
        cInput.style.width = cOutput.style.width || dim.widthPx + 'px';
        cInput.style.height = cOutput.style.height || dim.heightPx + 'px';

        // Ensure canvas wrapper maintains aspect ratio
        var wrapper = $('canvas-wrapper');
        var aspectRatio = dim.widthPx / dim.heightPx;
        wrapper.style.aspectRatio = aspectRatio.toFixed(4);

        Editor.init({
            onSelectionChange: updateSelectionInfo,
            onHistoryChange: updateHistoryButtons,
            onZoomChange: updateZoomLabel
        });

        fitCanvasToView();

        $('btn-generate').disabled = false;
        applyBackground();
    }

    function fitCanvasToView() {
        const wrapper = $('canvas-wrapper');
        const area = $('canvas-area');
        if (!wrapper || !area) return;

        // Remove CSS scaling - let Paper.js handle all zoom
        wrapper.style.transform = 'none';
        wrapper.style.transformOrigin = 'center center';

        // Use Paper.js zoom to fit the canvas to the view
        if (Editor.initialized && paper.project.activeLayer) {
            const areaW = area.clientWidth - 40;
            const areaH = area.clientHeight - 40;
            var dim = getCanvasDimensions();

            // Calculate zoom level to fit canvas in viewport
            const zoomX = areaW / dim.widthPx;
            const zoomY = areaH / dim.heightPx;
            const zoom = Math.min(zoomX, zoomY, 1);

            Editor.zoomTo(zoom);
            // Center the view
            paper.view.center = new paper.Point(dim.widthPx / 2, dim.heightPx / 2);
        }
    }

    // ── Background handling ──
    function applyBackground() {
        const cOutput = $('c-output');
        const bg = readOption('opt-background');
        cOutput.style.backgroundColor = '';

        switch (bg) {
            case 'paper':
            case 'white':
                // Paper texture removed for plotter compatibility
                cOutput.style.backgroundColor = '#ffffff';
                break;
            case 'transparent':
                cOutput.style.backgroundColor = 'transparent';
                break;
            case 'custom':
                cOutput.style.backgroundColor = readOption('opt-bg-color');
                break;
        }
    }

    // ── Generation ──
    function generate() {
        if (!imageLoaded || processing) return;
        processing = true;
        $('btn-generate').disabled = true;
        setProgress(5, 'Processing...');

        Editor.clearHistory();

        // Don't reset zoom/pan - preserve user's view state during regeneration

        // Collect options from UI
        var dim = getCanvasDimensions();
        const options = {
            inputCanvas: $('c-input'),
            levels: readOption('opt-levels'),
            threshLow: readOption('opt-thresh-low'),
            threshHigh: readOption('opt-thresh-high'),
            minPoints: readOption('opt-min-points'),
            edgeMethod: readOption('opt-edge-method'),
            simplifyMethod: readOption('opt-simplify-method'),
            tolerance: readOption('opt-tolerance'),
            smoothType: readOption('opt-smooth-type'),
            tension: readOption('opt-tension'),
            strokeWidth: readOption('opt-stroke-width'),
            strokeColor: readOption('opt-stroke-color'),
            useGPU: readOption('opt-gpu'),
            hatchEnabled: readOption('opt-hatch-enable'),
            hatchType: readOption('opt-hatch-type'),
            hatchSpacing: readOption('opt-hatch-spacing'),
            hatchAngle: readOption('opt-hatch-angle'),
            hatchBrightness: readOption('opt-hatch-brightness'),
            margin: readOption('opt-margin'),
            dpi: dim.dpi,
            onProgress: function (pct) {
                setProgress(pct, 'Processing... ' + pct + '%');
            }
        };

        // render() is async — yields between threshold levels to keep UI responsive
        LineRender.render(options)
            .then(function (result) {
                lastRenderResult = result;
                var weightVar = readOption('opt-weight-var');
                if (weightVar > 0) {
                    applyWeightVariation(
                        result,
                        $('c-input'),
                        readOption('opt-stroke-width'),
                        weightVar
                    );
                }
                updateStats(result);
                updateLayers(result);
                Editor.saveSnapshot();
                processing = false;
                $('btn-generate').disabled = false;
                setProgress(0);
            })
            .catch(function (err) {
                console.error('Render error:', err);
                processing = false;
                $('btn-generate').disabled = false;
                setProgress(0);
            });
    }

    // ── Stats + Layers ──
    function updateStats(result) {
        $('stat-paths').textContent = result.totalPaths;
        $('stat-points').textContent = result.totalPoints;
        $('stat-time').textContent = result.renderTimeMs + 'ms';
        $('stat-gpu').textContent = readOption('opt-gpu') && GPUProcessor.available ? 'On' : 'Off';

        var dim = getCanvasDimensions();
        var est = LineRender.estimatePlotTime(result.groups, dim.dpi);
        $('stat-plot-time').textContent = est.formatted;
        $('stat-draw-dist').textContent = est.drawDistM + ' m';
        $('stat-travel-dist').textContent = est.travelDistM + ' m';
        $('stat-pen-lifts').textContent = est.penLifts;
    }

    function updateLayers(result) {
        const list = $('layer-list');
        list.innerHTML = '';
        result.groups.forEach(function (group, i) {
            const item = document.createElement('div');
            item.className = 'layer-item';
            item.innerHTML =
                '<span class="layer-color" style="background:' +
                (readOption('opt-stroke-color') || '#313639') +
                '"></span>' +
                '<span class="layer-name">' +
                group.name +
                '</span>' +
                '<button class="layer-toggle" data-idx="' +
                i +
                '" title="Toggle visibility">' +
                (group.visible ? '&#9673;' : '&#9675;') +
                '</button>';

            item.querySelector('.layer-toggle').addEventListener('click', function (e) {
                e.stopPropagation();
                group.visible = !group.visible;
                this.innerHTML = group.visible ? '&#9673;' : '&#9675;';
                if (!group.visible) this.classList.add('hidden');
                else this.classList.remove('hidden');
                paper.view.draw();
            });

            item.addEventListener('click', function () {
                document.querySelectorAll('.layer-item').forEach(function (el) {
                    el.classList.remove('selected');
                });
                item.classList.add('selected');
            });

            list.appendChild(item);
        });
    }

    function updateSelectionInfo(item) {
        const el = $('selection-info');
        if (!item) {
            el.innerHTML = '<p class="muted">No selection</p>';
            return;
        }
        let info = '';
        if (item instanceof paper.Path) {
            info =
                '<div class="info-row"><span>Type</span><span>Path</span></div>' +
                '<div class="info-row"><span>Segments</span><span>' +
                item.segments.length +
                '</span></div>' +
                '<div class="info-row"><span>Length</span><span>' +
                Math.round(item.length) +
                'px</span></div>' +
                '<div class="info-row"><span>Closed</span><span>' +
                (item.closed ? 'Yes' : 'No') +
                '</span></div>';
        } else if (item instanceof paper.Group) {
            info =
                '<div class="info-row"><span>Type</span><span>Group</span></div>' +
                '<div class="info-row"><span>Children</span><span>' +
                item.children.length +
                '</span></div>';
        } else {
            info =
                '<div class="info-row"><span>Type</span><span>' + item.className + '</span></div>';
        }
        el.innerHTML = info;
    }

    function updateHistoryButtons() {
        $('btn-undo').disabled = !Editor.canUndo;
        $('btn-redo').disabled = !Editor.canRedo;
    }

    function updateZoomLabel(level) {
        $('zoom-level').textContent = Math.round(level * 100) + '%';
    }

    // ── Export ──
    function exportPNG() {
        const canvas = $('c-output');
        const link = document.createElement('a');
        const now = new Date();
        const ts =
            now.getHours().toString().padStart(2, '0') +
            '.' +
            now.getMinutes().toString().padStart(2, '0') +
            '.' +
            now.getSeconds().toString().padStart(2, '0');
        link.download = 'LineDrawing-' + ts + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    function exportSVG() {
        var dim = getCanvasDimensions();
        var svgNode = paper.project.exportSVG({ asString: false });

        // Set physical dimensions so pen plotters interpret real-world size
        svgNode.setAttribute('width', dim.widthIn + 'in');
        svgNode.setAttribute('height', dim.heightIn + 'in');
        svgNode.setAttribute('viewBox', '0 0 ' + dim.widthPx + ' ' + dim.heightPx);

        // Serialize to string
        var serializer = new XMLSerializer();
        var svgStr = serializer.serializeToString(svgNode);

        var blob = new Blob([svgStr], { type: 'image/svg+xml' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        var wLabel = dim.widthIn.toString().replace('.', '_');
        var hLabel = dim.heightIn.toString().replace('.', '_');
        link.download = 'LineDrawing-' + wLabel + 'x' + hLabel + 'in.svg';
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
    }

    // ── Panel toggle ──
    function setupPanelToggles() {
        document.querySelectorAll('.panel-title[data-toggle]').forEach(function (title) {
            title.addEventListener('click', function () {
                const panelId = title.getAttribute('data-toggle');
                const body = $(panelId);
                if (body) {
                    title.classList.toggle('collapsed');
                    body.classList.toggle('collapsed');
                }
            });
        });
    }

    // ── Slider value displays ──
    function setupSliderValues() {
        document.querySelectorAll('.slider-value[data-for]').forEach(function (span) {
            const input = $(span.getAttribute('data-for'));
            if (input) {
                var suffix = span.getAttribute('data-suffix') || '';
                input.addEventListener('input', function () {
                    span.textContent = input.value + suffix;
                });
            }
        });
    }

    // ── File input / drag-drop ──
    function setupImageInput() {
        const dropZone = $('drop-zone');
        const fileInput = $('file-input');

        dropZone.addEventListener('click', function () {
            fileInput.click();
        });

        fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files[0]) {
                loadImage(URL.createObjectURL(fileInput.files[0]), fileInput.files[0]);
            }
        });

        dropZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', function () {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', function (e) {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                loadImage(URL.createObjectURL(e.dataTransfer.files[0]), e.dataTransfer.files[0]);
            }
        });

        $('btn-change-image').addEventListener('click', function () {
            fileInput.click();
        });
    }

    // ── Background option ──
    function setupBackgroundOption() {
        $('opt-background').addEventListener('change', function () {
            const bgRow = $('bg-color-row');
            if (this.value === 'custom') show(bgRow);
            else hide(bgRow);
            applyBackground();
        });
        $('opt-bg-color').addEventListener('input', function () {
            applyBackground();
        });
    }

    // ── Set a control value and update its display ──
    function setControlValue(id, val) {
        var el = $(id);
        if (!el) return;
        el.value = val;
        var span = document.querySelector('.slider-value[data-for="' + id + '"]');
        if (span) {
            var suffix = span.getAttribute('data-suffix') || '';
            span.textContent = val + suffix;
        }
    }

    // ── Auto-threshold: histogram-based parameter tuning ──
    function autoThreshold() {
        if (!imageLoaded) return;

        var cInput = $('c-input');
        var w = cInput.width;
        var h = cInput.height;
        if (!w || !h) return;

        var ctx = cInput.getContext('2d');
        var imageData = ctx.getImageData(0, 0, w, h);
        var pixels = imageData.data;

        // Build brightness histogram, skip near-white background/margins
        var histogram = new Uint32Array(256);
        var contentPixels = 0;
        for (var i = 0; i < pixels.length; i += 4) {
            var lum = (pixels[i] * 77 + pixels[i + 1] * 150 + pixels[i + 2] * 29) >> 8;
            if (lum < 248) {
                histogram[lum]++;
                contentPixels++;
            }
        }

        if (contentPixels < 100) return;

        // Find brightness percentiles of the content pixels
        var cumulative = 0;
        var p5 = 0,
            p95 = 0;
        for (var b = 0; b < 256; b++) {
            cumulative += histogram[b];
            var pct = cumulative / contentPixels;
            if (!p5 && pct >= 0.05) p5 = b;
            if (!p95 && pct >= 0.95) p95 = b;
        }

        // Bracket the content range
        var threshLow = Math.max(10, p5);
        var threshHigh = Math.min(240, p95);

        // Ensure minimum usable range
        if (threshHigh - threshLow < 40) {
            threshLow = Math.max(10, threshLow - 20);
            threshHigh = Math.min(240, threshHigh + 20);
        }

        // Clamp to slider bounds
        threshLow = Math.max(0, Math.min(254, Math.round(threshLow)));
        threshHigh = Math.max(1, Math.min(255, Math.round(threshHigh)));

        // More levels for wider brightness ranges
        var range = threshHigh - threshLow;
        var levels = Math.max(3, Math.min(15, Math.round(range / 18)));

        // Min contour points: scale with resolution to filter noise
        var resolution = Math.sqrt(w * h);
        var minPoints = resolution > 2000 ? 4 : 3;

        // Apply to UI
        setControlValue('opt-thresh-low', threshLow);
        setControlValue('opt-thresh-high', threshHigh);
        setControlValue('opt-levels', levels);
        setControlValue('opt-min-points', minPoints);

        $('opt-preset').value = 'custom';

        // Generate immediately
        generate();
    }

    // ── Weight variation (brightness-adaptive stroke width) ──
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
        // Single draw after all paths updated (was inside loop - major performance hit)
        paper.view.draw();
    }

    // ── Presets ──
    function applyPreset(name) {
        var preset = PRESETS[name];
        if (!preset) return;
        Object.keys(preset).forEach(function (id) {
            var el = $(id);
            if (!el) return;
            var val = preset[id];
            if (el.type === 'checkbox') {
                el.checked = val;
                el.dispatchEvent(new Event('change'));
            } else if (el.type === 'range') {
                el.value = val;
                el.dispatchEvent(new Event('input'));
            } else {
                el.value = val;
                el.dispatchEvent(new Event('change'));
            }
        });
    }

    function setupPresets() {
        $('opt-preset').addEventListener('change', function () {
            if (this.value !== 'custom') {
                applyPreset(this.value);
                scheduleAutoGenerate();
            }
        });
    }

    // ── Auto-generate ──
    function scheduleAutoGenerate() {
        if (!readOption('opt-auto-generate') || !imageLoaded || processing) return;
        clearTimeout(autoGenTimer);

        // Adaptive debounce: starts responsive (300ms), increases if user keeps adjusting
        autoGenTimer = setTimeout(function () {
            generate();
            autoGenDelay = 300; // Reset after generation completes
        }, autoGenDelay);

        // Increase delay for next adjustment (max 600ms) to reduce churn during rapid changes
        autoGenDelay = Math.min(600, autoGenDelay + 150);
    }

    function setupAutoGenerate() {
        document
            .querySelectorAll('#sidebar-left input, #sidebar-left select')
            .forEach(function (el) {
                if (
                    el.id === 'opt-auto-generate' ||
                    el.id === 'opt-preset' ||
                    el.id === 'file-input'
                )
                    return;
                var evt = el.type === 'range' ? 'input' : 'change';
                el.addEventListener(evt, function () {
                    // Any manual change resets preset to Custom
                    if (el.id !== 'opt-preset') {
                        var presetEl = $('opt-preset');
                        if (presetEl.value !== 'custom') presetEl.value = 'custom';
                    }
                    scheduleAutoGenerate();
                });
            });
    }

    // ── Mobile sidebar ──
    function setupMobileSidebar() {
        var sidebar = $('sidebar-left');
        var overlay = $('sidebar-overlay');

        $('btn-sidebar-toggle').addEventListener('click', function () {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('visible');
        });

        overlay.addEventListener('click', function () {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        });

        // Mobile generate button triggers generate + closes drawer
        $('btn-generate-mobile').addEventListener('click', function () {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
            generate();
        });
    }

    // ── Hatching toggle ──
    function setupHatchingOption() {
        $('opt-hatch-enable').addEventListener('change', function () {
            var opts = $('hatch-options');
            if (this.checked) show(opts);
            else hide(opts);
        });
    }

    // ── Tool buttons ──
    function setupToolbar() {
        const toolButtons = {
            'tool-select': 'select',
            'tool-pan': 'pan',
            'tool-erase': 'erase'
        };
        Object.keys(toolButtons).forEach(function (btnId) {
            $(btnId).addEventListener('click', function () {
                document.querySelectorAll('.tool-group .tool-btn').forEach(function (b) {
                    b.classList.remove('active');
                });
                $(btnId).classList.add('active');
                if (Editor.initialized) {
                    Editor.setTool(toolButtons[btnId]);
                }
            });
        });

        $('btn-undo').addEventListener('click', function () {
            if (Editor.initialized) Editor.undo();
        });
        $('btn-redo').addEventListener('click', function () {
            if (Editor.initialized) Editor.redo();
        });

        $('btn-zoom-in').addEventListener('click', function () {
            if (Editor.initialized) Editor.zoom(1.25);
        });
        $('btn-zoom-out').addEventListener('click', function () {
            if (Editor.initialized) Editor.zoom(0.8);
        });
        $('btn-zoom-fit').addEventListener('click', function () {
            if (Editor.initialized) Editor.fitToView();
        });

        $('btn-toggle-source').addEventListener('click', function () {
            var cInput = $('c-input');
            cInput.classList.toggle('show-source');
            $('btn-toggle-source').classList.toggle(
                'active',
                cInput.classList.contains('show-source')
            );
        });

        $('btn-auto-threshold').addEventListener('click', autoThreshold);
        $('btn-export-png').addEventListener('click', exportPNG);
        $('btn-export-svg').addEventListener('click', exportSVG);
        $('btn-generate').addEventListener('click', function () {
            // Close mobile drawer if open
            $('sidebar-left').classList.remove('open');
            $('sidebar-overlay').classList.remove('visible');
            generate();
        });
    }

    // ── Keyboard shortcuts ──
    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (Editor.initialized) Editor.undo();
            } else if (
                (e.ctrlKey || e.metaKey) &&
                (e.key === 'y' || (e.shiftKey && e.key === 'z'))
            ) {
                e.preventDefault();
                if (Editor.initialized) Editor.redo();
            } else if (e.key === 'v' || e.key === 'V') {
                $('tool-select').click();
            } else if (e.key === 'h' || e.key === 'H') {
                $('tool-pan').click();
            } else if (e.key === 'e' || e.key === 'E') {
                $('tool-erase').click();
            } else if (e.key === '=' || e.key === '+') {
                if (Editor.initialized) Editor.zoom(1.25);
            } else if (e.key === '-') {
                if (Editor.initialized) Editor.zoom(0.8);
            } else if (e.key === '0') {
                if (Editor.initialized) Editor.fitToView();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (Editor.initialized) Editor.deleteSelection();
            }
        });
    }

    // ── Theme Switcher ──
    function setupThemeSwitcher() {
        const themeButtons = document.querySelectorAll('.theme-btn');
        const currentTheme = localStorage.getItem('edex-theme') || 'tron';

        // Apply saved theme on load
        if (currentTheme !== 'tron') {
            document.body.className = 'theme-' + currentTheme;
        }

        // Update active button
        themeButtons.forEach(function (btn) {
            if (btn.dataset.theme === currentTheme) {
                btn.classList.add('active');
            }

            btn.addEventListener('click', function () {
                const theme = this.dataset.theme;

                // Remove all theme classes
                document.body.className = '';
                if (theme !== 'tron') {
                    document.body.classList.add('theme-' + theme);
                }

                // Update active state
                themeButtons.forEach(function (b) {
                    b.classList.remove('active');
                });
                this.classList.add('active');

                // Save preference
                localStorage.setItem('edex-theme', theme);

                // Removed glitch effect on theme change
            });
        });
    }

    // ── Dimension controls ──
    function setupDimensionControls() {
        var widthIn = $('opt-width-in');
        var heightIn = $('opt-height-in');
        var preset = $('opt-paper-preset');
        var dpi = $('opt-dpi');
        var btnPortrait = $('btn-portrait');
        var btnLandscape = $('btn-landscape');

        function reloadIfNeeded() {
            updatePixelReadout();
            if (imageLoaded) {
                setupCanvas();
            }
        }

        // Paper preset fills in width/height
        preset.addEventListener('change', function () {
            if (preset.value === 'custom') return;
            var parts = preset.value.split('x');
            var pw = parseFloat(parts[0]);
            var ph = parseFloat(parts[1]);
            // Respect current orientation
            if (btnLandscape.classList.contains('active') && ph > pw) {
                widthIn.value = ph;
                heightIn.value = pw;
            } else {
                widthIn.value = pw;
                heightIn.value = ph;
            }
            reloadIfNeeded();
        });

        // Manual width/height edits switch to Custom
        widthIn.addEventListener('change', function () {
            preset.value = 'custom';
            reloadIfNeeded();
        });
        heightIn.addEventListener('change', function () {
            preset.value = 'custom';
            reloadIfNeeded();
        });

        dpi.addEventListener('change', reloadIfNeeded);

        // Margin change reloads image to re-draw with updated inset
        $('opt-margin').addEventListener('change', reloadIfNeeded);

        // Orientation buttons swap width/height
        btnPortrait.addEventListener('click', function () {
            btnPortrait.classList.add('active');
            btnLandscape.classList.remove('active');
            var w = parseFloat(widthIn.value);
            var h = parseFloat(heightIn.value);
            if (w > h) {
                widthIn.value = h;
                heightIn.value = w;
                reloadIfNeeded();
            }
        });
        btnLandscape.addEventListener('click', function () {
            btnLandscape.classList.add('active');
            btnPortrait.classList.remove('active');
            var w = parseFloat(widthIn.value);
            var h = parseFloat(heightIn.value);
            if (h > w) {
                widthIn.value = h;
                heightIn.value = w;
                reloadIfNeeded();
            }
        });

        updatePixelReadout();

        window.addEventListener('resize', function () {
            fitCanvasToView();
        });
    }

    // ── Init ──
    function init() {
        setLoadingText('Setting up...');

        // Init GPU
        const gpuAvailable = GPUProcessor.init($('c-gpu'));
        if (!gpuAvailable) {
            $('opt-gpu').checked = false;
            $('opt-gpu').disabled = true;
        }

        setupPanelToggles();
        setupSliderValues();
        setupImageInput();
        setupBackgroundOption();
        setupHatchingOption();
        setupPresets();
        setupToolbar();
        setupKeyboard();
        setupThemeSwitcher();
        setupDimensionControls();
        setupMobileSidebar();
        setupAutoGenerate();

        // Disable generate until image loaded
        $('btn-generate').disabled = true;

        // Hide loading
        $('loading-overlay').classList.add('hidden');
        setTimeout(function () {
            hide($('loading-overlay'));
        }, 500);
    }

    // Wait for OpenCV to load
    if (typeof cv !== 'undefined' && cv.onRuntimeInitialized !== undefined) {
        cv['onRuntimeInitialized'] = function () {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init);
            } else {
                init();
            }
        };
    } else {
        // OpenCV might already be loaded or loading will set it
        window.addEventListener('load', function checkCV() {
            if (typeof cv !== 'undefined' && cv.Mat) {
                init();
            } else {
                // Retry
                setTimeout(checkCV, 200);
            }
        });
    }
})();
