/** A photo prepared for upload: downscaled JPEG, base64 without the data: prefix. */
export interface PreparedImage {
  type: 'image/jpeg';
  data: string;
  previewUrl: string;
}

const MAX_EDGE = 1600;
const MAX_BYTES = 1_400_000;

/** The copy sent for text recognition: smaller, greyscale and contrast-stretched, so it uploads and reads fast. */
const READING_EDGE = 1400;

/** A photo for the record plus a light copy for reading its text. */
export interface PreparedIdPhoto extends PreparedImage {
  reading: { type: 'image/jpeg'; data: string };
}

type Source = CanvasImageSource & { width: number; height: number };

async function decode(file: File): Promise<{ source: Source; close: () => void }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  return bitmap ? { source: bitmap, close: () => bitmap.close() } : { source: await loadImageElement(file), close: () => undefined };
}

function draw(source: Source, maxEdge: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Greyscale with the darkest and lightest 1% clipped, which helps Tesseract on glare and dim photos. */
function toReadingCopy(source: Source): { type: 'image/jpeg'; data: string } {
  const { canvas, ctx } = draw(source, READING_EDGE);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
    px[i] = y;
    hist[y | 0]!++;
  }
  const total = px.length / 4;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]!) < total * 0.01) lo++;
  acc = 0;
  while (hi > 0 && (acc += hist[hi]!) < total * 0.01) hi--;
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i]! - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  return { type: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

/** An ID photo: the full photo kept with the record, and the light copy used only to read it. */
export async function prepareIdPhoto(file: File): Promise<PreparedIdPhoto> {
  const { source, close } = await decode(file);
  try {
    return { ...encodePhoto(source), reading: toReadingCopy(source) };
  } finally {
    close();
  }
}

/**
 * Downscales a camera photo in the browser (also strips EXIF metadata such as location) so the upload
 * stays small.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const { source, close } = await decode(file);
  try {
    return encodePhoto(source);
  } finally {
    close();
  }
}

function encodePhoto(source: Source): PreparedImage {
  const { canvas } = draw(source, MAX_EDGE);
  let quality = 0.88;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (dataUrl.length * 0.75 > MAX_BYTES && quality > 0.4) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return { type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1), previewUrl: dataUrl };
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}
