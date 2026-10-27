import {
  addDays,
  addMonths,
  compareDesc,
  formatDate,
  isValidISODate,
  monthKey,
  monthLabel,
  parseISODate,
  relativeTime,
  toISODate,
  todayISO,
} from '../../app/src/lib/dates';

describe('todayISO / parseISODate / toISODate', () => {
  it('uses the local date', () => {
    expect(todayISO(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03');
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses to local midnight', () => {
    const d = parseISODate('2026-10-03');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('returns an invalid date for garbage', () => {
    expect(isNaN(parseISODate('nope').getTime())).toBe(true);
    expect(isNaN(parseISODate('2026-02-30').getTime())).toBe(true);
  });

  it('round-trips', () => {
    for (const d of ['2026-10-03', '2024-02-29', '1999-12-31', '2000-01-01']) {
      expect(toISODate(parseISODate(d))).toBe(d);
    }
    expect(toISODate(new Date(NaN))).toBe('');
  });

  it('validates dates', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2023-02-29')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-1-01')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses months, years and leap days', () => {
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2000-02-28', 1)).toBe('2000-02-29');
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-27', 7)).toBe('2026-11-03');
    expect(addDays('2026-10-03', 0)).toBe('2026-10-03');
  });

  it('is reversible over long spans', () => {
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01');
    expect(addDays('2023-01-01', 365)).toBe('2024-01-01');
    expect(addDays(addDays('2026-10-03', 10000), -10000)).toBe('2026-10-03');
  });

  it('returns invalid input unchanged', () => {
    expect(addDays('garbage', 1)).toBe('garbage');
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2026-05-31', -1)).toBe('2026-04-30');
  });

  it('crosses year boundaries both ways', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-10-03', -13)).toBe('2025-09-03');
    expect(addMonths('2026-10-03', 24)).toBe('2028-10-03');
    expect(addMonths('2026-10-03', 0)).toBe('2026-10-03');
  });
});

describe('formatDate', () => {
  const now = new Date(2026, 9, 14, 12, 0);

  it('formats short and long dates', () => {
    expect(formatDate('2026-10-03', 'short', now)).toBe('Oct 3');
    expect(formatDate('2026-10-03', 'long', now)).toBe('Oct 3, 2026');
    expect(formatDate('2026-01-09', 'short', now)).toBe('Jan 9');
    expect(formatDate('2026-12-25', undefined, now)).toBe('Dec 25');
  });

  it('shows the year for other years in short style', () => {
    expect(formatDate('2025-10-03', 'short', now)).toBe('Oct 3, 2025');
    expect(formatDate('2027-05-01', 'short', now)).toBe('May 1, 2027');
  });

  it('returns invalid input unchanged', () => {
    expect(formatDate('soon', 'short', now)).toBe('soon');
  });
});

describe('monthKey / monthLabel', () => {
  it('builds and labels month keys', () => {
    expect(monthKey('2026-10-03')).toBe('2026-10');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(monthLabel(monthKey('2025-12-31'))).toBe('December 2025');
    expect(monthLabel('abc')).toBe('abc');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('relativeTime', () => {
  const now = new Date(2026, 9, 14, 15, 0, 0);
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const local = (...args: [number, number, number, number, number]) => new Date(...args).toISOString();

  it('describes recent times', () => {
    expect(relativeTime(ago(30 * 1000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60 * 1000), now)).toBe('5 min ago');
    expect(relativeTime(ago(59 * 60 * 1000), now)).toBe('59 min ago');
    expect(relativeTime(ago(60 * 60 * 1000), now)).toBe('1 hour ago');
    expect(relativeTime(ago(3 * 60 * 60 * 1000), now)).toBe('3 hours ago');
  });

  it('says yesterday, then falls back to dates', () => {
    expect(relativeTime(local(2026, 9, 13, 20, 0), now)).toBe('yesterday');
    expect(relativeTime(local(2026, 9, 3, 9, 30), now)).toBe('Oct 3');
    expect(relativeTime(local(2025, 9, 3, 9, 30), now)).toBe('Oct 3, 2025');
  });

  it('handles clock skew and garbage', () => {
    expect(relativeTime(new Date(now.getTime() + 20 * 1000).toISOString(), now)).toBe('just now');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('compareDesc', () => {
  it('sorts newest first', () => {
    expect(['2026-10-01', '2026-10-03', '2025-12-31', '2026-10-02'].sort(compareDesc)).toEqual([
      '2026-10-03',
      '2026-10-02',
      '2026-10-01',
      '2025-12-31',
    ]);
    expect(compareDesc('2026-10-03', '2026-10-03')).toBe(0);
  });
});
