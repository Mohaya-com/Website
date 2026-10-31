import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { Worker } from 'tesseract.js';
import { describeError, logger } from '../logger';

/**
 * Text recognition for ID / Iqama photos with Tesseract (runs inside this server; images are never sent
 * to a third party). The Arabic and English models are bundled through the @tesseract.js-data packages,
 * so nothing is downloaded at runtime. Arabic matters: Saudi cards print the identity number and dates
 * in Arabic-Indic digits. One worker is shared and requests are processed one at a time.
 */

const LANGS = ['ara', 'eng'] as const;
const DATA_VERSION = '4.0.0_best_int';

function findModel(lang: string): string {
  const file = `${lang}.traineddata.gz`;
  if (process.env.OCR_LANG_PATH) return path.join(process.env.OCR_LANG_PATH, file);
  const roots = [process.cwd(), path.resolve(process.cwd(), '../../packages/server')];
  for (const root of roots) {
    try {
      const pkg = createRequire(path.join(root, 'package.json')).resolve(`@tesseract.js-data/${lang}/package.json`);
      const candidate = path.join(path.dirname(pkg), DATA_VERSION, file);
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // try the next root
    }
  }
  throw new Error(`Tesseract model "${lang}" not found (install @tesseract.js-data/${lang} or set OCR_LANG_PATH)`);
}

/** Tesseract reads every model from one directory: link the bundled files into a private temp folder. */
function prepareLangDir(): string {
  if (process.env.OCR_LANG_PATH) return process.env.OCR_LANG_PATH;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vms-ocr-'));
  for (const lang of LANGS) fs.symlinkSync(findModel(lang), path.join(dir, `${lang}.traineddata.gz`));
  return dir;
}

let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker([...LANGS], 1, { langPath: prepareLangDir(), gzip: true, cacheMethod: 'none' });
  })().catch((err) => {
    worker = null;
    throw err;
  });
  return worker;
}

/** Loads the models in the background so the first photo read after a restart does not wait for them. */
export function warmUpOcr(): void {
  getWorker().catch((err) => logger.warn('ocr.warmup_failed', describeError(err)));
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
