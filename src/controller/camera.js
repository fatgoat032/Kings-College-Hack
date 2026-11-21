// Turn a photo File from <input type="file" capture> into a JPEG data URL, max 1280 px wide.
import { FORT_IMAGE_MAX_W } from '../shared/events.js';

export async function fileToJpeg(file, { maxW = FORT_IMAGE_MAX_W, quality = 0.85 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // browsers apply EXIF orientation to <img> by default
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
