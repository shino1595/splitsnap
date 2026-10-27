// DELIBERATE contract violation: path aliases are not allowed (expects SPLITSNAP1 + TS2307 on line 2).
import { formatRupees } from '@/money';

export const sample = formatRupees(100);
