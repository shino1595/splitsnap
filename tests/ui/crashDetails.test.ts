import { crashDetails } from '../../app/src/ui/crashDetails';

const AT = '2026-11-12T10:00:00.000Z';

describe('crashDetails', () => {
  it('starts with the title and holds the time, platform, message and stack', () => {
    const error = new TypeError('Cannot read property x');
    error.stack = 'TypeError: Cannot read property x\n    at foo (a.js:1:1)\n    at bar (b.js:2:2)';
    const text = crashDetails({ error, componentStack: '\n    in Foo\n    in Bar', platform: 'ios', at: AT });
    expect(text.split('\n')[0]).toBe('SplitSnap problem report');
    expect(text).toContain(AT);
    expect(text).toContain('ios');
    expect(text).toContain('TypeError');
    expect(text).toContain('Cannot read property x');
    expect(text).toContain('at foo (a.js:1:1)');
    expect(text).toContain('in Foo');
  });

  it('caps the stack at 30 lines and the component stack at 15', () => {
    const error = new Error('boom');
    error.stack = Array.from({ length: 80 }, (_, i) => `at stackline${i}`).join('\n');
    const componentStack = Array.from({ length: 40 }, (_, i) => `in Comp${i}`).join('\n');
    const text = crashDetails({ error, componentStack, platform: 'web', at: AT });
    expect(text).toContain('at stackline29');
    expect(text).not.toContain('at stackline30');
    expect(text).toContain('in Comp14');
    expect(text).not.toContain('in Comp15');
  });

  it('copes with values that are not errors', () => {
    expect(crashDetails({ error: 'just a string', platform: 'android', at: AT })).toContain('just a string');
    expect(crashDetails({ error: null, platform: 'android', at: AT })).toContain('null');
    expect(crashDetails({ error: undefined, platform: 'android', at: AT })).toContain('undefined');
    expect(crashDetails({ error: { message: 'plain object' }, platform: 'android', at: AT })).toContain('plain object');
    const odd = {
      toString() {
        throw new Error('no');
      },
    };
    expect(crashDetails({ error: odd, platform: 'android', at: AT })).toContain('SplitSnap problem report');
  });
});
