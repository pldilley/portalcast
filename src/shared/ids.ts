/**
 * Credential generation and the pairing payload codec. Plan §6.1, §6.2.
 *
 * Two rules this module exists to enforce:
 *
 *  1. **No UUIDs.** Ids are 16 raw bytes from `getRandomValues`. That is 128 bits
 *     against UUID v4's 122 (six bits are fixed version/variant markers), it is
 *     shorter to encode, and `getRandomValues` is supported far more widely than
 *     `crypto.randomUUID` — which matters on old TV browsers. Never reach for
 *     `randomUUID`; the field is called `roomId`, not `roomUuid`, for this reason.
 *
 *  2. **The scanned payload is binary, not JSON.** It is read by a laptop webcam
 *     off a glossy TV panel from across a room, so every character costs module
 *     size. Binary + no TV name takes the QR from 73×73 to 53×53 modules at the
 *     highest error correction — 37% larger modules on screen. See context §14.3b.
 */

export const PAYLOAD_VERSION = 1

const ID_BYTES = 16
const KEY_BYTES = 32

export interface RoomCredentials {
  /** 16 random bytes, base64url. Trystero's room id. */
  roomId: string
  /** 32 random bytes, base64url. Trystero's room password. */
  password: string
}

/** A pairing payload. `name` is present only in the permanent (bookmarked) form. */
export interface PairPayload extends RoomCredentials {
  version: number
  name?: string
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  // `crypto` is required — there is no safe fallback. Math.random() is predictable,
  // and a guessable password lets anyone join the room. Fail loudly instead.
  const c = globalThis.crypto
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable; cannot generate credentials safely')
  }
  c.getRandomValues(out)
  return out
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const raw = atob(b64 + pad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Mint a fresh room id and password. Used for both ephemeral and permanent rooms. */
export function mintCredentials(): RoomCredentials {
  return {
    roomId: toBase64Url(randomBytes(ID_BYTES)),
    password: toBase64Url(randomBytes(KEY_BYTES)),
  }
}

/**
 * Encode a payload for a URL fragment.
 *
 * Ephemeral (scanned, no name): 1 + 16 + 32 = 49 bytes → 66 base64url chars.
 * Permanent (bookmarked, with name): the above, plus a length byte and UTF-8 name.
 */
export function encodePayload(p: PairPayload): string {
  const id = fromBase64Url(p.roomId)
  const key = fromBase64Url(p.password)
  if (id.length !== ID_BYTES) throw new Error(`roomId must be ${ID_BYTES} bytes, got ${id.length}`)
  if (key.length !== KEY_BYTES) throw new Error(`password must be ${KEY_BYTES} bytes, got ${key.length}`)

  const nameBytes = p.name === undefined ? null : new TextEncoder().encode(p.name)
  if (nameBytes && nameBytes.length > 255) {
    throw new Error('name must encode to 255 bytes or fewer')
  }

  const size = 1 + ID_BYTES + KEY_BYTES + (nameBytes ? 1 + nameBytes.length : 0)
  const out = new Uint8Array(size)
  out[0] = p.version
  out.set(id, 1)
  out.set(key, 1 + ID_BYTES)
  if (nameBytes) {
    out[1 + ID_BYTES + KEY_BYTES] = nameBytes.length
    out.set(nameBytes, 2 + ID_BYTES + KEY_BYTES)
  }
  return toBase64Url(out)
}

/**
 * Decode a fragment payload. Throws with a human-readable reason on anything
 * malformed — a truncated paste must fail loudly and immediately, not turn into
 * a silent "waiting for peer…" that nobody can diagnose. Plan §6.4.
 */
export function decodePayload(fragment: string): PairPayload {
  const cleaned = fragment.replace(/^#/, '').trim()
  if (!cleaned) throw new Error('That code is empty.')

  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(cleaned)
  } catch {
    throw new Error('That code contains characters we did not expect — it may have been altered in transit.')
  }

  const min = 1 + ID_BYTES + KEY_BYTES
  if (bytes.length < min) {
    throw new Error('That code looks incomplete — it may have been cut short when it was copied.')
  }

  const version = bytes[0]!
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`That code was made by a different version of PortalCast (version ${version}).`)
  }

  const payload: PairPayload = {
    version,
    roomId: toBase64Url(bytes.subarray(1, 1 + ID_BYTES)),
    password: toBase64Url(bytes.subarray(1 + ID_BYTES, min)),
  }

  if (bytes.length > min) {
    const len = bytes[min]!
    const start = min + 1
    if (bytes.length < start + len) {
      throw new Error('That code looks incomplete — the device name was cut short.')
    }
    payload.name = new TextDecoder().decode(bytes.subarray(start, start + len))
  }

  return payload
}
