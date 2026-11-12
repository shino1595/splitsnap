// The only file that imports expo-file-system and expo-sharing. Neither works in the Snack web
// preview, so every function here does nothing but fall back there, and never throws.
import type * as FileSystemTypes from 'expo-file-system';
import type * as SharingTypes from 'expo-sharing';
import { Platform } from 'react-native';
import {
  KEPT_FOLDER,
  KEPT_SCHEME,
  isKeptUri,
  keptName,
  keptUriFor,
  newKeptFileName,
  safeFileName,
  unusedKeptNames,
  utiFor,
} from './receiptNames';

export { KEPT_SCHEME, isKeptUri };

// Loaded on first use, so a runtime without these modules fails one action, not the app.
let fileSystemModule: Promise<typeof FileSystemTypes> | null = null;
function loadFileSystem(): Promise<typeof FileSystemTypes> {
  if (!fileSystemModule) {
    fileSystemModule = import('expo-file-system').catch((error: unknown) => {
      fileSystemModule = null;
      throw error;
    });
  }
  return fileSystemModule;
}

let sharingModule: Promise<typeof SharingTypes> | null = null;
function loadSharing(): Promise<typeof SharingTypes> {
  if (!sharingModule) {
    sharingModule = import('expo-sharing').catch((error: unknown) => {
      sharingModule = null;
      throw error;
    });
  }
  return sharingModule;
}

/** Writes text to a file in the app's cache folder and opens the share sheet for it (so it can be saved to Files, Drive, or sent). Resolves false when files or sharing aren't available here; the caller then falls back. */
export async function shareTextAsFile(filename: string, contents: string, mimeType: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [FileSystem, Sharing] = await Promise.all([loadFileSystem(), loadSharing()]);
    if (!(await Sharing.isAvailableAsync())) return false;
    const file = new FileSystem.File(FileSystem.Paths.cache, safeFileName(filename));
    if (file.exists) file.delete();
    file.create();
    file.write(contents);
    await Sharing.shareAsync(file.uri, {
      mimeType: mimeType.split(';')[0]?.trim() || 'text/plain',
      UTI: utiFor(mimeType),
      dialogTitle: filename,
    });
    return true;
  } catch {
    return false;
  }
}

/** Copies a photo (a file:// or content:// uri from the camera, the gallery or the image shrinker) into <documents>/receipts/ under a fresh unique name and returns its 'kept://receipts/…' uri. Returns the uri it was given when it is already kept, is a data:/http(s): uri, on web, or when the copy fails. */
export async function keepReceiptPhoto(uri: string): Promise<string> {
  if (Platform.OS === 'web' || !uri || isKeptUri(uri) || /^(data|https?):/i.test(uri)) return uri;
  try {
    const FileSystem = await loadFileSystem();
    const folder = new FileSystem.Directory(FileSystem.Paths.document, KEPT_FOLDER);
    folder.create({ intermediates: true, idempotent: true });
    const name = newKeptFileName(uri, Date.now(), Math.random());
    const copy = new FileSystem.File(folder, name);
    new FileSystem.File(uri).copy(copy);
    return copy.exists ? keptUriFor(name) : uri;
  } catch {
    return uri;
  }
}

/** The uri an <Image> can show: kept:// uris resolved against the app's documents folder; everything else as given. null when a kept uri can't be resolved here (web, library missing). */
export async function resolveReceiptUri(uri: string): Promise<string | null> {
  const name = keptName(uri);
  if (name === null) return uri.startsWith(KEPT_SCHEME) ? null : uri;
  if (Platform.OS === 'web') return null;
  try {
    const FileSystem = await loadFileSystem();
    const file = new FileSystem.File(FileSystem.Paths.document, KEPT_FOLDER, name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Deletes kept photos that no expense refers to any more. `inUse` = every receiptUri in the state (kept or not). Never throws. Returns how many were deleted. */
export async function sweepKeptReceipts(inUse: string[]): Promise<number> {
  if (Platform.OS === 'web') return 0;
  try {
    const FileSystem = await loadFileSystem();
    const folder = new FileSystem.Directory(FileSystem.Paths.document, KEPT_FOLDER);
    if (!folder.exists) return 0;
    const names: string[] = [];
    for (const entry of folder.list()) {
      if (entry instanceof FileSystem.File) names.push(entry.name);
    }
    let deleted = 0;
    for (const name of unusedKeptNames(names, inUse)) {
      try {
        new FileSystem.File(folder, name).delete();
        deleted += 1;
      } catch {
        // Skip a file that can't be deleted; the next start tries again.
      }
    }
    return deleted;
  } catch {
    return 0;
  }
}
