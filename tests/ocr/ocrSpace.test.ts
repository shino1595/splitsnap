import {
  classifyOcrMessage,
  OCR_SPACE_DEMO_KEY,
  OCR_SPACE_ENDPOINT,
  overlayLines,
  readOcrSpaceResponse,
  recognizeText,
  rowsFromParsedText,
} from '../../app/src/ocr/ocrSpace';
import { isOcrError, OcrError, ocrErrorMessage } from '../../app/src/ocr/types';
import { response as billA } from './fixtures/live_bill_a';

type FetchArgs = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } };

const realFetch = globalThis.fetch;
let calls: FetchArgs[] = [];

function mockFetch(reply: (args: FetchArgs) => Promise<{ status: number; body: string }>) {
  calls = [];
  globalThis.fetch = ((url: string, init: FetchArgs['init']) => {
    const args = { url, init };
    calls.push(args);
    return reply(args).then(({ status, body }) => ({ ok: status >= 200 && status < 300, status, text: async () => body }));
  }) as unknown as typeof fetch;
}

const json = (status: number, value: unknown) => async () => ({ status, body: JSON.stringify(value) });

function formFields(body: string | undefined): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const pair of (body ?? '').split('&')) {
    const [k, v] = pair.split('=');
    fields[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return fields;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    return isOcrError(e) ? e.code : `not an OcrError: ${String(e)}`;
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('OCR.space response handling', () => {
  it('turns TextOverlay lines into OcrLines with word boxes', () => {
    const lines = overlayLines(billA as never);
    expect(lines[0].text).toBe('SPICE GARDEN');
    expect(lines[0].words[0]).toEqual({ text: 'SPICE', left: 268, top: 99, width: 117, height: 33 });
  });

  it('splits ParsedText on newlines and tabs', () => {
    expect(rowsFromParsedText('Naan\t6\t60.00\t360.00\t\r\n\r\nTotal\t360.00\t\n')).toEqual(['Naan  6  60.00  360.00', 'Total  360.00']);
    expect(rowsFromParsedText(undefined as unknown as string)).toEqual([]);
  });

  it('falls back to ParsedText when there is no overlay', () => {
    const result = readOcrSpaceResponse({
      ParsedResults: [{ ParsedText: 'Tea\t20.00\nTotal\t20.00\n', TextOverlay: { Lines: [] } }],
      OCRExitCode: 1,
      IsErroredOnProcessing: false,
    });
    expect(result.lines).toEqual(['Tea  20.00', 'Total  20.00']);
  });

  it('reports a blank page as no_text and processing errors by their message', () => {
    const errorOf = (value: unknown) => {
      try {
        readOcrSpaceResponse(value as never);
        return 'none';
      } catch (e) {
        return isOcrError(e) ? e.code : 'other';
      }
    };
    expect(errorOf({ ParsedResults: [{ ParsedText: '', TextOverlay: { Lines: [] } }], OCRExitCode: 1 })).toBe('no_text');
    expect(errorOf({ OCRExitCode: 3, IsErroredOnProcessing: true, ErrorMessage: ['E101: Timed out waiting for results'] })).toBe('timeout');
    expect(
      errorOf({
        OCRExitCode: 99,
        IsErroredOnProcessing: true,
        ErrorMessage: ['File failed validation. File size exceeds the maximum permissible file size limit of 1024 KB'],
      }),
    ).toBe('too_large');
    expect(errorOf({ OCRExitCode: 99, IsErroredOnProcessing: true, ErrorMessage: 'The API key is invalid' })).toBe('bad_key');
    expect(errorOf(null)).toBe('unknown');
  });

  it('classifies HTTP statuses and OCR.space messages', () => {
    expect(classifyOcrMessage('You may only perform this action upto maximum 180 number of times within 3600 seconds', 403)).toBe('quota');
    expect(classifyOcrMessage('', 429)).toBe('quota');
    expect(classifyOcrMessage('Unauthorized', 401)).toBe('bad_key');
    expect(classifyOcrMessage('API Key is not valid', 403)).toBe('bad_key');
    expect(classifyOcrMessage('E101: Timed out waiting for results')).toBe('timeout');
    expect(classifyOcrMessage('Something odd', 500)).toBe('unknown');
  });

  it('gives every error code a friendly message', () => {
    expect(ocrErrorMessage(new OcrError('quota'))).toMatch(/limit|busy/);
    expect(ocrErrorMessage(new Error('boom'))).toMatch(/went wrong/);
    expect(new OcrError('network') instanceof OcrError).toBe(true);
  });
});

describe('recognizeText', () => {
  it('posts the photo as a form with the expected options and returns rebuilt rows', async () => {
    mockFetch(json(200, billA));
    const result = await recognizeText('QUJD', { apiKey: '', engine: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OCR_SPACE_ENDPOINT);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers?.apikey).toBe(OCR_SPACE_DEMO_KEY);
    expect(calls[0].init.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(formFields(calls[0].init.body)).toEqual({
      base64Image: 'data:image/jpeg;base64,QUJD',
      language: 'eng',
      isTable: 'true',
      OCREngine: '2',
      scale: 'true',
      detectOrientation: 'true',
      isOverlayRequired: 'true',
    });
    expect(result.engine).toBe(2);
    expect(result.lines).toContain('Naan  6  60.00  360.00');
    expect(result.rawText).toContain('Naan\t6\t60.00\t360.00');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('uses the given key and engine, and does not double-prefix a data URI', async () => {
    mockFetch(json(200, billA));
    await recognizeText('data:image/jpeg;base64,QUJD', { apiKey: ' K123 ', engine: 1 });
    expect(calls[0].init.headers?.apikey).toBe('K123');
    const fields = formFields(calls[0].init.body);
    expect(fields.base64Image).toBe('data:image/jpeg;base64,QUJD');
    expect(fields.OCREngine).toBe('1');
  });

  it('maps failures to OcrError codes', async () => {
    mockFetch(async () => ({ status: 403, body: 'You may only perform this action upto maximum 500 number of times within 86400 seconds' }));
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2 }))).toBe('quota');

    mockFetch(json(200, { OCRExitCode: 3, IsErroredOnProcessing: true, ErrorMessage: ['E101: Timed out waiting for results'] }));
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2 }))).toBe('timeout');

    mockFetch(json(200, { ParsedResults: [{ ParsedText: '' }], OCRExitCode: 1, IsErroredOnProcessing: false }));
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2 }))).toBe('no_text');

    mockFetch(async () => ({ status: 200, body: '<html>gateway</html>' }));
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2 }))).toBe('unknown');

    mockFetch(() => Promise.reject(new TypeError('Network request failed')));
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2 }))).toBe('network');

    expect(await codeOf(recognizeText('', { apiKey: '', engine: 2 }))).toBe('unknown');
  });

  it('stops when the caller aborts', async () => {
    mockFetch(
      ({ init }) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const controller = new AbortController();
    const pending = recognizeText('QUJD', { apiKey: '', engine: 2, signal: controller.signal });
    controller.abort();
    expect(await codeOf(pending)).toBe('unknown');
    expect(calls[0].init.signal).toBeDefined();

    const already = new AbortController();
    already.abort();
    expect(await codeOf(recognizeText('QUJD', { apiKey: '', engine: 2, signal: already.signal }))).toBe('unknown');
  });
});
