import * as React from 'react';

/** Cormorant Garamond Bold (SIL Open Font License), a static TTF from the @expo-google-fonts npm package, pinned by version. */
export const TITLE_FONT_URL =
  'https://cdn.jsdelivr.net/npm/@expo-google-fonts/cormorant-garamond@0.4.1/700Bold/CormorantGaramond_700Bold.ttf';
export const TITLE_FONT_FAMILY = 'CormorantGaramond-Bold';

/** Sizes while the title font is active (Cormorant sets small, so it is larger than the system-font sizes). */
export const TITLE_FONT_SIZE = 27;
export const HEADER_FONT_SIZE = 22;
export const TITLE_LETTER_SPACING = 0.2;

/** Rendering waits for the font at most this long; a slow or offline load just leaves titles in the system font. */
export const FONT_WAIT_MS = 2500;

type Status = 'idle' | 'loading' | 'ready' | 'failed';
let status: Status = 'idle';
const listeners = new Set<() => void>();

function setStatus(next: Status): void {
  status = next;
  listeners.forEach((listener) => listener());
}

/** Starts loading the title font once. expo-font is loaded with import() so a runtime without it only loses the font. */
export function loadTitleFont(): void {
  if (status !== 'idle') return;
  setStatus('loading');
  import('expo-font')
    .then((Font) => Font.loadAsync({ [TITLE_FONT_FAMILY]: { uri: TITLE_FONT_URL } }))
    .then(() => setStatus('ready'))
    .catch((error: unknown) => {
      console.warn('Title font could not load, using the system font:', error);
      setStatus('failed');
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once the title font is registered; components using it re-render when that happens. */
export function useTitleFont(): boolean {
  return React.useSyncExternalStore(subscribe, () => status === 'ready');
}

/** False until the font has loaded or failed, or FONT_WAIT_MS has passed: the app shows its loading screen meanwhile. */
export function useFontSettled(): boolean {
  const settled = React.useSyncExternalStore(subscribe, () => status === 'ready' || status === 'failed');
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  return settled || timedOut;
}
