class LineRender {
  constructor(
    inputCanvas,
    outputCanvas,
    thresholdLow,
    thresholdHigh,
    levels,
    tension,
    tolerance,
    lWidth,
    minNumPoints
  ) {
    this.inputCanvas = inputCanvas;
    this.outputCanvas = outputCanvas;
    this.thresholdLow = thresholdLow;
    this.thresholdHigh = thresholdHigh;
    this.levels = levels;
    this.tension = tension;
    this.tolerance = tolerance;
    this.lWidth = lWidth;
    this.minNumPoints = minNumPoints;
  }
  readImage(inputCanvas) {
    let src = cv.imread(inputCanvas);
    return src;
  }
  findContours(src, dist) {
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
  }
  cleanUpPoints(contours, minNumPoints, tolerance) {
    let points = [];
    for (let i = 0; i < contours.size(); ++i) {
      const ci = contours.get(i);
      points[i] = [];
      for (let j = 0; j < ci.data32S.length; j += 2) {
        let p = [];
        p[0] = ci.data32S[j];
        p[1] = ci.data32S[j + 1];
        points[i].push(p);
      }
    }
    let fPoints = points.filter(function (element) {
      return element.length >= minNumPoints;
    });

    let sFPoints = [];
    fPoints.forEach((element) => {
      let simplifiedPoints = simplify(element, tolerance);
      sFPoints.push(simplifiedPoints);
    });
    return sFPoints;
  }
  scalePoints(points, canvas) {
    let currentScale = canvas.offsetWidth / cWidth;

    let scaledPoints = points.map(function (nested) {
      return nested.map(function (element) {
        return [element[0] * currentScale, element[1] * currentScale];
      });
    });
    return scaledPoints;
  }
}
