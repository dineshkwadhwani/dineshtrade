// AES-256-GCM encryption for broker credentials (API keys, secrets, access
// tokens) before they're stored in Supabase, and decryption after read back.
// Node.js built-in `crypto` only — no external dependencies. SERVER-ONLY: this
// module must never run in a browser context. ENCRYPTION_KEY has no
// NEXT_PUBLIC_ prefix so it would just be `undefined` there anyway, but the
// guard below fails loudly instead of quietly producing garbage.

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32 // AES-256 key length
const IV_BYTES = 12 // recommended IV length for GCM (96 bits)
const AUTH_TAG_BYTES = 16 // GCM auth tag length (128 bits)

let cachedKey: Buffer | null = null

// Validates and decodes ENCRYPTION_KEY once, caches the result. Throws
// immediately and clearly if the env var is missing, the wrong length, or
// not valid hex — never silently derives a weaker/shorter key.
function getKey(): Buffer {
  if (typeof window !== 'undefined') {
    throw new Error('[lib/encryption] must never run in a browser context.')
  }
  if (cachedKey) return cachedKey

  const hex = process.env.ENCRYPTION_KEY
  if (!hex) {
    throw new Error('[lib/encryption] Missing required env var: ENCRYPTION_KEY')
  }
  const expectedHexLen = KEY_BYTES * 2
  if (hex.length !== expectedHexLen || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(
      `[lib/encryption] ENCRYPTION_KEY must be a ${expectedHexLen}-character hex string ` +
        `encoding exactly ${KEY_BYTES} bytes — got ${hex.length} character(s).`
    )
  }

  cachedKey = Buffer.from(hex, 'hex')
  return cachedKey
}

// Encrypts `plaintext`, returning a single base64 string that packs together
// [IV (12 bytes)] + [auth tag (16 bytes)] + [ciphertext]. A fresh random IV is
// generated on every call — the same key is never reused with a repeated IV.
export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

// Reverses encrypt(): unpacks IV + auth tag + ciphertext from the base64
// string and returns the original plaintext. Throws if the auth tag doesn't
// match (wrong key, or the ciphertext was tampered with / corrupted).
export function decrypt(ciphertext: string): string {
  const key = getKey()
  const combined = Buffer.from(ciphertext, 'base64')

  if (combined.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('[lib/encryption] ciphertext is too short to contain an IV and auth tag')
  }

  const iv = combined.subarray(0, IV_BYTES)
  const authTag = combined.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
  const encrypted = combined.subarray(IV_BYTES + AUTH_TAG_BYTES)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return plaintext.toString('utf8')
}

// ---------------------------------------------------------------------------
// Self-test — commented out. To run manually:
//   1. Uncomment the block below
//   2. Ensure ENCRYPTION_KEY is set (32-byte hex string) in your shell env
//   3. npx tsx lib/encryption.ts   (or compile + node)
// ---------------------------------------------------------------------------
// const original = 'test-api-key-12345'
// const encrypted = encrypt(original)
// const decrypted = decrypt(encrypted)
// console.log('original: ', original)
// console.log('encrypted:', encrypted)
// console.log('decrypted:', decrypted)
// console.log('round-trip OK:', decrypted === original)
