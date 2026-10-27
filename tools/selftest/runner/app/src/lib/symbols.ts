export type Money = { minor: number; currency: string };

export const SYMBOLS: Record<string, string> = { INR: '₹', EUR: '€', GBP: '£', USD: '$' };

export const enum Kind {
  Item = 'item',
  Tax = 'tax',
}

export function kindLabel(k: Kind): string {
  return k === Kind.Item ? 'Item' : 'Tax';
}
