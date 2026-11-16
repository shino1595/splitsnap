// The Undo bar's state: one notice at a time, shown by showUndo and rendered by UndoBar.

export interface UndoNotice {
  id: number;
  message: string;
  undoLabel: string;
  onUndo: () => void;
}

type Listener = (notice: UndoNotice | null) => void;

const DEFAULT_DURATION_MS = 6000;

let current: UndoNotice | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners: Listener[] = [];

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function setCurrent(notice: UndoNotice | null): void {
  current = notice;
  for (const listener of listeners.slice()) listener(notice);
}

/** Shows the bar (replacing any current one); it hides by itself after durationMs (default 6000). */
export function showUndo(message: string, onUndo: () => void, opts?: { undoLabel?: string; durationMs?: number }): void {
  clearTimer();
  const notice: UndoNotice = { id: nextId++, message, undoLabel: opts?.undoLabel ?? 'Undo', onUndo };
  setCurrent(notice);
  timer = setTimeout(() => {
    if (current && current.id === notice.id) dismissUndo();
  }, opts?.durationMs ?? DEFAULT_DURATION_MS);
}

export function dismissUndo(): void {
  clearTimer();
  if (current) setCurrent(null);
}

/** Runs the current notice's onUndo once and hides the bar. */
export function runUndo(): void {
  const notice = current;
  if (!notice) return;
  dismissUndo();
  notice.onUndo();
}

export function currentUndo(): UndoNotice | null {
  return current;
}

export function subscribeUndo(listener: (notice: UndoNotice | null) => void): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}
