// "Pay via UPI": open the payee's UPI app, wait until the user is back, then ask
// whether the payment went through so it can be recorded.
import { AppState as AppLifecycle, Platform } from 'react-native';
import type { CurrencyCode, Minor, Person } from '../../types';
import { formatMoney } from '../../lib/money';
import { confirmAsync, openUpiPayment } from '../../ui';

export type UpiOutcome = 'paid' | 'not_paid' | 'unavailable';

/** True when a "Pay via UPI" button makes sense for paying `payee`. */
export function canPayByUpi(payee: Person | undefined, currency: CurrencyCode, amount: Minor | null): boolean {
  return !!payee && !!payee.upiId && payee.upiId.trim() !== '' && currency.toUpperCase() === 'INR' && amount !== null && amount > 0;
}

/**
 * Resolves when the app is in the foreground again after leaving it. If it never leaves
 * within `graceMs` (web, or a UPI app that opened in a pop-over) it resolves anyway.
 */
function waitUntilBack(graceMs = 1500, maxMs = 15 * 60 * 1000): Promise<void> {
  return new Promise((resolve) => {
    let left = AppLifecycle.currentState !== 'active';
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const sub = AppLifecycle.addEventListener('change', (status) => {
      if (status !== 'active') left = true;
      else if (left) finish();
    });
    function finish() {
      if (finished) return;
      finished = true;
      sub.remove();
      timers.forEach(clearTimeout);
      resolve();
    }
    timers.push(setTimeout(() => (left ? undefined : finish()), graceMs));
    timers.push(setTimeout(finish, maxMs));
  });
}

/** Text for when no UPI app could be opened (always on web): pay by hand, then record it. */
export function upiFallbackText(args: { payeeName: string; upiId: string; amount: Minor; currency: CurrencyCode; web: boolean }): {
  title: string;
  message: string;
} {
  const money = formatMoney(args.amount, args.currency);
  const why = args.web ? 'UPI apps can only be opened from SplitSnap on a phone.' : 'No UPI app could be opened on this phone.';
  return {
    title: 'Pay in your UPI app',
    message: `${why} Send ${money} to ${args.upiId} (${args.payeeName}) from your UPI app. Once it has gone through, record it here so your balances stay right.`,
  };
}

/**
 * Opens the UPI app pre-filled, then asks 'Did the payment go through?'. When no UPI app
 * opens (web, or none installed) it explains how to pay by hand and offers to record it.
 */
export async function payByUpi(args: { payee: Person; amount: Minor; currency: CurrencyCode; note: string }): Promise<UpiOutcome> {
  const { payee, amount, currency } = args;
  const upiId = (payee.upiId ?? '').trim();
  const money = formatMoney(amount, currency);
  const opened = await openUpiPayment({ upiId, name: payee.name, amount, currency, note: args.note });
  if (!opened) {
    const text = upiFallbackText({ payeeName: payee.name, upiId, amount, currency, web: Platform.OS === 'web' });
    const record = await confirmAsync(text.title, text.message, { confirmText: 'Record payment', cancelText: 'Not now' });
    return record ? 'paid' : 'unavailable';
  }
  await waitUntilBack();
  const paid = await confirmAsync('Did the payment go through?', `Record ${money} paid to ${payee.name} via UPI.`, {
    confirmText: 'Yes, record it',
    cancelText: 'No',
  });
  return paid ? 'paid' : 'not_paid';
}
