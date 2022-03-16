// four steps
// start with real image (DONE)
// use blob detection to generate same brightness iso lines (DONE)
// simplify (WORKING ON IT)
// draw catmull rom splines though said vertecies (NEED A BETTER WAY, DON'T LIKE CURRENT LIBRARY)

let threshLow = 0;
let threshHigh = 255;
let levels = 20;
let tension = -0.75;
let tolerance = 10;
let lWidth = 0.5;
let cWidth = 800;
let cHeight = 800;
let minNumPointsInContour = 4;
const imgUrl = 'https://source.unsplash.com/random';
function init() {
  const img = document.createElement('img');
  img.id = 'i0';
  img.crossOrigin = 'Anonymous';
  document.body.appendChild(img);

  const cInput = document.createElement('canvas');
  cInput.id = 'c0';
  cInput.width = cWidth;
  cInput.height = cHeight;

  document.body.appendChild(cInput);
  const cOutput = document.createElement('canvas');
  cOutput.id = 'c1';
  cOutput.width = cWidth;
  cOutput.height = cHeight;

  document.body.appendChild(cOutput);

  img.onload = function () {
    console.log('img loaded');

    paper.setup('c1');
    paper.view.size.width = cWidth;
    paper.view.size.height = cHeight;
    let center = new paper.Point(cWidth / 2, cHeight / 2);
    paper.view.center = center;
    draw.imgToCanvas();
  };
  img.src = imgUrl;
}
const draw = {
  imgToCanvas: function () {
    const img = document.querySelector('#i0');
    const c = document.querySelector('#c0');
    const ctx = c.getContext('2d');
    var scale = Math.max(c.width / img.width, c.height / img.height);
    // get the top left position of the image
    var x = c.width / 2 - (img.width / 2) * scale;
    var y = c.height / 2 - (img.height / 2) * scale;
    ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
    draw.contourMap();
  },
  contourMap: function () {
    const cInput = document.querySelector('#c0');
    const ctxInput = cInput.getContext('2d');
    const cOutput = document.querySelector('#c1');
    const ctxOutput = cOutput.getContext('2d');

    console.log('cvloaded');

    let inc = (threshHigh - threshLow) / levels;
    let tInc = threshLow;
    let threshArr = [];
    for (let i = 0; i < levels; i++) {
      tInc = tInc + inc;
      threshArr.push(tInc);
    }
    console.log('Curve Draw Started');
    let t1 = performance.now();
    // loop to perform contour find and draw a difference levels of grey
    let src = cv.imread(cInput);
    threshArr.forEach((element) => {
      console.log(element);
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
      let currentScale = getScale();
      let scaledPoints = fPoints.map(function (nested) {
        return nested.map(function (element) {
          return [element[0] * currentScale, element[1] * currentScale];
        });
      });

      scaledPoints.forEach((element) => {
        let path = new paper.Path(element);
        path.closed = true;
        path.simplify([tolerance]);
        path.smooth({ type: 'catmull-rom', factor: tension * Math.random() });

        path.strokeWidth = lWidth;
        path.strokeColor = 'black';
      });

      dst.delete();
      contours.delete();
      hierarchy.delete();
    });
    paper.view.viewsize = [
      document.querySelector('#c1').offsetWidth,
      document.querySelector('#c1').offsetHeight,
    ];
    paper.view.draw();
    src.delete();
    let t2 = performance.now();
    console.log(
      'Curve Draw Finished, took: ' + (t2 - t1) / 1000 + ' seconds'
      // draw.downloadAsSVG('test');
    );
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

cv['onRuntimeInitialized'] = () => {
  window.onload = init();
  // window.onresize = init();
};
