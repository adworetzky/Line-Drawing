// four steps
// start with image (DONE)
// use blob detection to generate same brightness iso lines from threshold (DONE)
// simplify/smooth (simplify js)
// draw catmull rom splines though said vertecies (switched to svg.js)

let threshLow = 50;
let threshHigh = 255;
let levels = 10;
let tension = -0.7;
let tolerance = 10;
let lWidth = 1;
let cWidth = 1080;
let cHeight = 1080;
let minNumPointsInContour = 2;
let margin = 150;
const imgUrl = 'https://source.unsplash.com/random/';
let img, fileInput, outputSVG, tensionSlider;
let newImageStatus = false;

function init() {
  // let presets = fetch('./js/presets.json')
  //   .then((response) => {
  //     return response.json();
  //   })
  //   .then((data) => console.log(data.presets[0].name));

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
  tensionSlider = makeSlider('tension-slider', -2, 2, 0.1, tension, 'Tension');
  toleranceSlider = makeSlider(
    'tolerance-slider',
    -20,
    20,
    0.5,
    tolerance,
    'Tolerance'
  );
  levelsSlider = makeSlider('levels-slider', 1, 100, 1, levels, 'Levels');
  marginSlider = makeSlider('margin-slider', 1, 500, 1, margin, 'Margin');
  thresholdLowSlider = makeSlider(
    'threshold-low-slider',
    1,
    255,
    1,
    threshLow,
    'Threshold Low'
  );
  thresholdHighSlider = makeSlider(
    'threshold-high-slider',
    1,
    255,
    1,
    threshHigh,
    'Threshold High'
  );
  lWidthSlider = makeSlider(
    'lwidth-slider',
    0.1,
    5,
    0.1,
    lWidth,
    'Stroke Width'
  );

  // Listeners
  img.onload = function () {
    console.timeEnd('Image Load Time');
    console.log('Img Loaded');
    cInput.width = img.width;
    cInput.height = img.height;
    outputSVG.viewbox(0, 0, img.width, img.height);
    outputSVG.attr('preserveAspectRatio', 'xMidYMid meet');
    draw.imgToCanvas(outputSVG);
  };
  img.src = imgUrl;

  fileInput.onchange = function () {
    console.log(fileInput.files[0]);
    img.src = URL.createObjectURL(fileInput.files[0]);
    console.log('File Uploaded');
    console.time('Image Load Time');
  };
  marginSlider.onchange = function () {
    margin = marginSlider.value;
    draw.imgToCanvas();
  };
  newImageButton.onclick = () => getNewImage(document.querySelector('#i0'));
  saveButton.onclick = () => saveOutputAsPNG();
  saveSvgButton.onclick = () => draw.downloadAsSVG(outputSVG);
  drawButton.onclick = () => draw.contourMap(outputSVG);

  console.time('Image Load Time');
}
const draw = {
  imgToCanvas: function (outputSVG) {
    const c = document.querySelector('#c0');
    const ctx = c.getContext('2d');
    // var scale = Math.max(c.width / img.width, c.height / img.height);
    // // get the top left position of the image
    // var x = c.width / 2 - (img.width / 2) * scale;
    // var y = c.height / 2 - (img.height / 2) * scale;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, img.width, img.height);
    ctx.lineWidth = margin * 2;
    ctx.strokeStyle = 'white';
    ctx.rect(0, 0, c.width, c.height);

    ctx.stroke();
    if (newImageStatus == true) {
      draw.contourMap(outputSVG);
      newImageStatus = false;
    }
  },
  contourMap: function (outputSVG) {
    outputSVG.clear();
    const cInput = document.querySelector('#c0');
    const ctxInput = cInput.getContext('2d');

    console.log('Open CV loaded');
    // set up threshold divisions
    let inc =
      (parseInt(thresholdHighSlider.value) -
        parseInt(thresholdLowSlider.value)) /
      levelsSlider.value;
    let tInc = parseInt(thresholdLowSlider.value);
    let threshArr = [];
    for (let i = 0; i < levelsSlider.value; i++) {
      tInc = tInc + inc;
      threshArr.push(tInc);
    }
    console.log('Curve Draw Started');
    console.time('Line Drawing Time');
    let src = cv.imread(cInput);
    // loop over the different threshold divisions
    threshArr.forEach((element) => {
      // find contours and setup
      let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);
      cv.threshold(
        dst,
        dst,
        element,
        parseInt(thresholdHighSlider.value),
        cv.THRESH_BINARY
      );
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(
        dst,
        contours,
        hierarchy,
        cv.RETR_CCOMP,
        cv.CHAIN_APPROX_SIMPLE
      );
      // get contour points and push to array
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
        let simplifiedPoints = simplify(element, toleranceSlider.value, false);
        sFPoints.push(simplifiedPoints);
      });

      // let currentScale = getScale();
      // let scaledPoints = sFPoints.map(function (nested) {
      //   return nested.map(function (element) {
      //     return [element[0] * currentScale, element[1] * currentScale];
      //   });
      // });

      // main svg line drawing loop
      sFPoints.forEach((element) => {
        // console.log(catmullRomInterpolation(element.flat(), tension));
        let drawnPath = outputSVG.path(
          catmullRomInterpolation(element.flat(), tensionSlider.value)
        );
        drawnPath.stroke({ color: '#000', width: lWidthSlider.value });
        drawnPath.fill('none');
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

function makeSlider(id, min, max, step, value, labelText) {
  let slider = document.createElement('input');
  slider.setAttribute('type', 'range');
  slider.setAttribute('min', min);
  slider.setAttribute('max', max);
  slider.setAttribute('step', step);
  slider.setAttribute('value', value);
  slider.setAttribute('id', id);
  document.querySelector('#controls').appendChild(slider);
  const sliderLabel = document.createElement('label');
  sliderLabel.classList.add('uiElementLabel');
  sliderLabel.setAttribute('for', id);
  sliderLabel.innerHTML = labelText + ' : ' + slider.value;
  slider.insertAdjacentElement('beforebegin', sliderLabel);
  slider.oninput = function () {
    sliderLabel.innerHTML = labelText + ' : ' + slider.value;
  };
  return slider;
}

function getScale() {
  let scale = document.querySelector('#c1').offsetWidth / cWidth;
  return scale;
}

function saveOutputAsPNG() {
  saveSvgAsPng(document.getElementById('outputSVG'), 'Download.png');
}
function getNewImage(img) {
  newImageStatus = true;
  img.src = 'https://source.unsplash.com/random/?n=' + Math.random();
  console.time('Image Load Time');
}

function catmullRomInterpolation(points, k) {
  if (k == null) k = 1;

  var size = points.length;
  var last = size - 4;

  var path = 'M' + [points[0], points[1]];

  for (var i = 0; i < size - 2; i += 2) {
    var x0 = i ? points[i - 2] : points[0];
    var y0 = i ? points[i - 1] : points[1];

    var x1 = points[i + 0];
    var y1 = points[i + 1];

    var x2 = points[i + 2];
    var y2 = points[i + 3];

    var x3 = i !== last ? points[i + 4] : x2;
    var y3 = i !== last ? points[i + 5] : y2;

    var cp1x = x1 + ((x2 - x0) / 6) * k;
    var cp1y = y1 + ((y2 - y0) / 6) * k;

    var cp2x = x2 - ((x3 - x1) / 6) * k;
    var cp2y = y2 - ((y3 - y1) / 6) * k;

    path += 'C' + [cp1x, cp1y, cp2x, cp2y, x2, y2];
  }
  path += 'Z';
  return path;
}

cv['onRuntimeInitialized'] = () => {
  window.onload = init();
  // window.onresize = init();
};
