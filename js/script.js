// four steps
// start with real image (DONE)
// use blob detection to generate same brightness iso lines (DONE)
// simplify/smooth (doing it manually)
// draw catmull rom splines though said vertecies (Paper.js does it but export at specific size svg will be a problem)

let threshLow = 1;
let threshHigh = 250;
let levels = 10;
let tension = -0.5;
let tolerance = 5;
let lWidth = 0.4;
let cWidth = 1080;
let cHeight = 1080;
let minNumPointsInContour = 3;
const imgUrl = 'https://source.unsplash.com/random';
let img, fileInput;

function init() {
  const controls = document.createElement('div');
  controls.id = 'controls';
  document.body.appendChild(controls);
  const main = document.createElement('main');
  document.body.appendChild(main);

  img = document.createElement('img');
  img.id = 'i0';
  img.crossOrigin = 'Anonymous';
  main.appendChild(img);
  const cInput = document.createElement('canvas');
  cInput.id = 'c0';
  cInput.width = cWidth;
  cInput.height = cHeight;
  main.appendChild(cInput);
  const cOutput = document.createElement('canvas');
  cOutput.id = 'c1';
  cOutput.width = cWidth;
  cOutput.height = cHeight;
  main.appendChild(cOutput);

  const fileInput = document.createElement('input');
  controls.append(fileInput);
  fileInput.classList.add('uiElement');
  fileInput.type = 'file';
  fileInput.setAttribute('id', 'fileUpload');
  const newImageButton = document.createElement('button');
  newImageButton.innerHTML = 'New Image';
  newImageButton.id = 'new-I=image-button';
  controls.appendChild(newImageButton);
  const saveButton = document.createElement('button');
  saveButton.innerHTML = 'Save as PNG';
  saveButton.id = 'save-button';
  controls.appendChild(saveButton);
  const drawButton = document.createElement('button');
  drawButton.innerHTML = 'Draw Lines';
  drawButton.id = 'draw-button';
  controls.appendChild(drawButton);

  img.onload = function () {
    console.timeEnd('Image Load Time');
    console.log('Img Loaded');
    paper.setup('c1');
    draw.imgToCanvas();
  };
  img.src = imgUrl;

  fileInput.onchange = function () {
    console.log(fileInput.files[0]);
    img.src = URL.createObjectURL(fileInput.files[0]);
    console.log('File Uploaded');
    console.time('Image Load Time');
  };
  newImageButton.onclick = () => getNewImage(document.querySelector('#i0'));
  saveButton.onclick = () => saveCanvasAsPNG(document.querySelector('#c1'));
  drawButton.onclick = () => draw.contourMap();

  console.time('Image Load Time');
}
const draw = {
  imgToCanvas: function () {
    const c = document.querySelector('#c0');
    const ctx = c.getContext('2d');
    var scale = Math.max(c.width / img.width, c.height / img.height);
    // get the top left position of the image
    var x = c.width / 2 - (img.width / 2) * scale;
    var y = c.height / 2 - (img.height / 2) * scale;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    // draw.contourMap();
  },
  contourMap: function () {
    const cInput = document.querySelector('#c0');
    const ctxInput = cInput.getContext('2d');
    const cOutput = document.querySelector('#c1');
    const ctxOutput = cOutput.getContext('2d');
    paper.project.clear();

    console.log('Open CV loaded');

    let inc = (threshHigh - threshLow) / levels;
    let tInc = threshLow;
    let threshArr = [];
    for (let i = 0; i < levels; i++) {
      tInc = tInc + inc;
      threshArr.push(tInc);
    }
    console.log('Curve Draw Started');
    console.time('Line Drawing Time');
    // loop to perform contour find and draw a difference levels of grey
    let src = cv.imread(cInput);
    let group = new paper.Group();
    threshArr.forEach((element) => {
      let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);
      cv.threshold(dst, dst, element, 255, cv.THRESH_BINARY);
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(
        dst,
        contours,
        hierarchy,
        cv.RETR_CCOMP,
        cv.CHAIN_APPROX_SIMPLE
      );
      let points = [];
      for (let j = 0; j < contours.size(); ++j) {
        const ci = contours.get(j);
        points[j] = [];
        for (let k = 0; k < ci.data32S.length; k += 2) {
          let p = [];
          p[0] = ci.data32S[k];
          p[1] = ci.data32S[k + 1];
          points[j].push(p);
        }
      }
      let fPoints = points.filter(function (element) {
        return element.length >= minNumPointsInContour;
      });

      let sFPoints = [];
      fPoints.forEach((element) => {
        let simplifiedPoints = simplify(element, tolerance);
        sFPoints.push(simplifiedPoints);
      });

      let currentScale = getScale();
      let scaledPoints = sFPoints.map(function (nested) {
        return nested.map(function (element) {
          return [element[0] * currentScale, element[1] * currentScale];
        });
      });

      scaledPoints.forEach((element) => {
        let path = new paper.Path(element);
        path.closed = true;
        // path.simplify([tolerance]);
        path.smooth({ type: 'catmull-rom', factor: tension });
        group.addChild(path);
      });

      dst.delete();
      contours.delete();
      hierarchy.delete();
    });
    src.delete();
    group.strokeWidth = lWidth;
    group.strokeScaling = false;
    group.miterLimit = 5;
    group.strokeColor = '#313639 ';
    paper.view.draw();
    console.timeEnd('Line Drawing Time');
  },
  downloadAsSVG: function (fileName) {
    if (!fileName) {
      fileName = 'paperjs_example.svg';
    }

    var url =
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(paper.project.exportSVG({ asString: true }));

    var link = document.createElement('a');
    link.download = fileName;
    link.href = url;
    link.click();
  },
};

function getScale() {
  let scale = document.querySelector('#c1').offsetWidth / cWidth;
  return scale;
}

function saveCanvasAsPNG(canvas) {
  const link = document.createElement('a');
  let d = new Date(),
    h = (d.getHours() < 10 ? '0' : '') + d.getHours(),
    m = (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(),
    s = (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
  link.download = 'Drawing-' + h + '.' + m + '.' + s + '.png';
  link.href = canvas.toDataURL();
  link.click();
  link.delete;
}
function getNewImage(img) {
  img.src = 'https://source.unsplash.com/random/';
  console.time('Image Load Time');
}

cv['onRuntimeInitialized'] = () => {
  window.onload = init();
  // window.onresize = init();
};
