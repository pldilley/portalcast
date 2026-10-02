import { describe, expect, it } from 'vitest'
import {
  PAYLOAD_VERSION,
  decodePayload,
  encodePayload,
  fromBase64Url,
  mintCredentials,
  toBase64Url,
} from './ids.js'

describe('base64url', () => {
  it('roundtrips every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i)
    expect(fromBase64Url(toBase64Url(all))).toEqual(all)
  })

  it('never emits +, / or = padding, at any length', () => {
    for (let len = 1; len <= 64; len++) {
      const s = toBase64Url(crypto.getRandomValues(new Uint8Array(len)))
      expect(s, `length ${len}`).not.toMatch(/[+/=]/)
    }
  })
})

describe('mintCredentials', () => {
  it('produces a 16-byte id and a 32-byte password', () => {
    const c = mintCredentials()
    expect(fromBase64Url(c.roomId)).toHaveLength(16)
    expect(fromBase64Url(c.password)).toHaveLength(32)
  })

  it('does not repeat across many calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(mintCredentials().roomId)
    expect(seen.size).toBe(2000)
  })
})

describe('ephemeral payload (the one that gets scanned)', () => {
  // Locks in the measured QR budget. 49 bytes -> 66 base64url chars -> 94-char
  // URL -> 53x53 modules at ecc=H. If this number grows, the QR gets denser and
  // harder for a webcam to read off a TV. See plan §6.2 and context §14.3b.
  it('encodes to exactly 66 characters', () => {
    const enc = encodePayload({ version: PAYLOAD_VERSION, ...mintCredentials() })
    expect(enc).toHaveLength(66)
    expect('https://portalcast.net/pair#'.length + enc.length).toBe(94)
  })

  it('roundtrips, carrying no name', () => {
    const c = mintCredentials()
    const d = decodePayload(encodePayload({ version: PAYLOAD_VERSION, ...c }))
    expect(d).toEqual({ version: PAYLOAD_VERSION, roomId: c.roomId, password: c.password })
  })

  it('tolerates a leading #', () => {
    const c = mintCredentials()
    const enc = encodePayload({ version: PAYLOAD_VERSION, ...c })
    expect(decodePayload(`#${enc}`).roomId).toBe(c.roomId)
  })
})

describe('permanent payload (bookmarked, never scanned)', () => {
  it.each(['Living Room TV', 'Télé du salon', '居間のテレビ', '📺 Big One', ''])(
    'roundtrips the name %j',
    (name) => {
      const c = mintCredentials()
      const d = decodePayload(encodePayload({ version: PAYLOAD_VERSION, ...c, name }))
      expect(d.name).toBe(name)
      expect(d.roomId).toBe(c.roomId)
      expect(d.password).toBe(c.password)
    },
  )
})

describe('malformed input fails loudly', () => {
  // A silent failure here becomes "waiting for peer..." forever, which is the
  // worst thing to debug. Plan §6.4.
  it('rejects an empty code', () => {
    expect(() => decodePayload('')).toThrow(/empty/i)
  })

  it('rejects a truncated code', () => {
    const enc = encodePayload({ version: PAYLOAD_VERSION, ...mintCredentials() })
    expect(() => decodePayload(enc.slice(0, 30))).toThrow(/incomplete/i)
  })

  it('rejects an unknown payload version', () => {
    expect(() => decodePayload(encodePayload({ version: 9, ...mintCredentials() }))).toThrow(
      /different version/i,
    )
  })

  it('rejects a name that would be cut short, rather than mangling it', () => {
    const enc = encodePayload({ version: PAYLOAD_VERSION, ...mintCredentials(), name: '居間のテレビ' })
    const bytes = fromBase64Url(enc)
    // Drop trailing bytes but leave the declared name length intact.
    const short = toBase64Url(bytes.subarray(0, bytes.length - 3))
    expect(() => decodePayload(short)).toThrow(/incomplete/i)
  })

  it('refuses to encode a name over 255 bytes', () => {
    expect(() =>
      encodePayload({ version: PAYLOAD_VERSION, ...mintCredentials(), name: 'x'.repeat(256) }),
    ).toThrow(/255 bytes/i)
  })

  it('refuses to encode a wrong-sized id', () => {
    expect(() =>
      encodePayload({
        version: PAYLOAD_VERSION,
        roomId: toBase64Url(new Uint8Array(8)),
        password: toBase64Url(new Uint8Array(32)),
      }),
    ).toThrow(/roomId must be 16 bytes/)
  })
})
