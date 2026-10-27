import type { ISODate, Recurrence, RecurrenceFrequency } from '../types';
import { addDays, addMonths, isValidISODate } from './dates';

/** In display order, for pickers. */
export const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = ['weekly', 'fortnightly', 'monthly', 'yearly'];

const MAX_DUE_DATES = 24;

/** The k-th occurrence counted from `start`. Monthly/yearly are measured from the anchor
 *  so a 31st keeps returning to month-end (31 Jan → 28 Feb → 31 Mar), not drifting to the 28th. */
function occurrence(start: ISODate, f: RecurrenceFrequency, k: number): ISODate {
  switch (f) {
    case 'weekly':
      return addDays(start, 7 * k);
    case 'fortnightly':
      return addDays(start, 14 * k);
    case 'yearly':
      return addMonths(start, 12 * k);
    case 'monthly':
    default:
      return addMonths(start, k);
  }
}

export function advance(date: ISODate, f: RecurrenceFrequency): ISODate {
  return occurrence(date, f, 1);
}

/**
 * The first date of the series that starts on `anchor` (the expense's own date) and comes
 * after `after`. Counting from the anchor keeps a 31st on month-ends for good
 * (31 Aug → 30 Sep → 31 Oct) instead of drifting to the 30th.
 */
export function nextOccurrenceAfter(anchor: ISODate, f: RecurrenceFrequency, after: ISODate): ISODate {
  let next = occurrence(anchor, f, 1);
  for (let k = 2; next <= after && k < 10000; k++) next = occurrence(anchor, f, k);
  return next;
}

/** Dates from r.nextDate up to and including `today` (max 24), and the next date after them.
 *  With `anchor` (the recurring expense's date, before r.nextDate) the dates after r.nextDate
 *  follow the anchor's series, so month-end anchors survive being stored as a 30th. */
export function dueDates(r: Recurrence, today: ISODate, anchor?: ISODate): { dates: ISODate[]; nextDate: ISODate } {
  const dates: ISODate[] = [];
  if (!isValidISODate(r.nextDate) || !isValidISODate(today)) return { dates, nextDate: r.nextDate };
  const start = anchor && isValidISODate(anchor) && anchor < r.nextDate ? anchor : r.nextDate;
  let next = r.nextDate;
  while (next <= today && dates.length < MAX_DUE_DATES) {
    dates.push(next);
    next = nextOccurrenceAfter(start, r.frequency, next);
  }
  return { dates, nextDate: next };
}

const LABELS: Record<RecurrenceFrequency, string> = {
  weekly: 'Every week',
  fortnightly: 'Every 2 weeks',
  monthly: 'Every month',
  yearly: 'Every year',
};

export function frequencyLabel(f: RecurrenceFrequency): string {
  return LABELS[f] ?? 'Every month';
}
