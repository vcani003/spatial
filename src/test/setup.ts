/**
 * Test environment shims.
 *
 * Everything here exists because jsdom implements the DOM but not a browser
 * ENGINE — no layout, no compositor, no pointer hardware. Each shim is a stub
 * rather than a polyfill, and the distinction matters: a polyfill would imply
 * the behaviour is being tested, when in fact it is being stood out of the way
 * so the behaviour AROUND it can be. What genuinely needs a browser is named
 * in the test file that needs it.
 *
 * Guarded so this file is harmless under the `node` environment that `core`'s
 * tests run in, where `Element` does not exist at all.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
  /* jsdom measures nothing, so a real observer would only ever report zero. */
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (typeof Element !== "undefined") {
  /* Pointer capture needs a real pointer. jsdom throws `NotFoundError` for an
     id no hardware ever produced, which would fail every gesture test for a
     reason that has nothing to do with the gesture. */
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {};
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {};
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
}
