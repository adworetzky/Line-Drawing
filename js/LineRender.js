/**
 * LineRender — Processing pipeline for image → contour → line drawing.
 * Supports multiple simplification algorithms, smoothing types, and GPU acceleration.
 */
const LineRender = (function () {
    'use strict';

    /**
     * Visvalingam-Whyatt simplification: removes points that contribute
     * the least area, preserving shape fidelity better than RDP for smooth curves.
     */
    function triangleArea(p1, p2, p3) {
        return Math.abs(
            (p2[0] - p1[0]) * (p3[1] - p1[1]) -
            (p3[0] - p1[0]) * (p2[1] - p1[1])
        ) / 2;
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
        return pts.map(p => [p.x, p.y]);
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
            case 'visvalingam': return simplifyVisvalingam(points, tolerance);
            case 'radial': return simplifyRadial(points, tolerance);
            case 'rdp':
            default:
                return (typeof simplify === 'function')
                    ? simplify(points, tolerance)
                    : points;
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
            cv.adaptiveThreshold(dst, dst, 255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY,
                11, threshValue / 25);
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
     * Extract contours using GPU-thresholded ImageData.
     * The thresholded image is written to a temp canvas for OpenCV to read.
     */
    function extractContoursGPU(imageData, minPoints) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageData.width;
        tempCanvas.height = imageData.height;
        const ctx = tempCanvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        let src = cv.imread(tempCanvas);
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
        var spacing  = opts.hatchSpacing    || 8;
        var baseAngle = (opts.hatchAngle    || 45) * Math.PI / 180;
        var type     = opts.hatchType       || 'cross';
        var maxBright = opts.hatchBrightness || 170;
        var stepSize  = 2; // sample every 2 px along each scan line

        var w = inputCanvas.width;
        var h = inputCanvas.height;
        var ctx = inputCanvas.getContext('2d');
        var imageData = ctx.getImageData(0, 0, w, h);
        var pixels = imageData.data;
        var diag = Math.sqrt(w * w + h * h);

        function brightness(x, y) {
            var ix = Math.round(x);
            var iy = Math.round(y);
            if (ix < 0 || ix >= w || iy < 0 || iy >= h) return 255;
            var idx = (iy * w + ix) * 4;
            return pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
        }

        // Build pass list — each pass gets a progressively tighter threshold
        var passes;
        if (type === 'parallel') {
            passes = [{ angle: baseAngle, thresh: maxBright }];
        } else if (type === 'cross') {
            passes = [
                { angle: baseAngle,                   thresh: maxBright },
                { angle: baseAngle + Math.PI / 2,     thresh: maxBright * 0.6 }
            ];
        } else { // triple
            passes = [
                { angle: baseAngle,                       thresh: maxBright },
                { angle: baseAngle + Math.PI / 3,         thresh: maxBright * 0.55 },
                { angle: baseAngle + 2 * Math.PI / 3,     thresh: maxBright * 0.3 }
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
                var lx0 = cx + (-sinA) * off - cosA * diag;
                var ly0 = cy +  cosA  * off - sinA * diag;
                var lx1 = cx + (-sinA) * off + cosA * diag;
                var ly1 = cy +  cosA  * off + sinA * diag;

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

                    var b = brightness(px, py);

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

            // Start from the path nearest to origin
            var current = 0;
            var minDist = Infinity;
            var origin = new paper.Point(0, 0);
            for (var i = 0; i < paths.length; i++) {
                var d = origin.getDistance(paths[i].firstSegment.point);
                if (d < minDist) { minDist = d; current = i; }
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
                    var dist = lastPt.getDistance(paths[j].firstSegment.point);
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
     * Returns { groups[], totalPaths, totalPoints, renderTimeMs }
     */
    function render(options) {
        const {
            inputCanvas,
            levels, threshLow, threshHigh,
            minPoints, edgeMethod,
            simplifyMethod, tolerance,
            smoothType, tension,
            strokeWidth, strokeColor,
            useGPU,
            hatchEnabled, hatchType, hatchSpacing, hatchAngle, hatchBrightness,
            onProgress
        } = options;

        const t0 = performance.now();
        paper.project.clear();

        const thresholds = buildThresholds(threshLow, threshHigh, levels);
        const allGroups = [];
        let totalPaths = 0;
        let totalPoints = 0;

        let src = null;
        if (!useGPU || !GPUProcessor.available) {
            src = cv.imread(inputCanvas);
        }

        thresholds.forEach((threshVal, idx) => {
            if (onProgress) {
                onProgress(Math.round(((idx + 1) / thresholds.length) * 90));
            }

            let rawContours;
            if (useGPU && GPUProcessor.available) {
                const imageData = GPUProcessor.threshold(inputCanvas, threshVal);
                rawContours = extractContoursGPU(imageData, minPoints);
            } else {
                rawContours = extractContours(src, threshVal, minPoints, edgeMethod);
            }

            const simplified = rawContours.map(pts => simplifyPoints(pts, simplifyMethod, tolerance));

            const group = new paper.Group();
            group.name = 'Level ' + (idx + 1) + ' (T:' + Math.round(threshVal) + ')';

            simplified.forEach(pts => {
                if (pts.length < 2) return;
                const path = new paper.Path(pts);
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
        });

        if (src) src.delete();

        // Generate hatching if enabled
        if (hatchEnabled) {
            if (onProgress) onProgress(92);

            var hatchSegs = generateHatching(inputCanvas, {
                hatchType: hatchType,
                hatchSpacing: hatchSpacing,
                hatchAngle: hatchAngle,
                hatchBrightness: hatchBrightness
            });

            var hatchGroup = new paper.Group();
            hatchGroup.name = 'Hatching (' + (hatchType || 'cross') + ')';

            hatchSegs.forEach(function (seg) {
                var simplified = simplifyPoints(seg, 'rdp', 1);
                if (simplified.length < 2) return;
                var path = new paper.Path(simplified);
                path.closed = false;
                hatchGroup.addChild(path);
                totalPaths++;
                totalPoints += simplified.length;
            });

            hatchGroup.strokeWidth = strokeWidth;
            hatchGroup.strokeScaling = false;
            hatchGroup.miterLimit = 5;
            hatchGroup.strokeColor = strokeColor;
            allGroups.push(hatchGroup);
        }

        // Sort paths within each group to minimize pen travel distance
        sortPathsForPlotter(allGroups);

        paper.view.draw();

        if (onProgress) onProgress(100);

        return {
            groups: allGroups,
            totalPaths,
            totalPoints,
            renderTimeMs: Math.round(performance.now() - t0)
        };
    }

    return {
        render,
        simplifyPoints,
        buildThresholds,
        extractContours,
        extractContoursGPU
    };
})();
