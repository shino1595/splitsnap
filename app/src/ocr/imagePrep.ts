// Shrinks a bill photo to a JPEG that fits OCR.space's free 1 MB upload limit.
import type * as ManipulatorTypes from 'expo-image-manipulator';
import { Image } from 'react-native';
import { OcrError } from './types';

/** Decoded JPEG size we aim below (OCR.space free tier rejects files over 1024 KB). */
export const MAX_OCR_BYTES = 950 * 1024;

const ATTEMPTS: { longEdge: number; compress: number }[] = [
  { longEdge: 1600, compress: 0.7 },
  { longEdge: 1300, compress: 0.5 },
  { longEdge: 1000, compress: 0.35 },
];

interface Size {
  width: number;
  height: number;
}

interface Saved {
  uri: string;
  base64?: string;
}

/** Older builds of expo-image-manipulator only have manipulateAsync. */
interface LegacyManipulator {
  manipulateAsync?: (
    uri: string,
    actions: { resize: { width?: number; height?: number } }[],
    options: { compress: number; format: ManipulatorTypes.SaveFormat; base64: boolean },
  ) => Promise<Saved>;
}

function validSize(size?: { width: number; height: number } | null): Size | null {
  if (!size) return null;
  const { width, height } = size;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function getImageSize(uri: string): Promise<Size | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (size: Size | null) => {
      if (settled) return;
      settled = true;
      resolve(size);
    };
    const timer = setTimeout(() => finish(null), 5000);
    try {
      Image.getSize(
        uri,
        (width, height) => {
          clearTimeout(timer);
          finish(validSize({ width, height }));
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
      );
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/** Resize target for a long edge, or null when the photo is already small enough (never upscale). */
function resizeFor(size: Size | null, longEdge: number): { width?: number; height?: number } | null {
  if (!size) return { width: longEdge };
  if (Math.max(size.width, size.height) <= longEdge) return null;
  return size.width >= size.height ? { width: longEdge } : { height: longEdge };
}

function release(shared: unknown): void {
  try {
    const fn = (shared as { release?: () => void } | null)?.release;
    if (typeof fn === 'function') fn.call(shared);
  } catch {
    // Already released or not a shared object.
  }
}

// Loaded on first use, so a manipulator that cannot load in some runtime fails one scan, not the app.
let manipulatorModule: Promise<typeof ManipulatorTypes> | null = null;
function loadManipulator(): Promise<typeof ManipulatorTypes> {
  if (!manipulatorModule) {
    manipulatorModule = import('expo-image-manipulator').catch((error: unknown) => {
      manipulatorModule = null;
      throw error;
    });
  }
  return manipulatorModule;
}

async function renderJpeg(uri: string, resize: { width?: number; height?: number } | null, compress: number): Promise<Saved> {
  const Manipulator = await loadManipulator();
  const modern: { manipulate?: unknown } | undefined = Manipulator.ImageManipulator;
  if (modern && typeof modern.manipulate === 'function') {
    const context = Manipulator.ImageManipulator.manipulate(uri);
    let image: ManipulatorTypes.ImageRef | null = null;
    try {
      // Pass only the side being set: on web an explicit `width: null` makes the canvas width 0.
      if (resize) context.resize(resize.width !== undefined ? { width: resize.width } : { height: resize.height });
      image = await context.renderAsync();
      return await image.saveAsync({ format: Manipulator.SaveFormat.JPEG, compress, base64: true });
    } finally {
      release(image);
      release(context);
    }
  }
  const legacy = (Manipulator as unknown as LegacyManipulator).manipulateAsync;
  if (typeof legacy !== 'function') throw new OcrError('unknown', 'Image tools are not available on this device.');
  return legacy(uri, resize ? [{ resize }] : [], { compress, format: Manipulator.SaveFormat.JPEG, base64: true });
}

function stripDataPrefix(base64: string): string {
  return base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
}

/** Bytes of the file encoded by a base64 string. */
export function base64Bytes(base64: string): number {
  const clean = stripDataPrefix(base64 || '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Resize (long edge ≤ 1600, then 1300, 1000) and JPEG-compress (0.7 → 0.5 → 0.35) until the
 *  decoded size is < 950 KB. Uses ImageManipulator.manipulate(uri).resize(...).renderAsync() then
 *  saveAsync({ format: SaveFormat.JPEG, compress, base64: true }); falls back to the deprecated
 *  manipulateAsync if the new API is missing. Works with file:// and data: URIs (web). */
export async function prepareImageForOcr(
  uri: string,
  size?: { width: number; height: number },
): Promise<{ base64: string; uri: string; bytes: number }> {
  if (typeof uri !== 'string' || !uri.trim()) throw new OcrError('unknown', 'There is no photo to read.');
  const known = validSize(size) ?? (await getImageSize(uri));

  for (const attempt of ATTEMPTS) {
    let saved: Saved;
    try {
      saved = await renderJpeg(uri, resizeFor(known, attempt.longEdge), attempt.compress);
    } catch (error) {
      if (error instanceof OcrError) throw error;
      console.warn('Shrinking the bill photo failed:', error);
      const failure = new OcrError('unknown', "Couldn't open this photo. Try another one.");
      failure.cause = error;
      throw failure;
    }
    const base64 = stripDataPrefix(saved.base64 ?? '');
    if (!base64) throw new OcrError('unknown', "Couldn't open this photo. Try another one.");
    const bytes = base64Bytes(base64);
    if (bytes < MAX_OCR_BYTES) return { base64, uri: saved.uri, bytes };
  }
  throw new OcrError('too_large');
}
