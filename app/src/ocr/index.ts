// Bill scanning: photo → ≤ 1 MB JPEG → OCR.space → our receipt parser → itemized bill.
import type { CurrencyCode, OcrEngine } from '../types';
import { receiptFromOcr } from './bill';
import { prepareImageForOcr } from './imagePrep';
import { recognizeText } from './ocrSpace';
import { OcrError, type OcrResult, type ParsedReceipt } from './types';

export * from './types';
export { buildRows } from './lineBuilder';
export { extractNumbers, normalizeLine, parseReceipt } from './receiptParser';
export { OCR_SPACE_DEMO_KEY, recognizeText } from './ocrSpace';
export { prepareImageForOcr } from './imagePrep';
export { SAMPLE_BILL_ROWS } from './sampleBill';
export { receiptFromOcr, receiptToBill, sampleReceipt } from './bill';

export type ScanStage = 'preparing' | 'uploading' | 'parsing';

/** Full pipeline for one photo. onStage reports 'preparing' | 'uploading' | 'parsing'. */
export async function scanBill(
  uri: string,
  opts: {
    apiKey: string;
    engine: OcrEngine;
    currencyHint: CurrencyCode;
    size?: { width: number; height: number };
    onStage?: (s: ScanStage) => void;
    signal?: AbortSignal;
  },
): Promise<{ receipt: ParsedReceipt; ocr: OcrResult }> {
  const stage = (s: ScanStage) => {
    try {
      opts.onStage?.(s);
    } catch {
      // A failing progress callback must not break the scan.
    }
  };
  const checkCancelled = () => {
    if (opts.signal?.aborted) throw new OcrError('unknown', 'The scan was cancelled.');
  };

  stage('preparing');
  const image = await prepareImageForOcr(uri, opts.size);
  checkCancelled();

  stage('uploading');
  const ocr = await recognizeText(image.base64, { apiKey: opts.apiKey, engine: opts.engine, signal: opts.signal });
  checkCancelled();

  stage('parsing');
  const receipt = receiptFromOcr(ocr, opts.currencyHint);
  return { receipt, ocr };
}
