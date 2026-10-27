// Self-test: every test in this file must pass (run-tests.ps1 -Root tools\selftest\runner -Filter passing).
import { splitEvenly, format, platformName, saveAndLoad, pickPhoto, delay } from '../app/src/lib/calc';
import { kindLabel, Kind, SYMBOLS } from '../app/src/lib/symbols';

describe('matchers', () => {
  it('toBe / toEqual / toStrictEqual', () => {
    expect(1 + 1).toBe(2);
    expect({ a: [1, { b: 2 }] }).toEqual({ a: [1, { b: 2 }] });
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 });
    expect([1, 2]).toStrictEqual([1, 2]);
    expect(new Map([['k', 1]])).toEqual(new Map([['k', 1]]));
    expect(new Set([1, 2])).not.toEqual(new Set([1, 3]));
    expect(0).not.toBe(-0);
    expect(NaN).toBe(NaN);
  });

  it('numbers and truthiness', () => {
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(3).toBeGreaterThan(2);
    expect(3).toBeGreaterThanOrEqual(3);
    expect(2).toBeLessThan(3);
    expect(2).toBeLessThanOrEqual(2);
    expect('x').toBeTruthy();
    expect('').toBeFalsy();
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(0).toBeDefined();
    expect(NaN).toBeNaN();
  });

  it('strings, arrays and objects', () => {
    expect('Butter Chicken').toContain('Chicken');
    expect([1, 2, 3]).toContain(2);
    expect([{ a: 1 }]).toContainEqual({ a: 1 });
    expect([1, 2, 3]).toHaveLength(3);
    expect('abc').toHaveLength(3);
    expect('Grand Total 1460.00').toMatch(/total\s+\d+/i);
    expect('Sub Total').toMatch('Sub');
    expect({ a: { b: [10, 20] } }).toHaveProperty('a.b[1]', 20);
    expect({ a: { b: 1 } }).not.toHaveProperty('a.c');
    expect({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } });
    expect(new RangeError('x')).toBeInstanceOf(Error);
    expect({ id: 'exp_1', amount: 5 }).toEqual({ id: expect.any(String), amount: expect.anything() });
    expect([3, 1, 2]).toEqual(expect.arrayContaining([1, 2]));
    expect('paid ₹500').toEqual(expect.stringContaining('₹'));
  });

  it('toThrow variants', () => {
    expect(() => splitEvenly(10, 0)).toThrow();
    expect(() => splitEvenly(10, 0)).toThrow('positive');
    expect(() => splitEvenly(10, 0)).toThrow(/must be/);
    expect(() => splitEvenly(10, 0)).toThrow(RangeError);
    expect(() => splitEvenly(10, 2)).not.toThrow();
  });
});

describe('module under test', () => {
  it('splits exactly', () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('keeps UTF-8 symbols intact', () => {
    expect(format({ minor: 139050, currency: 'INR' })).toBe('₹1390.50');
    expect(format({ minor: 999, currency: 'EUR' })).toBe('€9.99');
    expect(SYMBOLS.GBP).toBe('£');
    expect('₹'.charCodeAt(0)).toBe(0x20b9);
  });

  it('const enums and type-only imports transpile', () => {
    expect(kindLabel(Kind.Tax)).toBe('Tax');
  });

  it('react-native stub reports web', () => {
    expect(platformName()).toBe('web');
  });

  it('AsyncStorage stub is in-memory', async () => {
    await expect(saveAndLoad('k', 'v')).resolves.toBe('v');
  });

  it('Expo modules throw a clear error when called', () => {
    expect(() => pickPhoto()).toThrow(/not available in the headless test harness/);
  });

  it('fetch is blocked', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/Network access is disabled/);
  });
});

describe('async and hooks', () => {
  const order: string[] = [];
  beforeAll(() => { order.push('beforeAll'); });
  beforeEach(() => { order.push('beforeEach'); });
  afterEach(() => { order.push('afterEach'); });

  it('awaits timers (virtual time)', async () => {
    const v = await delay(2000, 42);
    expect(v).toBe(42);
  });

  it('supports done callbacks', (done) => {
    setTimeout(() => { expect(order[0]).toBe('beforeAll'); done(); }, 10);
  });

  it('ran hooks in order', () => {
    expect(order).toEqual(['beforeAll', 'beforeEach', 'afterEach', 'beforeEach', 'afterEach', 'beforeEach']);
  });

  it('rejects matcher', async () => {
    await expect(Promise.reject(new Error('boom'))).rejects.toThrow('boom');
    expect.assertions(1);
  });

  describe('nested', () => {
    it.each([
      [1, 1, 2],
      [2, 3, 5],
    ])('adds %i + %i = %i', (a, b, sum) => {
      expect(a + b).toBe(sum);
    });
  });
});

describe('mocks', () => {
  it('jest.fn records calls', () => {
    const f = jest.fn((x: number) => x * 2);
    expect(f(2)).toBe(4);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith(2);
    expect(f).not.toHaveBeenCalledWith(3);
  });

  it('jest.spyOn restores', () => {
    const obj = { hello: () => 'hi' };
    const spy = jest.spyOn(obj, 'hello').mockReturnValue('mocked');
    expect(obj.hello()).toBe('mocked');
    spy.mockRestore();
    expect(obj.hello()).toBe('hi');
  });
});

describe('skips', () => {
  it.skip('is skipped', () => {
    throw new Error('should not run');
  });
  it.todo('is a todo');
});
