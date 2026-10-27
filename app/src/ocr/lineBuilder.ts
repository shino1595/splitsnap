// Rebuilds the visual rows of a bill from OCR.space's TextOverlay. The engine often returns
// each column as separate lines ("Naan" / "6" / "60.00" / "360.00"), and on a slightly tilted
// photo the right-hand column sits higher than the left. We estimate the tilt from multi-word
// lines, straighten every line's centre, then group lines whose centres are close. Lines that
// span several columns (some engines return a whole table row as one line) are split first.
import type { OcrLine, OcrWord } from './types';

interface PlacedLine {
  text: string;
  left: number;
  right: number;
  /** Vertical centre after removing the page tilt. */
  y: number;
}

interface Row {
  y: number;
  lines: PlacedLine[];
}

/** Max tilt we correct for (tan ≈ 14°); anything steeper is better handled by OCR.space's orientation detection. */
const MAX_SLOPE = 0.25;
/** Lines whose centres are within this × median word height belong to one row. */
const ROW_TOLERANCE = 0.6;
/** A horizontal gap of at least this × median word height is a column break ('  '). */
const COLUMN_GAP = 0.8;
/** Inside one OCR line, only a gap of at least this many character widths is a column break
 *  (a single space between word boxes measures up to ~1.6 character widths). */
const LINE_SPLIT_CHARS = 3;
/** Tilt search when refining the slope: ± this around the estimate (≈ 7°), in steps of SLOPE_STEP. */
const SLOPE_SEARCH = 0.12;
const SLOPE_STEP = 0.0025;
/** Moving the slope this far from the estimate costs as much as every piece missing its row. */
const SLOPE_PRIOR = 2;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validWords(line: OcrLine): OcrWord[] {
  const words = Array.isArray(line?.words) ? line.words : [];
  return words.filter(
    (w) => !!w && isFiniteNumber(w.left) && isFiniteNumber(w.top) && isFiniteNumber(w.width) && isFiniteNumber(w.height) && w.height > 0,
  );
}

function textOf(line: OcrLine, words: OcrWord[]): string {
  const text = typeof line?.text === 'string' ? line.text.replace(/\s+/g, ' ').trim() : '';
  if (text) return text;
  return words
    .map((w) => (typeof w.text === 'string' ? w.text.trim() : ''))
    .filter(Boolean)
    .join(' ');
}

const centreX = (w: OcrWord) => w.left + w.width / 2;
const centreY = (w: OcrWord) => w.top + w.height / 2;

/** Median slope (dy/dx) of lines that span several word widths. 0 if there is no evidence. */
function estimateSlope(lines: OcrWord[][], wordHeight: number): number {
  const slopes: number[] = [];
  for (const words of lines) {
    if (words.length < 2) continue;
    let first = words[0];
    let last = words[0];
    for (const w of words) {
      if (centreX(w) < centreX(first)) first = w;
      if (centreX(w) > centreX(last)) last = w;
    }
    const dx = centreX(last) - centreX(first);
    if (dx < wordHeight * 3) continue;
    const slope = (centreY(last) - centreY(first)) / dx;
    if (Math.abs(slope) <= MAX_SLOPE) slopes.push(slope);
  }
  return slopes.length ? median(slopes) : 0;
}

interface Box {
  cx: number;
  cy: number;
  left: number;
  right: number;
}

/** Pieces that do not cover the same horizontal span can sit on one row. */
function sideBySide(a: Box, b: Box): boolean {
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return overlap <= 0.3 * Math.min(a.right - a.left, b.right - b.left);
}

/** How far side-by-side pieces miss each other's row at this slope, summed (lower is better). */
function alignmentCost(boxes: Box[], slope: number, cap: number): number {
  const ys = boxes.map((b) => b.cy - slope * b.cx);
  let cost = 0;
  for (let i = 0; i < boxes.length; i++) {
    let best = cap;
    for (let j = 0; j < boxes.length; j++) {
      if (i !== j && sideBySide(boxes[i], boxes[j])) best = Math.min(best, Math.abs(ys[i] - ys[j]));
    }
    cost += best;
  }
  return cost;
}

/**
 * Engine 3 returns one box per line, so there are no multi-word lines to measure the tilt from.
 * Try slopes around the estimate and keep the one that lines side-by-side pieces up best. At the
 * true tilt every column lines up with its own row; a slope that pairs prices with the row above
 * only lines up some of them, so it costs more. A small pull towards the estimate breaks ties.
 */
function refineSlope(boxes: Box[], estimate: number, wordHeight: number): number {
  if (boxes.length < 2) return estimate;
  const pull = (boxes.length * wordHeight) / SLOPE_PRIOR;
  const score = (slope: number) => alignmentCost(boxes, slope, wordHeight) + pull * Math.abs(slope - estimate);
  let best = estimate;
  let bestScore = score(estimate);
  const steps = Math.round(SLOPE_SEARCH / SLOPE_STEP);
  for (let k = -steps; k <= steps; k++) {
    const slope = estimate + k * SLOPE_STEP;
    if (k === 0 || Math.abs(slope) > MAX_SLOPE) continue;
    const value = score(slope);
    if (value < bestScore - 1e-9) {
      best = slope;
      bestScore = value;
    }
  }
  return best;
}

/** Rebuild visual rows from OCR.space TextOverlay lines/words: group words whose vertical
 *  centres are within ~0.6× median word height, sort each row by x, join with ' ' and use
 *  '  ' (two spaces) where the horizontal gap is large (column break). Rows top→bottom. */
export function buildRows(lines: OcrLine[]): string[] {
  if (!Array.isArray(lines) || lines.length === 0) return [];

  const entries: { text: string; words: OcrWord[] }[] = [];
  for (const line of lines) {
    if (!line) continue;
    const words = validWords(line);
    const text = textOf(line, words);
    if (text) entries.push({ text, words });
  }

  const placedEntries = entries.filter((e) => e.words.length > 0);
  const unplaced = entries.filter((e) => e.words.length === 0).map((e) => e.text);
  if (!placedEntries.length) return unplaced;

  const wordHeight = median(placedEntries.flatMap((e) => e.words.map((w) => w.height))) || 1;
  const splitGap = Math.max(LINE_SPLIT_CHARS * charWidth(placedEntries.flatMap((e) => e.words), wordHeight), 1.5 * wordHeight);
  const parts = placedEntries.flatMap((e) => splitAtGaps(e, splitGap));

  const boxes: Box[] = parts.map((e) => ({
    cx: e.words.reduce((s, w) => s + centreX(w), 0) / e.words.length,
    cy: e.words.reduce((s, w) => s + centreY(w), 0) / e.words.length,
    left: Math.min(...e.words.map((w) => w.left)),
    right: Math.max(...e.words.map((w) => w.left + w.width)),
  }));
  const estimate = estimateSlope(
    placedEntries.map((e) => e.words),
    wordHeight,
  );
  const slope = refineSlope(boxes, estimate, wordHeight);

  const placed: PlacedLine[] = parts.map((e) => {
    const ys = e.words.map((w) => centreY(w) - slope * centreX(w));
    return {
      text: e.text,
      left: Math.min(...e.words.map((w) => w.left)),
      right: Math.max(...e.words.map((w) => w.left + w.width)),
      y: ys.reduce((a, b) => a + b, 0) / ys.length,
    };
  });
  placed.sort((a, b) => a.y - b.y || a.left - b.left);

  const tolerance = ROW_TOLERANCE * wordHeight;
  const rows: Row[] = [];
  for (const line of placed) {
    let best: Row | null = null;
    let bestDistance = Infinity;
    for (const row of rows) {
      const distance = Math.abs(row.y - line.y);
      if (distance > tolerance || distance >= bestDistance) continue;
      if (overlapsRow(row, line)) continue;
      best = row;
      bestDistance = distance;
    }
    if (best) {
      best.lines.push(line);
      best.y = best.lines.reduce((sum, l) => sum + l.y, 0) / best.lines.length;
    } else {
      rows.push({ y: line.y, lines: [line] });
    }
  }

  rows.sort((a, b) => a.y - b.y);
  const columnGap = COLUMN_GAP * wordHeight;
  const out = rows.map((row) => joinRow(row, columnGap));
  return out.concat(unplaced);
}

/** Median width of one character, from words of three or more characters. */
function charWidth(words: OcrWord[], wordHeight: number): number {
  const widths = words
    .filter((w) => typeof w.text === 'string' && w.text.trim().length >= 3)
    .map((w) => w.width / w.text.trim().length);
  return median(widths) || wordHeight * 0.6;
}

/** Word texts joined by spaces. Punctuation OCR.space reports in the same box as the word before
 *  ('12' + ',' or '03' + '/' + '10'), closing marks and opening brackets are glued on. */
function joinWords(words: OcrWord[]): string {
  let text = '';
  let prev: OcrWord | null = null;
  for (const w of words) {
    const t = typeof w.text === 'string' ? w.text.trim() : '';
    if (!t) continue;
    const glue = !!prev && ((prev.left === w.left && prev.width === w.width) || /^[,.:;)\]%]+$/.test(t) || /[(\[]$/.test(text));
    text += text && !glue ? ` ${t}` : t;
    prev = w;
  }
  return text;
}

/** Some engines return a whole table row as one line ('Naan 6 60.00 360.00' with wide gaps):
 *  split it at column-sized gaps so every column becomes its own piece. */
function splitAtGaps(entry: { text: string; words: OcrWord[] }, minGap: number): { text: string; words: OcrWord[] }[] {
  const words = entry.words;
  if (words.length < 2) return [entry];
  const groups: OcrWord[][] = [[words[0]]];
  let right = words[0].left + words[0].width;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w.left - right >= minGap) groups.push([w]);
    else groups[groups.length - 1].push(w);
    right = Math.max(right, w.left + w.width);
  }
  if (groups.length === 1) return [entry];
  const pieces = groups.map((g) => ({ text: joinWords(g), words: g }));
  return pieces.every((p) => p.text) ? pieces : [entry];
}

/** Two lines that cover the same horizontal span are stacked, not side by side. */
function overlapsRow(row: Row, line: PlacedLine): boolean {
  return row.lines.some((other) => {
    const overlap = Math.min(other.right, line.right) - Math.max(other.left, line.left);
    const narrower = Math.min(other.right - other.left, line.right - line.left);
    return overlap > 0 && overlap > narrower * 0.3;
  });
}

function joinRow(row: Row, columnGap: number): string {
  const lines = row.lines.slice().sort((a, b) => a.left - b.left);
  let text = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].left - lines[i - 1].right;
    text += (gap >= columnGap ? '  ' : ' ') + lines[i].text;
  }
  return text;
}
