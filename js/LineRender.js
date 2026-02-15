/**
 * LineRender — Processing pipeline for image → contour → line drawing.
 * Supports multiple simplification algorithms, smoothing types, and GPU acceleration.
 */
const LineRender = (function () {
    'use strict';

    /**
     * Generate stippling (dots) based on image brightness.
     * Darker areas get more/bigger dots, lighter areas get fewer/smaller dots.
     * Popular technique for pen plotters.
     */
    function generateStippling(inputCanvas, options) {
        var dotDensity = options.dotDensity || 5000; // Total number of dots
        var minDotSize = options.minDotSize || 0.5; // Minimum dot radius
        var maxDotSize = options.maxDotSize || 3; // Maximum dot radius
        var distribution = options.distribution || 'weighted'; // 'weighted' or 'uniform'

        var w = inputCanvas.width;
        var h = inputCanvas.height;
        var ctx = inputCanvas.getContext('2d');
        var imageData = ctx.getImageData(0, 0, w, h);
        var pixels = imageData.data;

        // Build brightness map
        var brightnessMap = new Float32Array(w * h);
        for (var i = 0; i < pixels.length; i += 4) {
            var lum = (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255;
            brightnessMap[i / 4] = 1 - lum; // Invert: darker = higher value
        }

        // Generate dots using weighted random sampling
        var dots = [];
        for (var n = 0; n < dotDensity; n++) {
            var x, y, brightness;

            if (distribution === 'weighted') {
                // Weighted sampling: prefer darker areas
                var attempts = 0;
                do {
                    x = Math.random() * w;
                    y = Math.random() * h;
                    var idx = Math.floor(y) * w + Math.floor(x);
                    brightness = brightnessMap[idx] || 0;
                    attempts++;
                } while (Math.random() > brightness && attempts < 5);
            } else {
                // Uniform distribution
                x = Math.random() * w;
                y = Math.random() * h;
                var idx2 = Math.floor(y) * w + Math.floor(x);
                brightness = brightnessMap[idx2] || 0;
            }

            // Dot size based on local brightness
            var radius = minDotSize + brightness * (maxDotSize - minDotSize);

            dots.push({ x: x, y: y, radius: radius });
        }

        return dots;
    }

    // Reusable temp canvas for GPU contour extraction (avoids DOM allocation per level)
    var _gpuTempCanvas = null;

    /**
     * Visvalingam-Whyatt simplification: removes points that contribute
     * the least area, preserving shape fidelity better than RDP for smooth curves.
     */
    function triangleArea(p1, p2, p3) {
        return Math.abs((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1])) / 2;
    }

    function simplifyVisvalingam(points, tolerance) {
        if (points.length <= 3) return points.slice();
        const minArea = tolerance * tolerance;
        let pts = points.map((p, i) => ({ x: p[0], y: p[1], idx: i }));

        while (pts.length > 3) {
            let minIdx = -1;
            let minVal = Infinity;
            for (let i = 1; i < pts.length - 1; i++) {
                const area = triangleArea(
                    [pts[i - 1].x, pts[i - 1].y],
                    [pts[i].x, pts[i].y],
                    [pts[i + 1].x, pts[i + 1].y]
                );
                if (area < minVal) {
                    minVal = area;
                    minIdx = i;
                }
            }
            if (minVal >= minArea) break;
            pts.splice(minIdx, 1);
        }
        return pts.map((p) => [p.x, p.y]);
    }

    /**
     * Radial distance simplification: removes points that are too close together.
     */
    function simplifyRadial(points, tolerance) {
        if (points.length <= 2) return points.slice();
        const sqTol = tolerance * tolerance;
        const result = [points[0]];
        let prev = points[0];
        for (let i = 1; i < points.length; i++) {
            const dx = points[i][0] - prev[0];
            const dy = points[i][1] - prev[1];
            if (dx * dx + dy * dy > sqTol) {
                result.push(points[i]);
                prev = points[i];
            }
        }
        if (result[result.length - 1] !== points[points.length - 1]) {
            result.push(points[points.length - 1]);
        }
        return result;
    }

    /**
     * Apply the chosen simplification algorithm.
     */
    function simplifyPoints(points, method, tolerance) {
        if (method === 'none' || tolerance <= 0) return points;
        switch (method) {
            case 'visvalingam':
                return simplifyVisvalingam(points, tolerance);
            case 'radial':
                return simplifyRadial(points, tolerance);
            case 'rdp':
            default:
                return typeof simplify === 'function' ? simplify(points, tolerance) : points;
        }
    }

    /**
     * Extract contour point arrays from an OpenCV source mat at a given threshold.
     */
    function extractContours(src, threshValue, minPoints, edgeMethod) {
        let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);

        if (edgeMethod === 'canny') {
            cv.Canny(dst, dst, threshValue * 0.5, threshValue, 3, false);
        } else if (edgeMethod === 'adaptive') {
            cv.adaptiveThreshold(
                dst,
                dst,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                11,
                threshValue / 25
            );
        } else {
            cv.threshold(dst, dst, threshValue, 255, cv.THRESH_BINARY);
        }

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(dst, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

        let result = [];
        for (let j = 0; j < contours.size(); j++) {
            const ci = contours.get(j);
            if (ci.data32S.length / 2 < minPoints) continue;
            let pts = [];
            for (let k = 0; k < ci.data32S.length; k += 2) {
                pts.push([ci.data32S[k], ci.data32S[k + 1]]);
            }
            result.push(pts);
        }

        dst.delete();
        contours.delete();
        hierarchy.delete();
        return result;
    }

    /**
     * Extract contours from a pre-converted grayscale Mat.
     * Avoids redundant RGBA→gray conversion when processing multiple threshold levels.
     */
    function extractContoursFromGray(grayMat, threshValue, minPoints, edgeMethod) {
        var dst = grayMat.clone();

        if (edgeMethod === 'canny') {
            cv.Canny(dst, dst, threshValue * 0.5, threshValue, 3, false);
        } else if (edgeMethod === 'adaptive') {
            cv.adaptiveThreshold(
                dst,
                dst,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                11,
                threshValue / 25
            );
        } else {
            cv.threshold(dst, dst, threshValue, 255, cv.THRESH_BINARY);
        }

        var contours = new cv.MatVector();
        var hierarchy = new cv.Mat();
        cv.findContours(dst, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

        var result = [];
        for (var j = 0; j < contours.size(); j++) {
            var ci = contours.get(j);
            if (ci.data32S.length / 2 < minPoints) continue;
            var pts = [];
            for (var k = 0; k < ci.data32S.length; k += 2) {
                pts.push([ci.data32S[k], ci.data32S[k + 1]]);
            }
            result.push(pts);
        }

        dst.delete();
        contours.delete();
        hierarchy.delete();
        return result;
    }

    /**
     * Extract contours using GPU-thresholded ImageData.
     * The thresholded image is written to a temp canvas for OpenCV to read.
     */
    function extractContoursGPU(imageData, minPoints) {
        if (!_gpuTempCanvas) {
            _gpuTempCanvas = document.createElement('canvas');
        }
        _gpuTempCanvas.width = imageData.width;
        _gpuTempCanvas.height = imageData.height;
        var ctx = _gpuTempCanvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        let src = cv.imread(_gpuTempCanvas);
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(gray, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);

        let result = [];
        for (let j = 0; j < contours.size(); j++) {
            const ci = contours.get(j);
            if (ci.data32S.length / 2 < minPoints) continue;
            let pts = [];
            for (let k = 0; k < ci.data32S.length; k += 2) {
                pts.push([ci.data32S[k], ci.data32S[k + 1]]);
            }
            result.push(pts);
        }

        src.delete();
        gray.delete();
        contours.delete();
        hierarchy.delete();
        return result;
    }

    /**
     * Build threshold array from low to high across N levels.
     */
    function buildThresholds(low, high, levels) {
        const arr = [];
        const inc = (high - low) / levels;
        for (let i = 0; i < levels; i++) {
            arr.push(low + inc * (i + 1));
        }
        return arr;
    }

    /**
     * Generate brightness-adaptive hatching lines from the source canvas.
     * Returns an array of point arrays (line segments).
     *
     * For cross/triple hatching, each successive pass uses a tighter
     * brightness threshold so that only darker areas receive additional
     * hatch layers — building up natural tonal density.
     */
    function generateHatching(inputCanvas, opts) {
        var spacing = opts.hatchSpacing || 8;
        var baseAngle = ((opts.hatchAngle || 45) * Math.PI) / 180;
        var type = opts.hatchType || 'cross';
        var maxBright = opts.hatchBrightness || 170;
        var stepSize = 2; // sample every 2 px along each scan line

        var w = inputCanvas.width;
        var h = inputCanvas.height;
        var ctx = inputCanvas.getContext('2d');
        var imageData = ctx.getImageData(0, 0, w, h);
        var pixels = imageData.data;
        var diag = Math.sqrt(w * w + h * h);

        // Precompute grayscale lookup (integer math, single array vs per-pixel function)
        var grayData = new Uint8Array(w * h);
        for (var gi = 0, gj = 0; gi < pixels.length; gi += 4, gj++) {
            grayData[gj] = (pixels[gi] * 77 + pixels[gi + 1] * 150 + pixels[gi + 2] * 29) >> 8;
        }

        // Build pass list — each pass gets a progressively tighter threshold
        var passes;
        if (type === 'parallel') {
            passes = [{ angle: baseAngle, thresh: maxBright }];
        } else if (type === 'cross') {
            passes = [
                { angle: baseAngle, thresh: maxBright },
                { angle: baseAngle + Math.PI / 2, thresh: maxBright * 0.6 }
            ];
        } else {
            // triple
            passes = [
                { angle: baseAngle, thresh: maxBright },
                { angle: baseAngle + Math.PI / 3, thresh: maxBright * 0.55 },
                { angle: baseAngle + (2 * Math.PI) / 3, thresh: maxBright * 0.3 }
            ];
        }

        var segments = [];

        passes.forEach(function (pass) {
            var cosA = Math.cos(pass.angle);
            var sinA = Math.sin(pass.angle);
            var numLines = Math.ceil(diag / spacing);

            var cx = w / 2;
            var cy = h / 2;

            for (var i = -numLines; i <= numLines; i++) {
                var off = i * spacing;
                // Perpendicular offset from center, line runs along (cosA, sinA)
                var lx0 = cx + -sinA * off - cosA * diag;
                var ly0 = cy + cosA * off - sinA * diag;
                var lx1 = cx + -sinA * off + cosA * diag;
                var ly1 = cy + cosA * off + sinA * diag;

                var dx = lx1 - lx0;
                var dy = ly1 - ly0;
                var len = Math.sqrt(dx * dx + dy * dy);
                var steps = Math.ceil(len / stepSize);
                var sx = dx / steps;
                var sy = dy / steps;

                var seg = [];

                for (var s = 0; s <= steps; s++) {
                    var px = lx0 + sx * s;
                    var py = ly0 + sy * s;

                    // Out of canvas bounds → break segment
                    if (px < 0 || px >= w || py < 0 || py >= h) {
                        if (seg.length >= 2) segments.push(seg);
                        seg = [];
                        continue;
                    }

                    var b = grayData[(py | 0) * w + (px | 0)];

                    if (b < pass.thresh) {
                        seg.push([px, py]);
                    } else {
                        if (seg.length >= 2) segments.push(seg);
                        seg = [];
                    }
                }
                if (seg.length >= 2) segments.push(seg);
            }
        });

        return segments;
    }

    /**
     * Clip all paths to stay within margin bounds.
     * Critical for pen plotters - prevents drawing outside the paper boundaries.
     * Uses Paper.js clipping with a rectangular clipping path.
     */
    function clipPathsToMargin(groups, canvasWidth, canvasHeight, margin) {
        if (margin <= 0) return; // No clipping needed if no margin

        // Create clipping rectangle (canvas bounds minus margin)
        var clipRect = new paper.Path.Rectangle({
            point: [margin, margin],
            size: [canvasWidth - margin * 2, canvasHeight - margin * 2]
        });

        groups.forEach(function (group) {
            var paths = group.removeChildren();
            paths.forEach(function (path) {
                if (!path || !path.bounds) return;

                // Intersect path with clipping rectangle
                var clipped = path.intersect(clipRect, { insert: false });

                // If intersection produces valid geometry, use it
                if (clipped && clipped.className) {
                    if (clipped.className === 'CompoundPath') {
                        // Handle compound paths (multiple segments)
                        clipped.children.forEach(function (child) {
                            if (child.length > 0) {
                                child.strokeWidth = path.strokeWidth;
                                child.strokeColor = path.strokeColor;
                                child.strokeScaling = path.strokeScaling;
                                group.addChild(child);
                            }
                        });
                    } else if (clipped.className === 'Path' && clipped.length > 0) {
                        // Single path result
                        clipped.strokeWidth = path.strokeWidth;
                        clipped.strokeColor = path.strokeColor;
                        clipped.strokeScaling = path.strokeScaling;
                        group.addChild(clipped);
                    }
                    clipped.remove();
                } else {
                    // Path fully within bounds - keep original
                    group.addChild(path);
                }
            });
        });

        clipRect.remove();
    }

    /**
     * Sort paths within each group using greedy nearest-neighbor to minimize
     * pen travel distance (important for pen plotters).
     */
    function sortPathsForPlotter(groups) {
        groups.forEach(function (group) {
            var paths = group.removeChildren();
            if (paths.length < 2) {
                group.addChildren(paths);
                return;
            }

            // Start from the path nearest to origin (squared distance avoids sqrt)
            var current = 0;
            var minDist = Infinity;
            for (var i = 0; i < paths.length; i++) {
                var p = paths[i].firstSegment.point;
                var d = p.x * p.x + p.y * p.y;
                if (d < minDist) {
                    minDist = d;
                    current = i;
                }
            }

            var sorted = [paths[current]];
            var visited = new Array(paths.length);
            visited[current] = true;

            for (var s = 1; s < paths.length; s++) {
                var lastPt = sorted[sorted.length - 1].lastSegment.point;
                var bestIdx = -1;
                var bestDist = Infinity;
                for (var j = 0; j < paths.length; j++) {
                    if (visited[j]) continue;
                    var fp = paths[j].firstSegment.point;
                    var dx = lastPt.x - fp.x;
                    var dy = lastPt.y - fp.y;
                    var dist = dx * dx + dy * dy;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = j;
                    }
                }
                visited[bestIdx] = true;
                sorted.push(paths[bestIdx]);
            }

            group.addChildren(sorted);
        });
    }

    /**
     * Render contours to Paper.js paths grouped by threshold level.
     * Returns a Promise that resolves with { groups[], totalPaths, totalPoints, renderTimeMs }.
     * Yields to the event loop between threshold levels to prevent UI freeze.
     */
    function render(options) {
        var inputCanvas = options.inputCanvas;
        var levels = options.levels;
        var threshLow = options.threshLow;
        var threshHigh = options.threshHigh;
        var minPoints = options.minPoints;
        var edgeMethod = options.edgeMethod;
        var simplifyMethod = options.simplifyMethod;
        var tolerance = options.tolerance;
        var smoothType = options.smoothType;
        var tension = options.tension;
        var strokeWidth = options.strokeWidth;
        var strokeColor = options.strokeColor;
        var useGPU = options.useGPU;
        var hatchEnabled = options.hatchEnabled;
        var hatchType = options.hatchType;
        var hatchSpacing = options.hatchSpacing;
        var hatchAngle = options.hatchAngle;
        var hatchBrightness = options.hatchBrightness;
        var onProgress = options.onProgress;

        return new Promise(function (resolve) {
            var t0 = performance.now();
            paper.project.clear();

            var thresholds = buildThresholds(threshLow, threshHigh, levels);
            var allGroups = [];
            var totalPaths = 0;
            var totalPoints = 0;

            // Prepare source for processing
            var gray = null;
            var gpuSourceTexture = null;

            if (!useGPU || !GPUProcessor.available) {
                // CPU path: Convert to grayscale ONCE (avoids redundant conversion per level)
                var src = cv.imread(inputCanvas);
                gray = new cv.Mat();
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
                src.delete();
            } else {
                // GPU path: Upload source texture ONCE and reuse for all threshold levels
                gpuSourceTexture = GPUProcessor.uploadSourceTexture(inputCanvas);
            }

            function processLevel(idx) {
                if (idx >= thresholds.length) {
                    // Clean up resources
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
                if (useGPU && GPUProcessor.available && gpuSourceTexture) {
                    // Use cached texture instead of re-uploading source canvas
                    var imageData = GPUProcessor.thresholdCached(
                        gpuSourceTexture,
                        threshVal,
                        inputCanvas.width,
                        inputCanvas.height
                    );
                    rawContours = extractContoursGPU(imageData, minPoints);
                } else {
                    rawContours = extractContoursFromGray(gray, threshVal, minPoints, edgeMethod);
                }

                var simplified = rawContours.map(function (pts) {
                    return simplifyPoints(pts, simplifyMethod, tolerance);
                });

                var group = new paper.Group();
                group.name = 'Level ' + (idx + 1) + ' (T:' + Math.round(threshVal) + ')';

                simplified.forEach(function (pts) {
                    if (pts.length < 2) return;
                    var path = new paper.Path(pts);
                    path.closed = true;
                    if (smoothType !== 'none') {
                        path.smooth({ type: smoothType, factor: tension });
                    }
                    group.addChild(path);
                    totalPaths++;
                    totalPoints += pts.length;
                });

                group.strokeWidth = strokeWidth;
                group.strokeScaling = false;
                group.miterLimit = 5;
                group.strokeColor = strokeColor;
                allGroups.push(group);

                // Yield to event loop between levels to keep UI responsive
                // Use requestAnimationFrame for smoother rendering and better frame sync
                requestAnimationFrame(function () {
                    processLevel(idx + 1);
                });
            }

            function finalize() {
                // Generate hatching if enabled
                if (hatchEnabled) {
                    if (onProgress) onProgress(85);

                    var hatchSegs = generateHatching(inputCanvas, {
                        hatchType: hatchType,
                        hatchSpacing: hatchSpacing,
                        hatchAngle: hatchAngle,
                        hatchBrightness: hatchBrightness
                    });

                    var hatchGroup = new paper.Group();
                    hatchGroup.name = 'Hatching (' + (hatchType || 'cross') + ')';

                    hatchSegs.forEach(function (seg) {
                        var simplifiedSeg = simplifyPoints(seg, 'rdp', 1);
                        if (simplifiedSeg.length < 2) return;
                        var path = new paper.Path(simplifiedSeg);
                        path.closed = false;
                        hatchGroup.addChild(path);
                        totalPaths++;
                        totalPoints += simplifiedSeg.length;
                    });

                    hatchGroup.strokeWidth = strokeWidth;
                    hatchGroup.strokeScaling = false;
                    hatchGroup.miterLimit = 5;
                    hatchGroup.strokeColor = strokeColor;
                    allGroups.push(hatchGroup);
                }

                if (onProgress) onProgress(92);

                // Clip all paths to margin bounds (critical for plotters!)
                var margin = (options.margin || 0) * (options.dpi || 96);
                clipPathsToMargin(allGroups, inputCanvas.width, inputCanvas.height, margin);

                if (onProgress) onProgress(95);

                // Sort paths within each group to minimize pen travel distance
                sortPathsForPlotter(allGroups);

                paper.view.draw();

                if (onProgress) onProgress(100);

                resolve({
                    groups: allGroups,
                    totalPaths: totalPaths,
                    totalPoints: totalPoints,
                    renderTimeMs: Math.round(performance.now() - t0)
                });
            }

            processLevel(0);
        });
    }

    /**
     * Estimate pen plotter time from sorted path groups.
     * Walks the sorted paths computing drawing distance (pen down),
     * travel distance (pen up), and pen lift count, then converts
     * to physical units and applies typical plotter speeds.
     */
    function estimatePlotTime(groups, dpi) {
        var drawSpeedMmS = 40; // pen-down drawing speed (mm/s)
        var travelSpeedMmS = 150; // pen-up travel speed (mm/s)
        var penLiftTimeSec = 0.2; // time per pen lift+drop cycle
        var mmPerPx = 25.4 / dpi;

        var drawPx = 0;
        var travelPx = 0;
        var penLifts = 0;
        var lastPt = null;

        groups.forEach(function (group) {
            var children = group.children;
            for (var i = 0; i < children.length; i++) {
                var path = children[i];
                if (!path.segments || path.segments.length < 2) continue;

                // Pen-up travel from previous path end → this path start
                if (lastPt) {
                    travelPx += lastPt.getDistance(path.firstSegment.point);
                    penLifts++;
                }

                drawPx += path.length;
                lastPt = path.lastSegment.point;
            }
        });

        var drawMm = drawPx * mmPerPx;
        var travelMm = travelPx * mmPerPx;
        var totalSec =
            drawMm / drawSpeedMmS + travelMm / travelSpeedMmS + penLifts * penLiftTimeSec;

        return {
            drawDistM: Math.round(drawMm / 100) / 10, // metres, 1 decimal
            travelDistM: Math.round(travelMm / 100) / 10,
            penLifts: penLifts,
            totalSeconds: Math.round(totalSec),
            formatted: formatPlotTime(Math.round(totalSec))
        };
    }

    function formatPlotTime(sec) {
        if (sec < 60) return sec + 's';
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        if (m < 60) return m + 'm ' + (s > 0 ? s + 's' : '');
        var h = Math.floor(m / 60);
        m = m % 60;
        return h + 'h ' + (m > 0 ? m + 'm' : '');
    }

    /**
     * Render stippling (dots) from image.
     * Returns Paper.js groups with circular dots.
     */
    function renderStippling(options) {
        var inputCanvas = options.inputCanvas;
        var dotDensity = options.dotDensity || 5000;
        var minDotSize = options.minDotSize || 0.5;
        var maxDotSize = options.maxDotSize || 3;
        var distribution = options.distribution || 'weighted';
        var strokeColor = options.strokeColor || '#000000';
        var onProgress = options.onProgress;

        return new Promise(function (resolve) {
            var t0 = performance.now();
            paper.project.clear();

            if (onProgress) onProgress(20);

            // Generate dots
            var dots = generateStippling(inputCanvas, {
                dotDensity: dotDensity,
                minDotSize: minDotSize,
                maxDotSize: maxDotSize,
                distribution: distribution
            });

            if (onProgress) onProgress(60);

            // Create Paper.js circles
            var group = new paper.Group();
            group.name = 'Stippling (' + dots.length + ' dots)';

            dots.forEach(function (dot) {
                var circle = new paper.Path.Circle({
                    center: [dot.x, dot.y],
                    radius: dot.radius
                });
                circle.fillColor = strokeColor;
                group.addChild(circle);
            });

            if (onProgress) onProgress(90);

            // Clip to margins if specified
            var margin = (options.margin || 0) * (options.dpi || 96);
            if (margin > 0) {
                clipPathsToMargin([group], inputCanvas.width, inputCanvas.height, margin);
            }

            paper.view.draw();

            if (onProgress) onProgress(100);

            resolve({
                groups: [group],
                totalPaths: dots.length,
                totalPoints: dots.length,
                renderTimeMs: Math.round(performance.now() - t0)
            });
        });
    }

    return {
        render,
        renderStippling,
        estimatePlotTime,
        simplifyPoints,
        buildThresholds,
        extractContours,
        extractContoursGPU
    };
})();
