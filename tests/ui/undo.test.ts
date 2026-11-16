import { currentUndo, dismissUndo, runUndo, showUndo, subscribeUndo } from '../../app/src/ui/undo';

describe('undo bar store', () => {
  beforeEach(() => dismissUndo());

  it('shows a notice and tells listeners', () => {
    const seen: (string | null)[] = [];
    const stop = subscribeUndo((n) => seen.push(n ? n.message : null));
    showUndo('Payment deleted', () => undefined);
    expect(currentUndo()!.message).toBe('Payment deleted');
    expect(currentUndo()!.undoLabel).toBe('Undo');
    dismissUndo();
    stop();
    showUndo('Later', () => undefined);
    expect(seen).toEqual(['Payment deleted', null]);
  });

  it('replaces the current notice with a newer one', () => {
    let first = 0;
    showUndo('One', () => { first += 1; });
    showUndo('Two', () => undefined);
    expect(currentUndo()!.message).toBe('Two');
    runUndo();
    expect(first).toBe(0);
  });

  it('runs the undo once and hides the bar', () => {
    let calls = 0;
    showUndo('Gone', () => { calls += 1; });
    runUndo();
    runUndo();
    expect(calls).toBe(1);
    expect(currentUndo()).toBeNull();
  });

  it('dismisses without undoing', () => {
    let calls = 0;
    showUndo('Gone', () => { calls += 1; });
    dismissUndo();
    expect(calls).toBe(0);
    expect(currentUndo()).toBeNull();
  });
});
