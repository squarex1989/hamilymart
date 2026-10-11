/** Retain Three's ordinary-renderer contract without accessing any XR APIs. */
export class WebXRManager {
  enabled = false;
  isPresenting = false;
  addEventListener() {}
  removeEventListener() {}
  setAnimationLoop() {}
  dispose() {}
  getSession() { return null; }
  // WebGLBackground calls this on every frame, even when XR is disabled.
  getEnvironmentBlendMode() { return undefined; }
}
