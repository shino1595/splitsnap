// Which OCR.space key a scan sends: the user's own key from Settings, else the free key built into
// published builds, else the shared public demo key.
import { OCR_SPACE_DEMO_KEY } from './ocrSpace';

export type OcrKeySource = 'own' | 'built_in' | 'demo';

/** Keys arrive pasted (GitHub secret, Settings): drop spaces and line breaks picked up on the way. */
export function cleanBuiltInKey(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

function readBuiltInKey(): string {
  try {
    // Written out in full: Expo only inlines `process.env.EXPO_PUBLIC_…` member expressions.
    return cleanBuiltInKey(process.env.EXPO_PUBLIC_OCR_SPACE_KEY);
  } catch {
    // No `process` at all (the browser test runner, some previews).
    return '';
  }
}

/** Free OCR.space key that the GitHub publish job bakes into published builds (repo secret
 *  OCR_SPACE_KEY → EXPO_PUBLIC_OCR_SPACE_KEY, inlined when Expo bundles the update). '' in Snack,
 *  tests and builds published without the secret. It ships inside the app, so only ever a free key. */
export const OCR_BUILT_IN_KEY: string = readBuiltInKey();

/** Where the key for the next scan comes from. */
export function ocrKeySource(ownKey: string, builtInKey: string = OCR_BUILT_IN_KEY): OcrKeySource {
  if (ownKey.trim()) return 'own';
  return builtInKey.trim() ? 'built_in' : 'demo';
}

/** The key to send: the user's own, else the built-in one, else the demo key. */
export function ocrKeyFor(ownKey: string, builtInKey: string = OCR_BUILT_IN_KEY): string {
  return ownKey.trim() || builtInKey.trim() || OCR_SPACE_DEMO_KEY;
}

/** Short name of that key for the Account row and screen readers. */
export function ocrKeyLabel(source: OcrKeySource): string {
  if (source === 'own') return 'Your OCR.space key';
  return source === 'built_in' ? 'Built-in key' : 'Shared demo key';
}
