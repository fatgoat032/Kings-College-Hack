// Loads OpenCV.js from our own files (src/vision/vendor/opencv.js, OpenCV 4.10.0),
// NOT from a CDN, because venue Wi-Fi may fail. Vite serves/bundles it as a static asset.
import cvUrl from './vendor/opencv.js?url';

let loading = null;

/** Resolves with the ready `cv` object. Safe to call many times. */
export function loadCv() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    // OpenCV's module object is "thenable"; strip .then so awaiting it can't loop forever.
    const done = (m) => {
      if (m && typeof m.then === 'function') {
        try { delete m.then; } catch { /* ignore */ }
      }
      resolve(m);
    };
    const settle = () => {
      const cv = globalThis.cv;
      if (!cv) return reject(new Error('OpenCV.js loaded but window.cv is missing'));
      if (cv.Mat) done(cv);
      else if (typeof cv.then === 'function') cv.then(done);
      else cv.onRuntimeInitialized = () => done(cv);
    };
    if (globalThis.cv) return settle();
    const s = document.createElement('script');
    s.src = cvUrl;
    s.async = true;
    s.onload = settle;
    s.onerror = () => {
      loading = null;
      reject(new Error(`Could not load OpenCV.js from ${cvUrl}`));
    };
    document.head.appendChild(s);
  });
  return loading;
}
