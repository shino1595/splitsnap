// Display helpers for amount strings. Pure (no React / React Native) so they can be unit-tested.

/**
 * '₹500.00 + $12.00' for display: a non-breaking space ties each '+' to the amount after it,
 * so a narrow line breaks as '₹500.00 / + $12.00' and never leaves a '+' dangling at a line end.
 */
export function wrapFriendlyAmounts(text: string): string {
  return text.replace(/ \+ /g, ' + ');
}
