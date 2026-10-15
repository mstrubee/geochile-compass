import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom no trae DOMRect; Radix lo usa para posicionar menús y popovers.
if (typeof globalThis.DOMRect === "undefined") {
  class DOMRectPolyfill {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    static fromRect(r: { x?: number; y?: number; width?: number; height?: number } = {}) {
      return new DOMRectPolyfill(r.x, r.y, r.width, r.height);
    }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
  }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = DOMRectPolyfill;
}
