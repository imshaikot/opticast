import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2, pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { fromBase64, toBase64, toHex } from './bytes.js';
import type { EncryptionInfo } from './types.js';

export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const KEY_BYTES = 32;

/** Tuned for a ~1s pure-JS derivation on a mid-range phone. */
export const DEFAULT_PBKDF2_ITERATIONS = 150_000;

/** Thrown when AES-GCM authentication fails, which almost always means a bad PIN. */
export class WrongPinError extends Error {
  constructor(message = 'Incorrect PIN, or the data was damaged in transit') {
    super(message);
    this.name = 'WrongPinError';
  }
}

export function randomBytes(length: number): Uint8Array {
  const webcrypto = globalThis.crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error('No secure random source available in this runtime');
  }
  return webcrypto.getRandomValues(new Uint8Array(length));
}

export function sha256Hex(data: Uint8Array): string {
  return toHex(sha256(data));
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function deriveKey(pin: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: iterations, dkLen: KEY_BYTES });
}

/** Yields to the event loop between blocks, keeping the scanner's UI responsive. */
export function deriveKeyAsync(
  pin: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  return pbkdf2Async(sha256, pin, salt, { c: iterations, dkLen: KEY_BYTES });
}

export interface EncryptResult {
  /** Ciphertext with the 16-byte GCM tag appended. */
  ciphertext: Uint8Array;
  info: EncryptionInfo;
}

export async function encryptWithPin(
  plaintext: Uint8Array,
  pin: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS
): Promise<EncryptResult> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKeyAsync(pin, salt, iterations);
  const ciphertext = gcm(key, iv).encrypt(plaintext);
  return {
    ciphertext,
    info: {
      alg: 'AES-256-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
    },
  };
}

export async function decryptWithPin(
  ciphertext: Uint8Array,
  pin: string,
  info: EncryptionInfo
): Promise<Uint8Array> {
  const salt = fromBase64(info.salt);
  const iv = fromBase64(info.iv);
  const key = await deriveKeyAsync(pin, salt, info.iterations);
  try {
    return gcm(key, iv).decrypt(ciphertext);
  } catch {
    throw new WrongPinError();
  }
}
