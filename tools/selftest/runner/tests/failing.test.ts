// Self-test: DELIBERATE failures. run-tests.ps1 must report each of them and exit with code 1.
// Expected: 1 pass, 7 failures (see tools/selftest/run-selftest.ps1).
import { splitEvenly, crash, delay } from '../app/src/lib/calc';

describe('deliberate failures', () => {
  it('passes (control)', () => {
    expect(splitEvenly(10, 2)).toEqual([5, 5]);
  });

  it('toEqual shows a diff', () => {
    expect({ items: [{ name: 'Naan', amount: 36000 }, { name: 'Butter Chicken', amount: 42000 }], total: 78000 })
      .toEqual({ items: [{ name: 'Naan', amount: 36000 }, { name: 'Butter Chicken', amount: 45000 }], total: 81000 });
  });

  it('toBe shows expected and received', () => {
    expect(splitEvenly(100, 3)[0]).toBe(33);
  });

  it('.not failure', () => {
    expect('₹1,460.00').not.toContain('₹');
  });

  it('error thrown inside the module under test', () => {
    crash({ name: 'x' });
  });

  it('async rejection', async () => {
    await delay(5, null);
    throw new TypeError('async failure after a timer');
  });

  it('times out', async () => {
    await new Promise(() => undefined);
  }, 100);

  it('expect.assertions mismatch', () => {
    expect.assertions(2);
    expect(true).toBe(true);
  });
});
