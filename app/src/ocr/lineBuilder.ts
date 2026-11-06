// Rebuilds the visual rows of a bill from OCR.space's TextOverlay. The engine often returns
// each column as separate lines ("Naan" / "6" / "60.00" / "360.00"), and on a slightly tilted
// photo the right-hand column sits higher than the left. We estimate the tilt from multi-word
// lines, straighten every line's centre, then group lines whose centres are close. Lines that
// span several columns (some engines return a whole table row as one line) are split first.
//
// A long bill is often photographed cut or folded into strips that lie side by side. Each strip
// is then a receipt of its own, with its own tilt, and its rows must not be joined to the rows of
// the strip next to it. So the page is first split into strips at vertical gaps (straight or
// slanted) that have a complete receipt on both sides — names with prices — and every strip is
// read on its own, in reading order.
import { interpretAmounts } from './itemAmounts';
import { analyzeRow } from './rowClassifier';
import { isMoneyToken, isTrailingFlag, normalizeLine, tokenize } from './tokens';
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

/** A run of words of one OCR line between column-sized gaps. */
interface Piece {
  id: number;
  text: string;
  words: OcrWord[];
  /** Index of the OCR line it came from (lines spanning columns are the best tilt evidence). */
  entry: number;
  left: number;
  right: number;
  cx: number;
  cy: number;
}

/** Max tilt we correct for (tan ≈ 14°); anything steeper is better handled by OCR.space's orientation detection. */
const MAX_SLOPE = 0.25;
/** Lines whose centres are within this × median word height belong to one row. */
const ROW_TOLERANCE = 0.6;
/** Pieces whose straightened centres are this close (× median word height) are on the same line. */
const SAME_HEIGHT = 0.2;
/** A horizontal gap of at least this × median word height is a column break ('  '). */
const COLUMN_GAP = 0.8;
/** Inside one OCR line, only a gap of at least this many character widths is a column break
 *  (a single space between word boxes measures up to ~1.6 character widths). */
const LINE_SPLIT_CHARS = 3;
/** Tilt search when refining the slope: ± this around the estimate (≈ 7°), in steps of SLOPE_STEP. */
const SLOPE_SEARCH = 0.12;
const SLOPE_STEP = 0.0025;
/** Coarser steps for the many tilt searches of the strip search. */
const QUICK_SLOPE_STEP = 0.01;
/** Moving the slope this far from the estimate costs as much as every piece missing its row. */
const SLOPE_PRIOR = 2;

/** Tilt along a strip: measured in bands of ± BAND_HALF × word height, every BAND_STEP × word
 *  height, from at least MIN_BAND_PIECES pieces (else the strip's own tilt). */
const BAND_HALF = 6;
const BAND_STEP = 3;
const MIN_BAND_PIECES = 6;
/** A band's tilt may differ from its neighbour's by at most this much (a curl changes ~0.01 per band). */
const BAND_SEARCH = 0.03;

/** Text starting more than this × median word height right of the price column is beside the
 *  bill, not on it; the price column is only located from at least EDGE_ROWS priced rows. */
const OUTSIDE_MARGIN = 1.5;
const EDGE_ROWS = 4;
/** The price-column line must pass within EDGE_FIT word heights of EDGE_SHARE of the priced rows'
 *  last prices and lean no more than EDGE_LEAN (x per y); it is fitted to at most EDGE_SAMPLE points. */
const EDGE_FIT = 1.5;
const EDGE_SHARE = 0.6;
const EDGE_LEAN = 0.2;
const EDGE_SAMPLE = 60;

/** Strips: a gap between them is at least this × median word height wide … */
const GUTTER_MIN = 1;
/** … and may lean by up to this much (x shift per pixel down, ≈ 7°), tried in steps of GUTTER_STEP. */
const GUTTER_LEAN = 0.12;
const GUTTER_STEP = 0.01;
/** Reading the two sides apart must score at least this much more than reading them together.
 *  0: a cut may not break any priced row. (Strips whose rows sit beside the other strip's header
 *  lines lose nothing by being glued together, so a positive gain would miss them.) */
const SPLIT_GAIN = 0;
/** A strip has at least this many pieces and priced rows; a bill is cut into at most 2^SPLIT_DEPTH strips. */
const MIN_STRIP_PIECES = 2;
const MIN_STRIP_PRICED = 2;
const SPLIT_DEPTH = 2;
/** A strip with at most this many item lines, next to one with four times as many, is other
 *  paper photographed with the bill (a card slip, a ticket) and is read after the bill. */
const PAPER_ITEMS = 3;
/** Gaps tried per split, widest first. */
const MAX_GUTTERS = 24;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median; of the two middle values of an even count, the one closer to `prefer`. */
function middleValue(values: number[], prefer: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  const a = sorted[mid - 1];
  const b = sorted[mid];
  return Math.abs(a - prefer) <= Math.abs(b - prefer) ? a : b;
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

function medianWordHeight(words: OcrWord[]): number {
  return median(words.map((w) => w.height)) || 1;
}

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

/** Pieces that do not cover the same horizontal span can sit on one row. */
function sideBySide(a: Piece, b: Piece): boolean {
  const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return overlap <= 0.3 * Math.min(a.right - a.left, b.right - b.left);
}

/**
 * For each piece, the side-by-side pieces that could share its row at some tilt up to `maxSlope`:
 * centres at most cap + maxSlope × their horizontal distance apart. Any other pair misses by more
 * than `cap` at every such tilt, so leaving it out changes no alignment cost — and keeps the tilt
 * search linear in the length of the bill instead of quadratic.
 */
function rowNeighbours(pieces: Piece[], maxSlope: number, cap: number): number[][] {
  const order = pieces.map((_p, i) => i).sort((a, b) => pieces[a].cy - pieces[b].cy);
  const spanX = Math.max(...pieces.map((p) => p.right)) - Math.min(...pieces.map((p) => p.left));
  const reach = cap + maxSlope * spanX;
  const out: number[][] = pieces.map(() => []);
  for (let s = 0; s < order.length; s++) {
    const a = pieces[order[s]];
    for (let t = s + 1; t < order.length; t++) {
      const b = pieces[order[t]];
      const dy = b.cy - a.cy;
      if (dy > reach) break;
      if (dy <= cap + maxSlope * Math.abs(b.cx - a.cx) && sideBySide(a, b)) {
        out[order[s]].push(order[t]);
        out[order[t]].push(order[s]);
      }
    }
  }
  return out;
}

/** How far side-by-side pieces miss each other's row at this slope, summed (lower is better). */
function alignmentCost(pieces: Piece[], neighbours: number[][], slope: number, cap: number): number {
  const ys = pieces.map((b) => b.cy - slope * b.cx);
  let cost = 0;
  for (let i = 0; i < pieces.length; i++) {
    let best = cap;
    for (const j of neighbours[i]) best = Math.min(best, Math.abs(ys[i] - ys[j]));
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
function refineSlope(pieces: Piece[], estimate: number, wordHeight: number, search = SLOPE_SEARCH, step = SLOPE_STEP): number {
  if (pieces.length < 2) return estimate;
  const pull = (pieces.length * wordHeight) / SLOPE_PRIOR;
  const neighbours = rowNeighbours(pieces, Math.min(MAX_SLOPE, Math.abs(estimate) + search), wordHeight);
  const score = (slope: number) => alignmentCost(pieces, neighbours, slope, wordHeight) + pull * Math.abs(slope - estimate);
  let best = estimate;
  let bestScore = score(estimate);
  const steps = Math.round(search / step);
  for (let k = -steps; k <= steps; k++) {
    const slope = estimate + k * step;
    if (k === 0 || Math.abs(slope) > MAX_SLOPE) continue;
    const value = score(slope);
    if (value < bestScore - 1e-9) {
      best = slope;
      bestScore = value;
    }
  }
  return best;
}

/** Rebuild visual rows from OCR.space TextOverlay lines/words: find the strips of a bill cut in
 *  pieces, then in each strip group words whose vertical centres are within ~0.6× median word
 *  height, sort each row by x, join with ' ' and use '  ' (two spaces) where the horizontal gap is
 *  large (column break). Rows top→bottom, strip after strip. */
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

  const allWords = placedEntries.flatMap((e) => e.words);
  const wordHeight = medianWordHeight(allWords);
  const splitGap = Math.max(LINE_SPLIT_CHARS * charWidth(allWords, wordHeight), 1.5 * wordHeight);
  const pieces: Piece[] = [];
  placedEntries.forEach((entry, k) => {
    for (const part of splitAtGaps(entry, splitGap)) {
      pieces.push({
        id: pieces.length,
        text: part.text,
        words: part.words,
        entry: k,
        left: Math.min(...part.words.map((w) => w.left)),
        right: Math.max(...part.words.map((w) => w.left + w.width)),
        cx: part.words.reduce((s, w) => s + centreX(w), 0) / part.words.length,
        cy: part.words.reduce((s, w) => s + centreY(w), 0) / part.words.length,
      });
    }
  });

  const classify = classifier();
  const strips = splitStrips(pieces, wordHeight, 0, classify).map((strip) => stripRows(strip, 'full', classify));
  // Text beside the bill (a card or cheque lying next to it) goes after all of the bill's rows,
  // where the parser no longer looks for items.
  const outside = strips.flatMap((s) => s.outside);
  return orderStrips(
    strips.map((s) => s.rows),
    classify,
  )
    .flat()
    .concat(outside, unplaced);
}

/** Words of each OCR line that fall in these pieces (for the tilt estimate). */
function wordsByLine(pieces: Piece[]): OcrWord[][] {
  const byEntry = new Map<number, OcrWord[]>();
  for (const p of pieces) {
    const words = byEntry.get(p.entry);
    if (words) words.push(...p.words);
    else byEntry.set(p.entry, p.words.slice());
  }
  return Array.from(byEntry.values());
}

/** Rows of one strip (or of the whole page), top to bottom, and the text found to the right of
 *  its prices. 'quick' (for the strip search) refines the tilt coarsely; 'full' refines it
 *  finely and follows it along a long strip. */
function stripRows(pieces: Piece[], mode: 'quick' | 'full', classify: Classify): { rows: string[]; outside: string[] } {
  if (!pieces.length) return { rows: [], outside: [] };
  const wordHeight = medianWordHeight(pieces.flatMap((p) => p.words));
  const estimate = estimateSlope(wordsByLine(pieces), wordHeight);
  const slopeAt =
    mode === 'full'
      ? slopeAlong(pieces, refineSlope(pieces, estimate, wordHeight), wordHeight)
      : ((slope: number) => () => slope)(refineSlope(pieces, estimate, wordHeight, SLOPE_SEARCH, QUICK_SLOPE_STEP));
  const { inside, outside } = trimOutside(groupRows(pieces, slopeAt, wordHeight), wordHeight, classify);
  const columnGap = COLUMN_GAP * wordHeight;
  return { rows: inside.map((row) => joinRow(row, columnGap)), outside: outside.map((row) => joinRow(row, columnGap)) };
}

/**
 * A long receipt is rarely flat: the end nearest the camera curls, so its rows tilt more than
 * the rest (from ~0° at the top to ~6° at the bottom on a real bill). On a strip taller than a few
 * bands the tilt is measured again in overlapping bands of rows and interpolated between them.
 *
 * Evenly spaced rows make a false tilt that pairs every price with the next row's name fit a
 * band just as well as the true one (about row pitch ÷ price distance away, ~0.1). So the bands
 * follow the tilt step by step, outwards from the middle of the strip: each may move at most
 * BAND_SEARCH from the band next to it, which a curl does and a false tilt can't.
 */
function slopeAlong(pieces: Piece[], slope: number, wordHeight: number): (y: number) => number {
  const ys = pieces.map((p) => p.cy);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const half = BAND_HALF * wordHeight;
  if (bottom - top < 4 * half) return () => slope;
  const bands: { y: number; near: Piece[]; slope?: number }[] = [];
  for (let y = top; y <= bottom + BAND_STEP * wordHeight; y += BAND_STEP * wordHeight) {
    bands.push({ y, near: pieces.filter((p) => Math.abs(p.cy - y) <= half) });
  }
  const usable = (k: number) => bands[k].near.length >= MIN_BAND_PIECES;
  let start = -1;
  bands.forEach((b, k) => {
    if (usable(k) && (start < 0 || Math.abs(b.y - (top + bottom) / 2) < Math.abs(bands[start].y - (top + bottom) / 2))) start = k;
  });
  if (start < 0) return () => slope;
  bands[start].slope = refineSlope(bands[start].near, slope, wordHeight, BAND_SEARCH);
  for (const dir of [1, -1]) {
    let prev = bands[start].slope as number;
    for (let k = start + dir; k >= 0 && k < bands.length; k += dir) {
      if (!usable(k)) continue;
      prev = bands[k].slope = refineSlope(bands[k].near, prev, wordHeight, BAND_SEARCH);
    }
  }
  const measured = bands.map((b) => ({ y: b.y, slope: b.slope }));
  const known = measured.filter((m): m is { y: number; slope: number } => m.slope !== undefined);
  // A running median over five bands evens out bands that drifted with little evidence.
  const smooth = known.map((m, k) => ({ y: m.y, slope: middleValue(known.slice(Math.max(0, k - 2), k + 3).map((n) => n.slope), slope) }));
  // Bands with too few pieces (the ends of the strip) take the tilt of the nearest measured band.
  const anchors = measured.map((m) => ({
    y: m.y,
    slope: smooth.reduce((best, s) => (Math.abs(s.y - m.y) < Math.abs(best.y - m.y) ? s : best)).slope,
  }));
  return (y: number) => {
    if (y <= anchors[0].y) return anchors[0].slope;
    for (let k = 1; k < anchors.length; k++) {
      const a = anchors[k - 1];
      const b = anchors[k];
      if (y <= b.y) return a.slope + ((b.slope - a.slope) * (y - a.y)) / (b.y - a.y);
    }
    return anchors[anchors.length - 1].slope;
  };
}

/** Straightens every piece with the tilt at its height (measured from the strip's left edge, so
 *  a tilt that changes down the strip does not shift rows past each other) and groups them. */
function groupRows(pieces: Piece[], slopeAt: (y: number) => number, wordHeight: number): Row[] {
  const xRef = Math.min(...pieces.map((p) => p.left));
  const placed: PlacedLine[] = pieces.map((p) => {
    const slope = slopeAt(p.cy);
    const ys = p.words.map((w) => centreY(w) - slope * (centreX(w) - xRef));
    return { text: p.text, left: p.left, right: p.right, y: ys.reduce((a, b) => a + b, 0) / ys.length };
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
      if (overlapsRow(row, line, SAME_HEIGHT * wordHeight)) continue;
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

  return rows.sort((a, b) => a.y - b.y);
}

// ---------------------------------------------------------------------------------------------
// Which rows are prices

interface RowClass {
  /** An item, charge or total line that ends a name with a price: 'Paneer Tikka  2  280.00  560.00',
   *  'Sub Total  1280.00'. Not 'Paneer Tikka  2' (a quantity), 'Table: 7' or 'Bill No: 2231'. */
  priced: boolean;
  /** A priced item line (not a charge or total). */
  item: boolean;
  /** An item line whose quantity × rate = amount as printed: certainly a whole row. */
  checked: boolean;
  /** Column titles: 'Item  Qty  Rate  Amount'. */
  header: boolean;
  /** 'Sub Total …', 'Grand Total …'. */
  total: boolean;
}

type Classify = (text: string) => RowClass;

const PRICED_KINDS = new Set(['item', 'charge', 'subtotal', 'total', 'summary']);

/** The parser's own row classifier, remembered per row text (strip search asks many times). */
function classifier(): Classify {
  const cache = new Map<string, RowClass>();
  return (text: string) => {
    let known = cache.get(text);
    if (!known) {
      const row = analyzeRow(text, 0);
      const nums = row.tail.filter((n) => !n.percent);
      const prices = nums.length;
      const amount = row.amount;
      const before = nums[nums.length - 2];
      // A price has two decimals, or comes after a quantity or rate ('Naan  2  60  120'). A small
      // whole number ('2', '2.00') is a quantity, and so is a whole number after a larger one
      // ('1006  12': an HSN code and a count).
      const priced =
        PRICED_KINDS.has(row.kind) &&
        !!amount &&
        (amount.decimals === 2 || prices >= 2) &&
        !(Number.isInteger(amount.value) && Math.abs(amount.value) < 10) &&
        !(amount.decimals === 0 && !!before && Math.abs(before.value) > Math.abs(amount.value));
      const read = priced && row.kind === 'item' && prices >= 3 ? interpretAmounts(row.lead, row.tail, false) : null;
      known = {
        priced,
        item: priced && row.kind === 'item',
        checked: !!read && read.qtyPrinted && read.unitPrice !== undefined && !read.repaired && read.confidence >= 0.95,
        header: row.kind === 'header',
        total: row.kind === 'total' || row.kind === 'subtotal',
      };
      cache.set(text, known);
    }
    return known;
  };
}

// ---------------------------------------------------------------------------------------------
// Text beside the bill

/** Ends in a number that can be a price ('449.00', 'Naan  6  60.00  360.00', 'Total 1460'). */
function endsWithPrice(text: string): boolean {
  const tokens = tokenize(normalizeLine(text));
  const last = tokens[tokens.length - 1];
  return !!last && last.kind === 'number' && isMoneyToken(last.num);
}

/** Printed a little right of a price and part of its row: tax flags ('N', 'T*'), 'Cr', 'INR',
 *  a currency sign, a tax rate ('5%'). */
function isFlagPiece(text: string): boolean {
  const t = text.trim();
  return isTrailingFlag(t) || /^([₹$€£¥]|\(?-?\d+(\.\d+)?\s?%\)?)$/.test(t);
}

/** Theil–Sen line x = a + b·y: the median of pairwise slopes, so a few odd points don't move it. */
function theilSen(points: { y: number; x: number }[]): { a: number; b: number } {
  const step = Math.max(1, Math.ceil(points.length / EDGE_SAMPLE));
  const sample = points.filter((_p, k) => k % step === 0);
  const slopes: number[] = [];
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const dy = sample[j].y - sample[i].y;
      if (Math.abs(dy) > 1e-6) slopes.push((sample[j].x - sample[i].x) / dy);
    }
  }
  const b = median(slopes);
  return { a: median(points.map((p) => p.x - b * p.y)), b };
}

/**
 * Where the price column ends at height y: a line through the right end of the last price on
 * each priced row (only real item, charge and total lines — 'Table: 7' or 'Lane 3' would drag the
 * line off the column). Null unless at least EDGE_ROWS rows give a point, the line leans no more
 * than a tilted column can, and most points lie on it.
 */
function priceEdge(rows: Row[], wordHeight: number, classify: Classify): ((y: number) => number) | null {
  const columnGap = COLUMN_GAP * wordHeight;
  const points: { y: number; x: number }[] = [];
  for (const row of rows) {
    // The row up to its last price must be a priced line (what follows may be the paper beside it).
    const lines = row.lines.slice().sort((p, q) => p.left - q.left);
    let k = lines.length - 1;
    while (k >= 0 && !endsWithPrice(lines[k].text)) k--;
    if (k < 0 || !classify(joinRow({ y: row.y, lines: lines.slice(0, k + 1) }, columnGap)).priced) continue;
    points.push({ y: row.y, x: lines[k].right });
  }
  if (points.length < EDGE_ROWS) return null;
  const first = theilSen(points);
  const near = points.filter((p) => Math.abs(p.x - (first.a + first.b * p.y)) <= EDGE_FIT * wordHeight);
  if (near.length < Math.max(EDGE_ROWS, EDGE_SHARE * points.length)) return null;
  const { a, b } = theilSen(near);
  if (Math.abs(b) > EDGE_LEAN) return null;
  return (y: number) => a + b * y;
}

/**
 * Bills are photographed on tables, next to other paper. Pieces that start well to the right of
 * the price column (more than OUTSIDE_MARGIN word heights past its end) are not part of the bill:
 * left on a row they would hide its price ('Paneer Tikka  280.00  Bank'), and on a row of their
 * own they would read as the next line of an item's name.
 */
function trimOutside(rows: Row[], wordHeight: number, classify: Classify): { inside: Row[]; outside: Row[] } {
  const edge = priceEdge(rows, wordHeight, classify);
  if (!edge) return { inside: rows, outside: [] };
  const margin = OUTSIDE_MARGIN * wordHeight;
  const inside: Row[] = [];
  const outside: Row[] = [];
  for (const row of rows) {
    const limit = edge(row.y) + margin;
    const keep = row.lines.filter((l) => l.left <= limit || isFlagPiece(l.text));
    const away = row.lines.filter((l) => keep.indexOf(l) < 0);
    if (keep.length) inside.push(away.length ? { y: row.y, lines: keep } : row);
    if (away.length) outside.push({ y: row.y, lines: away });
  }
  return { inside, outside };
}

// ---------------------------------------------------------------------------------------------
// Strips

/** How many rows of these pieces are priced lines, and a score that counts lines whose
 *  qty × rate = amount twice: a cut through a price column breaks those, a cut between strips
 *  keeps them whole. */
function pricedRows(pieces: Piece[], classify: Classify): { count: number; score: number } {
  let count = 0;
  let score = 0;
  for (const row of stripRows(pieces, 'quick', classify).rows) {
    const kind = classify(row);
    if (!kind.priced) continue;
    count++;
    score += kind.checked ? 2 : 1;
  }
  return { count, score };
}

interface Split {
  left: Piece[];
  right: Piece[];
  width: number;
}

/**
 * Ways to cut the pieces in two along an empty vertical band, straight or leaning (a strip laid
 * at a slight angle), widest band first. Pieces without letters or digits (dots, dashes) may lie
 * in the band; they go to the side of their centre.
 */
function gutters(pieces: Piece[], wordHeight: number): Split[] {
  const solid = pieces.filter((p) => /[A-Za-z0-9]/.test(p.text));
  if (solid.length < 2) return [];
  const minGap = GUTTER_MIN * wordHeight;
  const found = new Map<string, Split>();
  const steps = Math.round(GUTTER_LEAN / GUTTER_STEP);
  for (let k = -steps; k <= steps; k++) {
    const lean = k * GUTTER_STEP;
    const spans = solid.map((p) => ({ start: p.left + lean * p.cy, end: p.right + lean * p.cy })).sort((a, b) => a.start - b.start);
    let reach = spans[0].end;
    for (let i = 1; i < spans.length; i++) {
      const gap = spans[i].start - reach;
      if (gap >= minGap) {
        const cut = reach + gap / 2;
        const left = pieces.filter((p) => p.cx + lean * p.cy < cut);
        const right = pieces.filter((p) => p.cx + lean * p.cy >= cut);
        const key = left.map((p) => p.id).join(',');
        const known = found.get(key);
        if (!known || gap > known.width) found.set(key, { left, right, width: gap });
      }
      reach = Math.max(reach, spans[i].end);
    }
  }
  return Array.from(found.values())
    .sort((a, b) => b.width - a.width)
    .slice(0, MAX_GUTTERS);
}

/**
 * Cuts a bill photographed as strips side by side into those strips, left to right. A cut is
 * kept only when each side is a receipt of its own — with its own rows that pair a name with a
 * price — and reading the sides apart breaks none of them. Cutting
 * one receipt between its names and its prices leaves the prices without names, so it never
 * qualifies, however badly a tilted photo lines up.
 */
function splitStrips(pieces: Piece[], wordHeight: number, depth: number, classify: Classify): Piece[][] {
  if (depth >= SPLIT_DEPTH || pieces.length < 2 * MIN_STRIP_PIECES) return [pieces];
  const before = pricedRows(pieces, classify).score;
  let best: (Split & { score: number }) | null = null;
  for (const split of gutters(pieces, wordHeight)) {
    if (split.left.length < MIN_STRIP_PIECES || split.right.length < MIN_STRIP_PIECES) continue;
    const left = pricedRows(split.left, classify);
    const right = pricedRows(split.right, classify);
    if (left.count < MIN_STRIP_PRICED || right.count < MIN_STRIP_PRICED) continue;
    const score = left.score + right.score;
    if (!best || score > best.score || (score === best.score && split.width > best.width)) best = { ...split, score };
  }
  if (!best || best.score < before + SPLIT_GAIN) return [pieces];
  return [...splitStrips(best.left, wordHeight, depth + 1, classify), ...splitStrips(best.right, wordHeight, depth + 1, classify)];
}

/**
 * Strips in reading order: left to right, except that the strip with the column titles comes
 * before the one with the totals (the bottom half of a bill laid on the left of the top half).
 * Other paper photographed with the bill — a card slip ('AMOUNT … TOTAL …'), a parking ticket:
 * no prices, or at most PAPER_ITEMS item lines next to a strip with four times as many — comes
 * after all of the bill, where its total can't end the bill's items early. Of two strips that
 * both print a total, the one with more items is the bill.
 */
function orderStrips(strips: string[][], classify: Classify): string[][] {
  if (strips.length < 2) return strips;
  const info = strips.map((rows, k) => {
    const kinds = rows.map(classify);
    const header = kinds.some((c) => c.header);
    const total = kinds.some((c) => c.total);
    const items = kinds.filter((c) => c.item).length;
    const rank = header && !total ? 0 : total && !header ? 2 : 1;
    return { rows, k, header, items, rank, priced: kinds.some((c) => c.priced) };
  });
  const most = Math.max(...info.map((s) => s.items));
  const paper = (s: (typeof info)[number]) => !s.priced || (!s.header && s.items <= PAPER_ITEMS && s.items * 4 < most);
  return info
    .sort(
      (a, b) =>
        Number(paper(a)) - Number(paper(b)) || a.rank - b.rank || (a.rank === 2 ? b.items - a.items : 0) || a.k - b.k,
    )
    .map((s) => s.rows);
}

// ---------------------------------------------------------------------------------------------
// Pieces and joining

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

/** Two lines that cover the same horizontal span are stacked, not side by side — unless they sit
 *  at the same height: engine 3 only estimates where each word of a line is, and those estimated
 *  boxes can overlap ('Beetroot, Orange' over the '1.0' next to it). */
function overlapsRow(row: Row, line: PlacedLine, sameHeight: number): boolean {
  return row.lines.some((other) => {
    if (Math.abs(other.y - line.y) <= sameHeight) return false;
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
