/**
 * Polyfill browser-specific DOMMatrix, Path2D, and ImageData globals
 * required by PDF.js (pdfjs-dist / pdf-parse) in Node.js environments.
 */
export function ensureNodeCanvasPolyfills(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    class DOMMatrixPolyfill {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      m11 = 1;
      m12 = 0;
      m13 = 0;
      m14 = 0;
      m21 = 0;
      m22 = 1;
      m23 = 0;
      m24 = 0;
      m31 = 0;
      m32 = 0;
      m33 = 1;
      m34 = 0;
      m41 = 0;
      m42 = 0;
      m43 = 0;
      m44 = 1;
      is2D = true;
      isIdentity = true;

      constructor(init?: unknown) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }

      translate() {
        return this;
      }
      scale() {
        return this;
      }
      rotate() {
        return this;
      }
      multiply() {
        return this;
      }
      inverse() {
        return this;
      }
      transformPoint(p: unknown) {
        return p;
      }
      static fromMatrix() {
        return new DOMMatrixPolyfill();
      }
      static fromFloat32Array() {
        return new DOMMatrixPolyfill();
      }
      static fromFloat64Array() {
        return new DOMMatrixPolyfill();
      }
    }
    g.DOMMatrix = DOMMatrixPolyfill;
    g.DOMMatrixReadOnly = DOMMatrixPolyfill;
  }

  if (typeof g.Path2D === "undefined") {
    class Path2DPolyfill {
      addPath() {}
      closePath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      arc() {}
      rect() {}
    }
    g.Path2D = Path2DPolyfill;
  }

  if (typeof g.ImageData === "undefined") {
    class ImageDataPolyfill {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    g.ImageData = ImageDataPolyfill;
  }
}

ensureNodeCanvasPolyfills();
