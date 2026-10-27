// Labels and icons for payment methods (pure; shared by settle up, payment detail and the friend timeline).
import type { PaymentMethod } from '../../types';

export interface PaymentMethodInfo {
  value: PaymentMethod;
  /** Short chip label. */
  label: string;
  /** Longer label for details. */
  longLabel: string;
  /** Ionicons glyph. */
  icon: string;
}

export const PAYMENT_METHODS: PaymentMethodInfo[] = [
  { value: 'cash', label: 'Cash', longLabel: 'Cash', icon: 'cash-outline' },
  { value: 'upi', label: 'UPI', longLabel: 'UPI', icon: 'phone-portrait-outline' },
  { value: 'bank', label: 'Bank', longLabel: 'Bank transfer', icon: 'business-outline' },
  { value: 'other', label: 'Other', longLabel: 'Other', icon: 'ellipsis-horizontal' },
];

export function paymentMethodInfo(method: PaymentMethod): PaymentMethodInfo {
  return PAYMENT_METHODS.find((m) => m.value === method) ?? PAYMENT_METHODS[PAYMENT_METHODS.length - 1];
}
