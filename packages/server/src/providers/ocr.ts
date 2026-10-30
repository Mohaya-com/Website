import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Worker } from 'tesseract.js';
import { describeError, logger } from '../logger';

/**
 * Text recognition for ID / Iqama photos with Tesseract (runs inside this server; images are never sent
 * to a third party). The English model is bundled through the @tesseract.js-data/eng package, so no
 * download happens at runtime. One worker is shared and requests are processed one at a time.
 */

const DATA_PACKAGE = '@tesseract.js-data/eng';
const DATA_VERSION = '4.0.0_best_int';

function findLangPath(): string {
  if (process.env.OCR_LANG_PATH) return process.env.OCR_LANG_PATH;
  const roots = [process.cwd(), path.resolve(process.cwd(), '../../packages/server')];
  for (const root of roots) {
    try {
      const pkg = createRequire(path.join(root, 'package.json')).resolve(`${DATA_PACKAGE}/package.json`);
      const dir = path.join(path.dirname(pkg), DATA_VERSION);
      if (fs.existsSync(dir)) return dir;
    } catch {
      // try the next root
    }
  }
  throw new Error('Tesseract language data not found (install @tesseract.js-data/eng or set OCR_LANG_PATH)');
}

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker('eng', 1, { langPath: findLangPath(), gzip: true, cacheMethod: 'none' });
  })().catch((err) => {
    worker = null;
    throw err;
  });
  return worker;
}

/** Returns the text found in the image, or null when recognition is unavailable. */
export async function recognizeText(image: Buffer): Promise<string | null> {
  const run = queue.then(async () => {
    const w = await getWorker();
    const { data } = await w.recognize(image);
    return data.text;
  });
  queue = run.catch(() => undefined);
  try {
    return await run;
  } catch (err) {
    logger.warn('ocr.failed', describeError(err));
    return null;
  }
}
