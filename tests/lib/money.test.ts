import {
  CURRENCIES,
  allocate,
  compareCurrencyCodes,
  currencyDecimals,
  currencyInfo,
  formatCurrencyAmounts,
  formatMoney,
  minorToInputText,
  parseAmountInput,
  splitEvenly,
  sumMinor,
  toMajor,
  toMinor,
} from '../../app/src/lib/money';

describe('currencies', () => {
  it('lists at least the required currencies, each once', () => {
    const codes = CURRENCIES.map((c) => c.code);
    for (const code of ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED', 'AUD', 'CAD', 'JPY', 'THB', 'HKD', 'CHF']) {
      expect(codes).toContain(code);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('knows symbols and decimals', () => {
    expect(currencyInfo('INR').symbol).toBe('₹');
    expect(currencyDecimals('INR')).toBe(2);
    expect(currencyDecimals('JPY')).toBe(0);
    expect(currencyInfo('usd').code).toBe('USD');
  });

  it('falls back for unknown codes', () => {
    expect(currencyInfo('XYZ')).toEqual({ code: 'XYZ', symbol: 'XYZ ', name: 'XYZ', decimals: 2 });
  });
});

describe('toMinor / toMajor', () => {
  it('converts and rounds half away from zero', () => {
    expect(toMinor(1390.5, 'INR')).toBe(139050);
    expect(toMinor(1.005, 'INR')).toBe(101);
    expect(toMinor(-1.005, 'INR')).toBe(-101);
    expect(toMinor(0.125, 'USD')).toBe(13);
    expect(toMinor(-0.125, 'USD')).toBe(-13);
    expect(toMinor(1390.5, 'JPY')).toBe(1391);
  });

  it('never returns -0 or NaN', () => {
    expect(Object.is(toMinor(-0.001, 'INR'), 0)).toBe(true);
    expect(toMinor(NaN, 'INR')).toBe(0);
  });

  it('converts back to major units', () => {
    expect(toMajor(139050, 'INR')).toBe(1390.5);
    expect(toMajor(1391, 'JPY')).toBe(1391);
  });
});

describe('parseAmountInput', () => {
  const ok: [string, number][] = [
    ['1,390.50', 139050],
    ['₹ 1390.5', 139050],
    ['1390', 139000],
    ['.5', 50],
    [' 1390 ', 139000],
    ['₹1390.50', 139050],
    ['Rs. 1,390', 139000],
    ['Rs 1390/-', 139000],
    ['INR 250', 25000],
    ['250 INR', 25000],
    ['1,23,456.78', 12345678],
    ['0', 0],
    ['5.', 500],
    ['1390.555', 139056],
    ['1390.554', 139055],
    ['12,5', 1250],
    ['1.234,56', 123456],
    ['+50', 5000],
  ];
  for (const [text, expected] of ok) {
    it(`parses '${text}'`, () => {
      expect(parseAmountInput(text, 'INR')).toBe(expected);
    });
  }

  const bad = ['1.2.3', 'abc', '', '   ', '-', '.', '1,2345', '12abc', '1e5', '₹', ',,', '1..2', '99999999999999'];
  for (const text of bad) {
    it(`rejects '${text}'`, () => {
      expect(parseAmountInput(text, 'INR')).toBeNull();
    });
  }

  it('rejects negatives unless allowed', () => {
    expect(parseAmountInput('-50', 'INR')).toBeNull();
    expect(parseAmountInput('-50', 'INR', { allowNegative: true })).toBe(-5000);
    expect(parseAmountInput('−50', 'INR', { allowNegative: true })).toBe(-5000);
    expect(parseAmountInput('-₹50', 'INR', { allowNegative: true })).toBe(-5000);
    expect(parseAmountInput('₹-50.25', 'INR', { allowNegative: true })).toBe(-5025);
    expect(parseAmountInput('-0', 'INR')).toBe(0);
  });

  it('respects the currency decimals', () => {
    expect(parseAmountInput('1390.5', 'JPY')).toBe(1391);
    expect(parseAmountInput('1,390', 'JPY')).toBe(1390);
    expect(parseAmountInput('$12.99', 'USD')).toBe(1299);
  });
});

describe('minorToInputText', () => {
  it('drops the decimals only for whole amounts', () => {
    expect(minorToInputText(139050, 'INR')).toBe('1390.50');
    expect(minorToInputText(100000, 'INR')).toBe('1000');
    expect(minorToInputText(139005, 'INR')).toBe('1390.05');
    expect(minorToInputText(5, 'INR')).toBe('0.05');
    expect(minorToInputText(0, 'INR')).toBe('0');
    expect(minorToInputText(-5050, 'INR')).toBe('-50.50');
    expect(minorToInputText(1390, 'JPY')).toBe('1390');
  });

  it('round-trips through parseAmountInput', () => {
    for (const v of [0, 1, 99, 100, 139050, 12345678, 100000000]) {
      expect(parseAmountInput(minorToInputText(v, 'INR'), 'INR')).toBe(v);
    }
  });
});

describe('formatMoney', () => {
  it('uses Indian grouping for INR', () => {
    expect(formatMoney(139050, 'INR')).toBe('₹1,390.50');
    expect(formatMoney(12345600, 'INR')).toBe('₹1,23,456.00');
    expect(formatMoney(123456789, 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(100000000000, 'INR')).toBe('₹1,00,00,00,000.00');
    expect(formatMoney(99900, 'INR')).toBe('₹999.00');
  });

  it('uses 3-digit groups for other currencies', () => {
    expect(formatMoney(12345600, 'USD')).toBe('$123,456.00');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
    expect(formatMoney(99, 'EUR')).toBe('€0.99');
    expect(formatMoney(5000, 'AED')).toBe('AED 50.00');
    expect(formatMoney(5000, 'XYZ')).toBe('XYZ 50.00');
  });

  it('formats JPY without decimals', () => {
    expect(formatMoney(139000, 'JPY')).toBe('¥139,000');
    expect(formatMoney(1390, 'JPY', { compact: true })).toBe('¥1,390');
  });

  it('handles small amounts and zero', () => {
    expect(formatMoney(0, 'INR')).toBe('₹0.00');
    expect(formatMoney(5, 'INR')).toBe('₹0.05');
    expect(formatMoney(100, 'INR')).toBe('₹1.00');
  });

  it('formats negatives and signs', () => {
    expect(formatMoney(-5000, 'INR')).toBe('-₹50.00');
    expect(formatMoney(-5000, 'INR', { signed: true })).toBe('−₹50.00');
    expect(formatMoney(5000, 'INR', { signed: true })).toBe('+₹50.00');
    expect(formatMoney(0, 'INR', { signed: true })).toBe('₹0.00');
    expect(formatMoney(-5000, 'INR', { abs: true })).toBe('₹50.00');
    expect(formatMoney(-12345600, 'INR')).toBe('-₹1,23,456.00');
  });

  it('drops .00 in compact mode only', () => {
    expect(formatMoney(139000, 'INR', { compact: true })).toBe('₹1,390');
    expect(formatMoney(139050, 'INR', { compact: true })).toBe('₹1,390.50');
  });
});

describe('allocate', () => {
  it('splits by largest remainder and always sums to the total', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(100, [1, 1])).toEqual([50, 50]);
    expect(allocate(10, [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(allocate(1000, [50, 25, 25])).toEqual([500, 250, 250]);
  });

  it('breaks ties by lower index', () => {
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
  });

  it('gives remainders to the largest fractions first', () => {
    // GST example: 3475 by item subtotals is exact; 50 paise round-off is not.
    expect(allocate(3475, [30000, 32000, 45000, 32000])).toEqual([750, 800, 1125, 800]);
    expect(allocate(50, [30000, 32000, 45000, 32000])).toEqual([11, 12, 16, 11]);
  });

  it('handles decimal and fractional weights', () => {
    expect(allocate(1000, [33.34, 33.33, 33.33])).toEqual([334, 333, 333]);
    expect(allocate(1000, [1.5, 0.5])).toEqual([750, 250]);
    expect(allocate(100, [1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
  });

  it('mirrors negative totals', () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(-5, [1, 1, 1, 1])).toEqual([-2, -1, -1, -1]);
    const r = allocate(-1, [1, 1]);
    expect(r).toEqual([-1, 0]);
    expect(Object.is(r[1], 0)).toBe(true);
  });

  it('returns zeros for a zero total', () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('never gives anything to zero weights', () => {
    expect(allocate(100, [0, 1, 1])).toEqual([0, 50, 50]);
    expect(allocate(101, [0, 1, 1])).toEqual([0, 51, 50]);
    expect(allocate(7, [0, 0, 1])).toEqual([0, 0, 7]);
  });

  it('throws on invalid weights or totals', () => {
    expect(() => allocate(100, [0, 0])).toThrow();
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(0, [0, 0])).toThrow();
    expect(() => allocate(100, [1, -1])).toThrow();
    expect(() => allocate(100, [1, NaN])).toThrow();
    expect(() => allocate(10.5, [1, 1])).toThrow();
  });

  it('copes with large totals', () => {
    const r = allocate(1000000000000, [1, 1, 1]);
    expect(sumMinor(r)).toBe(1000000000000);
    expect(r).toEqual([333333333334, 333333333333, 333333333333]);
  });
});

describe('splitEvenly / sumMinor', () => {
  it('splits evenly with the extra paise going first', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEvenly(36000, 4)).toEqual([9000, 9000, 9000, 9000]);
  });

  it('rejects invalid counts', () => {
    expect(() => splitEvenly(100, 0)).toThrow();
    expect(() => splitEvenly(100, 1.5)).toThrow();
  });

  it('sums', () => {
    expect(sumMinor([])).toBe(0);
    expect(sumMinor([1, 2, -3])).toBe(0);
    expect(sumMinor([31500, 33600, 47250, 33600])).toBe(145950);
  });
});

describe('formatCurrencyAmounts', () => {
  it('joins currencies in a stable order and skips zeros', () => {
    expect(formatCurrencyAmounts({ INR: 50000, USD: 1200 })).toBe('₹500.00 + $12.00');
    expect(formatCurrencyAmounts({ USD: 1200, INR: 50000 })).toBe('₹500.00 + $12.00');
    expect(formatCurrencyAmounts({ INR: 0, USD: 1200 })).toBe('$12.00');
    expect(formatCurrencyAmounts({})).toBe('');
    expect(formatCurrencyAmounts({ INR: 0 })).toBe('');
  });

  it('shows signs unless abs is set', () => {
    expect(formatCurrencyAmounts({ INR: -50000 })).toBe('-₹500.00');
    expect(formatCurrencyAmounts({ INR: -50000, USD: 1200 }, { abs: true })).toBe('₹500.00 + $12.00');
  });

  it('orders known currencies before unknown ones', () => {
    expect(['USD', 'XYZ', 'INR', 'ABC'].sort(compareCurrencyCodes)).toEqual(['INR', 'USD', 'ABC', 'XYZ']);
  });
});
