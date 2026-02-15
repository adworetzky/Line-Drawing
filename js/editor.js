/**
 * Editor — Interactive editing tools for the Paper.js canvas.
 * Provides select/move, pan, erase tools, and undo/redo history.
 */
const Editor = (function () {
    'use strict';

    let currentTool = 'select';
    let selectedItem = null;
    let undoStack = [];
    let redoStack = [];
    const MAX_HISTORY = 50;
    let _initialized = false;

    // Paper.js tools
    let selectTool, panTool, eraseTool;

    // Zoom state
    let zoomLevel = 1;
    const MIN_ZOOM = 0.1;
    const MAX_ZOOM = 10;

    // Callbacks
    let onSelectionChange = null;
    let onHistoryChange = null;
    let onZoomChange = null;

    function saveState() {
        const svgData = paper.project.exportSVG({ asString: true });
        undoStack.push(svgData);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack = [];
        if (onHistoryChange) onHistoryChange();
    }

    function restoreState(svgData) {
        paper.project.clear();
        paper.project.importSVG(svgData, {
            onLoad: function () {
                paper.view.draw();
            }
        });
        clearSelection();
    }

    function clearSelection() {
        if (selectedItem) {
            selectedItem.selected = false;
            selectedItem = null;
        }
        if (onSelectionChange) onSelectionChange(null);
    }

    function initTools() {
        // Select tool
        selectTool = new paper.Tool();
        selectTool.name = 'select';

        let dragOffset = null;

        // Mouse handlers
        selectTool.onMouseDown = function (event) {
            const hitResult = paper.project.hitTest(event.point, {
                stroke: true,
                tolerance: 12, // Larger for touch
                fill: false
            });
            clearSelection();
            if (hitResult && hitResult.item) {
                let item = hitResult.item;
                // Walk up to a Path (skip compound paths, etc.)
                while (
                    item.parent &&
                    !(item instanceof paper.Path) &&
                    item.parent !== paper.project.activeLayer
                ) {
                    item = item.parent;
                }
                selectedItem = item;
                selectedItem.selected = true;
                dragOffset = event.point.subtract(selectedItem.position);
                if (onSelectionChange) onSelectionChange(selectedItem);
            }
        };

        selectTool.onMouseDrag = function (event) {
            if (selectedItem && dragOffset) {
                selectedItem.position = event.point.subtract(dragOffset);
            }
        };

        selectTool.onMouseUp = function () {
            dragOffset = null;
        };

        selectTool.onKeyDown = function (event) {
            if (selectedItem && (event.key === 'delete' || event.key === 'backspace')) {
                saveState();
                selectedItem.remove();
                clearSelection();
                paper.view.draw();
            }
        };

        // Pan tool
        panTool = new paper.Tool();
        panTool.name = 'pan';

        let panStart = null;
        let viewStart = null;

        panTool.onMouseDown = function (event) {
            panStart = event.point;
            viewStart = paper.view.center;
        };

        panTool.onMouseDrag = function (event) {
            if (panStart && viewStart) {
                const delta = panStart.subtract(event.point);
                paper.view.center = viewStart.add(delta);
            }
        };

        // Erase tool
        eraseTool = new paper.Tool();
        eraseTool.name = 'erase';

        eraseTool.onMouseDown = function (event) {
            const hitResult = paper.project.hitTest(event.point, {
                stroke: true,
                tolerance: 12, // Larger for touch
                fill: false
            });
            if (hitResult && hitResult.item) {
                saveState();
                hitResult.item.remove();
                paper.view.draw();
            }
        };

        eraseTool.onMouseDrag = function (event) {
            const hitResult = paper.project.hitTest(event.point, {
                stroke: true,
                tolerance: 12, // Larger for touch
                fill: false
            });
            if (hitResult && hitResult.item) {
                hitResult.item.remove();
                paper.view.draw();
            }
        };

        // Add native touch event support for better mobile UX
        // Paper.js doesn't handle touch well by default
        const canvas = document.getElementById('c-output');
        if (canvas) {
            // Prevent default touch behaviors
            canvas.style.touchAction = 'none';

            // Touch event handlers
            let touchStartPoint = null;
            let isTouching = false;

            canvas.addEventListener(
                'touchstart',
                function (e) {
                    e.preventDefault();
                    if (e.touches.length === 1) {
                        isTouching = true;
                        const touch = e.touches[0];
                        const rect = canvas.getBoundingClientRect();
                        const point = new paper.Point(touch.clientX - rect.left, touch.clientY - rect.top);
                        touchStartPoint = paper.view.viewToProject(point);

                        // Trigger appropriate tool handler
                        const activeTool = paper.tools.find((t) => t === paper.tool);
                        if (activeTool && activeTool.onMouseDown) {
                            activeTool.onMouseDown({ point: touchStartPoint });
                        }
                    }
                },
                { passive: false }
            );

            canvas.addEventListener(
                'touchmove',
                function (e) {
                    e.preventDefault();
                    if (isTouching && e.touches.length === 1) {
                        const touch = e.touches[0];
                        const rect = canvas.getBoundingClientRect();
                        const point = new paper.Point(touch.clientX - rect.left, touch.clientY - rect.top);
                        const touchPoint = paper.view.viewToProject(point);

                        // Trigger appropriate tool handler
                        const activeTool = paper.tools.find((t) => t === paper.tool);
                        if (activeTool && activeTool.onMouseDrag) {
                            activeTool.onMouseDrag({ point: touchPoint });
                        }
                        paper.view.draw();
                    }
                },
                { passive: false }
            );

            canvas.addEventListener(
                'touchend',
                function (e) {
                    e.preventDefault();
                    if (isTouching) {
                        isTouching = false;
                        touchStartPoint = null;

                        // Trigger appropriate tool handler
                        const activeTool = paper.tools.find((t) => t === paper.tool);
                        if (activeTool && activeTool.onMouseUp) {
                            activeTool.onMouseUp();
                        }
                    }
                },
                { passive: false }
            );

            canvas.addEventListener(
                'touchcancel',
                function (e) {
                    e.preventDefault();
                    isTouching = false;
                    touchStartPoint = null;
                },
                { passive: false }
            );
        }
    }

    return {
        init: function (callbacks) {
            // Only initialize once - prevent duplicate event listeners
            if (_initialized) {
                // Just update callbacks if already initialized
                if (callbacks) {
                    onSelectionChange = callbacks.onSelectionChange || onSelectionChange;
                    onHistoryChange = callbacks.onHistoryChange || onHistoryChange;
                    onZoomChange = callbacks.onZoomChange || onZoomChange;
                }
                return;
            }

            if (callbacks) {
                onSelectionChange = callbacks.onSelectionChange || null;
                onHistoryChange = callbacks.onHistoryChange || null;
                onZoomChange = callbacks.onZoomChange || null;
            }
            initTools();
            _initialized = true;
            this.setTool('select');
        },

        get initialized() {
            return _initialized;
        },

        setTool: function (toolName) {
            currentTool = toolName;
            clearSelection();
            switch (toolName) {
                case 'select':
                    selectTool.activate();
                    break;
                case 'pan':
                    panTool.activate();
                    break;
                case 'erase':
                    eraseTool.activate();
                    break;
            }
            // Update cursor
            const canvas = document.getElementById('c-output');
            if (canvas) {
                switch (toolName) {
                    case 'select':
                        canvas.style.cursor = 'crosshair';
                        break;
                    case 'pan':
                        canvas.style.cursor = 'grab';
                        break;
                    case 'erase':
                        canvas.style.cursor = 'pointer';
                        break;
                }
            }
        },

        get currentTool() {
            return currentTool;
        },

        saveSnapshot: function () {
            saveState();
        },

        undo: function () {
            if (undoStack.length === 0) return;
            const currentState = paper.project.exportSVG({ asString: true });
            redoStack.push(currentState);
            const prevState = undoStack.pop();
            restoreState(prevState);
            if (onHistoryChange) onHistoryChange();
        },

        redo: function () {
            if (redoStack.length === 0) return;
            const currentState = paper.project.exportSVG({ asString: true });
            undoStack.push(currentState);
            const nextState = redoStack.pop();
            restoreState(nextState);
            if (onHistoryChange) onHistoryChange();
        },

        get canUndo() {
            return undoStack.length > 0;
        },
        get canRedo() {
            return redoStack.length > 0;
        },

        clearHistory: function () {
            undoStack = [];
            redoStack = [];
            if (onHistoryChange) onHistoryChange();
        },

        // Zoom
        zoom: function (factor) {
            zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel * factor));
            paper.view.zoom = zoomLevel;
            if (onZoomChange) onZoomChange(zoomLevel);
        },

        zoomTo: function (level) {
            zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
            paper.view.zoom = zoomLevel;
            if (onZoomChange) onZoomChange(zoomLevel);
        },

        fitToView: function () {
            const bounds = paper.project.activeLayer.bounds;
            const view = paper.view;

            // If there's no content, fit to canvas size
            if (!bounds || bounds.width === 0) {
                // Get canvas dimensions from the canvas element
                const canvas = view.element;
                const canvasArea = document.getElementById('canvas-area');
                if (canvasArea) {
                    const areaW = canvasArea.clientWidth - 40;
                    const areaH = canvasArea.clientHeight - 40;
                    const zw = areaW / canvas.width;
                    const zh = areaH / canvas.height;
                    zoomLevel = Math.min(zw, zh, 1);
                    view.zoom = zoomLevel;
                    view.center = new paper.Point(canvas.width / 2, canvas.height / 2);
                }
            } else {
                // Fit to content bounds
                const zw = view.viewSize.width / bounds.width;
                const zh = view.viewSize.height / bounds.height;
                zoomLevel = Math.min(zw, zh) * 0.9;
                view.zoom = zoomLevel;
                view.center = bounds.center;
            }
            if (onZoomChange) onZoomChange(zoomLevel);
        },

        get zoomLevel() {
            return zoomLevel;
        },

        getSelection: function () {
            return selectedItem;
        },

        deleteSelection: function () {
            if (selectedItem) {
                saveState();
                selectedItem.remove();
                clearSelection();
                paper.view.draw();
            }
        },

        getStats: function () {
            let paths = 0;
            let points = 0;
            paper.project.activeLayer.children.forEach((item) => {
                if (item instanceof paper.Group) {
                    item.children.forEach((child) => {
                        if (child instanceof paper.Path) {
                            paths++;
                            points += child.segments.length;
                        }
                    });
                } else if (item instanceof paper.Path) {
                    paths++;
                    points += item.segments.length;
                }
            });
            return { paths, points };
        }
    };
})();
