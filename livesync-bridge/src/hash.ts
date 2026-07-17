const MASK_64 = (1n << 64n) - 1n;
const PRIME_1 = 11_400_714_785_074_694_791n;
const PRIME_2 = 14_029_467_366_897_019_727n;
const PRIME_3 = 1_609_587_929_392_839_161n;
const PRIME_4 = 9_650_029_242_287_828_579n;
const PRIME_5 = 2_870_177_450_012_600_261n;

function u64(value: bigint): bigint {
  return value & MASK_64;
}

function rotateLeft(value: bigint, bits: bigint): bigint {
  return u64((value << bits) | (value >> (64n - bits)));
}

function readU32LE(bytes: Uint8Array, offset: number): bigint {
  return (
    BigInt(bytes[offset]!) |
    (BigInt(bytes[offset + 1]!) << 8n) |
    (BigInt(bytes[offset + 2]!) << 16n) |
    (BigInt(bytes[offset + 3]!) << 24n)
  );
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  return readU32LE(bytes, offset) | (readU32LE(bytes, offset + 4) << 32n);
}

function round(accumulator: bigint, lane: bigint): bigint {
  let value = u64(accumulator + u64(lane * PRIME_2));
  value = rotateLeft(value, 31n);
  return u64(value * PRIME_1);
}

function mergeRound(accumulator: bigint, lane: bigint): bigint {
  let value = accumulator ^ round(0n, lane);
  value = u64(value * PRIME_1 + PRIME_4);
  return value;
}

export function xxhash64(input: string, seed = 0n): bigint {
  const bytes = new TextEncoder().encode(input);
  const length = bytes.byteLength;
  let offset = 0;
  let hash: bigint;

  if (length >= 32) {
    let v1 = u64(seed + PRIME_1 + PRIME_2);
    let v2 = u64(seed + PRIME_2);
    let v3 = u64(seed);
    let v4 = u64(seed - PRIME_1);
    const limit = length - 32;

    while (offset <= limit) {
      v1 = round(v1, readU64LE(bytes, offset));
      offset += 8;
      v2 = round(v2, readU64LE(bytes, offset));
      offset += 8;
      v3 = round(v3, readU64LE(bytes, offset));
      offset += 8;
      v4 = round(v4, readU64LE(bytes, offset));
      offset += 8;
    }

    hash = u64(
      rotateLeft(v1, 1n) +
        rotateLeft(v2, 7n) +
        rotateLeft(v3, 12n) +
        rotateLeft(v4, 18n),
    );
    hash = mergeRound(hash, v1);
    hash = mergeRound(hash, v2);
    hash = mergeRound(hash, v3);
    hash = mergeRound(hash, v4);
  } else {
    hash = u64(seed + PRIME_5);
  }

  hash = u64(hash + BigInt(length));

  while (offset + 8 <= length) {
    const lane = round(0n, readU64LE(bytes, offset));
    hash ^= lane;
    hash = u64(rotateLeft(hash, 27n) * PRIME_1 + PRIME_4);
    offset += 8;
  }

  if (offset + 4 <= length) {
    hash ^= u64(readU32LE(bytes, offset) * PRIME_1);
    hash = u64(rotateLeft(hash, 23n) * PRIME_2 + PRIME_3);
    offset += 4;
  }

  while (offset < length) {
    hash ^= u64(BigInt(bytes[offset]!) * PRIME_5);
    hash = u64(rotateLeft(hash, 11n) * PRIME_1);
    offset += 1;
  }

  hash ^= hash >> 33n;
  hash = u64(hash * PRIME_2);
  hash ^= hash >> 29n;
  hash = u64(hash * PRIME_3);
  hash ^= hash >> 32n;
  return u64(hash);
}

function mixedHash(source: string): [number, number] {
  const epochFnv1a = 2_166_136_261;
  const c1 = 3_432_918_353;
  const c2 = 461_845_907;
  const r1 = 15;
  const r2 = 13;
  const multiplier = 5;
  const addition = 3_864_292_196;
  let murmur = 1;
  let fnv = epochFnv1a;

  for (let index = 0; index < source.length; index += 1) {
    let code = source.charCodeAt(index);
    fnv ^= code;
    fnv = Math.imul(fnv, 16_777_619) >>> 0;
    code *= c1;
    code = (code << r1) | (code >>> (32 - r1));
    code *= c2;
    murmur ^= code;
    murmur = (murmur << r2) | (murmur >>> (32 - r2));
    murmur = murmur * multiplier + addition;
  }

  murmur ^= source.length;
  murmur ^= murmur >>> 16;
  murmur = Math.imul(murmur, 2_246_822_507);
  murmur ^= murmur >>> 13;
  murmur = Math.imul(murmur, 3_266_489_909);
  murmur ^= murmur >>> 16;
  return [murmur >>> 0, fnv];
}

export function fallbackMixedHashEach(source: string): string {
  const decorated = `${source.length}${source}`;
  const [murmur, fnv] = mixedHash(decorated);
  return `${murmur.toString(36)}${fnv.toString(36)}`;
}

export function liveSyncChunkId(content: string, passphrase: string): string {
  // LiveSync deliberately hashes only this prefix of the passphrase. It is a
  // compatibility identifier, not a password verifier or security digest.
  // Changing it would make Bridge-generated chunk IDs differ from Obsidian's.
  const usingLetters = Math.trunc((passphrase.length / 4) * 3);
  const passphraseForHash =
    "a83hrf7f\u0003y7sa8g31" + passphrase.substring(0, usingLetters);
  const hashedPassphrase = fallbackMixedHashEach(passphraseForHash);
  const hashInput = `${content}-${hashedPassphrase}-${content.length}`;
  return `h:+${xxhash64(hashInput).toString(36)}`;
}
