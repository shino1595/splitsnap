import {
  imageExtensionOf,
  isKeptUri,
  keptName,
  keptUriFor,
  newKeptFileName,
  safeFileName,
  unusedKeptNames,
  utiFor,
} from '../../app/src/ui/receiptNames';

describe('kept uris', () => {
  it('recognises kept://receipts/<name> and nothing else', () => {
    expect(isKeptUri('kept://receipts/receipt-1-abc.jpg')).toBe(true);
    expect(isKeptUri('file:///data/cache/a.jpg')).toBe(false);
    expect(isKeptUri('kept://other/a.jpg')).toBe(false);
    expect(isKeptUri('kept://receipts/')).toBe(false);
    expect(isKeptUri(undefined)).toBe(false);
    expect(isKeptUri('')).toBe(false);
  });

  it('reads the file name and rejects path tricks', () => {
    expect(keptName('kept://receipts/receipt-1-abc.jpg')).toBe('receipt-1-abc.jpg');
    expect(keptName('kept://receipts/../secret.jpg')).toBeNull();
    expect(keptName('kept://receipts/a/b.jpg')).toBeNull();
    expect(keptName('kept://receipts/..')).toBeNull();
    expect(keptName('https://example.com/a.jpg')).toBeNull();
  });

  it('builds a uri from a name', () => {
    expect(keptUriFor('receipt-1-abc.jpg')).toBe('kept://receipts/receipt-1-abc.jpg');
    expect(keptName(keptUriFor('receipt-1-abc.jpg'))).toBe('receipt-1-abc.jpg');
  });
});

describe('newKeptFileName', () => {
  it('keeps a known image extension, lower-cased, ignoring the query', () => {
    expect(imageExtensionOf('file:///cache/ImagePicker/IMG_0001.PNG')).toBe('png');
    expect(imageExtensionOf('content://media/external/images/12.heic?x=1.jpg')).toBe('heic');
    expect(imageExtensionOf('file:///cache/photo.tar.gz')).toBe('jpg');
    expect(imageExtensionOf('content://media/external/images/12')).toBe('jpg');
    expect(imageExtensionOf('file:///dir.png/photo')).toBe('jpg');
  });

  it('is receipt-<time>-<random>.<ext> and differs with the random part', () => {
    const a = newKeptFileName('file:///a/b.webp', 1700000000000, 0.123456);
    const b = newKeptFileName('file:///a/b.webp', 1700000000000, 0.654321);
    expect(a).toMatch(/^receipt-1700000000000-[a-z0-9]{6}\.webp$/);
    expect(a).not.toBe(b);
    expect(newKeptFileName('file:///a/b', 5, 0)).toBe('receipt-5-000000.jpg');
    expect(newKeptFileName('file:///a/b', 5, 1)).toMatch(/^receipt-5-[a-z0-9]{6}\.jpg$/);
  });

  it('makes names that count as ours when sweeping', () => {
    const name = newKeptFileName('file:///a/b.jpg', Date.now(), 0.5);
    expect(unusedKeptNames([name], [])).toEqual([name]);
  });
});

describe('unusedKeptNames', () => {
  const a = 'receipt-1-aaaaaa.jpg';
  const b = 'receipt-2-bbbbbb.png';

  it('lists names no uri refers to', () => {
    expect(unusedKeptNames([a, b], [keptUriFor(a)])).toEqual([b]);
    expect(unusedKeptNames([a, b], [keptUriFor(a), keptUriFor(b)])).toEqual([]);
  });

  it('ignores uris that are not kept ones', () => {
    expect(unusedKeptNames([a], ['file:///x/receipt-1-aaaaaa.jpg', 'data:image/png;base64,AAAA'])).toEqual([a]);
  });

  it('never lists files it did not create', () => {
    expect(unusedKeptNames(['notes.txt', '.nomedia', a], [])).toEqual([a]);
  });
});

describe('safeFileName and utiFor', () => {
  it('replaces characters that break file names', () => {
    expect(safeFileName('Trip: 2026/11?.csv')).toBe('Trip_ 2026_11_.csv');
    expect(safeFileName('splitsnap-backup.json')).toBe('splitsnap-backup.json');
    expect(safeFileName('..')).toBe('file.txt');
    expect(safeFileName('   ')).toBe('file.txt');
  });

  it('maps mime types to share-sheet types', () => {
    expect(utiFor('text/csv;charset=utf-8')).toBe('public.comma-separated-values-text');
    expect(utiFor('application/json')).toBe('public.json');
    expect(utiFor('text/plain')).toBe('public.plain-text');
  });
});
