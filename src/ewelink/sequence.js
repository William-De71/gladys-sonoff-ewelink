// eWeLink matches answers to requests by `sequence`, a millisecond timestamp:
// two commands sent within the same millisecond must not share one.
let last = 0;

/**
 * @returns {string} A strictly increasing millisecond timestamp.
 */
export function nextSequence() {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return String(last);
}
