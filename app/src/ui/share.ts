// Sharing that works on iOS, Android and react-native-web (Snack web preview).
import { Linking, Platform, Share } from 'react-native';
import type { CurrencyCode, Minor } from '../types';
import { toMajor } from '../lib/money';
import { confirmAsync, showAlert } from './dialogs';

/** The few browser APIs used here, looked up on globalThis so this file needs no DOM typings. */
interface WebAnchor {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
}
interface WebGlobals {
  navigator?: {
    share?: (data: { title?: string; text?: string }) => Promise<void>;
    clipboard?: { writeText(text: string): Promise<void> };
  };
  document?: {
    createElement(tag: 'a'): WebAnchor;
    body: { appendChild(node: WebAnchor): unknown };
  };
  URL?: { createObjectURL(blob: unknown): string; revokeObjectURL(url: string): void };
  Blob?: new (parts: string[], options?: { type?: string }) => unknown;
  setTimeout: (fn: () => void, ms: number) => unknown;
  self?: unknown;
  top?: unknown;
}

const web = globalThis as unknown as WebGlobals;

/** True inside an iframe, e.g. Expo Snack's web preview, which may block downloads without telling us. */
function inFrame(): boolean {
  try {
    return web.top !== undefined && web.self !== undefined && web.top !== web.self;
  } catch {
    return true;
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!web.navigator?.clipboard) return false;
    await web.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Native share sheet; on web navigator.share, else copy to the clipboard, else show the text. */
export async function shareText(message: string, title?: string): Promise<void> {
  if (Platform.OS !== 'web') {
    try {
      await Share.share(title ? { message, title } : { message }, title ? { dialogTitle: title, subject: title } : undefined);
    } catch {
      showAlert('Could not share', 'Sharing is not available on this device.');
    }
    return;
  }

  if (web.navigator?.share) {
    try {
      await web.navigator.share({ title, text: message });
      return;
    } catch (error) {
      if (isAbort(error)) return; // the user closed the share sheet
    }
  }
  if (await copyToClipboard(message)) {
    showAlert('Copied to clipboard', 'Paste it into any chat or email.');
    return;
  }
  showAlert(title ?? 'Share', message);
}

/** Byte-order mark: without it Excel reads a UTF-8 CSV as ANSI and mangles ₹, € and non-ASCII names. */
const UTF8_BOM = '\uFEFF';

function withoutBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

/** A sandboxed preview can swallow the download silently, so offer the data on the clipboard too. */
async function offerCopyAfterDownload(filename: string, contents: string): Promise<void> {
  const copy = await confirmAsync(
    'Download started',
    `${filename} should appear in your downloads. If it does not (some previews block downloads), copy the data instead and paste it into a spreadsheet.`,
    { confirmText: 'Copy data', cancelText: 'Done' },
  );
  if (!copy) return;
  if (await copyToClipboard(withoutBom(contents))) {
    showAlert('Copied to clipboard', 'Paste it into a spreadsheet or a note.');
  } else {
    showAlert('Could not copy', 'This preview blocks the clipboard. Open SplitSnap on your phone with Expo Go to share the file.');
  }
}

/**
 * Web: downloads `contents` as `filename`. Native: shares the text through the share sheet
 * (Snack has no file-system APIs, so there is no real file to attach).
 */
export async function shareFile(filename: string, contents: string, mimeType: string = 'text/plain'): Promise<void> {
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message: contents, title: filename }, { dialogTitle: filename, subject: filename });
    } catch {
      showAlert('Could not share', 'Sharing is not available on this device.');
    }
    return;
  }

  try {
    const { document, URL, Blob } = web;
    if (!document || !URL || !Blob) throw new Error('No download support');
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    web.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (await copyToClipboard(withoutBom(contents))) {
      showAlert('Copied to clipboard', `Could not download ${filename}, so its contents were copied to your clipboard.`);
    } else {
      showAlert('Could not export', `Downloading ${filename} is not supported here.`);
    }
    return;
  }
  if (inFrame()) await offerCopyAfterDownload(filename, contents);
}

/** Web: downloads `filename` (UTF-8 with BOM, so Excel shows ₹ correctly). Native: shares the CSV text. */
export async function shareCsv(filename: string, csv: string): Promise<void> {
  if (Platform.OS !== 'web') {
    await shareFile(filename, csv, 'text/csv');
    return;
  }
  const body = csv.startsWith(UTF8_BOM) ? csv : UTF8_BOM + csv;
  await shareFile(filename, body, 'text/csv;charset=utf-8');
}

const UPI_NOTE_MAX = 50; // some UPI apps reject longer transaction notes

/**
 * Opens a UPI app with the payment pre-filled. Resolves false when no app could be opened
 * (web, non-INR currency, no UPI app installed); the caller then explains or falls back.
 */
export async function openUpiPayment(args: {
  upiId: string;
  name: string;
  amount: Minor;
  currency: CurrencyCode;
  note: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (args.currency.toUpperCase() !== 'INR' || !args.upiId.trim()) return false;

  const params = [
    `pa=${encodeURIComponent(args.upiId.trim())}`,
    `pn=${encodeURIComponent(args.name)}`,
  ];
  if (args.amount > 0) params.push(`am=${toMajor(args.amount, 'INR').toFixed(2)}`);
  params.push('cu=INR');
  const note = args.note.trim().slice(0, UPI_NOTE_MAX);
  if (note) params.push(`tn=${encodeURIComponent(note)}`);
  const url = `upi://pay?${params.join('&')}`;

  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return true;
    }
  } catch {
    // fall through to the direct attempt
  }
  // canOpenURL says false in Expo Go even with a UPI app installed (the upi scheme is not
  // declared in Expo Go's app config), so try opening directly; it throws if nothing handles it.
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
