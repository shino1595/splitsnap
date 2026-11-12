// Lets the user pick a text file (a backup) and reads it. expo-document-picker is loaded on first
// use, like the photo libraries: if it can't load, only the file button stops working.
type DocumentPickerModule = typeof import('expo-document-picker');
let documentPickerModule: Promise<DocumentPickerModule> | null = null;

function loadDocumentPicker(): Promise<DocumentPickerModule> {
  if (!documentPickerModule) {
    documentPickerModule = import('expo-document-picker').catch((error: unknown) => {
      documentPickerModule = null;
      throw error;
    });
  }
  return documentPickerModule;
}

export type PickedTextFile =
  | { ok: true; text: string; name: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'too-big' | 'unreadable' };

export async function pickTextFile(maxBytes: number): Promise<PickedTextFile> {
  let picker: DocumentPickerModule;
  try {
    picker = await loadDocumentPicker();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    // Any type: some phones don't tag .json files as JSON, and the content is checked anyway.
    const result = await picker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled || !result.assets || result.assets.length === 0) return { ok: false, reason: 'cancelled' };
    const asset = result.assets[0];
    if (asset.size && asset.size > maxBytes) return { ok: false, reason: 'too-big' };
    // The web picker hands over a File; on phones the copy in the app's cache is read with fetch.
    const webFile = (asset as { file?: { text(): Promise<string> } }).file;
    const text = webFile ? await webFile.text() : await (await fetch(asset.uri)).text();
    if (text.length > maxBytes) return { ok: false, reason: 'too-big' };
    return { ok: true, text, name: asset.name || 'backup.json' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
