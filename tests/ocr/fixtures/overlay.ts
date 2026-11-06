// Builds OCR.space-style TextOverlay lines for tests: monospace word boxes on a (possibly tilted) page.
import type { OcrLine, OcrWord } from '../../../app/src/ocr/types';

export interface PageStyle {
  /** Pixels per character. */
  charWidth?: number;
  /** Word box height. */
  height?: number;
  /** Page tilt: vertical shift per horizontal pixel (0.035 ≈ 2°, positive = right side lower). */
  tilt?: number;
}

/** One OCR line whose first character starts at (left, top); words keep their monospace positions. */
export function makeLine(text: string, left: number, top: number, style: PageStyle = {}): OcrLine {
  const cw = style.charWidth ?? 14;
  const height = style.height ?? 24;
  const tilt = style.tilt ?? 0;
  const words: OcrWord[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const wordLeft = left + m.index * cw;
    words.push({ text: m[0], left: wordLeft, top: Math.round(top + tilt * wordLeft), width: m[0].length * cw, height });
  }
  return { text: text.replace(/\s+/g, ' ').trim(), words };
}

/**
 * A receipt laid out in columns. Each row is a list of [text, column x] cells. Like OCR.space's
 * engine 2, every cell becomes its own line and the lines come column by column (all names, then
 * all quantities, …), so buildRows has to put the rows back together.
 */
export function columnLines(rows: [string, number][][], style: PageStyle & { top?: number; rowHeight?: number } = {}): OcrLine[] {
  const top = style.top ?? 100;
  const rowHeight = style.rowHeight ?? 36;
  const cells: { x: number; line: OcrLine }[] = [];
  rows.forEach((row, r) => {
    for (const [text, x] of row) {
      if (text.trim()) cells.push({ x, line: makeLine(text, x, top + r * rowHeight, style) });
    }
  });
  const columns = Array.from(new Set(cells.map((c) => c.x))).sort((a, b) => a - b);
  return columns.flatMap((x) => cells.filter((c) => c.x === x).map((c) => c.line));
}

export interface StripStyle extends PageStyle {
  /** x of the strip's left edge on the photo. */
  left?: number;
  top?: number;
  rowHeight?: number;
  /** Extra tilt reached at the last row (paper curling up towards the camera). */
  curl?: number;
}

/**
 * One strip of a long bill laid on the table: like columnLines (every cell is its own OCR line),
 * placed at `left`, tilted around its left edge by `tilt`, and by more and more further down when
 * `curl` is set. Cells are [text, x from the strip's left edge].
 */
export function stripLines(rows: [string, number][][], style: StripStyle = {}): OcrLine[] {
  const left = style.left ?? 0;
  const top = style.top ?? 100;
  const rowHeight = style.rowHeight ?? 36;
  const out: OcrLine[] = [];
  rows.forEach((row, r) => {
    const tilt = (style.tilt ?? 0) + (rows.length > 1 ? ((style.curl ?? 0) * r) / (rows.length - 1) : 0);
    for (const [text, x] of row) {
      if (!text.trim()) continue;
      const line = makeLine(text, left + x, top + r * rowHeight, { ...style, tilt: 0 });
      out.push({ text: line.text, words: line.words.map((w) => ({ ...w, top: Math.round(w.top + tilt * (w.left - left)) })) });
    }
  });
  return out;
}

/** Like OCR.space engine 3: every line comes back as a single box covering all its words. */
export function singleBoxes(lines: OcrLine[]): OcrLine[] {
  return lines.map((line) => {
    if (!line.words.length) return line;
    const left = Math.min(...line.words.map((w) => w.left));
    const right = Math.max(...line.words.map((w) => w.left + w.width));
    const top = Math.min(...line.words.map((w) => w.top));
    const bottom = Math.max(...line.words.map((w) => w.top + w.height));
    return { text: line.text, words: [{ text: line.text, left, top, width: right - left, height: bottom - top }] };
  });
}

/** Shorthand for a typical 4-column restaurant layout (name, qty, rate, amount). */
export const COLS = { name: 40, qty: 330, rate: 420, amount: 560, label: 40, value: 560 };
