import type { ID } from '../types';

let lastTime = 0;
let sequence = 0;

/** e.g. 'exp_lq3k9x_4f2a' (base-36 time + random). A per-millisecond counter keeps ids
 *  created in the same millisecond unique even if the random part collides. */
export function newId(prefix: string): ID {
  const now = Date.now();
  if (now === lastTime) {
    sequence += 1;
  } else {
    lastTime = now;
    sequence = 0;
  }
  let random = Math.floor(Math.random() * 1679616).toString(36); // 36^4
  while (random.length < 4) random = '0' + random;
  const seq = sequence > 0 ? sequence.toString(36) : '';
  const head = prefix ? `${prefix}_` : '';
  return `${head}${now.toString(36)}_${random}${seq}`;
}
