// Keccak-256 (the pre-NIST padding Ethereum uses), for event topics and the
// v4 pool id. Lanes are split into 32-bit halves so it runs without BigInt.
// Checked against viem's keccak256 in test/chain.test.js.

const RC = [
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000,
  0x0000808b, 0x00000000, 0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000,
  0x0000008a, 0x00000000, 0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000,
  0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000,
  0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000,
  0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const PI = [0, 10, 20, 5, 15, 16, 1, 11, 21, 6, 7, 17, 2, 12, 22, 23, 8, 18, 3, 13, 14, 24, 9, 19, 4];

function f1600(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      c[x * 2] = s[x * 2] ^ s[x * 2 + 10] ^ s[x * 2 + 20] ^ s[x * 2 + 30] ^ s[x * 2 + 40];
      c[x * 2 + 1] = s[x * 2 + 1] ^ s[x * 2 + 11] ^ s[x * 2 + 21] ^ s[x * 2 + 31] ^ s[x * 2 + 41];
    }
    for (let x = 0; x < 5; x++) {
      const nx = ((x + 1) % 5) * 2;
      const px = ((x + 4) % 5) * 2;
      const lo = c[px] ^ ((c[nx] << 1) | (c[nx + 1] >>> 31));
      const hi = c[px + 1] ^ ((c[nx + 1] << 1) | (c[nx] >>> 31));
      for (let y = 0; y < 25; y += 5) {
        s[(y + x) * 2] ^= lo;
        s[(y + x) * 2 + 1] ^= hi;
      }
    }
    for (let i = 0; i < 25; i++) {
      const r = ROT[i];
      const lo = s[i * 2];
      const hi = s[i * 2 + 1];
      let nlo, nhi;
      if (r === 0) { nlo = lo; nhi = hi; }
      else if (r < 32) { nlo = (lo << r) | (hi >>> (32 - r)); nhi = (hi << r) | (lo >>> (32 - r)); }
      else if (r === 32) { nlo = hi; nhi = lo; }
      else { const q = r - 32; nlo = (hi << q) | (lo >>> (32 - q)); nhi = (lo << q) | (hi >>> (32 - q)); }
      b[PI[i] * 2] = nlo;
      b[PI[i] * 2 + 1] = nhi;
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = (y + x) * 2;
        const j = (y + ((x + 1) % 5)) * 2;
        const k = (y + ((x + 2) % 5)) * 2;
        s[i] = b[i] ^ (~b[j] & b[k]);
        s[i + 1] = b[i + 1] ^ (~b[j + 1] & b[k + 1]);
      }
    }
    s[0] ^= RC[round * 2];
    s[1] ^= RC[round * 2 + 1];
  }
}

/** keccak256 of bytes (Uint8Array) -> Uint8Array(32). */
export function keccak256Bytes(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Uint32Array(50);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const p = off + i * 4;
      s[i] ^= padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
    }
    f1600(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = s[i] & 0xff;
    out[i * 4 + 1] = (s[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (s[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (s[i] >>> 24) & 0xff;
  }
  return out;
}

export function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** keccak256 of a 0x hex string -> 0x hex string. */
export const keccak256 = (hex) => bytesToHex(keccak256Bytes(hexToBytes(hex)));

/** keccak256 of a UTF-8 string, e.g. an event signature. */
export const keccakText = (text) => bytesToHex(keccak256Bytes(new TextEncoder().encode(text)));
