import { OCR_SPACE_DEMO_KEY } from '../../app/src/ocr/ocrSpace';
import { cleanBuiltInKey, OCR_BUILT_IN_KEY, ocrKeyFor, ocrKeyLabel, ocrKeySource } from '../../app/src/ocr/ocrKey';

describe('ocrKey', () => {
  it('has no built-in key where there is no process (this runner, Snack)', () => {
    expect(OCR_BUILT_IN_KEY).toBe('');
  });

  it('cleans the built-in key the publish job passes in', () => {
    expect(cleanBuiltInKey(' K8123 45\n')).toBe('K812345');
    expect(cleanBuiltInKey('')).toBe('');
    expect(cleanBuiltInKey(undefined)).toBe('');
    expect(cleanBuiltInKey(42)).toBe('');
  });

  it('prefers the own key, then the built-in key, then the demo key', () => {
    expect(ocrKeySource('K-own', 'K-built')).toBe('own');
    expect(ocrKeyFor(' K-own ', 'K-built')).toBe('K-own');
    expect(ocrKeySource('', 'K-built')).toBe('built_in');
    expect(ocrKeySource('   ', 'K-built')).toBe('built_in');
    expect(ocrKeyFor('  ', 'K-built')).toBe('K-built');
    expect(ocrKeySource('', '')).toBe('demo');
    expect(ocrKeySource('', '  ')).toBe('demo');
    expect(ocrKeyFor('', '')).toBe(OCR_SPACE_DEMO_KEY);
  });

  it('defaults to the built-in key of this build', () => {
    expect(ocrKeySource('')).toBe('demo');
    expect(ocrKeyFor('')).toBe(OCR_SPACE_DEMO_KEY);
    expect(ocrKeyFor('K-own')).toBe('K-own');
  });

  it('labels each source', () => {
    expect(ocrKeyLabel('own')).toBe('Your OCR.space key');
    expect(ocrKeyLabel('built_in')).toBe('Built-in key');
    expect(ocrKeyLabel('demo')).toBe('Shared demo key');
  });
});
