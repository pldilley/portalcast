/**
 * Fixed application constants. See portalcast-plan.md §6.
 *
 * `APP_ID` is the Trystero appId: a fixed constant for the whole app, used as
 * part of the relay topic. It must never change once published, or existing
 * pairings stop finding each other.
 */
export const APP_ID = 'portalcast-7f3a9c21'

/**
 * Ephemeral pairing link lifetime, milliseconds. Plan §5.3, §6.3; context decision 53.
 * Long enough to send the link to a friend; single-use regardless.
 */
export const PAIR_CODE_TTL_MS = 10 * 60_000

/** How long before the Portal shows "not reachable". It then retries forever. Plan §6.7. */
export const UNREACHABLE_WARN_MS = 20_000

// PAYLOAD_VERSION lives in ./ids.ts, next to the codec that depends on it.
