/**
 * GPU-accelerated image processing using WebGL shaders.
 * Provides fast grayscale conversion and thresholding on the GPU,
 * falling back to CPU (OpenCV) when WebGL is unavailable.
 */
const GPUProcessor = (function () {
    'use strict';

    let gl = null;
    let canvas = null;
    let programs = {};
    let _available = false;

    // Vertex shader shared by all fragment programs
    const VERT_SRC = `
        attribute vec2 a_position;
        attribute vec2 a_texCoord;
        varying vec2 v_texCoord;
        void main() {
            gl_Position = vec4(a_position, 0.0, 1.0);
            v_texCoord = a_texCoord;
        }
    `;

    // Fragment shader: grayscale conversion
    const FRAG_GRAYSCALE = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        void main() {
            vec4 color = texture2D(u_image, v_texCoord);
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            gl_FragColor = vec4(gray, gray, gray, color.a);
        }
    `;

    // Fragment shader: threshold (binary)
    const FRAG_THRESHOLD = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform float u_threshold;
        void main() {
            vec4 color = texture2D(u_image, v_texCoord);
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            float val = step(u_threshold, gray);
            gl_FragColor = vec4(val, val, val, 1.0);
        }
    `;

    // Fragment shader: Sobel edge detection
    const FRAG_SOBEL = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texelSize;
        uniform float u_threshold;

        float luma(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }

        void main() {
            float tl = luma(texture2D(u_image, v_texCoord + vec2(-1, -1) * u_texelSize));
            float t  = luma(texture2D(u_image, v_texCoord + vec2( 0, -1) * u_texelSize));
            float tr = luma(texture2D(u_image, v_texCoord + vec2( 1, -1) * u_texelSize));
            float l  = luma(texture2D(u_image, v_texCoord + vec2(-1,  0) * u_texelSize));
            float r  = luma(texture2D(u_image, v_texCoord + vec2( 1,  0) * u_texelSize));
            float bl = luma(texture2D(u_image, v_texCoord + vec2(-1,  1) * u_texelSize));
            float b  = luma(texture2D(u_image, v_texCoord + vec2( 0,  1) * u_texelSize));
            float br = luma(texture2D(u_image, v_texCoord + vec2( 1,  1) * u_texelSize));

            float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
            float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
            float mag = length(vec2(gx, gy));

            float val = step(u_threshold, mag);
            gl_FragColor = vec4(val, val, val, 1.0);
        }
    `;

    // Fragment shader: Gaussian blur (separable, horizontal pass)
    const FRAG_BLUR_H = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texelSize;
        void main() {
            vec4 sum = vec4(0.0);
            sum += texture2D(u_image, v_texCoord + vec2(-2.0, 0.0) * u_texelSize) * 0.06136;
            sum += texture2D(u_image, v_texCoord + vec2(-1.0, 0.0) * u_texelSize) * 0.24477;
            sum += texture2D(u_image, v_texCoord) * 0.38774;
            sum += texture2D(u_image, v_texCoord + vec2( 1.0, 0.0) * u_texelSize) * 0.24477;
            sum += texture2D(u_image, v_texCoord + vec2( 2.0, 0.0) * u_texelSize) * 0.06136;
            gl_FragColor = sum;
        }
    `;

    // Fragment shader: Gaussian blur (vertical pass)
    const FRAG_BLUR_V = `
        precision mediump float;
        varying vec2 v_texCoord;
        uniform sampler2D u_image;
        uniform vec2 u_texelSize;
        void main() {
            vec4 sum = vec4(0.0);
            sum += texture2D(u_image, v_texCoord + vec2(0.0, -2.0) * u_texelSize) * 0.06136;
            sum += texture2D(u_image, v_texCoord + vec2(0.0, -1.0) * u_texelSize) * 0.24477;
            sum += texture2D(u_image, v_texCoord) * 0.38774;
            sum += texture2D(u_image, v_texCoord + vec2(0.0,  1.0) * u_texelSize) * 0.24477;
            sum += texture2D(u_image, v_texCoord + vec2(0.0,  2.0) * u_texelSize) * 0.06136;
            gl_FragColor = sum;
        }
    `;

    function compileShader(src, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function createProgram(fragSrc) {
        const vert = compileShader(VERT_SRC, gl.VERTEX_SHADER);
        const frag = compileShader(fragSrc, gl.FRAGMENT_SHADER);
        if (!vert || !frag) return null;

        const program = gl.createProgram();
        gl.attachShader(program, vert);
        gl.attachShader(program, frag);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    function setupGeometry(program) {
        const posLoc = gl.getAttribLocation(program, 'a_position');
        const texLoc = gl.getAttribLocation(program, 'a_texCoord');

        // Full-screen quad
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
            gl.STATIC_DRAW
        );
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const texBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
            gl.STATIC_DRAW
        );
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
    }

    function uploadTexture(source) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        return tex;
    }

    function createFramebuffer(width, height) {
        const fb = gl.createFramebuffer();
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { framebuffer: fb, texture: tex };
    }

    return {
        /**
         * Initialize the WebGL context. Returns true if GPU is available.
         */
        init: function (gpuCanvas) {
            canvas = gpuCanvas || document.getElementById('c-gpu');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'c-gpu';
                canvas.style.display = 'none';
                document.body.appendChild(canvas);
            }
            try {
                gl =
                    canvas.getContext('webgl', { preserveDrawingBuffer: true }) ||
                    canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });
            } catch (e) {
                gl = null;
            }
            if (!gl) {
                console.warn('WebGL not available, falling back to CPU processing');
                _available = false;
                return false;
            }

            programs.grayscale = createProgram(FRAG_GRAYSCALE);
            programs.threshold = createProgram(FRAG_THRESHOLD);
            programs.sobel = createProgram(FRAG_SOBEL);
            programs.blurH = createProgram(FRAG_BLUR_H);
            programs.blurV = createProgram(FRAG_BLUR_V);

            _available = Object.values(programs).every(Boolean);
            if (!_available) {
                console.warn('Failed to compile GPU shaders, falling back to CPU');
            }
            return _available;
        },

        get available() {
            return _available;
        },

        /**
         * Apply threshold on the GPU.
         * sourceCanvas: canvas with the input image
         * thresholdValue: 0-255
         * Returns: ImageData from the thresholded result
         */
        threshold: function (sourceCanvas, thresholdValue) {
            if (!_available) return null;
            const w = sourceCanvas.width;
            const h = sourceCanvas.height;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);

            const prog = programs.threshold;
            gl.useProgram(prog);
            setupGeometry(prog);

            const tex = uploadTexture(sourceCanvas);
            gl.uniform1f(gl.getUniformLocation(prog, 'u_threshold'), thresholdValue / 255.0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.deleteTexture(tex);

            // Flip vertically (WebGL reads bottom-up)
            const flipped = new Uint8Array(w * h * 4);
            for (let y = 0; y < h; y++) {
                const srcOff = (h - 1 - y) * w * 4;
                const dstOff = y * w * 4;
                flipped.set(pixels.subarray(srcOff, srcOff + w * 4), dstOff);
            }

            return new ImageData(new Uint8ClampedArray(flipped.buffer), w, h);
        },

        /**
         * Apply Sobel edge detection on the GPU.
         * sourceCanvas: canvas with the input image
         * thresholdValue: edge sensitivity 0-255
         * Returns: ImageData from the edge-detected result
         */
        sobelEdge: function (sourceCanvas, thresholdValue) {
            if (!_available) return null;
            const w = sourceCanvas.width;
            const h = sourceCanvas.height;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);

            const prog = programs.sobel;
            gl.useProgram(prog);
            setupGeometry(prog);

            const tex = uploadTexture(sourceCanvas);
            gl.uniform2f(gl.getUniformLocation(prog, 'u_texelSize'), 1.0 / w, 1.0 / h);
            gl.uniform1f(gl.getUniformLocation(prog, 'u_threshold'), thresholdValue / 255.0);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.deleteTexture(tex);

            const flipped = new Uint8Array(w * h * 4);
            for (let y = 0; y < h; y++) {
                const srcOff = (h - 1 - y) * w * 4;
                const dstOff = y * w * 4;
                flipped.set(pixels.subarray(srcOff, srcOff + w * 4), dstOff);
            }

            return new ImageData(new Uint8ClampedArray(flipped.buffer), w, h);
        },

        /**
         * Apply Gaussian blur on the GPU (two-pass separable).
         * sourceCanvas: canvas with the input image
         * passes: number of blur iterations (default 1)
         * Returns: ImageData
         */
        blur: function (sourceCanvas, passes) {
            if (!_available) return null;
            passes = passes || 1;
            const w = sourceCanvas.width;
            const h = sourceCanvas.height;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);

            let inputTex = uploadTexture(sourceCanvas);
            const fb1 = createFramebuffer(w, h);
            const fb2 = createFramebuffer(w, h);

            for (let i = 0; i < passes; i++) {
                // Horizontal pass
                gl.useProgram(programs.blurH);
                setupGeometry(programs.blurH);
                gl.bindTexture(gl.TEXTURE_2D, inputTex);
                gl.uniform2f(
                    gl.getUniformLocation(programs.blurH, 'u_texelSize'),
                    1.0 / w,
                    1.0 / h
                );
                gl.bindFramebuffer(gl.FRAMEBUFFER, fb1.framebuffer);
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                // Vertical pass
                gl.useProgram(programs.blurV);
                setupGeometry(programs.blurV);
                gl.bindTexture(gl.TEXTURE_2D, fb1.texture);
                gl.uniform2f(
                    gl.getUniformLocation(programs.blurV, 'u_texelSize'),
                    1.0 / w,
                    1.0 / h
                );
                if (i < passes - 1) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, fb2.framebuffer);
                } else {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                }
                gl.drawArrays(gl.TRIANGLES, 0, 6);

                if (i === 0) gl.deleteTexture(inputTex);
                inputTex = fb2.texture;
            }

            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            gl.deleteTexture(fb1.texture);
            gl.deleteTexture(fb2.texture);
            gl.deleteFramebuffer(fb1.framebuffer);
            gl.deleteFramebuffer(fb2.framebuffer);

            const flipped = new Uint8Array(w * h * 4);
            for (let y = 0; y < h; y++) {
                const srcOff = (h - 1 - y) * w * 4;
                const dstOff = y * w * 4;
                flipped.set(pixels.subarray(srcOff, srcOff + w * 4), dstOff);
            }

            return new ImageData(new Uint8ClampedArray(flipped.buffer), w, h);
        }
    };
})();
