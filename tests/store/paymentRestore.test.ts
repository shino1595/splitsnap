import { myGroupBalance } from '../../app/src/store/selectors';
import { TRIP, T0, makeState, payment, run, stamp } from './fixtures';

const T1 = '2026-10-02T10:00:00.000Z';
const T2 = '2026-10-02T10:00:05.000Z';

describe('payment/restore (Undo after deleting a payment)', () => {
  it('brings the payment and the balances back and logs it as a payment', () => {
    const paid = run(makeState(), { type: 'payment/add', id: 'pay1', input: payment(), ...stamp(T0) });
    const deleted = run(paid, { type: 'payment/delete', id: 'pay1', ...stamp(T1) });
    const restored = run(deleted, { type: 'payment/restore', id: 'pay1', ...stamp(T2) });
    expect(restored.payments.pay1.deletedAt).toBeUndefined();
    expect(myGroupBalance(restored, TRIP)).toEqual(myGroupBalance(paid, TRIP));
    expect(myGroupBalance(deleted, TRIP)).not.toEqual(myGroupBalance(paid, TRIP));
    expect(restored.activity[0].type).toBe('payment_added');
    expect(restored.activity[0].paymentId).toBe('pay1');
    expect(restored.activity[0].summary).toContain('restored a payment');
  });

  it('does nothing for a payment that is not deleted or does not exist', () => {
    const paid = run(makeState(), { type: 'payment/add', id: 'pay1', input: payment(), ...stamp(T0) });
    expect(run(paid, { type: 'payment/restore', id: 'pay1', ...stamp(T1) })).toBe(paid);
    expect(run(paid, { type: 'payment/restore', id: 'ghost', ...stamp(T1) })).toBe(paid);
  });
});
