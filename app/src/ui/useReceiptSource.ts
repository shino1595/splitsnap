import * as React from 'react';
import { resolveReceiptUri } from './files';
import { KEPT_SCHEME } from './receiptNames';

export interface ReceiptSource {
  /** What an <Image> can show; null while a kept photo is being looked up, or when it is missing. */
  uri: string | null;
  /** True once we know the photo can't be shown on this phone. */
  missing: boolean;
}

/** Turns an Expense.receiptUri into something an <Image> can show (kept:// uris are looked up in the app's folder). */
export function useReceiptSource(uri: string): ReceiptSource {
  const kept = uri.startsWith(KEPT_SCHEME);
  const [resolved, setResolved] = React.useState<{ source: string; uri: string | null } | null>(null);

  React.useEffect(() => {
    if (!kept) return undefined;
    let cancelled = false;
    void resolveReceiptUri(uri).then((result) => {
      if (!cancelled) setResolved({ source: uri, uri: result });
    });
    return () => {
      cancelled = true;
    };
  }, [uri, kept]);

  if (!kept) return { uri, missing: false };
  if (!resolved || resolved.source !== uri) return { uri: null, missing: false };
  return { uri: resolved.uri, missing: resolved.uri === null };
}
