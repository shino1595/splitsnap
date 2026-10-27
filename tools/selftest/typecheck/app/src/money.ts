export function formatRupees(minor: number): string {
  return '₹' + (minor / 100).toFixed(2);
}
