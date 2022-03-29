// four steps
// start with image (DONE)
// use blob detection to generate same brightness iso lines from threshold (DONE)
// simplify/smooth (simplify js)
// draw catmull rom splines though said vertecies (switched to svg.js)
//to do, add rough.js

let threshLow = 0;
let threshHigh = 255;
let levels = 5;
let tension = 1;
let tolerance = 3;
let lWidth = 1;
let minNumPointsInContour = 3;
let margin = 150;
let marginGrow = 30;
let minPathLength = 10;
let miterLimit = 5;

const imgUrl = 'https://source.unsplash.com/random/';
let img, fileInput, outputSVG, tensionSlider;
let newImageStatus = true;

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
  tensionSlider = makeSlider(
    'tension-slider',
    -10,
    10,
    0.25,
    tension,
    'Tension'
  );
  toleranceSlider = makeSlider(
    'tolerance-slider',
    0,
    50,
    0.5,
    tolerance,
    'Tolerance'
  );
  levelsSlider = makeSlider('levels-slider', 1, 100, 1, levels, 'Levels');
  marginSlider = makeSlider('margin-slider', 1, 500, 1, margin, 'Margin');
  thresholdLowSlider = makeSlider(
    'threshold-low-slider',
    0,
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
  minPathLengthSlider = makeSlider(
    'min-path-length-slider',
    0,
    100,
    1,
    minPathLength,
    'Minimum Path Length'
  );
  const drawButton = document.createElement('button');
  drawButton.innerHTML = 'Draw Lines';
  drawButton.id = 'draw-button';
  controls.appendChild(drawButton);

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
    newImageStatus = true;
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
    let pathGroup = outputSVG.group();
    let pathArray = [];
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
    if (threshArr.length == 1) {
      threshArr[0] = 255 / 2;
    }
    console.log(threshArr);
    console.log('Curve Draw Started');
    console.time('Line Drawing Time');
    let src = cv.imread(cInput);
    let ksize = new cv.Size(25, 25);
    let pathLengthCounter = 0;
    // loop over the different threshold divisions
    threshArr.forEach((element) => {
      // find contours and setup
      let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);

      // cv.GaussianBlur(dst, dst, ksize, 0, 0, cv.BORDER_DEFAULT);
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
          // if (
          //   parseInt(ci.data32S[k]) >= parseInt(marginSlider.value) &&
          //   parseInt(ci.data32S[k]) <=
          //     outputSVG.viewbox().width - parseInt(marginSlider.value) &&
          //   parseInt(ci.data32S[k + 1]) >= parseInt(marginSlider.value) &&
          //   parseInt(ci.data32S[k + 1]) <=
          //     outputSVG.viewbox().height - parseInt(marginSlider.value)
          // ) {
          p[0] = parseInt(ci.data32S[k]);
          p[1] = parseInt(ci.data32S[k + 1]);
          points[j].push(p);
          // }
        }
      }

      // filter out contours with less than minNumPointsInContour (usually < 4)
      let fPoints = points.filter(function (element) {
        return element.length >= minNumPointsInContour;
      });

      // simplify points before drawing
      let sFPoints = [];
      fPoints.forEach((element) => {
        let simplifiedPoints = simplify(element, toleranceSlider.value, true);
        sFPoints.push(simplifiedPoints);
      });

      // push parsed svg paths to new array
      sFPoints.forEach((element) => {
        // console.log(catmullRomInterpolation(element.flat(), tension));
        let drawnPath = catmullRomInterpolation(
          element.flat(),
          tensionSlider.value,
          outputSVG
        );
        pathArray.push(drawnPath);
      });
      dst.delete();
      contours.delete();
      hierarchy.delete();
    });

    pathArray.forEach((element) => {
      let currentPath = outputSVG.path(element);
      if (currentPath.length() >= minPathLengthSlider.value) {
        pathLengthCounter += currentPath.length();
        pathGroup.add(currentPath);
      }
    });
    console.log('Total Path Length:' + pathLengthCounter);
    outputSVG.fill('none');
    pathGroup.stroke({
      color: '#313639',
      linejoin: 'miter',
      miterlimit: miterLimit,
      width: lWidthSlider.value,
    });

    // let rect = outputSVG
    //   .rect(
    //     outputSVG.viewbox().width - marginSlider.value * 2,
    //     outputSVG.viewbox().height - marginSlider.value * 2
    //   )
    //   .move(marginSlider.value, marginSlider.value);
    // pathGroup.clipWith(rect);
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

function saveOutputAsPNG() {
  saveSvgAsPng(document.getElementById('outputSVG'), 'Download.png');
}
function getNewImage(img) {
  newImageStatus = true;
  img.src = 'https://source.unsplash.com/random/?n=' + Math.random();
  console.time('Image Load Time');
}

function catmullRomInterpolation(points, k, outputSVG) {
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
    if (x2 <= marginSlider.value) {
      path += 'L' + [x2, y2];
    } else if (y2 <= marginSlider.value) {
      path += 'L' + [x2, y2];
    } else if (x2 >= outputSVG.viewbox().width - marginSlider.value) {
      path += 'L' + [x2, y2];
    } else if (y2 >= outputSVG.viewbox().height - marginSlider.value) {
      path += 'L' + [x2, y2];
    } else {
      path += 'C' + [cp1x, cp1y, cp2x, cp2y, x2, y2];
    }
  }
  // path += 'Z';
  return path;
}
function getRandomColor() {
  var letters = '0123456789ABCDEF';
  var color = '#';
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

cv['onRuntimeInitialized'] = () => {
  window.onload = init();
  // window.onresize = init();
};
