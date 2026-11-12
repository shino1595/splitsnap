// Pure helpers for kept bill photos: the 'kept://' link format and file names. No file access here.

/** Scheme of a bill photo kept in the app's own folder: 'kept://receipts/<file name>'. */
export const KEPT_SCHEME = 'kept://';

/** Folder, inside the app's documents folder, that holds kept photos. */
export const KEPT_FOLDER = 'receipts';

const KEPT_PREFIX = `${KEPT_SCHEME}${KEPT_FOLDER}/`;
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'];
const OUR_NAME = /^receipt-\d+-[a-z0-9]+\.[a-z0-9]+$/;

export function isKeptUri(uri: string | undefined): boolean {
  return typeof uri === 'string' && keptName(uri) !== null;
}

/** The file name inside a kept uri, or null when `uri` is not a well-formed kept uri. */
export function keptName(uri: string | undefined): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(KEPT_PREFIX)) return null;
  const name = uri.slice(KEPT_PREFIX.length);
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  return name;
}

export function keptUriFor(name: string): string {
  return KEPT_PREFIX + name;
}

/** Image extension of a file:// or content:// uri (query and fragment ignored); 'jpg' when unknown. */
export function imageExtensionOf(uri: string): string {
  const path = uri.split(/[?#]/)[0] ?? '';
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  const ext = dot >= 0 ? last.slice(dot + 1).toLowerCase() : '';
  return IMAGE_EXTENSIONS.includes(ext) ? ext : 'jpg';
}

/** 'receipt-<time>-<random>.<ext>'; `random` is a number in [0, 1). */
export function newKeptFileName(sourceUri: string, now: number, random: number): string {
  const part = Math.floor(Math.min(Math.max(random, 0), 0.999999999) * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `receipt-${Math.floor(now)}-${part}.${imageExtensionOf(sourceUri)}`;
}

/** Names from `listed` that we created (receipt-…) and that no uri in `inUse` refers to. */
export function unusedKeptNames(listed: string[], inUse: string[]): string[] {
  const used = new Set<string>();
  for (const uri of inUse) {
    const name = keptName(uri);
    if (name) used.add(name);
  }
  return listed.filter((name) => OUR_NAME.test(name) && !used.has(name));
}

/** A file name that is safe on every phone: path and reserved characters replaced by '_'. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'file.txt';
}

/** Share-sheet type identifier (iOS UTI) for a mime type. */
export function utiFor(mimeType: string): string {
  const type = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  if (type === 'text/csv') return 'public.comma-separated-values-text';
  if (type === 'application/json') return 'public.json';
  return 'public.plain-text';
}
