# PortalCast — Project Plan

App-free, website-only casting. A TV opens a web page (the **Portal**), a laptop opens another (the **Source**), they pair by the laptop scanning a QR code off the TV screen, and the laptop plays local video files on the TV over a direct peer-to-peer connection. A phone can join as a **Remote** to browse and control playback. No installs, no accounts, no media server.

The name is a nod to the game *Portal*: step in one side, come out the other. Video goes in on the laptop and comes out on the TV.

This document is the starting brief for building the project from scratch. Read it fully before writing code. The companion file `portalcast-context.md` holds the research, competitor survey, verified browser facts, and reasoning behind each decision; read it before changing any decision here.

**This file is the single source of truth for the current design.** `portalcast-context.md` records *why* — research, history and the decision log — and deliberately does not restate the design. If the two ever disagree, this file wins and the other is the one to fix. Any design change is: edit this file, then append one entry to the context decision log.

> **Context §16 applied 30 September 2026.** `portalcast-context.md` §16 holds the verbatim review and the owner's answers that produced the Portal UI spec (§11.2), the narrower connection rule (§3) and several of the open questions in §15. It is kept as the raw record; this file is now the current design. Note that its own cross-references predate a later renumbering, and the single ~20 s pairing threshold (§6.7) superseded the dual-threshold scheme recorded there.

---

## 1. Goals and non-goals

**Goals**
- Works with nothing but a modern browser on every device (smart TV browser, Fire TV Silk, sideloaded Android TV browser, laptop Chrome/Firefox/Edge/Safari, phone browser).
- Nothing is ever typed on the TV. Pairing is a QR code the TV displays and another device reads.
- Video never goes through our servers. Media and control data travel directly between devices, end-to-end encrypted.
- Simple codebase: TypeScript, static hosting, no backend of our own for phases 1–3. The one exception is an opt-in report collector, which is a Google Apps Script and Sheet rather than a server we run (§12).
- Phase 3: a friend in another home can watch a file from my laptop on their TV and control it from their own phone.

**Non-goals (for now)**
- DRM content (Netflix, Disney+, etc.). Browsers deliberately block capturing it.
- Accounts, cloud libraries, transcoding servers.
- Phases 1–2 assume all devices are on the same Wi-Fi/LAN. Internet streaming arrives in phase 3, direct connections only.
- TURN relays (for networks that block direct connections) are deferred to phase 4. Until then, a failed connection shows a clear error rather than falling back to a relay.

**Quality target**
- **1080p is the ceiling; 720p is the sweet spot.** Most material people actually cast is a modest-quality download, and a well-tuned Mode A re-encode at these resolutions should be close to transparent. 4K and HDR are explicitly out of scope — they are the two things a realtime re-encode cannot preserve, and chasing them would force Mode B to exist.

**Accepted requirement**
- **Pairing needs a camera somewhere** — the laptop's webcam, or a phone that forwards the link. Permanent credentials are far too long to type, so there is no manual fallback. This is a deliberate trade: see `portalcast-context.md` decision 15.

---

## 2. Plain-language glossary

- **Portal** — the page opened on the TV (`/tv`). Displays the pairing QR code, plays video, owns playback state. Talks to exactly one Source at a time.
- **Source** — the page on the laptop that holds the video files (`/`). Picks files and sends video. In phases 1–2 it is also the controller.
- **Remote** — the mobile page (`/remote`, installable as a PWA). Browses the library a Source has shared and controls playback on a Portal *through* that Source. Holds no video and talks to no Portal directly.
- **Pair page** — a tiny page (`/pair`) that the TV's QR code points at. On a phone it offers to forward the link; on a laptop it offers to connect. It never joins a room by itself.
- **Profile** — a named set on the Source: which files are shared, and which TVs and Remotes are paired. "Family", "Mates", "Work". One profile is active per tab.
- **Signalling** — the brief "introduction" step where browsers swap connection details before they can talk directly. Trystero handles this using public relay networks.
- **Room** — a named meeting point on the relay network. Peers in the same room with the same password connect to each other. In PortalCast a room is minted per pairing, so it normally holds two peers: one Source and one Portal, or one Source and one Remote. The rule is only that strangers never share a room (§3).
- **Data channel** — a direct pipe between two browsers for arbitrary messages and bytes.
- **Service Worker** — a small background script that can answer a page's network requests itself. Used by the Remote PWA so it opens instantly, and — if Mode B is ever built — to feed file bytes to the TV's `<video>` element.
- **STUN / TURN** — helper servers for connecting across the internet. STUN tells a device its public address. TURN relays encrypted traffic when a direct connection is impossible.

---

## 3. Architecture

```
  REMOTE (phone, ph.3)        SOURCE (laptop)              PORTAL (TV browser)
 ┌────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────┐
 │ browses library    │   │ picks local files         │   │ shows pairing QR    │
 │ play/pause/seek    │   │ (File API, never uploaded)│   │ plays fullscreen    │
 │ no video, no       │   │ profiles: files, TVs,     │   │ owns playback state │
 │ authority          │   │   remotes                 │   │ ONE active Source   │
 │ talks ONLY to      │   │ scans the TV's QR code    │   │ joins ONE room      │
 │   the Source       │   │ ROUTES between the two    │   │ no playback controls│
 └─────────┬──────────┘   └─────┬───────────────┬─────┘   └──────────┬──────────┘
           │   room C           │               │   room A           │
           └────────────────────┘               └────────────────────┘
               one room per pairing — strangers never share one

           1. find each other ──► public relays (Nostr) ◄── encrypted handshake
           2. then direct WebRTC only — no relay touches video or messages

   status : Portal ──► Source ──► Remote          (the Source relays)
   control: Remote ──► Source ──► Portal
   library, thumbnails: Source ◄──► Remote        (direct, never relayed)
```

**Pages**, one static site:
- `/tv` — Portal.
- `/` — Source (laptop-first, responsive).
- `/pair` — the QR landing page (tiny, mobile-first).
- `/remote` — Remote (mobile-first PWA, phase 3), with `/remote/pair` as its QR landing page (§11.3).

**The rule is: no cross-connection between parties that do not know each other.** Trystero connects every peer in a room to every other peer, so two Sources sharing a room would get direct connections to one another — that is what must never happen. Every pairing therefore mints a fresh room, which in practice means two peers per room in every phase — including phase 3, because a Remote gets its own room rather than joining the Portal's.

Two peers per room is therefore what the design *does*, but it is not the rule and nothing should be derived from it. The rule permits a third known peer; the design only ever produces one when a user copies a paired Remote's bookmark onto a second phone (§11.3) — two trusted Remotes and their Source, which the rule allows. Earlier drafts called two-peer rooms "an invariant" and reasoned from that; it overstated the requirement (see `portalcast-context.md` §16, answer 3).

Consequences:
- A **Source tab joins exactly one Portal room — the TV it has claimed** (§11.1) — plus one room per connected Remote. It does *not* join the rooms of the profile's other paired TVs. If it did, two tabs would both be peers in the same TV's room: two Sources in one room, which is the thing this rule exists to prevent, and wasted connections on the weakest device in the system.
  - So a Source tab holds **1 Portal room + N Remote rooms**, each normally a two-peer room. Only the Portal room is exclusive, enforced by the Web Lock (§11.1); Remotes need no lock because nothing is contended.
  - Consequence: the TV selector lists paired TVs **without live online status**, because knowing that would require joining them. Selecting one takes the Web Lock, joins that room, and shows "Connecting…". Honest, and it costs nothing.
- A **Portal joins exactly one room at a time** — its *active Source*, chosen from the top-bar selector (§11.2). Anything not selected cannot reach the TV at all. This bounds memory on weak TV hardware, stops two households fighting over one screen, and means someone must be physically at the TV to change who controls it.
- The same TV paired into two profiles is **two separate pairings**, two rooms.
- **Unknown Sources and unknown TVs never share a room.** That is the whole of the isolation requirement.
- **A Remote pairs directly with the Source, in its own room** — it never joins the Portal's room. Decided 30 September; see below.

**The Portal owns playback state** (what's loaded, playing/paused, position). Everyone else sends commands to it and receives status from it. That keeps one source of truth even with a laptop and a phone controlling at once. Note this is independent of who generated the room credentials.

**The Source owns the queue.** It holds the files, persists the working playlist (§11.1) and is the only place the queue is edited — a Remote's edits are proxied to it like everything else. The Portal keeps a **mirror** of the queue, received via `queue` (§10), only so it can auto-advance and report the queue in `status`. The Source re-sends the whole queue on every connect and on every change, so on any disagreement the Source's copy wins. This also means a TV that wipes its storage loses nothing.

### Where the Remote sits

**The Remote pairs directly with the Source, in its own two-peer room.** It never joins the Portal's room, and never connects to the Portal at all.

```
   Remote ──[room C]── Source ──[room A]── Portal        ← chosen
                         └─────[room B]──── Portal 2

   NOT: Remote ──┐
                 ├─[room A]── Portal                     ← rejected
        Source ──┘
```

Why:
1. **It matches the UI.** §11.3 makes the Remote *the Source UI with every action proxied to the Source*. A Remote that talks only to the Source has the same shape as the interface built on top of it.
2. **It survives the Portal switching Sources.** In the Portal's room, changing active Source changes the room — orphaning the Remote and forcing credential migration. Bound to the Source, nothing moves.
3. **Per-Remote revocation.** Its own room means dropping one Remote is deleting one record. In the TV's room, revoking a Remote means rotating that room's password, which breaks the Source pairing too.
4. **The TV's credentials never reach a phone.**
5. **It reuses the minting flow**, Source-side, where the QR-display and device-list UI already live.

The cost, accepted: **the Source relays.** `status` travels Portal → Source → Remote, and `control` travels Remote → Source → Portal, so the Source is a message router. Bandwidth is trivial at roughly one status message per second, but it adds a hop of latency to seek feedback — so the Remote must update optimistically and reconcile against `status` rather than waiting for a round trip.

Consequences recorded elsewhere: relay semantics in §10, Remote connection flow in §11.3, and the `fileId` allowlist as the real guard in §5.3 (a Remote still gets a direct channel to the Source, by design — that is how it fetches thumbnails).

---

## 4. Tech stack

- **TypeScript + Vite**, static multi-page build.
- **UI, split deliberately by page.** Vite's multi-page build lets each entry point carry its own dependencies, and the pages have opposite requirements:
  - **Source and Remote: React + [Mantine](https://mantine.dev).** Complex stateful UI on capable hardware. Mantine has every component this app needs out of the box (`Drawer`, `Modal`, `Menu`, `Popover`, `TextInput`, `TagsInput`) plus useful hooks (`useLocalStorage`, `useHotkeys`, `useMediaQuery`), and since v7 uses CSS Modules rather than runtime CSS-in-JS.
  - **Portal: vanilla TS, or Preact at most. No component library.** It runs on the weakest hardware in the system at an ES2017 target, and its UI is genuinely tiny — a QR code, a `<video>`, a source list, some status text. It also needs spatial d-pad focus navigation, which no React UI library provides, and which is easier to hand-roll without a library's DOM in the way.
- **Rejected: Next.js.** It is a server framework (SSR, API routes, server components) and we have no backend by design. Static export would work, but its file-based routing fights the multi-page static build and we would carry the framework for nothing.
- **Rejected for the Source: MUI** (heaviest, runtime CSS-in-JS, more than this app needs) and **shadcn/ui** (good, smallest runtime, but Tailwind setup plus maintaining copied components — work with no payoff unless we expect to fight the library's styling).
- **Cross-tab coordination:** the **Web Locks API** (`navigator.locks`), not `localStorage`. See §11.1.
- **P2P:** [Trystero](https://github.com/dmotz/trystero) (`npm i trystero`, MIT). Default strategy is Nostr; keep the strategy import in one module so it can be swapped (MQTT, BitTorrent, or a self-hosted `@trystero-p2p/ws-relay`) without touching the rest of the code.
- **QR generation (Portal, and the Source for Remote pairing, §11.3):** [`uqr`](https://www.npmjs.com/package/uqr) — MIT, zero dependencies, renders to SVG. SVG scales to any TV resolution without canvas. Avoid `qrcode`, which drags in `yargs` and `pngjs`.
- **QR scanning (Source):** [`barcode-detector`](https://www.npmjs.com/package/barcode-detector) — MIT, actively maintained, a ponyfill of the standard `BarcodeDetector` API backed by ZXing-C++ WASM. Write against the standard API once: native fast path where it exists, WASM everywhere else. **Do not rely on native `BarcodeDetector` alone** — see the compatibility table in `portalcast-context.md`.
- **Hosting: GitHub Pages** to start. **HTTPS is required** for Service Workers, `getUserMedia`, PWA install, and a secure context — and note `localhost` counts as secure but **a TV cannot reach your localhost**, so every TV test needs a deployed URL from day one.
  - **A path prefix is acceptable.** A *project* page serves from `/<repo>/`, making the routes `/portalcast/tv`. The obvious fix — a *user* page (`<username>.github.io`), which serves from root — is unavailable, since that repo is already in use. This is fine: the only people typing a URL on a TV are the owner and a few friends, all of whom can manage a long one, and `/check` is never a public artefact (§13 milestone 1b). Root paths become worth having when the domain arrives (§15), not before.
  - **Known limitation for later:** GitHub Pages cannot set response headers. That only bites when ffmpeg.wasm arrives for MKV remux, which wants `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` for `SharedArrayBuffer`. A single-threaded ffmpeg.wasm build avoids it; otherwise move to Cloudflare Pages or Netlify, which support a `_headers` file. Not a blocker now.
  - Vite's `base` must match whatever path the site is actually served from.
- **Build target:** TV browsers can be old. Target ES2017 for the Portal bundle, avoid very new APIs there, and feature-detect everything.
- **PWA (Remote):** web app manifest + a small Service Worker so the Remote can be added to the home screen and opens instantly.

**Two Trystero gaps we work around, and plan to upstream** (detail in `portalcast-context.md` §5):
1. `addStream()` / `addTrack()` return nothing, so the `RTCRtpSender` needed for quality control has to be dug out of `getPeers()`. Since streams are added per-peer with `{target}` anyway, returning the sender is a small non-breaking change.
2. No SDP transform hook, so Opus stereo cannot be requested. Workaround today is the documented `rtcPolyfill` option with an `RTCPeerConnection` subclass that rewrites the `fmtp` line; the clean fix upstream is an `sdpTransform` option.

Before coding, check the current Trystero README for exact option names (`joinRoom`, `makeAction`, `addStream`, `onPeerHandshake`, `password`, `relayConfig`, `turnConfig`, `handshakeTimeoutMs`). The notes here were accurate as of September 2026.

---

## 5. How Trystero connects devices, and what is private

### 5.1 The middle piece, step by step
1. Every page calls `joinRoom({ appId, password }, roomId)`.
2. Trystero connects each browser to several public relays (Nostr by default) and announces on a topic derived from the app ID and room ID.
3. When peers see each other, they exchange **session descriptions (SDP)**: technical details about how to reach each other, including network addresses. These pass through the relays.
4. With a `password` set, Trystero encrypts the SDP with AES-GCM using a key derived from the password. Peers with a different password cannot connect (`onJoinError` fires).
5. The browsers then connect directly with WebRTC. From here on, **nothing goes through the relays**. All data and media are sent peer-to-peer and encrypted by WebRTC (DTLS/SRTP).

### 5.2 What each party can see

| Party | Can see | Cannot see |
|---|---|---|
| Public relays (Nostr etc.) | Each browser's IP address (as with any website visit), that some peer announced on a hashed topic, timing | Contents of the handshake (encrypted with our password), any video, file names, or control messages |
| STUN server (Trystero default, configurable via `rtcConfig.iceServers`) | Public IP address, used to discover it | Anything else |
| TURN server (phase 4, only if used) | That two IP addresses are exchanging encrypted traffic, and how much | Contents (still end-to-end encrypted) |
| Our static host | Normal page-load logs | Anything about pairing or media. Room credentials live only in URL fragments, which browsers never send to servers |
| Anyone else on the network | Encrypted WebRTC traffic | Contents |
| A messaging or email provider, if the user forwards a pairing link | The ephemeral pairing credentials | Nothing after pairing completes; those credentials die on first use |
| A TV manufacturer's bookmark sync, if the TV syncs bookmarks to an account | The permanent room credentials for that pairing | Contents. Worth stating on a privacy page |
| Google, if a report is sent (§12) | The report's device capabilities; Google's infrastructure sees the sender's IP, as with any request | File names, credentials, video, control messages. The collecting script itself never sees the IP |

### 5.3 Threat model and how we cover it

**Room credentials carry full entropy.** Because the QR code transfers a 128-bit room id and a 256-bit password directly, there is no short secret anywhere in the system and nothing worth brute-forcing. This is why PortalCast needs no key-derivation step, no password hashing, and no authenticated key exchange. Simplicity is the security property.

| Risk | Cover |
|---|---|
| No `password` given → Trystero derives the key from app ID + room ID, which a relay operator could reverse | **Always pass a password.** Never rely on the default |
| Someone photographs or intercepts the QR during its short life, and pairs instead of you | Ephemeral credentials are **single-use** (the room closes the moment the first Source pairs) and **short-lived** (10 minutes — long enough to send a link to a friend, short enough that a forgotten link in a chat history dies). Worst case is a stranger casting to your TV; the TV holds no data of yours. The active-Source list on the Portal has a Remove option |
| Stale QR photographed and used later | Dead on expiry. Permanent credentials are minted fresh at pairing and are never the same as the ephemeral ones |
| A second Source tries to take over the TV | It cannot. The Portal only ever joins its one selected room. Switching requires someone at the TV |
| A Portal or Remote requests a file it was never offered | Every `fileId` is a random opaque handle minted per profile per file, never a path or a name. The Source checks membership in the active profile's shared list on every request |
| **A Remote has a direct data channel to the Source** — including, in phase 3, a friend's Remote reaching my laptop | By design (§3): the Remote's room *is* a Source room, and it needs that channel for thumbnails and library data. **The `fileId` allowlist is therefore the guard, not room isolation** — enforce it on every byte-serving request, never as a formality. Mitigated by the Remote having its own room, so it is revocable on its own without touching any TV's credentials |
| Public relays are unreliable | Configure `relayConfig.urls` with several known-good relays, or `redundancy`, and surface relay failures in the debug panel. A self-hosted `ws-relay` is the fallback plan |

---

## 6. Pairing spec

### 6.1 What is stored where

**Portal** (`localStorage`, plus the URL fragment as the portable copy):
```
sources: [ { roomId, roomPassword, sourceName, pairedAt, lastSeen } ]
activeRoomId            // which one it is currently listening to
```
**`roomId` is the key** — there is no separate id field, and none is needed, since a room is minted per pairing and cannot collide.

**Source** (`localStorage`, per profile):
```
profiles: [ { profileId, name,
              tvs:     [ { roomId, roomPassword, tvName,     pairedAt, lastSeen } ],
              remotes: [ { roomId, roomPassword, remoteName, pairedAt, lastSeen } ] } ]
activeProfileId
```
File metadata, thumbnails and file handles are **not** here — they live in IndexedDB, keyed by `profileId` and `fileId` (§8), because `localStorage` cannot hold handles or binary thumbnails. The working playlist is keyed by the TV's `roomId` (§11.1).

**Remote** (`localStorage`, plus the URL fragment as the portable copy — same shape as the Portal):
```
sources: [ { roomId, roomPassword, sourceName, pairedAt, lastSeen } ]
activeRoomId
```

**There is no `deviceId` anywhere.** Earlier drafts stored and transmitted one; it never had a reader. The room *is* the identity (§6.5), because each pairing mints a room nothing else can enter. A separate device id was a leftover from the abandoned per-device-token scheme (`portalcast-context.md` §7.10) and has been removed rather than left to mislead.

**Whoever owns the room mints its credentials.** For a Source↔Portal pairing that is the **Portal**, and they travel Portal → Source. For a Source↔Remote pairing it is the **Source** (§11.3). Same shape either way: the device displaying the QR owns the room it is inviting the other into.

Which Web Crypto APIs are actually required, and by whom:

| API | Needed for | If missing |
|---|---|---|
| `crypto.getRandomValues` | The 32-byte room password and the 16-byte room id | **Fatal.** `Math.random()` is predictable, and a guessable password lets anyone join the room |
| `crypto.randomUUID` | **Not used.** Ids are raw random bytes, not UUIDs (§6.2) | Nothing — we never call it |
| `crypto.subtle` | **Nothing we write.** But Trystero AES-GCM encrypts the SDP handshake with the room password (§5.1) | **Fatal** — password-protected rooms stop working, and we must never fall back to no password |

Note what is *not* here: PortalCast performs no key derivation, no hashing and no key agreement of its own. PBKDF2 became unnecessary when the QR started carrying full-entropy credentials, and ECDH died with the abandoned SAS design (`portalcast-context.md` §7.10). The `/pair` checksum guards against mistyping, not attackers, so it needs no cryptographic hash.

### 6.2 The QR payload

The QR encodes a URL so that a phone camera does something useful with it. The Source's own scanner simply parses the fragment out of the decoded string. The fragment is never sent to any server, and the path tells each page what the payload means, so the payload carries no type field.

| URL | Opened on | Meaning | Scanned? |
|---|---|---|---|
| `/pair#…` | Source, or a phone forwarding it | **Ephemeral** credentials for a Source↔Portal pairing in progress | **Yes** — keep it as short as possible |
| `/tv#…` | Portal | **Permanent** credentials for one pairing, bookmarkable | No — length does not matter |
| `/remote/pair#…` | Remote (the phone that scanned it) | **Ephemeral** credentials for a Source↔Remote pairing in progress (§11.3) | **Yes** — same 49-byte layout as `/pair` |
| `/remote#…` | Remote | **Permanent** credentials for one Remote pairing, bookmarkable | No |

`/remote/pair` *does* join on open, unlike `/pair`: the phone that scans the Source's QR is the intended Remote, so there is nobody else for it to steal the pairing from.

`portalcast.net` is a **placeholder** throughout this document — the domain is still undecided (§15).

**Ephemeral payload — binary, 49 bytes, no JSON and no name.**

```
byte 0        version (currently 1)
bytes 1–16    roomId    — 16 random bytes
bytes 17–48   password  — 32 random bytes
              → base64url, 66 characters
              → https://portalcast.net/pair#<66 chars>   = 94 characters total
```

The TV's name is deliberately **absent**: §6.3 step 3 already sends `tvName` over the data channel, so the QR never needed it. Until then the Source shows "Connecting…" and fills the name in on arrival.

**Why this matters — measured, not guessed.** QR module counts for the same data at error-correction level H:

| Encoding | URL length | QR at ecc=H |
|---|---|---|
| JSON with a UUID string and the name | 190 ch | 73 × 73 modules |
| JSON with raw bytes and the name | 171 ch | 69 × 69 modules |
| **Binary, no name (chosen)** | **94 ch** | **53 × 53 modules** |

The chosen form at the *highest* error correction is coarser than the JSON form at the *lowest*. On a 1080p TV displaying an 800 px QR that is 15.1 px per module instead of 11.0 — **37% larger modules**, which goes directly at the weakest link in this design: a laptop webcam reading a glossy panel from sofa distance at an angle (§6.4).

**These figures assume a short domain.** Until one exists the site is served from a GitHub Pages project path (§4), which makes the URL `https://<user>.github.io/portalcast/pair#…` — **109 characters, 57 × 57 modules at ecc=H** (measured with `uqr`, border excluded), or 14.0 px per module. Still far better than any JSON form, so nothing is blocked; a short domain recovers the remaining 7%.

Use **ecc=H** and spend the headroom on robustness rather than on a smaller code.

**Permanent payload — same layout plus a name**, since it is bookmarked and never scanned:

```
byte 0        version
bytes 1–16    roomId
bytes 17–48   password
byte 49       name length in bytes
bytes 50…     sourceName, UTF-8 — the Source this device belongs to
              → base64url → /tv#<…> (Portal) or /remote#<…> (Remote)
```

**No UUIDs anywhere.** 16 random bytes from `getRandomValues` give 128 bits; UUID v4 gives 122, because six bits are fixed version and variant markers. The raw form is also shorter to encode (22 base64url characters versus 36 for a formatted UUID) and `getRandomValues` is supported far more widely than `crypto.randomUUID`. The field is called `roomId`, matching Trystero's own parameter name — never `roomUuid`, which would invite someone to reach for `randomUUID`.

### 6.3 Pairing flow

1. **Portal:** user picks **"Add a new source"** from the top-bar selector (§11.2). The Portal generates ephemeral `{roomId, roomPassword}`, joins that room, and displays a large full-screen QR code with a 10-minute countdown.
2. **Source:** user opens the scanner (`getUserMedia` + `barcode-detector`), points the laptop at the TV, and the QR decodes. The Source joins the ephemeral room.
3. **Portal:** on peer join, mints **fresh permanent** `{roomId, roomPassword}` for this Source and sends them over the data channel with its `tvName`. The Portal switches to a loading screen immediately, so the user turning the laptop back around sees that it worked.
4. **Source:** stores the record under the active profile, replies with `sourceName`. The Portal stores its own entry and sets it active.
5. **Both leave the ephemeral room.** The Portal discards the ephemeral credentials. Both join the new permanent room. Each screen confirms.
6. **Portal:** rewrites its own URL to `/tv#<permanent payload>` with `history.replaceState`, then prompts: *"Bookmark this page so you never have to pair again."*

### 6.4 The phone fallback

Laptops have no camera, or the TV is out of reach. The user scans the TV's QR with the phone's ordinary camera app, which opens `/pair#…` on the phone.

That page **never joins a room by itself** — if it did, the phone would consume the single-use pairing before the laptop ever saw it. Instead it offers:
- **On a phone:** the link with copy and share buttons, *and the payload on its own as a selectable code*, so the user can send whichever suits the channel they're using.
- **On the laptop** (same page, same link): a "Connect from this device" button.

The code is simply the base64url payload already in the fragment — nothing new is encoded. **Append a short checksum** (four base32 characters of a hash of the payload), verified on paste. Without it, a truncated or mangled paste produces a silent "waiting for peer…" forever, which is the worst possible failure to diagnose; with it, the Source says "that code looks incomplete" straight away.

On the Source, the scanner is the default view with **"Enter a code instead"** beneath it, revealing the phone instructions and a paste box. That path is also the only route for a friend's TV, where there is no camera-to-screen line of sight at all.

Expect this to become the common path once the phone Remote exists, since phones scan QR codes effortlessly. Phase 1 ships the laptop webcam path; the scanner code is shared with the Remote later.

### 6.5 Reconnecting

No codes, no QR, no camera. On load the Portal decides what to trust:

```
fragment present  → use it, and merge it into localStorage (populates the source list)
fragment absent   → use localStorage's activeRoomId
neither           → show the "Add a source" / QR screen
```

The Source joins **only the room of the TV this tab has claimed** (§3, §11.1) — never every TV in the profile — plus one room per paired Remote. Room membership plus a 256-bit password is the entire proof of identity; nothing further is exchanged. `hello` still declares roles, and a second peer claiming `portal` in a two-peer room is rejected.

**Why the fragment matters.** Many built-in smart TV browsers clear `localStorage` and cookies between sessions, which would mean re-pairing every time. A bookmarked `/tv#…` URL survives that, so on those TVs the bookmark *is* the pairing record and `localStorage` is only a cache. Because the Portal talks to one Source at a time, one bookmark per Source is a complete representation — switching Source on such a TV is just opening the other bookmark.

The awkward part: **a page cannot bookmark itself.** The user must press the remote's bookmark button, and that button differs across Tizen, webOS, Silk and TV Bro. The Portal shows an explicit bookmark step with per-platform hints derived from the user agent. Verify on real hardware that fragments survive at all — some TV "browsers" are thin webview wrappers.

### 6.6 Choosing and removing a Source

**Answered by the Portal UI (§11.2): the selector is always present**, in a persistent faded top bar. Earlier drafts treated it as a screen that had to be summoned without interrupting playback; making it ambient removes the question entirely.

The selector lists paired Sources with the active one marked, ending in **"Add a new source"**. **Long press gives Remove.** That one control covers picking a Source, adding one and removing one, so there is no settings screen to navigate with a remote.

### 6.7 Failures

| Situation | Behaviour |
|---|---|
| QR expires unused | Portal shows a fresh QR with new credentials |
| Camera unavailable or permission denied | Source explains, and points to the phone fallback (6.4) |
| QR won't decode (glare, moiré, angle) | Keep scanning. Portal renders the QR large, high contrast, wide quiet zone, high error correction |
| Permanent room joined, no peer after **~20 s** | Show "Paul's laptop isn't running PortalCast", with **Retry**, **Remove** and **Pair a new source**. Keep waiting and keep retrying indefinitely — the Source may simply not be open yet. **The Portal never gives up on its own**; moving to the pairing screen is always the user's choice |
| Source's record deleted or storage cleared | Same as above — the Portal cannot tell this apart from a closed laptop, and does not need to |
| Portal's storage cleared, bookmark exists | Fragment restores the pairing silently |
| Portal's storage cleared, no bookmark | Falls back to the QR screen |
| Either side removes the pairing | Send `unpair` first so the other side drops its record, then delete |
| `/tv/reset` | Clears all Portal records and returns to the QR screen. A path, not `?reset` — `?` is buried in TV on-screen keyboards |

### 6.8 Sharing a TV between profiles (medium term)

Do not copy credentials between profiles: if both profiles are live, both Sources end up in one room, which is exactly the cross-connection §3 forbids. Instead the already-connected Source asks the Portal over the existing channel to mint a second set of credentials for the other profile. Small message, rule preserved.

---

## 7. Playback modes

### Mode A — "Live capture" (build first)
- Source plays the file in a hidden `<video>` element and calls `captureStream()` on it.
- Send the resulting `MediaStream` with `room.addStream(stream, { target: portalPeerId })`. Streams are **not** automatically sent to peers who join later, so add per peer on `onPeerJoin`.
- Portal receives it in `onPeerStream` and sets `video.srcObject = stream`.
- Control: the Portal forwards play/pause/seek to the Source, which applies them to its hidden video. The device that decodes is also the device that seeks, which is why Mode A is simple — the Portal never needs to know what a file is.
- Pros: plays anything the laptop browser can decode; WebRTC adapts quality to the connection automatically, which suits internet streaming in phase 3.
- Cons: re-encoded like a video call; uses laptop CPU continuously.

**Browser support splits Mode A into two implementations**, not one with a caveat:

- **Mode A-native** — `HTMLMediaElement.captureStream()`. Chrome 62+, Edge, Firefox 149+ unprefixed. Older Firefox needs `mozCaptureStream()`, which MDN flags as a partial implementation, so feature-detect `captureStream ?? mozCaptureStream` and expect Firefox audio to be the fragile part. The browser keeps audio and video locked together for us.
- **Mode A-canvas** — for WebKit, where `HTMLMediaElement.captureStream()` has never shipped. **Its real purpose is iOS**, since WebKit is the only engine allowed there and someone may want to cast from their phone; desktop Safari is a side benefit. Build it last, and abandon it without regret if it fights back. Separate code path: draw frames to a `<canvas>`, capture *that* for video, route the element's audio through Web Audio into a `MediaStreamAudioDestinationNode`, and merge the tracks. Every piece is supported in Safari 11+ (see `portalcast-context.md` §14.5). Two real costs: **A/V sync becomes ours to maintain** against `video.currentTime`, since canvas frames and audio run on separate clocks; and `requestAnimationFrame` is the wrong clock (display refresh, not frame rate), so `requestVideoFrameCallback` must be used.

Prefer native where it exists — it is less code and the browser handles sync. Order: Chrome, then Firefox, then Mode A-canvas for Safari.

**Quality tuning is mandatory, not optional.** Every WebRTC default assumes a video call and will make captured playback look like one. All of these must be set:

| Lever | Where | Why |
|---|---|---|
| `maxBitrate` | `sender.setParameters({ encodings: [{ maxBitrate: … }] })` | The big one. Lifts the ceiling from roughly 2 Mbps to whatever the LAN will take |
| `scaleResolutionDownBy: 1` | same call | Stops the encoder quietly shrinking 1080p to 720p or lower under pressure |
| `degradationPreference` | same call | What is sacrificed when bandwidth dips. Prefer `maintain-framerate`; film below 24 fps is a slideshow |
| `track.contentHint = 'motion'` | video track | Tells the encoder this is moving picture, not a slide |
| `audioTrack.contentHint = 'music'` | audio track | Default Opus in WebRTC is speech-grade and roughly mono. Film audio needs stereo |
| Opus `stereo=1; maxaveragebitrate=…` | SDP `fmtp` line, via `rtcPolyfill` | No JavaScript API exists for this; SDP editing is the only route in every browser |
| Codec preference (VP9) | `transceiver.setCodecPreferences()` | Roughly 30–50% better quality per bit than the VP8 default. **Driven by the Portal's reported capabilities, not guessed** — see below |

Measure with `getStats()` on real hardware; treat any specific bitrate number as a starting point.

**Codec choice is negotiated at runtime, never hardcoded.** WebRTC's own offer/answer already guarantees you cannot send a codec the TV can't decode — it picks the intersection. What it does *badly* is ordering: Chrome tends to put VP8 first even when VP9 is available on both sides. So:

1. On connect, the Portal sends `capabilities` (§10) from `RTCRtpReceiver.getCapabilities('video'|'audio')`.
2. The Source picks the best mutually supported codec — VP9 over VP8 where present, AV1 only if clearly supported — and applies it with `setCodecPreferences()`.
3. **This must happen before the offer is created**, since `setCodecPreferences` only affects the next negotiation. Trystero builds the offer internally, so this lands on the same `sdpTransform` / `rtcPolyfill` gap as the Opus settings (§4).
4. Re-send on every connect rather than caching — a TV firmware update can change what it decodes.

The `/check` page probes the same API, but for a different purpose: telling *us*, during development, whether a TV model is worth trying, and seeding `docs/devices.md`. The product itself never relies on it.

**What cannot be controlled:** `maxBitrate` is a ceiling, not a floor. Congestion control will always lower the bitrate when it sees loss or delay, and the standard API has no `minBitrate`. Realtime encoders also skip B-frames, so WebRTC video at a given bitrate is worse than a file encoded at the same bitrate. On a LAN you compensate with headroom; over the internet you cannot.

**Prove stereo audio early — this is the single biggest risk to Mode A.** Capturing the audio is trivial; the problem is that **WebRTC assumes a phone call**:

- Opus in WebRTC defaults to roughly 32–40 kbps and effectively mono. Fine for speech, ruinous for a film score.
- Stereo requires `stereo=1; sprop-stereo=1; maxaveragebitrate=…` on the Opus `fmtp` line, and **no JavaScript API exists for it in any browser** — SDP text editing is the only route, i.e. Trystero gap #2 (§4).
- The stack may also apply voice processing (noise suppression, auto gain) to an outgoing track; `track.contentHint = 'music'` is the standard way to decline it.

Failure mode to watch for: the picture is fine and the audio sounds like a conference call. Verify end-to-end with music, and confirm channel count and bitrate in `getStats()` rather than trusting the SDP.

### Mode B — "Original file" (**parked — do not build**)

**There is nothing wrong with Mode A. Mode B is the alternative that exists only if Mode A disappoints.** It is documented, not scheduled. Build it only if measurement shows Mode A is not good enough.

Mode B was originally justified by three things: laptop CPU, 4K, and HDR. With 4K and HDR out of scope (§1), only CPU remains — and at a 720p–1080p ceiling the encode is much lighter, so even that is weaker. Mode B also translates poorly to the internet, where the Source's upload becomes a hard floor rather than something WebRTC can adapt around.

**Decision gate, in order:**
1. Measure tuned Mode A on a real LAN: `getStats()` bitrate and resolution, visible quality on a TV, and laptop CPU and battery over a full film.
2. Only then run the library audit (`scripts/audit-library.sh`). If most of the library is MKV or HEVC the TV cannot decode it anyway, and Mode B is worthless without remuxing — that effort belongs in ffmpeg.wasm instead. **Never run this before step 1**: it answers nothing about Mode A.
3. Only if Mode A falls short *and* the library is TV-playable does the Service Worker bridge earn its place.

The design below is recorded so the decision can be made on evidence rather than re-litigated from scratch.

**Why a Service Worker rather than MSE.** In Mode B the TV decodes, so only the TV can answer "which bytes do I need for 1 hour 20 minutes?" An MP4 carries that answer in its `moov` index. A Service Worker lets the TV's own native media pipeline read that index, map seeks to byte ranges, and choose its buffering — our code only answers "send bytes X to Y" and writes no media logic at all. MSE would mean parsing the index in JavaScript *and* re-wrapping the data into fragmented segments MSE will accept, because ordinary progressive MP4s are not segmented that way. That is writing a remuxer. A Service Worker is the cheap option, not the expensive one. On Tizen and webOS it also has wider format coverage, because `<video src>` often reaches the platform decoder, which accepts more than `MediaSource.isTypeSupported()` admits.

**How it works.**
- The Portal's `<video>` points at a fake URL like `/stream/<fileId>`.
- A Service Worker intercepts the request, asks the Source for bytes over Trystero, and returns the response.
- Source answers with `file.slice(start, end)` as an ArrayBuffer.

**Answer with a stream, not a chunk.** A `<video>` element does not issue many small range requests. It issues **one open-ended** `Range: bytes=0-` and then reads the body lazily, throttling by simply not reading. New requests happen on *seek*, not at chunk boundaries. So the Service Worker should reply once with `Content-Range: bytes 0-<size-1>/<size>` and a `ReadableStream` it pumps continuously from the data channel. Backpressure comes free — `controller.desiredSize` drops to zero when the TV stops consuming, so we stop pulling and never buffer the film in TV memory. A seek cancels the pump and restarts at the new offset. This is what avoids the slow loading and seeking that Browsercast reports from per-chunk request/response.

Requirements:
- Handle `Range: bytes=start-`, `bytes=start-end`, a missing header, and `HEAD`. Always send `Accept-Ranges: bytes`. Never return `200` with a partial body.
- The Service Worker cannot talk to WebRTC directly. Route Service Worker → Portal page (`MessageChannel` / `postMessage`) → Trystero → Source, and back.
- Handle Service Worker lifecycle: it is killed after roughly 30 s idle and revived on `fetch`, at which point its channel to the page is gone. Re-find the page with `clients.matchAll()` and re-handshake.
- `skipWaiting()` + `clients.claim()` so the Portal is controlled on first load rather than after a reload.
- Automatic fallback: if the Portal cannot play the file (`video.error`, or `canPlayType` says no), switch to Mode A.

**File formats matter only here.** This is the one place a TV must decode the original file, so container and codec support decide whether Mode B works at all. In Mode A they are irrelevant: the Source decodes and re-encodes, and the TV only ever sees VP8/VP9/AV1/H.264, settled at runtime by `capabilities` (§10).

### Later: MKV support
Remux MKV → MP4 in the Source browser with ffmpeg.wasm (no re-encode) when codecs allow. Remuxing also helps Mode B directly, because we then control the output container and can force `faststart` so the `moov` index sits at the front, removing the initial-load stall. Out of scope for now: in Mode A it only matters for MKV files the Source browser itself cannot open, and Mode B is parked.

---

## 8. Holding on to the user's files

A browser cannot keep a usable reference to a file the user picked, across page loads, without either copying the file or holding a File System Access handle. This shapes what a profile can promise, so it is settled here rather than left to the UI.

| Approach | Verdict |
|---|---|
| **Store the `File` in IndexedDB** | Works in every browser and needs no encoding — `File` and `Blob` store directly. But a `Blob` is an immutable snapshot by spec, so this **copies the library into browser storage**: a 2 GB film costs 2 GB of quota. Unusable for video |
| **File System Access handles** | The only workable answer. `showOpenFilePicker` / `showDirectoryPicker` return handles that are structured-cloneable, so they go in IndexedDB and are revived with `requestPermission()` behind a user gesture next session. **Chromium only** |
| **Service Worker** | Does not help at all. A Service Worker can intercept network requests; it has no more filesystem access than the page |
| **Browser extension as a polyfill** | Harder than it looks and not planned. Extensions need "Allow access to file URLs", which is off by default, *and* a filesystem path — which `<input>` never provides (`File.name` is a name; `webkitRelativePath` is relative to the picked folder). Revisit in phase 2 only if Firefox users ask |

**`localStorage` cannot hold a handle at all.** It stores strings, calling `String(value)` on anything else, so a handle becomes the literal text `"[object FileSystemFileHandle]"`. IndexedDB is the only web storage that structured-clones. Thumbnails are a second, independent reason to use it.

**The strategy, which degrades honestly:**

1. **Always persist metadata** — names, durations, sizes, `fileId`s, and thumbnail JPEGs. Kilobytes, and it works in every browser via IndexedDB. A profile therefore always looks populated, and the Remote's library UI works before any file is reopened.
2. **Persist handles where available** (Chromium), re-permissioning on load.
3. **Otherwise re-pick on demand.** Ask for a file only when playback is requested and its handle is missing — "Re-select `Blade Runner.mkv`" — rather than demanding the whole library up front.
4. **Tell Firefox and Safari users plainly**, once, in the Source UI: file access is not remembered in this browser, so files must be re-selected each session; Chrome or Edge remembers them. Not a nag — state it and move on.
5. Optimise the Chromium path around `showDirectoryPicker`, which makes a whole folder one click.

---

## 9. Keeping the Source tab alive

The Source is a normal browser tab, and browsers save power by slowing down or suspending tabs you aren't looking at. There is **no JavaScript API that simply says "keep this tab alive"**. Behaviour below is as understood in September 2026; verify on current browser versions early.

**What browsers do**
- **Chrome/Edge (desktop):** background tabs have their timers slowed down (to as little as once a minute after a while). "Memory Saver" can discard inactive tabs entirely. Tabs that are playing audio or holding active real-time connections are generally treated as in use and spared from the harshest throttling and from discarding. Users can also add the site to Chrome's "Always keep these sites active" list.
- **Firefox (desktop):** similar timer throttling in background tabs; can unload tabs under memory pressure, preferring tabs that aren't playing media.
- **Safari (macOS):** throttles background tabs fairly aggressively.
- **Phones (iOS Safari especially, also Android Chrome):** once the tab is backgrounded or the screen locks, JavaScript is usually suspended within seconds and WebRTC connections drop. A phone is fine as a Remote, which reconnects on wake and holds nothing important.
- **Any device:** closing the laptop lid or letting it sleep stops everything. Nothing in a browser can prevent that.

**A phone as a Source is limited by lifecycle, not by capture.** Mode A-canvas can work on iOS — `requestVideoFrameCallback` is in Safari 15.4+, and `playsinline` is mandatory or the video goes fullscreen — but none of that matters once the screen locks. `navigator.wakeLock` can hold the screen on and only arrived in **iOS 18.4**, so older iPhones have no answer at all. Realistic best case: casting while the phone stays unlocked, awake and preferably plugged in. Fine for a clip, not for an unattended film. Budget effort accordingly and set expectations in the UI.

**Design rules that make this work**
1. **Be message-driven on the Source, not timer-driven.** Answer range requests and commands when they arrive over the data channel, instead of using `setInterval` loops. Incoming network messages keep being processed in background tabs even while timers are slowed.
2. **Heartbeats come from the foreground device, never the Source.** The Portal pings the Source; a Remote pings the Source while the phone is awake. The Source only replies, so it has no timers to be throttled.
3. **Mode A keeps the tab "busy" naturally**, because it's playing media and streaming. For Mode B, consider playing the file muted in the Source tab too, as a mirror; test whether this helps each browser avoid discarding it.
4. **Use the Page Lifecycle events** (`visibilitychange`, `freeze`, `resume`, `pagehide`) to detect trouble, and reconnect automatically on `resume`.
5. **Tell the user plainly.** On the Source: "Keep this tab open and your laptop awake while watching." Show a clear warning on the Portal if the Source stops responding ("Paul's laptop went to sleep").
6. **Screen Wake Lock** (`navigator.wakeLock.request('screen')`) keeps the screen on only while the tab is visible, so it helps on the Portal, not on a background Source tab.
7. **Remote reconnection:** the Remote will be suspended whenever the phone locks. It must rejoin its room quickly on `visibilitychange` and fetch fresh status from the Source, which relays the Portal's latest `status` (§3) — a Remote never talks to a Portal. It never holds anything important itself, so this is harmless.

---

## 10. Message protocol (Trystero actions)

All messages are typed in a shared `protocol.ts`. Keep every send targeted — export only a `sendTo(peerId, msg)` wrapper, never an untargeted broadcast.

**The Source is a router.** Because a Remote lives in its own room (§3), it never speaks to a Portal directly. The Source forwards `status` outward to each connected Remote and forwards `control` / `select` inward to the active Portal. Queue edits from a Remote are *not* forwarded: the Source applies them to its own queue and sends the Portal a fresh `queue` (§3). `library`, `thumb`, `remote-pair` and `remote-pair-ack` are Source↔Remote only and are never relayed.

| Action | Direction | Payload |
|---|---|---|
| `hello` | all | `{ role: 'portal' \| 'source' \| 'remote', name, version }` |
| `capabilities` | Portal → Source, on every connect | `{ video: [mimeType…], audio: [mimeType…] }` from `RTCRtpReceiver.getCapabilities()`. The Source uses it to choose the best codec both sides support *before* offering. **Not cached across sessions** — a TV firmware update can change it |
| `pair-credentials` | Portal → Source (ephemeral room only) | `{ roomId, roomPassword, tvName }` |
| `pair-ack` | Source → Portal (ephemeral room only) | `{ sourceName }` |
| `mint-credentials` | Source → Portal | `{ profileId }` → responds with a fresh permanent credential set (§6.8) |
| `unpair` | either direction | `{}` — the other side deletes its record |
| `library` | Source → Remote, direct | `{ items: [{ fileId, name, duration, size, mime, thumbId? }] }` — `fileId` is a random opaque handle minted per profile |
| `remote-pair` | Source → Remote (ephemeral room only) | `{ roomId, roomPassword, sourceName }` — the Source mints the Remote's permanent room, mirroring §6.3 |
| `remote-pair-ack` | Remote → Source (ephemeral room only) | `{ remoteName }` — mirrors `pair-ack` |
| `thumb` (request kind) | Remote → Source, direct | request `{ thumbId }` → response JPEG ArrayBuffer |
| `select` | Source → Portal (relayed for a Remote) | `{ fileId, startAt? }` |
| `queue` | Source → Portal, on every connect and every change | `{ fileIds: string[] }` — the whole queue, replacing the Portal's mirror. The Source owns the queue (§3); a Remote's edits go to the Source, which then sends this |
| `load` | Portal → Source | `{ fileId, mode: 'A' \| 'B' }` |
| `control` | Source → Portal. From a Remote it goes Remote → Source → Portal | `{ cmd: 'play' \| 'pause' \| 'seek' \| 'volume' \| 'next' \| 'prev' \| 'stop', value? }` |
| `source-control` | Portal → Source (Mode A only) | same shape as `control`, applied to the hidden video |
| `status` | Portal → Source, **relayed by the Source to its Remotes** | `{ state, fileId, currentTime, duration, buffered, queue, error? }` (~1/second and on change) |
| `stream-open` | Portal → Source (Mode B) | `{ fileId, start }` — begins a continuous byte pump |
| `stream-data` | Source → Portal (Mode B) | `{ seq }` + ArrayBuffer. **Known unresolved:** this says credit-based flow control while §7 specifies backpressure via the Service Worker's `controller.desiredSize`. Both are plausible and they are not the same scheme. Deliberately left unreconciled because Mode B is parked — settle it if the gate ever opens |
| `stream-close` | Portal → Source (Mode B) | `{ fileId }` — on seek or stop |
| `range` (request kind) | Portal → Source | request `{ fileId, start, end }` → response ArrayBuffer. Kept for genuine one-off reads, such as probing the `moov` box |
| `subtitles` | Source → Portal | `{ fileId, vtt: string }` (convert SRT → VTT on the Source) |
| `ping` / `pong` | Portal → Source, and separately Remote → Source | Liveness, within each two-peer room. Always sent by the foreground device; the Source only answers (§9). A Portal can never ping a Remote — they share no room (§3) |
| `device-report` | Portal → Source | **Not built yet (§12.3)** — capabilities only. The Source forwards it to the collector only if the user opted in, and only if it has not sent the same payload before |

Every `fileId` arriving at the Source is checked against the active profile's shared list before any bytes are read.

---

## 11. User interface

### 11.1 Source (laptop)

#### Pairing and setup affordances

- **QR scanner** is the default view when adding a TV: `getUserMedia` with a live preview, `barcode-detector` decoding, and **non-visual success feedback (a beep)** because the user may be facing away from the screen while pointing the laptop at the TV.
- **"Enter a code instead"** beneath it, revealing the phone instructions and a paste box with checksum validation (§6.4). Shown prominently when no camera exists or permission is denied.
- **Profiles:** create, rename, switch, delete, from the profile selector.
- **File picking** prefers `showDirectoryPicker` where available, so a whole folder is one click.
- **File persistence notice** on Firefox and Safari, once, per §8 step 4.
- **"Keep this tab open and your laptop awake while watching"** notice; full lifecycle handling per §9.
- **Thumbnails** are generated by seeking a hidden `<video>` to ~10% and drawing to a `<canvas>` at ~320 px wide, encoded as JPEG and stored in IndexedDB. Queued, never blocking — see the file list below.

#### Scope rule: one of everything per tab

**One profile, one playlist, one TV per tab.** Want two TVs? Open the site twice, build two playlists, select a different TV in each. This keeps every screen unambiguous and matches one-room-per-pairing (§3).

#### Layout

```
┌────────────────────────────────────────────────────────────────┐
│  [search: name or #tag]                    [Profile ▾] [≣ 4]   │  top bar
├────────────────────────────────────────────────────────────────┤
│  + Add files                                                   │  primary action
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [thumb]  Blade Runner 2049.mkv            ✏  [+]         │  │  scrollable
│  │          #scifi #rewatch                                 │  │  file list
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [thumb]  ▶ The Thing.mp4                  ✏  [+]         │  │  ▶ = now playing
│  │          #horror                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│  ⏮  ▶  ⏭   ━━━━━━●─────────  12:04 / 1:47:22   🔊   [📺 TV ▾] │  bottom bar
└────────────────────────────────────────────────────────────────┘
```

**Top bar:** search in the centre (filters by filename *or* tag; typing `#` pops tag suggestions), profile selector and playlist button on the right. The `≣` glyph above is a **list/queue icon, never a hamburger** (decision 32).

**Playlist button, right-hand side**, with a **badge showing the item count** so additions are visible without opening it. Use a queue/list icon, **not a hamburger** — a hamburger reads as navigation and people will click it looking for settings. Opens a drawer.

**Bottom bar** is slim and fixed: transport controls, scrub bar, volume, and the TV selector.

**Keyboard shortcuts** for transport (play/pause, seek, next/previous, volume) via Mantine's `useHotkeys`, on the Source and the Remote alike. This is where playback control lives instead of the TV remote's media keys (§11.2, `portalcast-context.md` decision 36).

#### File list

- Ordered by date added. Hover gives the row a border and shadow.
- **Thumbnail left**, then filename and tags, left-aligned. A faded spinner sits in the thumbnail slot while it is being generated.
- **Row click = play now.** Inserts the file *above* the currently playing item and starts it, so the previous item plays next rather than being discarded. Known quirk, accepted: clicking three rows in a row leaves the queue in reverse click order. Each click plays immediately so the visible result is still correct.
- **`+` = add to the end of the playlist** in one click, since that is the common case. "Play next" sits behind a small overflow (`⋯`) or long-press. *(Open: the alternative is `+` opening a two-item menu — more discoverable, one extra click every time.)*
- **Pencil icon** for per-file edits: rename (display name only, never the file on disk), blur thumbnail, add and remove tags.
- Row states:
  - **Normal.**
  - **Now playing** — marked in the list, not only in the bottom bar.
  - **Needs reconnecting** — handle exists but permission lapsed. Common and fixable; see below.
  - **Missing** — no handle at all. "Click to re-select."

#### File reconnection — two failures, only one is the user's problem

| Failure | Where | Fix |
|---|---|---|
| Permission lapsed, handle intact | Chromium, every new session | One `requestPermission()` behind any user gesture |
| Handle gone entirely | Firefox, Safari, cleared storage | Re-pick that file |

The first is routine and must not look like the second. Offer **one "Reconnect files" action** that re-permissions the whole library at once — never 40 rows each demanding attention. Rows only fall back to "missing — click to re-select" after re-permissioning has actually failed.

**During playback**, a file that cannot be opened shows a brief message on **both** the TV and the Source, lingers about 3 seconds, then skips to the next item. Guard against the all-items-fail case: stop and say so rather than spinning through the queue.

#### Playlist drawer

Opens from the right. Contains: reorder (drag), remove, repeat one / repeat all, clear, and the snapshot controls.

**Snapshots** replace having multiple named playlists. Save the current queue under a name; load it back later. If the name exists, warn that it will be overwritten. The name field defaults to the last one saved.

#### Playlist persistence — keyed by TV

**The working playlist is stored under the selected TV's `roomId`, not under the profile.** A playlist belongs to the screen you are casting to, so this resolves the two-tabs problem without any locking or user-visible compromise:

- **Two tabs, two TVs** → two independent playlists. No merging, no "this tab won't be saved" message.
- **Two tabs, one TV** → already impossible; the Web Locks TV claim prevents it. That claim *is* the persistence lock.
- **Reload** → the tab reconnects to its TV and restores that TV's queue. Correct by construction.
- **Profile scoping is free**, because a TV paired into two profiles has two `roomId`s. The key already encodes profile and TV.
- **Before a TV is selected** there is no key, so hold the draft in `sessionStorage` — per-tab by definition, survives reload, dies with the tab. Promote it to the TV's key on selection.
- Removing a pairing deletes its playlist; the `fileId`s were profile-scoped anyway.

This copy is the authoritative queue (§3). On connect the Source sends it to the Portal with `queue`, overwriting whatever the Portal held.

**Division of labour:** working playlist is TV-scoped and automatic; snapshots are profile-scoped and explicit. So "save this queue and load it in the bedroom later" is a thing the model supports.

#### Claiming a TV across tabs — use Web Locks

Hold `navigator.locks.request(roomId, …)` for as long as the tab is using that TV. It **releases automatically when the tab dies**, so there are no stale claims, no heartbeats and no cleanup code — the failure mode a `localStorage` flag would have (a crashed tab locking you out of your own TV) does not exist.

A second tab requests with `ifAvailable: true`, fails instantly, and shows "Living Room TV is in use by another tab." Pair with `BroadcastChannel` so it can ask the holding tab to hand over, rather than making the user hunt for the right window.

Verified support: `LockManager` Chrome 69 / Firefox 96 / Safari 15.4; `BroadcastChannel` Chrome 54 / Firefox 38 / Safari 15.4.

#### Settings: no settings dialog

Every control lives next to the thing it affects, which also keeps them off the scrolling area where they would disappear.

| Control | Home |
|---|---|
| Select TV, add a TV (QR scanner), manage and rename TVs | **TV button, bottom bar** → popover listing paired TVs, ending in "Add a TV…" and "Manage" |
| Switch profile, rename, delete, password (later) | **Profile selector**, top right |
| Pair a Remote (QR code), list and revoke Remotes (phase 3) | **Profile selector** — a Remote pairs with the Source, not a TV (§3), and its record lives in the profile's `remotes[]` |
| Add files | Above the file list, as the primary action |

Rejected: a row of 2–4 buttons above the file list. "Select TV" would then sit in the bottom bar while "manage TVs" sat at the top, splitting one concept across the screen, and anything above the list scrolls away.

#### Deferred: profile privacy

A profile password is recorded as **wanted but not designed** — see `portalcast-context.md` §15. Short version: a password field is itself a disclosure, so the useful version is a profile that leaves no trace at all, and that turns out to require encryption rather than a hash. Build neither until the design is settled.

---

### 11.2 Portal (TV)

Deliberately basic. It runs on the weakest hardware, is driven by a d-pad, and is read from a sofa. One persistent chrome element plus three states.

#### Persistent top bar

A **small faded bar** across the top of every state, holding the **Source selector on the right** — the Portal's mirror of the Source page's profile selector.

- Click → drop-down listing paired Sources, the active one marked, ending in **"Add a new source"**.
- **Long press → Remove** for the highlighted entry.
- **Always reachable, in every state.** This is what answers the old "when can the source list appear without interrupting playback?" question — it is ambient, never modal, so the question dissolves.
- Faded so it does not distract during playback; it should brighten on focus.

#### State A — reconnecting

Entered on load when a stored pairing exists.

1. Small **loader in the centre** of the screen while it joins the stored room and waits for the Source.
2. On success → **"waiting for the cast"** screen. That is the idle-but-connected state.
3. After **~20 s** with no peer, show the failure line — **"‹name› isn't running PortalCast"** — with **Retry**, **Remove** and **Pair a new source**. Then keep waiting and keep retrying, indefinitely. **No automatic fall-through to pairing:** the Portal stays here until the user chooses otherwise, so a TV left on does not silently abandon its pairing and start showing a QR code to the room.

#### State B — pairing

Entered when never paired, when the user presses **Pair a new source** or picks "Add a new source" from the selector, or after `/tv/reset`. **Never entered automatically from a failure** — see state A.

- Small caption: **"Ready to pair with a new source"**.
- **Giant QR code**, high contrast, wide quiet zone, high error correction, with its 10-minute countdown (§6.3).
- The top-bar selector **stays live**, so a user who just wants a different known Source is never forced through pairing.
- If the user arrived here from a failing Source, carry that context: a line near the bottom naming it — **"last source ‹name› was not accessible"** — with **Retry** and **Remove**, so pairing afresh is not the only way out.
- On success → the bookmark step (§6.5), then state A's "waiting for the cast".

#### Playback

- **Fullscreen and autoplay need a user gesture**, so the first load shows a large **"Press OK to start"** button; that single press calls `requestFullscreen()` and unlocks audio.
- Video fills the viewport on black, so it looks right even if fullscreen is refused — the layout never depends on fullscreen being granted.
- **No playback controls in v1.** Play, pause, seek, volume and queue all live on the Source and the Remote.

**Why the TV remote's media keys are deferred rather than included.** Tempting, because the TV remote is the only control to hand when the laptop is across the room. **Receiving the keys is easy** — they arrive as ordinary `keydown` events (see Input map below). Two reasons it is still not v1:
  1. **In Mode A, a local pause desyncs.** The Portal pausing its own `<video>` would stop the picture while the Source kept streaming. A key press has to become a `source-control` message, never a local action — easy to get wrong.
  2. **Keys with no visible affordance and no feedback feel broken.** Shipping them would need at least a transient on-screen icon on press, which is most of a transport UI anyway.

  `/check` (§13) logs which keys this TV browser actually delivers, so the decision can be made on data when controls are revisited.
- Screen Wake Lock held while playing (`navigator.wakeLock.request('screen')`, where available).

#### Legibility and state

- **Big, readable text.** Everything on this screen is read from a sofa: the QR code, the captions, the Source names, the failure lines.
- **Connection state is always legible**, never guessed at: *waiting* / *connected* / *reconnecting* / *Source asleep* / *error*. The Source-asleep case matters most (§9) — "Paul's laptop went to sleep" beats a frozen picture with no explanation.

#### Input map

Smart TV browsers (Tizen, webOS, Android TV) map physical remote buttons to **standard DOM keyboard events**, so a plain `keydown` listener is the mechanism — no vendor API needed in a web page.

| `event.key` | Button |
|---|---|
| `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` | D-pad |
| `Enter` | OK / Select |
| `Escape`, `Backspace` | Back — and on Tizen often **`keyCode` 10009** with no useful `key` |
| `MediaPlayPause`, `MediaPlay`, `MediaStop`, `MediaRewind`, `MediaFastForward` | Transport (captured but unused in v1, §11.2 Playback) |

Two cautions, both to confirm via `/check`:
- **Older Tizen and webOS engines may only give legacy numeric `keyCode`s** (13 for Enter, 10009 for Back). Handle `event.key` first and fall back to `keyCode`; never rely on `key` alone.
- Vendor implementations vary, which is precisely why `/check` logs `key`, `keyCode` and `code` together.

**Focus must be set explicitly** with `element.focus()` so directional keys map to the intended element — TV browsers do not maintain a sensible default focus the way desktop does.

#### D-pad navigation

Everything is reachable with arrows, OK and Back. Because the UI is a top bar plus at most three focusable elements per state, spatial navigation can be a **simple ordered focus ring** rather than a general geometric solver — hand-rolled, no library. Visible focus outline, large targets, no hover-only affordances.

---

### 11.3 Remote (phone, phase 3)

**The Remote is the Source UI.** Same layout, same file list, same playlist drawer, same bottom transport bar — with two differences:

1. **The profile switcher is replaced by a remote icon**, which offers **Disconnect**. A Remote does not own profiles; it borrows the Source's active one.
2. **Every action is proxied.** The Remote sends intent to the Source, which applies it or relays it to the Portal (§10). It never talks to a Portal, and holds no files and no authority.

Sharing the component tree with the Source is the point — it is the same React/Mantine app with a different mode flag, not a second UI.

It is **mobile-first but the same vertical file list**, not a grid — an earlier draft described a thumbnail grid, which contradicted sharing the Source's component tree. Same list, same playlist drawer, same bottom transport bar, laid out for a phone.

**Installable:** web app manifest, icons, `display: standalone`, and a small Service Worker so it opens instantly from the home screen.

#### Connecting

The Remote pairs with the **Source**, never with a TV (§3).

Same two-step shape as Source↔Portal pairing (§6.3), with the roles mirrored — the Source displays the QR, so it owns and mints the room:

1. **Source:** "Pair a Remote" in the profile selector mints ephemeral credentials, joins that room and shows a QR of `/remote/pair#…` with a 10-minute countdown.
2. **Phone:** the ordinary camera app opens the link; the page joins the ephemeral room.
3. **Source:** mints **fresh permanent** credentials and sends them with `remote-pair`; the Remote replies `remote-pair-ack`. Both leave the ephemeral room and join the permanent one. The Source records the Remote in its profile's `remotes[]`.
4. **Remote:** rewrites its URL to `/remote#<permanent payload>` and stores `{ roomId, roomPassword, sourceName, pairedAt, lastSeen }` — the same shape as the Portal, since both are "a device remembering which Source it belongs to" (§6.1).

- **Fallback:** the Source offers **copy the link** to the same ephemeral `/remote/pair#…` URL, so it can be sent by message, email or AirDrop when scanning is impractical. It is single-use and dies after 10 minutes, like any pairing link.
- **One room per Remote pairing**, so each Remote is independently revocable. Copying a paired phone's *permanent* `/remote#…` bookmark to a second phone puts both in one room — harmless, since both are trusted, but they can then only be revoked together. Pair once per device for clean revocation.

---

### 11.4 Pair page (`/pair`)

Tiny, mobile-first, and **it never joins a room on its own** — if it did, a phone scanning the TV's QR would consume the single-use pairing before the laptop ever saw it (§6.4).

- **On a phone:** the link with copy and share buttons, plus the payload on its own as a selectable code.
- **On a laptop:** a "Connect from this device" button.
- Later, once the Remote exists, this is where a phone can forward a TV's pairing payload straight to the Source instead of the user sending a link by hand.

---

## 12. Device reports and telemetry

We own two TVs plus the Tizen and webOS emulators. Real users will run PortalCast on devices we will never touch, and their Portals already know exactly what we need: receive codecs, storage persistence, fragment survival, and whether pairing and playback actually worked.

### 12.1 The collector: a Google Sheet, not a server

Reports are POSTed to a **Google Apps Script web app** (`scripts/telemetry/Code.gs`) that appends each one as a row in a Google Sheet in the owner's account. Free at this volume, nothing to host or patch, and setup is five minutes (instructions at the top of the script).

- **It stays inside the "no backend of our own" goal (§1)** in the sense that matters — there is no server we run — but it *is* an endpoint we own, so it is covered by the rules below and by a privacy page before the live app uses it.
- **The script never sees the sender's IP address** — Apps Script does not expose it — so it cannot be stored even by accident. Google's own infrastructure does see it, as with any web request (§5.2).
- **The URL is public**, so anyone can post to it. The script accepts only known report kinds, caps every cell, and neutralises spreadsheet formula injection. Spam is a nuisance, not a leak: the Sheet holds nothing secret.
- **One row per device type** (same browser on the same TV model). Columns: `hash`, `report`, then `storage survives`, `fragment survives`, `fullscreen`, `wake lock`, and `keys`.
  - `hash` is SHA-256 of the report's *shape*: the report minus every line that changes per run (timestamps, counters, page URL, window size) or that needs someone to act (the restart, fragment, fullscreen and wake-lock results), and without the remote-button log. The exclusion list is `EXCLUDED_FROM_SHAPE` in `check/index.html`.
  - A report whose hash is new adds a row. A report whose hash exists **updates that row**: action results fill in blank columns, a result that disagrees with an earlier one becomes `mixed`, and `keys` accumulates every distinct remote button seen. The page is told which row it matched and what changed.
  - **The page decides storage survival by itself**, so no identity is needed to link runs: `sessionStorage` dies when the browser closes and `localStorage` should not, so "localStorage mark present, session mark gone" means it survived a restart. A marker the page writes into its own URL catches the wiped case when the browser reopens the page. Browsers that restore `sessionStorage` on restart (Chrome's "Continue where you left off") hide the restart from this check, so the page also has an "I fully restarted the browser" button that settles it from the `localStorage` mark alone.
  - `/check` shows its **page version** (commit and build time, stamped by `vite.config.ts`) so a cached copy is obvious, and reports **User-Agent Client Hints** (`navigator.userAgentData`, Chromium only) alongside the classic user agent, which is often frozen or disguised as desktop. Send report waits for asynchronous probes to finish, so a report never carries "testing…". A fragment test that loses its fragment is recorded as a failure, not as untested.
- The script and the pages share a `v` field so old rows stay interpretable.

### 12.2 `/check`: a button, which is the consent

`/check` (§13 milestone 1b) has a **Send report** button that posts its results directly — TV browsers often cannot copy to a clipboard that reaches anyone. Pressing the button is the consent; nothing is sent otherwise. Repeat runs of the same device with the same results are de-duplicated by the sheet (§12.1).

Sending uses a plain `XMLHttpRequest` with a `text/plain` body (a "simple" request, so no CORS preflight, which Apps Script cannot answer). Where that fails, it falls back to posting a hidden form into an iframe, which crosses origins on almost any browser but cannot read the reply — the page then says it could not confirm delivery.

### 12.3 The live app: relayed through the Source, sent once — **direction agreed, not built**

1. The Portal gathers the same facts `/check` probes and sends them to the Source as `device-report` (§10), over the data channel it already has.
2. The **Source** sends them to the collector — the Portal never contacts it directly. Two reasons: consent belongs to the person at the laptop, who chose to use this (a TV is often shared); and the Source is the device that *remembers*, so it can stop a TV that keeps forgetting its own storage from reporting again on every visit.
3. **Consent is a one-time opt-in on the Source**, then automatic — a clear "Share anonymous device reports to help improve PortalCast" toggle, off by default, with the exact payload viewable and the choice reversible. Never silent without that opt-in.

**De-duplication — open.** If a TV wipes its storage and is re-paired, it looks like a new device. A device fingerprint would solve that but is exactly the persistent identifier the rules below forbid, and fingerprinting is what privacy-conscious users object to most. **Leading idea:** de-duplicate by *content*, not identity — the Source keeps a hash of each capability payload it has already sent (timestamps excluded) and skips any payload it has sent before. A TV that forgets itself produces the same payload, so it is not re-sent; nothing identifies the TV. Accepted cost: two identical TV models in one household count once, which is fine, because the question is "do 2019 Tizen panels keep `localStorage`", never "how many households own one". Settle this before building 12.3.

**A live report is not a `/check` report.** Several `/check` results exist only because a person deliberately does something — write a fragment and reload, fully restart the browser, press fullscreen. The live app cannot ask for any of that, so its report has two parts:
- **Capabilities, probed silently at connect** — codecs, crypto, features, user agent. Stable for a given TV and browser version, so this is the part to hash for de-duplication.
- **Outcomes, observed during real use** — whether a stored pairing was still there on the next load (storage survival), whether the Portal was opened from a `/tv#…` bookmark (fragment survival), whether "Press OK to start" got fullscreen (§11.2). These arrive over time, not at once, and are reported as they are first seen. They are excluded from the hash, or a TV would re-report every time an outcome arrived.
- **Not remote-control keys.** `/check` collects the key map because someone deliberately presses every button once. In real use, every press would be new information arriving forever, so the same row would be updated over and over. Live reports leave keys out entirely; revisit only if Portal playback controls (§11.2) ever need field data.

### 12.4 Hard constraints on every payload, whatever the sender

- Device capabilities and outcomes only. **Never** filenames, library contents, room credentials, profile names or IP addresses.
- **No identifier that persists across reports** — no device id, no install id, no fingerprint.
- Versioned (`v`), so old reports stay interpretable.

---

## 13. Milestones

**Phase 1 — Local files to TV (same network)**
1. **Skeleton:** Vite + TS, multi-page, deploy to static HTTPS host.
1b. **Compatibility check page** (`/check`) — ship early, it unblocks everything else. Built for **our own** TVs and emulators, not for strangers. A single static page that reports, for whatever device opens it: the probes below. **It is mostly a Mode A and pairing page, not a Mode B page** — only the last two rows concern Mode B.

   | Probe | Decides |
   |---|---|
   | `RTCRtpReceiver.getCapabilities('video')` | Whether this TV model is worth trying at all, and seeds `docs/devices.md`. **The product does not rely on this page** — the Portal reports the same thing over `capabilities` at connect time (§7) |
   | `getCapabilities('audio')`, Opus stereo in the SDP | Whether the TV's receiver *advertises* stereo Opus — necessary but not sufficient. Whether stereo actually arrives is proven end-to-end with `getStats()` in milestone 3 (`docs/quality.md`), never from the SDP (§7) |
   | `localStorage` survives a browser restart | Whether bookmarking is a convenience or the *only* pairing record (§6.5) |
   | URL fragment survives navigation and bookmarking | Whether the storage-wipe fallback works on webview-wrapper browsers |
   | `getRandomValues`, and **`crypto.subtle` AES-GCM** | Both fatal if missing: `getRandomValues` generates every credential, AES-GCM is what Trystero needs to encrypt the handshake. `randomUUID` is reported for information only — we never call it (§6.2) |
   | **`keydown` log: `event.key`, `event.keyCode`, `event.code`** | Which buttons this remote actually produces — the input map for §11.2, and whether playback controls are ever viable |
   | Wake Lock, fullscreen, gesture-gated autoplay | Portal basics |
   | `canPlayType()` against real codec strings | *Mode B only — irrelevant to Mode A, where the TV never sees the file* |
   | Service Worker registration and ranged media | *Mode B only* |

   **Audience: us.** Our own TVs, the Tizen and webOS emulators, and at most a few friends — all of whom can type a long URL. It is a development instrument, not a public page, so it needs no short domain and no marketing copy. Results reach us through its **Send report** button (§12.2), because TV browsers often have no usable clipboard. Field data from real users is the live app's job (§12.3).
2. **Pairing:** QR generation and scanning, ephemeral and permanent credentials, one room per pairing, fragment bookmarking, `unpair` and reset, profiles.
2b. **Portal UI (§11.2):** persistent top bar with Source selector, the three states, d-pad focus ring and the `key`/`keyCode` input map, wake lock. **No playback controls** — media keys are deferred (§11.2).
3. **Mode A streaming (native):** pick file, capture, stream, play/pause/seek/volume, status back to Source — **including the full quality-tuning set in §7**, with `getStats()` measurements recorded. Chrome first, then Firefox.
4. **Playlist:** multiple files, next/previous, auto-advance.
5. **Subtitles:** load `.srt`/`.vtt`, send as VTT, render on TV.
6. **Tab-alive handling:** §9 rules, Source-asleep warning, auto-reconnect.
7. **Mode B streaming — parked (§7).** Only if the gate opens: LAN measurement of Mode A first, then the library audit, then the Service Worker streaming bridge, format detection and fallback to Mode A.
8. **Multi-screen:** nothing to build — it is **one tab per TV** (§11.1), which already works. This milestone is only to confirm two tabs driving two TVs do not interfere: separate Web Locks, separate rooms, separate playlists. Note Mode A costs one encode per screen, so two TVs is twice the laptop CPU. Mirroring one playlist onto two TVs simultaneously is a *different* feature and is out of scope — it contradicts one-of-everything-per-tab.
9. **Mode A-canvas** for Safari and iOS Sources (§7). Last, because it is a second capture implementation with its own A/V sync — and because the iOS lifecycle limits in §9 may cap its value regardless. Timebox it; drop it if it resists.

**Phase 2 — Browser extension for website video** (separate plan later)
- Extension acts as another Source using the same protocol.
- Either capture the page's `<video>`/tab as a stream (works widely, call quality) or send the video's URL for the TV to load directly (better quality, often blocked by login/CORS).
- DRM sites will not work, by design of the browser.
- Aim for the Chrome Web Store and Firefox Add-ons; the website links to the store listing.

**Phase 3 — Mobile Remote and watching with a friend**
- **Goal:** a friend in another home opens `/tv` on their TV, and their TV's QR code reaches my laptop — scanned by their phone and forwarded, or shared as a link. My laptop joins as the Source and shares a profile's files. They browse and control playback from their own phone; I just keep the tab open.
- **Mobile Remote PWA** (§11.3) is the main deliverable — the Source UI in Remote mode, not a second UI. It works the same whether the Source is in the same house or across the internet.
- **Profiles are the sharing boundary.** A friend gets their own profile, so they see only the files it contains, in a room no other Source is in.
- **Internet connections, direct only:** most home-to-home WebRTC connections work directly with STUN. Some networks (strict routers, mobile carriers, offices) can't connect without a TURN relay; in phase 3 these fail. Detect this via Trystero's `onJoinError` (SDP exchanged but no direct connection) and show a clear message: "Couldn't connect directly to this TV's network. Try another network, or both devices on the same Wi-Fi." Log how often this happens so phase 4 is sized on real data.
- **Mode A over the internet**, since WebRTC adjusts quality to the available bandwidth. Mode B stays parked here too (§7): even if the gate ever opens for the LAN, the Source's upload becomes a hard floor over the internet.
- **Data, not pixels:** the Remote renders its own UI from the `library` and `status` messages. Streaming the Source tab to control it was rejected: it needs a screen-share prompt every time and still can't be clicked from another device without a translation layer.
- Seeks travel Remote → Source → Portal (§3), so the **Remote** must update its own scrub bar optimistically and reconcile against `status`, or the UI will feel broken. Two hops, not one.
- A TV-remote-only library browser on the Portal can come later, reusing the same messages.
- Phase 3 only needs phase 1, so it can be built before phase 2.

**Phase 4 — TURN relay for hard networks** (last)
- Only for users whose networks block direct connections. Everyone else stays direct and costs nothing.
- Cost is the main concern: relayed video goes through the TURN server, and a 2-hour 1080p film is roughly 2–4 GB. Cloudflare's free tier (1,000 GB/month) is only about 250–500 relayed films a month across all users, so it can't be offered openly and unmetered.
- Options to evaluate then: self-hosted coturn on a cheap VPS with generous bandwidth; short-lived TURN credentials issued per session (needs a tiny backend); per-user caps; a paid tier; or "bring your own TURN" config for power users.
- Wire it through Trystero's `turnConfig` option and show on screen whether a connection is direct or relayed.

---

## 14. Testing

- **Unit:** credential generation, QR payload encode/decode, fragment parsing and precedence rules, profile and `fileId` allowlist checks, SRT→VTT, range header parsing, protocol message validation.
- **Local multi-tab test:** open `/tv`, `/` and `/remote` in three browser windows on one machine. Pairing needs a camera, so provide a test hook to inject a QR payload directly rather than scanning.
- **Automated:** Playwright with three browser contexts for pairing (via the injection hook), roles, Mode A, and Remote control. (Mode B only if its gate opens, §7.)
- **Mode A quality:** `getStats()` measurements of bitrate, resolution, framerate and codec, with and without the tuning set, recorded in `docs/quality.md`. Confirm stereo audio actually arrives. Also record laptop CPU and battery over a full film — that is the number the Mode B gate turns on.
- **Library audit — Mode B only, NOT on the critical path.** `scripts/audit-library.sh ~/Movies` reports container, codec, resolution and HDR distribution plus what fraction would play directly on a basic TV. **Only run it if the Mode B gate opens** (§7). In Mode A the Source decodes the file and re-encodes it as a WebRTC stream, so the TV never sees the container or the file codec and the library's format mix is irrelevant.
- **Emulators** where real hardware is missing: Tizen Studio and the webOS TV SDK both ship free TV emulators. Not trustworthy for codec support, but fine for Service Workers, fragments, storage behaviour and `canPlayType` shape.
- **Background-tab tests:** play a long file with the Source tab in the background for 30+ minutes in each desktop browser; record whether playback survives. Keep results in `docs/devices.md`.
- **Real devices early:** at least one Samsung (Tizen) or LG (webOS) TV, one Android TV with a sideloaded browser, one iPhone and one Android phone as Remotes. Per device record: fullscreen, autoplay, Service Worker, `RTCRtpReceiver.getCapabilities` codecs, `getRandomValues` and `crypto.subtle` AES-GCM, the remote's key map, **whether URL fragments survive**, **whether `localStorage` survives a restart**, and how bookmarking works.
- **Scanning:** real laptop webcams against real TV panels, at angles, with glare, on glossy screens.
- **Internet test (phase 3):** Source and Portal on different networks, including one on mobile data. Record which combinations fail without TURN.
- Debug overlay on the Portal (hidden behind a key combo) showing relay status (`getRelaySockets()`), peers and roles, mode, bitrate, direct vs relayed.

---

## 15. Open questions

- Domain for PortalCast — `portalcast.tv` is the current candidate. **Nothing is blocked on it:** the only people typing a URL on a TV are the owner and a few friends, and the permanent pairing is a bookmark thereafter (§6.5). Also check trademark clearance: "Portal" is a Valve game and was also a Meta device name, so avoid their logos or artwork and check the combined name.
- Which default relays to pin in `relayConfig.urls`, and whether to self-host a `ws-relay` from day one for reliability.
- **Is tuned Mode A good enough on a LAN at 1080p?** The single most valuable early measurement, and the only one that matters: if yes, Mode B is never built and the library's formats never matter. Answered by the measurements taken in milestone 3 (§13) and recorded in `docs/quality.md` (§14).
- Worth considering as a Mode B alternative: let two Sources connect and simply **transfer the whole file**, so a friend plays it locally. Sidesteps streaming entirely, but turns the project into a file-transfer app as well. Not designed.
- **Subtitles: burn into the Mode A capture at the Source, or overlay as text on the Portal?** The `subtitles` protocol message (§10) already assumes the second. Trade-off:
  - *Burn in:* works on any TV regardless of its capabilities, costs a canvas compositing step in the capture pipeline, and is then unstyleable and un-toggleable from the TV.
  - *Overlay:* toggleable and styleable, needs the cue list shipped over the data channel and TV-side timing against `status`.
  - **Embedded MKV tracks are unaddressed under either option** — sidecar `.srt`/`.vtt` only (milestone 5). Extraction needs ffmpeg.wasm or a JS demuxer, and LocalMovieSync already does it, so it is table stakes (`portalcast-context.md` §8.2).
- **Does `+` add to the end of the playlist, or open a two-option menu?** (§11.1.) Adding directly is one click for the common case; the menu is more discoverable but slower every time.
- How many friends' Portals one laptop can serve at once. The mechanism is already settled — one tab per Portal (§11.1) — so the open part is upload bandwidth and CPU, since each tab is its own Mode A encode.
- Phase 4: which TURN approach to use and how to pay for or cap it (see phase 4 notes).
