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

    // ── DOM refs (populated in init) ──
    const $ = (id) => document.getElementById(id);

    // ── Helpers ──
    function show(el) { if (el) el.style.display = ''; }
    function hide(el) { if (el) el.style.display = 'none'; }

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
        if (pct <= 0) { hide(bar); return; }
        show(bar);
        fill.style.width = pct + '%';
        if (text) label.textContent = text;
    }

    function setLoadingText(msg) {
        const el = $('loading-text');
        if (el) el.textContent = msg;
    }

    // ── Image loading ──
    function loadImage(src) {
        const img = $('source-img');
        img.onload = function () {
            imageLoaded = true;
            // Show preview
            $('preview-img').src = img.src;
            show($('source-preview'));
            hide($('drop-zone'));
            hide($('empty-state'));
            show($('canvas-wrapper'));

            // Draw to input canvas
            const cInput = $('c-input');
            const size = parseInt(readOption('opt-canvas-size')) || 1080;
            cInput.width = size;
            cInput.height = size;
            const ctx = cInput.getContext('2d');
            const scale = Math.max(size / img.width, size / img.height);
            const x = (size - img.width * scale) / 2;
            const y = (size - img.height * scale) / 2;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

            // Setup output canvas
            const cOutput = $('c-output');
            cOutput.width = size;
            cOutput.height = size;

            // Fit canvas in view
            fitCanvasToView();

            // Setup Paper.js on the output canvas
            paper.setup(cOutput);

            // Initialize editor tools
            Editor.init({
                onSelectionChange: updateSelectionInfo,
                onHistoryChange: updateHistoryButtons,
                onZoomChange: updateZoomLabel
            });

            $('btn-generate').disabled = false;
            applyBackground();
        };
        img.onerror = function () {
            console.error('Failed to load image');
            imageLoaded = false;
        };
        img.src = src;
    }

    function fitCanvasToView() {
        const wrapper = $('canvas-wrapper');
        const area = $('canvas-area');
        const cOutput = $('c-output');
        if (!cOutput || !area) return;

        const areaW = area.clientWidth - 40;
        const areaH = area.clientHeight - 40;
        const scale = Math.min(areaW / cOutput.width, areaH / cOutput.height, 1);
        wrapper.style.transform = 'scale(' + scale + ')';
        wrapper.style.transformOrigin = 'center center';
    }

    // ── Background handling ──
    function applyBackground() {
        const cOutput = $('c-output');
        const bg = readOption('opt-background');
        cOutput.classList.remove('paper-bg');
        cOutput.style.backgroundColor = '';

        switch (bg) {
            case 'paper':
                cOutput.classList.add('paper-bg');
                break;
            case 'white':
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

        // Collect options from UI
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
            onProgress: function (pct) {
                setProgress(pct, 'Processing... ' + pct + '%');
            }
        };

        // Use requestAnimationFrame to let the UI update before heavy work
        requestAnimationFrame(function () {
            setTimeout(function () {
                try {
                    lastRenderResult = LineRender.render(options);
                    updateStats(lastRenderResult);
                    updateLayers(lastRenderResult);
                    Editor.saveSnapshot();
                } catch (err) {
                    console.error('Render error:', err);
                    setProgress(0);
                }
                processing = false;
                $('btn-generate').disabled = false;
                setProgress(0);
            }, 50);
        });
    }

    // ── Stats + Layers ──
    function updateStats(result) {
        $('stat-paths').textContent = result.totalPaths;
        $('stat-points').textContent = result.totalPoints;
        $('stat-time').textContent = result.renderTimeMs + 'ms';
        $('stat-gpu').textContent = (readOption('opt-gpu') && GPUProcessor.available) ? 'On' : 'Off';
    }

    function updateLayers(result) {
        const list = $('layer-list');
        list.innerHTML = '';
        result.groups.forEach(function (group, i) {
            const item = document.createElement('div');
            item.className = 'layer-item';
            item.innerHTML =
                '<span class="layer-color" style="background:' + (readOption('opt-stroke-color') || '#313639') + '"></span>' +
                '<span class="layer-name">' + group.name + '</span>' +
                '<button class="layer-toggle" data-idx="' + i + '" title="Toggle visibility">' +
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
                document.querySelectorAll('.layer-item').forEach(function (el) { el.classList.remove('selected'); });
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
            info = '<div class="info-row"><span>Type</span><span>Path</span></div>' +
                '<div class="info-row"><span>Segments</span><span>' + item.segments.length + '</span></div>' +
                '<div class="info-row"><span>Length</span><span>' + Math.round(item.length) + 'px</span></div>' +
                '<div class="info-row"><span>Closed</span><span>' + (item.closed ? 'Yes' : 'No') + '</span></div>';
        } else if (item instanceof paper.Group) {
            info = '<div class="info-row"><span>Type</span><span>Group</span></div>' +
                '<div class="info-row"><span>Children</span><span>' + item.children.length + '</span></div>';
        } else {
            info = '<div class="info-row"><span>Type</span><span>' + item.className + '</span></div>';
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
        const ts = now.getHours().toString().padStart(2, '0') + '.' +
            now.getMinutes().toString().padStart(2, '0') + '.' +
            now.getSeconds().toString().padStart(2, '0');
        link.download = 'LineDrawing-' + ts + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    function exportSVG() {
        const svgStr = paper.project.exportSVG({ asString: true });
        const blob = new Blob([svgStr], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = 'LineDrawing.svg';
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
                input.addEventListener('input', function () {
                    span.textContent = input.value;
                });
            }
        });
    }

    // ── File input / drag-drop ──
    function setupImageInput() {
        const dropZone = $('drop-zone');
        const fileInput = $('file-input');

        dropZone.addEventListener('click', function () { fileInput.click(); });

        fileInput.addEventListener('change', function () {
            if (fileInput.files && fileInput.files[0]) {
                loadImage(URL.createObjectURL(fileInput.files[0]));
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
                loadImage(URL.createObjectURL(e.dataTransfer.files[0]));
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

    // ── Tool buttons ──
    function setupToolbar() {
        const toolButtons = {
            'tool-select': 'select',
            'tool-pan': 'pan',
            'tool-erase': 'erase'
        };
        Object.keys(toolButtons).forEach(function (btnId) {
            $(btnId).addEventListener('click', function () {
                document.querySelectorAll('.tool-group .tool-btn').forEach(function (b) { b.classList.remove('active'); });
                $(btnId).classList.add('active');
                if (Editor.initialized) {
                    Editor.setTool(toolButtons[btnId]);
                }
            });
        });

        $('btn-undo').addEventListener('click', function () { if (Editor.initialized) Editor.undo(); });
        $('btn-redo').addEventListener('click', function () { if (Editor.initialized) Editor.redo(); });

        $('btn-zoom-in').addEventListener('click', function () { if (Editor.initialized) Editor.zoom(1.25); });
        $('btn-zoom-out').addEventListener('click', function () { if (Editor.initialized) Editor.zoom(0.8); });
        $('btn-zoom-fit').addEventListener('click', function () { if (Editor.initialized) Editor.fitToView(); });

        $('btn-export-png').addEventListener('click', exportPNG);
        $('btn-export-svg').addEventListener('click', exportSVG);
        $('btn-generate').addEventListener('click', generate);
    }

    // ── Keyboard shortcuts ──
    function setupKeyboard() {
        document.addEventListener('keydown', function (e) {
            // Ignore if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (Editor.initialized) Editor.undo();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
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

    // ── Canvas resize ──
    function setupCanvasResize() {
        $('opt-canvas-size').addEventListener('change', function () {
            if (imageLoaded) {
                const img = $('source-img');
                loadImage(img.src);
            }
        });

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
        setupToolbar();
        setupKeyboard();
        setupCanvasResize();

        // Disable generate until image loaded
        $('btn-generate').disabled = true;

        // Hide loading
        $('loading-overlay').classList.add('hidden');
        setTimeout(function () { hide($('loading-overlay')); }, 500);
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
