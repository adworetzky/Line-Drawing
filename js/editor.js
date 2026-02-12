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

        selectTool.onMouseDown = function (event) {
            const hitResult = paper.project.hitTest(event.point, {
                stroke: true,
                tolerance: 8,
                fill: false
            });
            clearSelection();
            if (hitResult && hitResult.item) {
                let item = hitResult.item;
                // Walk up to a Path (skip compound paths, etc.)
                while (item.parent && !(item instanceof paper.Path) && item.parent !== paper.project.activeLayer) {
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
                tolerance: 8,
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
                tolerance: 8,
                fill: false
            });
            if (hitResult && hitResult.item) {
                hitResult.item.remove();
                paper.view.draw();
            }
        };
    }

    return {
        init: function (callbacks) {
            if (callbacks) {
                onSelectionChange = callbacks.onSelectionChange || null;
                onHistoryChange = callbacks.onHistoryChange || null;
                onZoomChange = callbacks.onZoomChange || null;
            }
            initTools();
            _initialized = true;
            this.setTool('select');
        },

        get initialized() { return _initialized; },

        setTool: function (toolName) {
            currentTool = toolName;
            clearSelection();
            switch (toolName) {
                case 'select': selectTool.activate(); break;
                case 'pan': panTool.activate(); break;
                case 'erase': eraseTool.activate(); break;
            }
            // Update cursor
            const canvas = document.getElementById('c-output');
            if (canvas) {
                switch (toolName) {
                    case 'select': canvas.style.cursor = 'crosshair'; break;
                    case 'pan': canvas.style.cursor = 'grab'; break;
                    case 'erase': canvas.style.cursor = 'pointer'; break;
                }
            }
        },

        get currentTool() { return currentTool; },

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

        get canUndo() { return undoStack.length > 0; },
        get canRedo() { return redoStack.length > 0; },

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
            if (!bounds || bounds.width === 0) return;
            const view = paper.view;
            const zw = view.viewSize.width / bounds.width;
            const zh = view.viewSize.height / bounds.height;
            zoomLevel = Math.min(zw, zh) * 0.9;
            view.zoom = zoomLevel;
            view.center = bounds.center;
            if (onZoomChange) onZoomChange(zoomLevel);
        },

        get zoomLevel() { return zoomLevel; },

        getSelection: function () { return selectedItem; },

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
            paper.project.activeLayer.children.forEach(item => {
                if (item instanceof paper.Group) {
                    item.children.forEach(child => {
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
