import { RECURRENCE_FREQUENCIES, advance, dueDates, frequencyLabel, nextOccurrenceAfter } from '../../app/src/lib/recurrence';
import { addDays } from '../../app/src/lib/dates';

describe('advance', () => {
  it('moves one period forward', () => {
    expect(advance('2026-10-03', 'weekly')).toBe('2026-10-10');
    expect(advance('2026-10-03', 'fortnightly')).toBe('2026-10-17');
    expect(advance('2026-10-03', 'monthly')).toBe('2026-11-03');
    expect(advance('2026-10-03', 'yearly')).toBe('2027-10-03');
  });

  it('clamps month ends and leap days', () => {
    expect(advance('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advance('2024-01-31', 'monthly')).toBe('2024-02-29');
    expect(advance('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(advance('2026-12-28', 'weekly')).toBe('2027-01-04');
  });
});

describe('dueDates', () => {
  it('returns nothing before the next date', () => {
    expect(dueDates({ frequency: 'monthly', nextDate: '2026-11-01' }, '2026-10-14')).toEqual({ dates: [], nextDate: '2026-11-01' });
  });

  it('includes today', () => {
    expect(dueDates({ frequency: 'monthly', nextDate: '2026-10-14' }, '2026-10-14')).toEqual({
      dates: ['2026-10-14'],
      nextDate: '2026-11-14',
    });
  });

  it('catches up on every missed week', () => {
    expect(dueDates({ frequency: 'weekly', nextDate: '2026-09-01' }, '2026-09-29')).toEqual({
      dates: ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'],
      nextDate: '2026-10-06',
    });
    expect(dueDates({ frequency: 'fortnightly', nextDate: '2026-09-01' }, '2026-09-28')).toEqual({
      dates: ['2026-09-01', '2026-09-15'],
      nextDate: '2026-09-29',
    });
  });

  it('keeps month-end anchors instead of drifting', () => {
    expect(dueDates({ frequency: 'monthly', nextDate: '2026-01-31' }, '2026-05-01')).toEqual({
      dates: ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
      nextDate: '2026-05-31',
    });
  });

  it('handles yearly recurrences', () => {
    expect(dueDates({ frequency: 'yearly', nextDate: '2024-02-29' }, '2026-10-14')).toEqual({
      dates: ['2024-02-29', '2025-02-28', '2026-02-28'],
      nextDate: '2027-02-28',
    });
  });

  it('caps at 24 dates and returns the next one after them', () => {
    const r = dueDates({ frequency: 'weekly', nextDate: '2020-01-01' }, '2026-01-01');
    expect(r.dates).toHaveLength(24);
    expect(r.dates[0]).toBe('2020-01-01');
    expect(r.dates[23]).toBe('2020-06-10');
    expect(r.nextDate).toBe('2020-06-17');
    expect(r.nextDate).toBe(addDays('2020-01-01', 7 * 24));
  });

  it('ignores invalid dates', () => {
    expect(dueDates({ frequency: 'weekly', nextDate: '' }, '2026-10-14')).toEqual({ dates: [], nextDate: '' });
  });
});


describe('series anchored on the expense date', () => {
  it('finds the next date of the series after a given day', () => {
    expect(nextOccurrenceAfter('2026-08-31', 'monthly', '2026-08-31')).toBe('2026-09-30');
    expect(nextOccurrenceAfter('2026-08-31', 'monthly', '2026-09-30')).toBe('2026-10-31');
    expect(nextOccurrenceAfter('2026-08-31', 'monthly', '2026-01-01')).toBe('2026-09-30');
    expect(nextOccurrenceAfter('2026-10-01', 'weekly', '2026-10-20')).toBe('2026-10-22');
  });

  it('keeps a 31st on month-ends when nextDate was stored as the 30th', () => {
    const first = dueDates({ frequency: 'monthly', nextDate: '2026-09-30' }, '2026-10-01', '2026-08-31');
    expect(first).toEqual({ dates: ['2026-09-30'], nextDate: '2026-10-31' });
    expect(dueDates({ frequency: 'monthly', nextDate: first.nextDate }, '2026-11-30', '2026-08-31')).toEqual({
      dates: ['2026-10-31', '2026-11-30'],
      nextDate: '2026-12-31',
    });
  });

  it('still honours a nextDate off the series, then rejoins it', () => {
    expect(dueDates({ frequency: 'monthly', nextDate: '2026-10-05' }, '2026-11-02', '2026-09-01')).toEqual({
      dates: ['2026-10-05', '2026-11-01'],
      nextDate: '2026-12-01',
    });
  });
});
describe('frequencyLabel', () => {
  it('labels every frequency', () => {
    expect(RECURRENCE_FREQUENCIES).toEqual(['weekly', 'fortnightly', 'monthly', 'yearly']);
    expect(frequencyLabel('weekly')).toBe('Every week');
    expect(frequencyLabel('fortnightly')).toBe('Every 2 weeks');
    expect(frequencyLabel('monthly')).toBe('Every month');
    expect(frequencyLabel('yearly')).toBe('Every year');
  });
});
