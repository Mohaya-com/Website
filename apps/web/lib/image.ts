/** A photo prepared for upload: downscaled JPEG, base64 without the data: prefix. */
export interface PreparedImage {
  type: 'image/jpeg';
  data: string;
  previewUrl: string;
}

const MAX_EDGE = 1600;
const MAX_BYTES = 1_400_000;

/**
 * Downscales a camera photo in the browser (also strips EXIF metadata such as location) so the upload
 * stays small and readable for text recognition.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  const source: CanvasImageSource & { width: number; height: number } = bitmap ?? (await loadImageElement(file));
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close();
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
