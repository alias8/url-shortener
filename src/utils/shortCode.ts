// Derives a short_url code from a Url's (bigint, autoincrementing) id.
//
// The old scheme hashed the long url with md5 and took 6 hex chars — only 16^6 (~16.7M)
// possible codes, so it was guaranteed to start colliding well before reaching anywhere near
// 1B urls, and the collision-retry loop in createUrl.ts would eventually fail outright.
//
// Encoding the id directly would be collision-free but makes urls sequentially enumerable
// (short.ly/1, short.ly/2, ...). Instead we run the id through a bijective mix (multiplication
// by an odd constant mod 2^40, which is invertible since gcd(odd, 2^k) = 1) before base62
// encoding. This is still a 1:1 mapping — zero collisions possible — but doesn't leak
// insertion order. 2^40 (~1.1 trillion) gives 1B ids ~1000x headroom.
const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BITS = 40n;
const MODULUS = 1n << BITS;
const CODE_WIDTH = 7; // 62^7 > 2^40, so the mixed value always fits in 7 base62 chars

const MULTIPLIER = (0x9e3779b97f4a7c15n % MODULUS) | 1n; // masked into range, forced odd
const MULTIPLIER_INVERSE = modInverse(MULTIPLIER, MODULUS);

export function encodeId(id: bigint): string {
  if (id < 0n) throw new Error(`id must be non-negative, got ${id}`);
  // Picture MODULUS as a clock face with 2^40 positions. Each id takes one step of size
  // MULTIPLIER around it (id=1 lands at MULTIPLIER, id=2 at 2*MULTIPLIER mod MODULUS, ...).
  // Since MULTIPLIER is odd and MODULUS is a power of 2 (gcd = 1), that step size visits every
  // position exactly once per lap before repeating — hence the bijection / no collisions.
  const mixed = (id * MULTIPLIER) % MODULUS;
  return toBase62(mixed).padStart(CODE_WIDTH, '0');
}

export function decodeId(code: string): bigint {
  const mixed = fromBase62(code);
  return (mixed * MULTIPLIER_INVERSE) % MODULUS;
}

function toBase62(n: bigint): string {
  if (n === 0n) return '0';
  let result = '';
  let cur = n;
  while (cur > 0n) {
    result = BASE62_ALPHABET[Number(cur % 62n)] + result;
    cur /= 62n;
  }
  return result;
}

function fromBase62(code: string): bigint {
  let result = 0n;
  for (const ch of code) {
    const idx = BASE62_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base62 character: ${ch}`);
    result = result * 62n + BigInt(idx);
  }
  return result;
}

// Extended Euclidean algorithm — works for any modulus, not just primes.
function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  return ((oldS % m) + m) % m;
}
