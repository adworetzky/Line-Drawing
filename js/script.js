// four steps
// start with real image (DONE)
// use blob detection to generate same brightness iso lines (DONE)
// simplify/smooth (doing it manually)
// draw catmull rom splines though said vertecies (Paper.js does it but export at specific size svg will be a problem)

let threshLow = 30;
let threshHigh = 200;
let levels = 5;
let tension = -0.3;
let tolerance = 10;
let lWidth = 0.4;
let cWidth = 1080;
let cHeight = 1080;
let minNumPointsInContour = 4;
const imgUrl = 'https://source.unsplash.com/random/';
let img, fileInput, outputSVG;

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
  main.appendChild(cInput);
  // const cOutput = document.createElement('canvas');
  // cOutput.id = 'c1';
  // cOutput.width = cWidth;
  // cOutput.height = cHeight;
  // main.appendChild(cOutput);
  let outputSVG = SVG().addTo('main');
  outputSVG.attr('id', 'outputSVG');

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
  const saveSvgButton = document.createElement('button');
  saveSvgButton.innerHTML = 'Save as SVG';
  saveSvgButton.id = 'save-svg-button';
  controls.appendChild(saveSvgButton);
  const drawButton = document.createElement('button');
  drawButton.innerHTML = 'Draw Lines';
  drawButton.id = 'draw-button';
  controls.appendChild(drawButton);

  img.onload = function () {
    console.timeEnd('Image Load Time');
    console.log('Img Loaded');
    cInput.width = img.width;
    cInput.height = img.height;
    outputSVG.viewbox(0, 0, img.width, img.height);
    outputSVG.attr('preserveAspectRatio', 'xMidYMid meet');
    console.log(outputSVG);
    draw.imgToCanvas();
    // var rect = outputSVG.rect(100, 100).attr({ fill: '#f06' });
  };
  img.src = imgUrl;

  fileInput.onchange = function () {
    console.log(fileInput.files[0]);
    img.src = URL.createObjectURL(fileInput.files[0]);
    console.log('File Uploaded');
    console.time('Image Load Time');
  };
  newImageButton.onclick = () => getNewImage(document.querySelector('#i0'));
  saveButton.onclick = () => saveOutputAsPNG();
  saveSvgButton.onclick = () => draw.downloadAsSVG(outputSVG);
  drawButton.onclick = () => draw.contourMap(outputSVG);

  console.time('Image Load Time');
}
const draw = {
  imgToCanvas: function () {
    const c = document.querySelector('#c0');
    const ctx = c.getContext('2d');
    // var scale = Math.max(c.width / img.width, c.height / img.height);
    // // get the top left position of the image
    // var x = c.width / 2 - (img.width / 2) * scale;
    // var y = c.height / 2 - (img.height / 2) * scale;
    // ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, img.width, img.height);

    // draw.contourMap();
  },
  contourMap: function (outputSVG) {
    outputSVG.clear();
    const cInput = document.querySelector('#c0');
    const ctxInput = cInput.getContext('2d');

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
      console.log(sFPoints);

      // let currentScale = getScale();
      // let scaledPoints = sFPoints.map(function (nested) {
      //   return nested.map(function (element) {
      //     return [element[0] * currentScale, element[1] * currentScale];
      //   });
      // });

      sFPoints.forEach((element) => {
        var polyline = outputSVG.polyline(element);
        polyline.stroke({
          color: '#000',
          width: 1,
        });
        polyline.fill('none');
      });

      dst.delete();
      contours.delete();
      hierarchy.delete();
    });
    src.delete();
    console.timeEnd('Line Drawing Time');
  },
  downloadAsSVG: function (outputSVG) {
    download(svgDataURL(document.getElementById('outputSVG')));

    function svgDataURL(svg) {
      var svgAsXML = new XMLSerializer().serializeToString(svg);
      return 'data:image/svg+xml,' + encodeURIComponent(svgAsXML);
    }

    function download(dataURL) {
      var dl = document.createElement('a');
      document.body.appendChild(dl); // This line makes it work in Firefox.
      dl.setAttribute('href', dataURL);
      dl.setAttribute('download', 'test.svg');
      dl.click();
    }
  },
};

function getScale() {
  let scale = document.querySelector('#c1').offsetWidth / cWidth;
  return scale;
}

function saveOutputAsPNG() {
  saveSvgAsPng(document.getElementById('outputSVG'), 'Download.png');
}
function getNewImage(img) {
  img.src = 'https://source.unsplash.com/random/?n=' + Math.random();
  console.time('Image Load Time');
}

cv['onRuntimeInitialized'] = () => {
  window.onload = init();
  // window.onresize = init();
};
