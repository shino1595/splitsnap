// OCR.space client (free tier). Uses only fetch / AbortController so it runs on iOS, Android
// and react-native-web; the response handling is pure and unit-tested with real responses.
import type { OcrEngine } from '../types';
import { buildRows } from './lineBuilder';
import { OcrError, type OcrErrorCode, type OcrLine, type OcrResult, type OcrWord } from './types';

export const OCR_SPACE_DEMO_KEY = 'helloworld';
export const OCR_SPACE_ENDPOINT = 'https://api.ocr.space/parse/image';
export const OCR_TIMEOUT_MS = 45000;

interface OcrSpaceWord {
  WordText?: unknown;
  Left?: unknown;
  Top?: unknown;
  Width?: unknown;
  Height?: unknown;
}

interface OcrSpaceLine {
  LineText?: unknown;
  Words?: unknown;
}

interface OcrSpaceParsedResult {
  TextOverlay?: { Lines?: unknown } | null;
  ParsedText?: unknown;
  ErrorMessage?: unknown;
  ErrorDetails?: unknown;
  FileParseExitCode?: unknown;
}

/** The parts of an OCR.space /parse/image response we read. */
export interface OcrSpaceResponse {
  ParsedResults?: unknown;
  OCRExitCode?: unknown;
  IsErroredOnProcessing?: unknown;
  ErrorMessage?: unknown;
  ErrorDetails?: unknown;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function messageText(...values: unknown[]): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) v.forEach(add);
  };
  values.forEach(add);
  return parts.join(' ');
}

function parsedResults(json: OcrSpaceResponse | null | undefined): OcrSpaceParsedResult[] {
  return asArray(json?.ParsedResults).filter((r): r is OcrSpaceParsedResult => !!r && typeof r === 'object');
}

/** TextOverlay lines of every page, in OCR.space order. Lines without usable boxes keep their text. */
export function overlayLines(json: OcrSpaceResponse | null | undefined): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const page of parsedResults(json)) {
    for (const raw of asArray(page.TextOverlay?.Lines)) {
      const line = raw as OcrSpaceLine;
      if (!line || typeof line !== 'object') continue;
      const words: OcrWord[] = [];
      for (const w of asArray(line.Words)) {
        const word = w as OcrSpaceWord;
        if (!word || typeof word !== 'object') continue;
        const box = { left: asNumber(word.Left), top: asNumber(word.Top), width: asNumber(word.Width), height: asNumber(word.Height) };
        if (![box.left, box.top, box.width, box.height].every(Number.isFinite)) continue;
        words.push({ text: typeof word.WordText === 'string' ? word.WordText : '', ...box });
      }
      const text = typeof line.LineText === 'string' ? line.LineText : words.map((w) => w.text).join(' ');
      if (text.trim()) lines.push({ text, words });
    }
  }
  return lines;
}

/** ParsedText of every page joined (rows by newlines, columns by tabs). */
export function parsedText(json: OcrSpaceResponse | null | undefined): string {
  return parsedResults(json)
    .map((page) => (typeof page.ParsedText === 'string' ? page.ParsedText : ''))
    .filter((t) => t.trim())
    .join('\n');
}

/** '|------|-----|' under a Markdown table header. */
const MARKDOWN_RULE = /^\s*\|[\s:|-]*-[\s:|-]*$/;

/** ParsedText rows with columns joined by two spaces (the buildRows convention). Engines 1 and 2
 *  separate columns with tabs; engine 3 writes Markdown tables ('| Naan | 6 | 360.00 |'). */
export function rowsFromParsedText(text: string): string[] {
  return (typeof text === 'string' ? text : '')
    .split(/\r?\n/)
    .filter((row) => !MARKDOWN_RULE.test(row))
    .map((row) => {
      const markdown = /^\s*\|/.test(row);
      return row
        .split(markdown ? /[\t|]/ : '\t')
        .map((cell) => cell.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('  ');
    })
    .filter(Boolean);
}

/** Visual rows of the bill: rebuilt from the word boxes when the overlay is present, else ParsedText. */
export function rowsFromResponse(json: OcrSpaceResponse | null | undefined): string[] {
  const lines = overlayLines(json);
  if (lines.some((l) => l.words.length > 0)) {
    const rows = buildRows(lines);
    if (rows.length) return rows;
  }
  return rowsFromParsedText(parsedText(json));
}

/** OCR.space error text → our error code ('' text → 'unknown'). */
export function classifyOcrMessage(message: string, httpStatus?: number): OcrErrorCode {
  const m = (message || '').toLowerCase();
  if (httpStatus === 401) return 'bad_key';
  if (httpStatus === 403 || httpStatus === 429) {
    return /api\s*key|apikey/.test(m) && /invalid|not\s*valid|wrong/.test(m) ? 'bad_key' : 'quota';
  }
  if (httpStatus === 413) return 'too_large';
  if (/(api\s*key|apikey)/.test(m) && /(invalid|not\s*valid|wrong|missing|not\s*found)/.test(m)) return 'bad_key';
  if (/file\s*size|maximum\s*(permissible\s*)?(file\s*)?size|too\s*large|size\s*limit|exceeds?\s*the\s*max/.test(m)) return 'too_large';
  if (/maximum\s*\d*\s*number\s*of\s*times|rate\s*limit|too\s*many\s*requests|quota|daily\s*limit|upto\s*maximum/.test(m)) return 'quota';
  if (/\be101\b|timed?\s*out|timeout/.test(m)) return 'timeout';
  return 'unknown';
}

/** Rows, raw text and errors of an OCR.space JSON response (throws OcrError on failure or no text). */
export function readOcrSpaceResponse(json: OcrSpaceResponse | null | undefined): { lines: string[]; rawText: string } {
  if (!json || typeof json !== 'object') throw new OcrError('unknown', 'OCR.space returned an empty response.');
  const lines = rowsFromResponse(json);
  const rawText = parsedText(json);
  const pageErrors = parsedResults(json).map((p) => messageText(p.ErrorMessage, p.ErrorDetails));
  const errorText = messageText(json.ErrorMessage, json.ErrorDetails, pageErrors);
  const exitCode = asNumber(json.OCRExitCode);
  const failed = json.IsErroredOnProcessing === true || exitCode === 3 || exitCode === 4;

  if (!lines.length) {
    if (failed || (errorText && exitCode !== 1)) {
      throw new OcrError(classifyOcrMessage(errorText), errorText || undefined);
    }
    throw new OcrError('no_text');
  }
  return { lines, rawText };
}

function encodeForm(fields: Record<string, string>): string {
  return Object.keys(fields)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(fields[key])}`)
    .join('&');
}

function toDataUri(base64Jpeg: string): string {
  const trimmed = (base64Jpeg || '').trim();
  if (/^data:/i.test(trimmed)) return trimmed;
  return `data:image/jpeg;base64,${trimmed.replace(/\s+/g, '')}`;
}

function isAbortError(error: unknown): boolean {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  return name === 'AbortError';
}

/** POST https://api.ocr.space/parse/image (x-www-form-urlencoded: base64Image=data:image/jpeg;base64,…,
 *  language=eng, isTable=true, OCREngine, scale=true, detectOrientation=true, isOverlayRequired=true),
 *  header apikey. 45 s timeout. Rows from buildRows(overlay) when available, else ParsedText split
 *  on newlines. Maps OCR.space errors to OcrError codes (E101 timeouts, 'maximum file size', rate
 *  limits '403'/'429', 'API key' invalid). */
export async function recognizeText(
  base64Jpeg: string,
  opts: { apiKey: string; engine: OcrEngine; signal?: AbortSignal },
): Promise<OcrResult> {
  if (typeof base64Jpeg !== 'string' || !base64Jpeg.trim()) {
    throw new OcrError('unknown', 'There is no photo to read.');
  }
  const outer = opts.signal;
  if (outer?.aborted) throw new OcrError('unknown', 'The scan was cancelled.');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OCR_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener?.('abort', onOuterAbort);

  const body = encodeForm({
    base64Image: toDataUri(base64Jpeg),
    language: 'eng',
    isTable: 'true',
    OCREngine: String(opts.engine || 2),
    scale: 'true',
    detectOrientation: 'true',
    isOverlayRequired: 'true',
  });
  const started = Date.now();

  try {
    let status = 0;
    let ok = false;
    let text = '';
    try {
      const response = await fetch(OCR_SPACE_ENDPOINT, {
        method: 'POST',
        headers: {
          apikey: (opts.apiKey || '').trim() || OCR_SPACE_DEMO_KEY,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });
      status = response.status;
      ok = response.ok;
      text = await response.text();
    } catch (error) {
      if (timedOut) throw new OcrError('timeout');
      if (outer?.aborted || isAbortError(error)) throw new OcrError('unknown', 'The scan was cancelled.');
      throw new OcrError('network');
    }

    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const isObject = !!json && typeof json === 'object' && !Array.isArray(json);
    const errorText = isObject
      ? messageText((json as OcrSpaceResponse).ErrorMessage, (json as OcrSpaceResponse).ErrorDetails)
      : messageText(typeof json === 'string' ? json : text);

    if (!ok) throw new OcrError(classifyOcrMessage(errorText || text, status), errorText || undefined);
    if (!isObject) throw new OcrError(classifyOcrMessage(errorText), errorText || undefined);

    const { lines, rawText } = readOcrSpaceResponse(json as OcrSpaceResponse);
    return { lines, rawText, engine: opts.engine, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.('abort', onOuterAbort);
  }
}
