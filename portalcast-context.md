# PortalCast — Background, Research and Decision Log

Companion to `portalcast-plan.md`. The plan says **what** to build; this file records **why**: the original idea, what research found, which options were considered and rejected, and which facts are verified versus assumed. It was written from planning conversations on 28–30 September 2026. Use it when a decision in the plan needs revisiting.

**The plan is the single source of truth for the current design.** This file does not restate the design; where it mentions it, it points at a plan section. If the two disagree, the plan wins and this file is the one to fix. Two maintenance rules keep it that way:
- **Never describe the current design here.** Record the reasoning, the research and the owner's words, and link to the plan for the "what".
- **Never reword a decision-log entry in place.** When a decision changes, mark the old entry *Superseded by #N* and append a new one. Partial rewording is how entries went stale before (decision 49).

**Section 14 holds browser and library facts verified by direct lookup.** Prefer it over anything else in this file where they disagree.

Confidence labels used below:
- **[verified]** — checked against a source during research (links in section 13).
- **[knowledge]** — general technical knowledge, not checked against a source during research. Likely right, but confirm before relying on it.
- **[decision]** — a choice made by the project owner.

---

## 1. The original idea

People struggle to get Chromecast, Plex, DLNA and similar set up. Browsers already contain everything needed for peer-to-peer streaming. So: a website acts as a viewport on the TV, another page on the computer attaches local video files (referenced by JavaScript, never uploaded), and the computer tells the TV what to play. Completely app-free, just websites. Multiple TVs could be controlled from one controller.

The first idea was to connect the devices by IP address, then add codes or QR codes later. That order was reversed (see 3.1).

---

## 2. Owner priorities, in the owner's words

The standing principles behind the decision log. Each specific choice is in §12; the design is in the plan.

- Build from scratch in TypeScript, with AI assistance, rather than forking an old project — technology has moved on, and a small inactive codebase is a tie (decision 5).
- **Keep it simple.** "Simplicity is often the best way to do security" — a design with no weak secret needs no audit (decisions 6, 7, 43).
- Nothing is ever typed on the TV, and line of sight to the screen is the authorisation (decisions 6, 9).
- Quality: "Most people will likely be playing crappy quality downloads anyway." 1080p ceiling, 720p sweet spot (decision 21).
- Mode B: "I am tempted to avoid Mode B as much as possible, unless I find LAN performance poor." Shelved until Mode A is measured (decisions 22, 45).
- Hosting: GitHub Pages to start; the owner has not used Cloudflare. The `<user>.github.io` root repo is already in use, so the site lives under a project path — acceptable, since only the owner and a few friends type a URL on a TV (plan §4, decision 25).
- TURN last, because public usage would exhaust a free tier (decision 14, §10).
- Plain-language explanations; keep user-facing copy and docs simple.

---

## 3. Core technical findings

### 3.1 Why codes, not IP addresses
- **[knowledge]** A web page cannot listen for incoming connections on an IP address the way a server can. Two browsers can only connect to each other through WebRTC, and WebRTC needs a **signalling** step: a third party passes each side's connection details to the other. After that, media flows directly (on a home network, the signalling service never touches the video).
- Since a signalling service is required anyway, room codes cost nothing extra. So codes/QR are the starting point, and "by IP address" was dropped.
- The design later moved from typed codes to **QR codes only** (7.10). The reasoning here is unaffected: a rendezvous identifier is needed either way.

### 3.2 Two ways to get the video to the TV
1. **Mode A, live capture** — re-encode on the laptop and send a WebRTC stream. **[knowledge]** Plays anything the laptop can decode and adapts to the connection, at the cost of a call-style re-encode and laptop CPU.
   - **[verified 30 Sep]** `captureStream()` has **never shipped in WebKit**, and Firefox only got it unprefixed in 149 (14.1).
   - **[verified 30 Sep]** WebRTC quality defaults assume a video call; tuned (14.4), 1080p on a LAN should be close to transparent.
2. **Mode B, original file bytes** — the TV decodes the file itself. **[knowledge]** Original quality, but MKV and HEVC often won't play on a TV browser, and many personal libraries are MKV.

Originally Mode B was to follow Mode A as the "high quality" mode (decision 2). Once 4K and HDR were ruled out that case collapsed, and Mode B is now shelved until Mode A is measured (decisions 21, 22, 45; plan §7).

### 3.3 How to feed file bytes to the TV (Mode B)

**The real question is who parses the container and maps a timestamp to a byte offset.** In Mode B the TV decodes, so only the TV can answer "which bytes do I need for 1 hour 20 minutes?" An MP4 carries that answer in its `moov` index (nested `trak` / `mdia` / `stbl` tables). Something has to read it.

- Option 1: Media Source Extensions (MSE) — a browser API where JavaScript feeds video chunks straight to a `<video>` element instead of giving it a URL. **[verified]** Browsercast's author rejected MSE as complicated and only supporting fragmented MP4. **[knowledge]** Understated: with MSE you parse the index yourself *and* re-wrap the data into self-contained segments MSE will accept, because ordinary progressive MP4s are not segmented that way. That is writing a remuxer.
- Option 2 (chosen): **Service Worker range-request bridge.** **[verified]** Browsercast uses a Service Worker that intercepts the video element's HTTP range requests and forwards them to the sender over WebRTC, returning the bytes as the response. The TV's `<video>` thinks it's reading a normal file from a server. **[verified]** Browsercast notes initial load and seeking can be slower, apparently due to packet size limits, but watching is fine.
- **[verified]** Handling range requests in a Service Worker is supported by all major browsers, but parsing the `Range` header and returning a correct 206 response is fiddly (web.dev article).
- **[knowledge]** Service Workers require HTTPS, and older TV browsers may have patchy support, so this must be tested on real TVs.
- **Assessment [30 Sep]: the Service Worker is the *cheap* option, not the expensive one.** It lets the TV's own native media pipeline read the index, map seeks to ranges and choose its buffering, so our code writes zero media logic. On Tizen/webOS it also has wider format coverage than MSE, because `<video src>` often reaches the platform decoder, which accepts more than `MediaSource.isTypeSupported()` admits **[knowledge — test on device]**. Its real costs are: no WebRTC in worker scope (W3C SW issue #1522), so every request routes SW → page → data channel; worker lifecycle (killed ~30 s idle, channel to the page gone on revival); and needing `skipWaiting()` + `clients.claim()` for first-load control.
- **Correction to Browsercast's per-chunk model [30 Sep, knowledge].** A `<video>` element does not issue many small range requests; it issues **one open-ended** `Range: bytes=0-` and reads the body lazily, throttling by not reading. New requests happen on *seek*. So the Service Worker should answer once with a `ReadableStream` it pumps continuously, getting backpressure free via `controller.desiredSize`. This is very likely the cause of the slow initial load and seeking Browsercast reports, and it makes "1 MB chunks, prefetch the next one" the wrong design.
- The design that resulted is recorded in plan §7 (Mode B, parked). It is only built if the gate there opens.

### 3.4 TV browser realities
- **[knowledge]** Samsung (Tizen) and LG (webOS) browsers are Chromium-based and fairly capable. Fire TV has Silk. Many Android TV / Google TV devices ship **with no browser**; a browser can be sideloaded (TV Bro is popular; sideloaded Chrome works but is awkward with a remote).
- **[knowledge]** Fullscreen and audio autoplay require a user gesture on that device. A remote-control press on a button usually counts. The controller cannot trigger fullscreen on the TV remotely. Fix: a big "Press OK to start" button, plus a full-viewport black layout as a fallback.
- **[verified]** A self-hosted signage project runs on the Samsung Tizen browser and advises: set the player page as the browser homepage, use the browser's own Full screen menu option, and disable the TV's auto power-off and screen saver. Its TV player is written in plain ES5 for old TV browsers.
- **[verified]** AWS's streaming docs note Samsung, LG and Fire TV browsers don't support microphone input and Silk has limited gamepad support; a reminder that TV browsers vary in odd ways.

### 3.5 Risks identified early
- The laptop is effectively the server: if it sleeps, the lid closes, or the tab is closed, playback stops.
- Users will immediately expect subtitles (SRT files and embedded tracks).
- The target audience partly overlaps with people whose TVs have no usable browser.

---

## 4. Signalling options considered

| Option | Notes | Status |
|---|---|---|
| **PeerJS** | Library with a free hosted signalling server; give each page an ID and connect. Great for prototypes, no uptime guarantee. **[verified]** used by Camera Cast and LocalMovieSync. | Considered |
| **Trystero** | Uses existing public networks (Nostr, BitTorrent trackers, MQTT, IPFS) or Supabase/Firebase/self-hosted relay for signalling. No server of your own. | **Chosen** |
| Firebase / Supabase / Cloudflare Workers free tiers | Own the signalling later if reliability becomes a problem. | Fallback |
| Own Node WebSocket server | Tiny, but it's a server to run. | Fallback |

**STUN** helps a device discover its public address (free public ones exist); on a home network it's often not even needed. **TURN** relays traffic when a direct connection fails; not needed on a LAN. See section 10.

---

## 5. Trystero facts (from its README, September 2026)

All **[verified]** from github.com/dmotz/trystero unless marked.

- MIT licensed; about 2.7k stars, 158 forks, 1,267 commits: actively maintained.
- Strategies: Nostr (**default**, `trystero` package), MQTT, BitTorrent, Supabase, Firebase, IPFS, and a self-hosted WebSocket relay (`@trystero-p2p/ws-relay`, with `createWsRelayServer` for Node/Bun/Deno). Swapping strategy means changing the import only.
- Author's robustness ranking for decentralised strategies: Nostr (hundreds of relays), then MQTT, BitTorrent, IPFS. Supabase/Firebase are a middle ground.
- **Privacy statement:** beyond peer discovery, app data never touches the strategy medium; it's sent directly peer-to-peer and end-to-end encrypted.
- **Encryption of the handshake:** SDPs pass through the strategy medium. By default they're encrypted with a key derived from app ID + room ID, which **a relay operator could reverse-engineer**. Passing a `password` derives the key from it instead (AES-GCM). All peers must use the same password or they can't connect.
- `joinRoom(config, roomId, callbacks)`: `config.appId` (required), `password`, `passive`, `relayConfig` (`urls`, `redundancy`, `manualReconnection`, `warnOnRelayFailure`, strategy keys), `rtcConfig`, `trickleIce`, `turnConfig`, `rtcPolyfill`.
- Callbacks: `onJoinError(details)` fires on wrong password, handshake failure/timeout, or **when SDP was exchanged but a direct connection couldn't be made** (the "you need TURN" case). `onPeerHandshake(peerId, send, receive, isInitiator)` is an async gate that runs after transport connects but **before the peer becomes active**: resolve to accept, throw to reject. `handshakeTimeoutMs` defaults to 10,000 ms. Pending peers don't trigger `onPeerJoin` and their non-handshake data is dropped. This is the hook for the `hello` role check (plan §6.5).
- Room API: `leave()`, `getPeers()`, `addStream`/`removeStream`, `addTrack`/`removeTrack`/`replaceTrack` (with `target` and `metadata`), `onPeerJoin`, `onPeerLeave`, `onPeerStream`, `onPeerTrack`, `makeAction(id, config)`, `ping(peerId)`.
- `makeAction` handles serialisation and **automatic chunking** of large data, progress callbacks, binary metadata, and a **request/response** kind (`kind: 'request'`, `request()`, `requestMany()`, `timeoutMs`). The request kind fits Mode B's "give me bytes X–Y".
- `selfId`, `getRelaySockets()` (relay connection state, useful for a debug panel), `pauseRelayReconnection()` / `resumeRelayReconnection()`.
- Trystero connects every peer in a room to every other peer (mesh) **[knowledge, consistent with README's room model]**. Rooms should stay small.
- README suggests Cloudflare TURN (free tier 1,000 GB/month), Open Relay, or self-hosted coturn / Pion TURN / Violet / eturnal. Data via TURN stays end-to-end encrypted.
- Trystero adds default STUN servers when `turnConfig` is used; to fully control STUN, pass `rtcConfig.iceServers`.

**Verified 30 September, from the README:**
- `getPeers()` "returns a map of `RTCPeerConnection` instances for the peers present in room". So the real peer connections are reachable — needed for quality control.
- `makeAction`'s send signature is `send(data, [options])` with `options` of `target, metadata, onProgress, signal`. **`target` accepts a peer ID or an array**, so messages can be addressed to one peer.
- `onPeerHandshake(peerId, send, receive, isInitiator)` runs *after transport connects* but before the peer becomes active, so its `send`/`receive` are a direct encrypted data channel to that one peer — not relayed, not broadcast. Pending peers don't fire `onPeerJoin` and their non-handshake data is dropped.
- **`addStream` does NOT automatically send to peers who join later.** The documented pattern is to re-send on `onPeerJoin` with `{target: peerId}`. This matters: streams are added per peer anyway, so multi-screen Mode A is explicitly N encodes and N senders.

### 5.1 Two gaps, and the plan to upstream them

1. **`addStream()` / `addTrack()` return nothing.** The `RTCRtpSender` — the only object carrying the quality knobs (`setParameters`) — is created internally and never handed out, so it must be dug out of `getPeers()` → `getSenders()` and matched by track. Racy, because the sender doesn't exist until negotiation completes and no event announces it. Since streams are added per peer with `{target}`, **returning the sender is sufficient and non-breaking** (it currently returns `undefined`). An `onPeerSender` event was considered and rejected as unnecessary once we learned `addStream` doesn't fan out to late joiners.
2. **No SDP transform hook.** Opus stereo (`stereo=1; maxaveragebitrate=…`) can only be requested by editing the SDP text — there is no JavaScript API for it in any browser — and `setCodecPreferences()` must run before the offer is built, which Trystero does internally. Workaround: the documented `rtcPolyfill` option (intended for Node/React Native) accepting an `RTCPeerConnection` subclass that intercepts `setLocalDescription`. Clean fix upstream is an `sdpTransform: (sdp, type) => sdp` option — the name simple-peer and mediasoup both use.

**[decision]** Build with the `rtcPolyfill` wrapper, open the PR in parallel, drop the wrapper when it lands. Good first contribution: small, no API break, real gap rather than preference. Caveat: shape depends on internals not yet read.

**Not verified:** exactly which default STUN servers Trystero uses (the STUN operator sees users' public IPs), the default Nostr relay list, whether `selfId` persists across sessions (assume **not** — it is documented as unique "globally across rooms", which is a per-session scope), the upper bound of `handshakeTimeoutMs`, and whether `password` can be changed without leaving and rejoining (assume **not** — it is a `joinRoom` config argument). Check the source before launch.

---

## 6. Privacy model — reasoning

The current privacy model — what each party can see, and the threat table — is plan §5.2 and §5.3. What belongs here is why it is shaped that way.

**There is no short-secret weak spot, and that is the whole point.** The QR code transfers a 128-bit room id and a 256-bit password directly, so nothing in the system is brute-forceable and no key derivation is needed anywhere. This is the single biggest simplification the QR design bought (7.10).

**Superseded weak spot, kept for the record.** The earlier design derived `roomId` and `password` from a short typed code with a single SHA-256. That was enumerable offline — a single SHA-256 is nanoseconds, so 10⁶ six-digit codes is instant and even the proposed 31⁸ ≈ 852 billion alphanumeric space is hours on a GPU. Length was never the lever; the derivation was. See 7.10 for why the whole approach was dropped rather than patched.

---

## 7. How the pairing design evolved

1. Start: connect by IP → replaced by codes (3.1).
2. Need a password so guessing a room ID isn't enough → Trystero's `password` option.
3. "A code doesn't contain a password" → **derive both room ID and password from the one code** with SHA-256 and different prefixes. The raw code never leaves the device.
4. "How does a laptop scan a QR code?" → **flip roles: the TV shows the code, the laptop types it** (like Netflix/YouTube TV pairing). QR codes are for phones. Pointing a laptop webcam at the TV works (jsQR or the browser's barcode detector) but is clumsy; a possible extra, not the main path.
5. Direction: **the TV hosts the room and waits; the laptop joins.** Makes multi-screen easy (one room per TV, laptop joins several).
6. Allow/Deny prompt on TV → **dropped for the first device**; the code proves physical presence. Code rotates after each pairing; the TV shows a "‹device› connected" notice.
7. Second device → **"Switch to this device?"** with Yes pre-selected. "Add as second controller" later.
8. After pairing → exchange a long **home secret**, store in `localStorage`, reconnect via a home room without a code. Fall back to a code if storage was cleared (common on some TVs **[knowledge]**).
9. Phase 3 adds roles (Source vs Remote), so "first device" becomes "first device **of each role**".

### 7.10 Steps 2–9 above were all superseded on 30 September

The typed-code design was reworked three times in one session and then discarded wholesale. The intermediate designs are recorded because each failure is instructive, and because a future reader may otherwise re-propose one.

**Attempt 1 — invert the direction.** Source hosts the room, TV opens `portalcast.net/#r=<code>`. Gains: multi-screen collapses to one room; the approval prompt moves to a device with a keyboard, which removes the reason decision 9 existed. Problems found: typing a URL containing `#` and `=` on a TV on-screen keyboard is *worse* than typing a code (those symbols are buried in submenus), and a bookmarked room ID is "reserved" from the user's point of view while Trystero reserves nothing — two Sources that picked the same code would land in the same room with the same derived password and see each other's peers.

**Attempt 2 — temporary numeric code, then a durable UUID.** Numberpad on the TV (digits only, easy with a d-pad), upgrading to a UUID + independent random password kept in `localStorage`, nothing in the URL. Added: PBKDF2 (~300k iterations) instead of a single SHA-256 for the pairing room derivation, so enumeration costs ~100 ms per guess rather than nanoseconds, making 6 digits defensible. Also added: a **second** 6-digit code generated and displayed by the TV and typed into the Source, giving mutual proof of physical co-presence — the Source's code proves the TV's operator saw the laptop, the TV's code proves the laptop's operator saw the TV. This is what defeats a malicious Source camping in the pairing room: it cannot produce the TV's digits because it cannot see the TV.

**Attempt 3 — ECDH plus a short authenticated string.** An intermediate scheme encrypted the durable credentials under `PBKDF2(sourceCode + tvCode)`. Broken: an interloper already in the pairing room knows the Source's code and receives the ciphertext, so it needs only the 6-digit TV code — a million candidates, GPU-feasible offline — after which it can impersonate the TV permanently. Replaced with proper SAS design: exchange P-256 ECDH public keys over the handshake channel, then display 6 digits derived from the session key so a man-in-the-middle produces mismatching values. This was sound, and it is the design a typed-code flow *should* use.

**Rejected on grounds of complexity, not correctness.** In the owner's words: "It's clumsy but it's a one off clumsy thing to just not have to build a whole encrypted flow that we then have to audit and logic through. Simplicity is often the best way to do security."

**Attempt 4, adopted — QR only.** The TV displays ephemeral full-entropy credentials as a QR code; a camera reads them. The crypto collapses to `crypto.getRandomValues`: no PBKDF2, no ECDH, no SAS, no derivation of any kind, because there is no short secret to protect. Line of sight to the screen is the authorisation, which is the WhatsApp Web / Discord login model. This reverses decision 6 (which had called webcam scanning "clumsy, a possible extra, not the main path") knowingly.

**Refinements during that session:**
- **One room minted per pairing.** Sharing one permanent room across Sources would give them direct connections to each other, because Trystero is full mesh. A fresh room per pairing makes isolation structural rather than a discipline every `send` must remember. *(Recorded at the time as a "two-peer invariant"; narrowed on 30 September to "no cross-connection between parties that don't know each other" — see §16 answer 3, since a Remote is an invited third peer.)* Rotating only the password on a kept room was considered: it saves nothing (a config change needs leave + rejoin either way) and permanently exposes the room ID to anyone who photographed the QR.
- **One active Source per Portal**, chosen from an on-screen list. Solves TV memory limits, households fighting over a screen, revocation, and where the "add a source" affordance lives — one control, four problems.
- **URL fragment as the portable pairing record.** Many built-in smart TV browsers clear `localStorage` between sessions. A bookmarked `/tv#…` survives it, so on those TVs the bookmark *is* the record and storage is a cache. This composes with one-active-Source: one bookmark per Source is complete, and switching is just opening the other bookmark.
- **A `/pair` landing page that never auto-joins.** Found while questioning whether the fragment needed a type tag: it does not, because the pairing payload is consumed by the *Source* and the permanent payload by the *Portal*, so the path disambiguates. But if the QR pointed at the Source page, a phone scanning it would join the ephemeral room and consume the single-use pairing before the laptop saw it.
- **What was retained from the discarded work:** one room minted per pairing, independent random passwords (never derived from a UUID, since a UUID can reach a URL, a bookmark or a synced bookmark list), `unpair` messages so revocation is symmetric, a path-based reset (`/tv/reset`, because `?` is buried on TV keyboards), and per-profile opaque `fileId`s.

---

## 8. Competitor and prior-art survey

Searched 28 September 2026 across GitHub, app stores, product sites and forums. **No project was found that combines all of: website on both ends, local files, and a controller driving one or more TV screens.** Every individual piece exists.

### 8.1 Closest direct competitors (TV side is a website, sender is an app)
- **CastBrowser** (castb.cc) **[verified]**: open castb.cc on any browser (smart TV, Xbox, PS4, projector, hotel TV), type the 3-character code shown in the CastBrowser **app**, and it pairs. MP4 and HLS play reliably; DASH, MKV, WebM, AVI depend on the receiving browser. Can pick a local file. Sender is a phone app, not a website.
- **Web Video Caster** (InstantBits) **[verified]**: established app; most web browsers can be receivers by visiting cast2tv.app (PS4, smart TVs, consoles, set-top boxes). Doesn't decode or transcode; the TV must support the format. Also has desktop browser extensions (Chrome, Firefox, Safari, Edge) and a browser receiver at cast2tv.io. Users report the phone-receiver connection isn't always consistent.
- Takeaway: the "website as TV receiver" idea is proven in the market. The differentiator is **no app on the sending side either**, plus multi-screen and a web Remote.

### 8.2 Same technology, different purpose ("watch together")
- **CineLink** (github.com/SanjayB29/Watch-Together) **[verified]**: host plays a local file, captures with `captureStream()`, streams to up to 4 guests over P2P WebRTC; synced controls, SRT/VTT subtitles parsed client-side and broadcast, passcode rooms, host-only controls. Node server for signalling. Closest to Mode A.
- **Fizzy444/watch-together** **[verified]**: P2P broadcast of local files (.mp4, .mkv, .webm, .mov) to multiple friends; star topology.
- **movie-night-together** **[verified]**: two-browser P2P, `captureStream()`, host-authoritative sync over a data channel, shows "Direct P2P" vs "TURN Relay" from WebRTC stats (a nice touch worth copying).
- **LocalMovieSync** **[verified]**: single static HTML file, PeerJS free broker, loads movie folders, extracts embedded MKV subtitles; but **everyone needs their own copy of the file**; it syncs playback only.
- **WatchWithMe** (PeerJS), **SyncWatch** (extension), **FileParty** (WebTorrent-based), **Video Party**, **Movmash** (needs Google sign-in to host) **[verified]**.
- None is designed around a TV screen plus remote-style controller.

### 8.3 Most useful reference: Browsercast
- github.com/johanholmerin/browsercast **[verified]**: casts local files to **Chromecast** from the browser, no install. WebRTC between sender and receiver; Service Worker range-request bridge (3.3). Supports MP4, WebM, MP3, AAC, WAV, SRT/VTT subtitles, and WebTorrent streaming.
- MIT license; 12 commits, 6 stars, 4 forks, 1 open issue: a small, quiet project.
- The receiver is launched and paired through Google's Cast system, which is exactly the part PortalCast replaces.
- **[decision]** Don't fork or contribute; build from scratch and borrow the Service Worker idea.

### 8.4 Same plumbing, other purposes
- **Camera Cast** (github.com/ctbot000/camera-cast) **[verified]**: streams a camera to any browser P2P, no app, no account, no server of its own; PeerJS signalling; pairs by link, QR or 8-character code with no look-alike characters; codes persist across visits; one broadcaster, many viewers. Nearly the same architecture; good code to study.
- **Picklecast** **[verified]**: share your screen to a projector with only a web browser.
- **Snapdrop, PairDrop, LocalSend Web** **[verified]**: browser-to-browser file transfer (copies whole files, no playback control). Snapdrop is mentioned as a way to send files to Android TV.
- **devx-cast** **[verified]**: screen-share caster/presenter with room codes, Supabase signalling, GitHub Pages hosting.

### 8.5 App-based local casting (not app-free)
- **1001 TVs** **[verified]**: sends local files including MKV/4K to a TV over the LAN, no cloud; needs its app.
- **Go2TV** **[verified]**: desktop app casting to DLNA TVs and Chromecast, optional FFmpeg transcoding; uses a custom Chromecast receiver.
- **FCast** **[verified]**: open-source casting protocol and receivers (desktop apps).
- **PlayBridge** **[verified]**: open-source phone→Android TV suite; needs APKs on both ends.
- **LocalCast, TV Cast, CastPlay** and many similar iOS/Android apps **[verified]**.
- **Plex** remains the "proper" answer on forums, but needs a server and apps.

### 8.6 Multi-screen control already exists in digital signage
- **Mjebreen/signage** (self-hosted, any TV browser including Tizen, pairing code, no TV app) **[verified]**; **AbleSign** web player (pairing code) **[verified]**; OptiSigns, Play Digital Signage PWA, Screenly Anywhere **[verified]**. Business-focused and based on uploaded media, but they show TV-browser players with pairing codes work in practice. Signage vendors list browser weaknesses: crashes on long runtimes, sleep interruptions, autoplay restrictions **[verified, Juuno]**.

### 8.7 Assessment
- The exact combination appears unclaimed.
- Moat is thin: CastBrowser or Web Video Caster could add a web sender. The edge has to be **polish**: easiest pairing, subtitles, MKV handling (where others struggle), multi-screen, and the web Remote.

---

## 9. Why casting alone isn't enough (market reasoning)

All **[knowledge]**, not researched in depth.
- Chrome tab/video casting reaches only Chromecast, Google TV, and TVs with Chromecast built in (some Sony, TCL, Hisense). Safari/Apple devices AirPlay to Apple TV or AirPlay-capable TVs.
- Many Samsung and LG TVs don't accept Chrome casting; their YouTube/Netflix apps pair with phones via their own protocols.
- Firefox has no casting. Hotel TVs, projectors, consoles and older smart TVs often can't receive casts. Casting is often flaky (device not found, drops).
- Pitch: "If your TV has a web browser, it works."
- This is an assumption to test: if phase 1 users ask "can it do YouTube too?", that's the signal for the phase 2 extension.

---

## 10. Phase-by-phase reasoning

### Phase 2 — browser extension for website video
- Two approaches: **capture** the page's video or tab as a stream (works almost everywhere, call quality) or **send the video's URL** for the TV to load directly (better quality, laptop idle; often fails when the site needs login or blocks cross-site loading). **[knowledge]**
- DRM services (Netflix, Disney+) block capture; you get a black screen. Target ordinary web video.
- Distribution: **store listing preferred** [decision]; the website can link straight to it. Casting extensions are an ordinary category and should pass review if not pitched around piracy **[knowledge]**. Sideloading is awkward: Chrome needs developer mode; Firefox requires Mozilla signing, though unlisted signing is possible **[knowledge]**.

### Phase 3 — mobile Remote, and watching with a friend
Design: plan §3 (Remote topology), §11.3 (Remote UI and pairing), §13 phase 3. Reasoning only below.
- Original idea: share the controller tab to the TV so it can be controlled remotely. **Rejected: streaming the tab** — a screen-share prompt every time, and the viewer still couldn't click inside the picture without a translation layer. **Chosen: send data, not pixels** (decision 12).
- The owner moved the Remote to **a phone**, not the TV, because a friend watching remotely can't otherwise control someone else's Portal.
- The friend flow reverses direction: the owner's laptop *accepts* a link to the friend's TV, rather than the friend joining the owner's room. So no new pairing mechanism is needed.
- **Profiles are the sharing boundary.** They replaced an earlier plan of per-friend rooms, expressing the same isolation as something users already understand (decision 18).
- This makes phase 3 an **internet** scenario. The Source's upload becomes the limit (roughly 5–10 Mbit/s for typical 1080p in Mode B **[knowledge]**), which is one more reason Mode A is the default there.
- Remote revocation and seek-feedback lag were open here; both were settled by decision 39 (the Remote pairs with the Source in its own room, and updates optimistically).
- Phase 3 depends only on phase 1, so it can come before phase 2.

### Phase 4 — TURN relay
- **[knowledge]** Most home-to-home WebRTC connections succeed directly with STUN; commonly cited figures are roughly 80–90%. The rest (strict NAT, some mobile carriers, corporate networks) need TURN. Measure the real rate in phase 3 rather than trusting this.
- **Cost reasoning [decision + arithmetic]:** relayed video passes through the TURN server. A 2-hour 1080p film is roughly 2–4 GB. Cloudflare's free 1,000 GB/month ÷ 2–4 GB ≈ 250–500 relayed films per month across **all** users. A public service would burn through that quickly.
- The options to evaluate and the interim behaviour are in plan §13, phase 4.

---

## 11. Keeping the Source tab alive

The rules are plan §9. All browser behaviour there is **[knowledge]**, not checked against browser documentation during research — verify it early with the background-tab tests in plan §14.

---

## 12. Decision log

Append-only from 2 October 2026 (decision 49): a changed decision is marked *Superseded by #N* or *Amended by #N* and a new entry is appended — older entries are never reworded. Before that date, entries 6–10 were rewritten on 30 September (the designs they replaced are in 7.10), and 8, 25 and 36 were revised in place.

| # | Decision | Alternatives rejected | Why |
|---|---|---|---|
| 1 | Pair by rendezvous identifier, not IP | IP address | Browsers can't accept inbound connections; signalling is needed anyway |
| 2 | Mode A first, then Mode B | MSE-only; B-first | A proves the concept fastest; B needs TV codec support. ***Superseded by #22:** Mode B is shelved until Mode A is measured* |
| 3 | Service Worker range bridge for Mode B | MSE | The TV's own media pipeline reads the container index and maps seeks to byte ranges, so we write zero media logic. MSE means parsing the index *and* re-wrapping into fragmented segments — a remuxer. Proven by Browsercast |
| 4 | Trystero for signalling | PeerJS, own server | No server to run; strategy is swappable; password-encrypted handshake; handshake hook |
| 5 | Build from scratch | Fork/contribute to Browsercast | Browsercast is tied to Chromecast, small and inactive |
| 6 | **Pair by QR code: TV displays, camera reads** | Typed codes in either direction; typed URL with a fragment; ECDH + SAS | Full-entropy credentials mean no weak secret, so no derivation, no key exchange, nothing to audit. Symbols like `#` and `=` are buried on TV keyboards. Reverses the original "webcam scanning is clumsy" call, knowingly |
| 7 | **Credentials carried whole in the QR, never derived** | SHA-256 or PBKDF2 from a short code | A single SHA-256 over 10⁶ codes is instant; even 31⁸ is GPU-hours. The derivation was the weakness, not the length |
| 8 | **No cross-connection between parties that don't know each other. One room minted fresh per pairing** | One room per profile; one permanent room per TV; keep the room and rotate only the password | Trystero is full mesh, so a shared room gives Sources direct connections to each other — that is the thing to prevent. Rotating the password saves nothing and leaks the room ID permanently. **Reworded 30 Sep:** earlier drafts called two-peer rooms "an invariant", which overstated it — a Remote is an invited party and a third peer is fine (§16 answer 3) |
| 9 | **No approval prompt at all. One active Source per Portal, from an on-screen list** | Allow/Deny per device; "Switch to this device?" | Line of sight to the screen is the authorisation. One control solves TV memory limits, screen-hogging, revocation and the add-a-source affordance |
| 10 | **URL fragment is the portable pairing record; `localStorage` is a cache** | `localStorage` only | Many built-in TV browsers clear storage between sessions. A bookmark survives, and one bookmark per Source is complete because a Portal talks to one Source at a time |
| 11 | Extension is phase 2, via store | Sideloading | Easier install; linkable |
| 12 | Phase 3 Remote on phone, data not pixels | Stream Source tab; TV-only UI | Enables friend scenario; no prompts; clickable |
| 13 | Name: PortalCast | Viewport | Owner preference; *Portal* reference. Check trademarks ("Portal" is Valve's game and was a Meta device) |
| 14 | TURN deferred to phase 4 | TURN in phase 3 | Free tiers too small for public use |
| 15 | **Accept that pairing needs a camera somewhere** | A typeable manual fallback | UUID + 256-bit password is far too long to type. Nearly everyone has a phone camera, and the phone path will likely become primary. *(Terminology amended by #44: the room id is 16 raw random bytes, not a UUID. The reasoning is unchanged.)* |
| 16 | **Chrome first, then Firefox, then Safari via canvas** | Cross-browser from day one | `captureStream()` has never shipped in WebKit (14.1), so Mode A cannot work there at all. Owner accepted this explicitly. ***Amended by #23:** native Mode A cannot work in WebKit, but the separate Mode A-canvas route can (14.5)* |
| 17 | **Mode A quality tuning is mandatory, not optional** | WebRTC defaults | Every default assumes a video call. Untuned, captured playback looks like one (14.4) |
| 18 | **Profiles are the sharing and isolation boundary** | Per-friend rooms as a separate concept | Same isolation, expressed as something users already ask for. One active profile per tab; extra tabs for more |
| 19 | **`barcode-detector` ponyfill for scanning** | Native `BarcodeDetector`; jsQR directly | Native is missing on desktop Chrome for Windows and Linux (14.2). The ponyfill gives one code path with a native fast path where it exists |
| 20 | **No blacklisting of failed connection attempts** | Blacklist peers that fail auth | Technically impossible: a wrong password means no connection, so no ICE candidates, so no IP; peer IDs are self-generated and free to re-roll. Worse, rotate-on-attack would itself be a denial of service. Log for visibility instead — a 256-bit password has no guessing threat to mitigate |
| 21 | **1080p ceiling, 720p sweet spot. 4K and HDR out of scope** | Support whatever the file is | The only two things a realtime re-encode cannot preserve. Excluding them removes two of Mode B's three justifications, and most material people actually cast is a modest-quality download. Owner: "If people want 4K… don't use my little project" |
| 22 | **Mode B becomes conditional, gated on measurement** | Build it as a certainty | With 4K and HDR gone, only laptop CPU justifies it — and a 720p encode is much lighter, so even that weakens. Gate: measure tuned Mode A on a LAN and audit the library first (plan §7). ***Amended by #45:** the audit is not a prerequisite — it runs only if the measurement shows Mode A falling short* |
| 23 | **Mode A is two implementations: native and canvas** | One path with a Safari caveat | `captureStream()` has never shipped in WebKit. The canvas route needs its own capture, its own audio graph and our own A/V sync, so it is separate work — last in the milestone order, after Chrome and Firefox |
| 24 | **File persistence: metadata everywhere, handles in Chromium, re-pick elsewhere** | Copy files into IndexedDB; extension polyfill | Copying duplicates the library (2 GB film = 2 GB quota). No API exists outside Chromium to hold a handle to a user's file, and an extension would need a filesystem path `<input>` never provides. See 14.7 |
| 25 | **Ship a `/check` page early — as a development instrument for our own devices** | Buy more TVs; rely on emulators alone; crowdsource it publicly | One page answers the TV unknowns (`localStorage` survival, fragment survival, receive codecs, the remote's key map) without guessing. **Revised:** an earlier version of this entry proposed a *public* page, crowdsourced on r/smarttv and doubling as marketing. The owner ruled that out as unrealistic — "it will be unlikely other strangers would randomly help me test" — and testing is the owner's own TVs, the Tizen/webOS emulators, and a few friends. Field data from devices we never touch is decision 46's job instead. Consequence: `/check` needs no short domain |
| 26 | **Mode A-canvas is for iOS, timeboxed, and abandonable** | Cross-browser parity as a goal; skip WebKit entirely | WebKit is the only engine allowed on iOS, so it is the only route to a phone Source. But lifecycle, not capture, is the binding limit: iOS suspends JS on lock and Wake Lock needs iOS 18.4. Build last, timebox, drop if it resists (14.5) |
| 27 | **Vite + React + Mantine for Source and Remote; vanilla TS (or Preact) for the Portal** | Next.js; one stack everywhere; MUI; shadcn/ui | Next is a server framework and we have no backend. The Portal runs on the weakest hardware at ES2017 and needs hand-rolled d-pad focus navigation, which no React UI library provides. Mantine has the components needed with least setup and no runtime CSS-in-JS; MUI is heaviest; shadcn means Tailwind plus maintaining copied components |
| 28 | **One profile, one playlist, one TV per tab** | Multiple TVs and playlists in one tab | Every screen stays unambiguous, and it matches one-room-per-pairing. Extra tabs for extra TVs |
| 29 | **Working playlist is keyed by the TV's `roomId`; snapshots are profile-scoped** | Key by profile, with a first-tab-wins persistence lock | A playlist belongs to the screen being cast to. Keying by TV means two tabs on two TVs never collide, and two tabs on one TV is already prevented by the Web Locks claim — so no second lock and no baffling "this tab won't be saved" message. Draft lives in `sessionStorage` until a TV is chosen |
| 30 | **Web Locks for the cross-tab TV claim** | A `localStorage` claim flag | Web Locks release automatically when a tab dies, so a crashed tab cannot lock the user out of their own TV. No heartbeat, no staleness, no cleanup code. Verified in every target browser (14.8) |
| 31 | **Row click = play now (inserted above current); `+` = add to end** | `+` opens a two-option menu; row click undefined | An undefined primary click on the biggest target in the UI is what people hit first. Insert-above is non-destructive: the previous item plays next. "Play next" goes behind an overflow so the common case stays one click. Accepted quirk: three rapid row clicks leave the queue in reverse click order |
| 32 | **Playlist button on the right with a count badge, never a hamburger** | Hamburger menu on the left | A hamburger reads as navigation; people would click it looking for settings. A badge makes additions visible without opening the drawer |
| 33 | **No settings dialog; every control sits next to what it affects** | A row of 2–4 buttons above the file list | Otherwise "select TV" (bottom bar) and "manage TVs" (top of list) split one concept across the screen, and anything above the list scrolls away |
| 34 | **One "Reconnect files" action, not per-row prompts** | Treat every unopenable file the same | Two different failures: lapsed permission (Chromium, every session, one gesture fixes all of them) versus a missing handle (needs re-picking). Conflating them makes the routine case look broken |
| 35 | **Portal UI is a persistent top bar plus three states** | A summonable settings screen; an on-screen transport UI | The Source selector being always visible dissolves the "when can it appear without interrupting playback?" question. Three states only: reconnecting, waiting for the cast, pairing. Plan §11.2 |
| 36 | **No Portal playback controls in v1; keyboard shortcuts on the Source and Remote instead** | Honour the remote's media keys on the Portal; on-screen transport | **Two** blockers, not three: in Mode A a local pause would desync from the still-streaming Source, so a press must become `source-control`; and keys with no affordance or feedback feel broken, which needs most of a transport UI anyway. *An earlier version of this entry claimed the event mechanism was also unproven — wrong: TV browsers map remote buttons to standard DOM `keydown` events (§14.10), so receiving them is easy.* `/check` logs the real key map; revisit with data. Source and Remote get ordinary hotkeys now, and the Remote can later expose phone lock-screen controls via `mediaSession`, which *is* well supported on phones |
| 37 | **One pairing threshold: warn at ~20 s, then keep retrying forever** | ~20 s warn plus a 3-minute fall-through to the QR screen | A TV left on must never silently abandon its pairing and start showing a QR code to the room. At ~20 s show Retry / Remove / **Pair a new source** and keep retrying indefinitely; leaving for the pairing screen is always the user's choice. **Supersedes the briefly-adopted 3-minute auto-fall-through** |
| 38 | **The Remote is the Source UI in a different mode** | A separate mobile UI | Same React/Mantine component tree with a mode flag; profile switcher swapped for a remote icon offering Disconnect, and every action proxied to the Source. Plan §11.3 |
| 39 | **A Remote pairs directly with the Source, in its own two-peer room. It never joins a Portal's room** | Remote as a third peer in the Portal's room | Five reasons: it matches the UI (plan §11.3 proxies every action to the Source anyway); it survives the Portal switching Sources, which would otherwise orphan the Remote and force credential migration; per-Remote revocation without rotating a room the Source depends on; the TV's credentials never reach a phone; and it reuses the Source-side minting flow. **Accepted cost: the Source is a router** — `status` goes Portal → Source → Remote and `control` the other way, so the Remote must update optimistically and reconcile |
| 40 | **One room per Remote pairing** | One shared "remote room" any phone can join by URL | Independent revocation. Sharing a URL between two phones is harmless (both trusted) but loses it, so scan once per device. ***Clarified by #50:** the scanned URL is single-use; only the permanent `/remote#…` bookmark can be shared* |
| 41 | **Dissolve the old "Page requirements" section into the three UI specs; renumber sections 1–14** | Keep a summary section beside the detailed specs | The summary had drifted: its Remote bullets described a thumbnail grid and pairing with the TV, both contradicting the UI spec and the room topology. Duplicated requirements are where inconsistency breeds. Letter-suffixed sections (7a, 10a–10d) were the symptom of a numbering that needed reflowing, not of a document that needed splitting. *(The plan later grew to 15 sections when device reports became §12.)* |
| 42 | **The Portal reports its receive capabilities at connect time; the Source chooses the codec** | Hardcode VP9; probe once at pairing and cache; rely on `/check` | WebRTC's offer/answer already prevents sending an undecodable codec — the gap is *ordering*, since Chrome favours VP8 even when VP9 is mutually available. A `capabilities` message on every connect fixes that and survives TV firmware updates. Owner's suggestion, and better than the probe-and-guess the plan originally implied |
| 43 | **PortalCast performs no cryptography of its own beyond `getRandomValues`** | Keep `crypto.subtle` as a stated requirement of our code | PBKDF2 died with full-entropy QR credentials; ECDH died with the SAS design. `crypto.subtle` is still a hard requirement, but **Trystero's**, for AES-GCM on the SDP handshake. Recorded because `/check` was still probing ECDH — dead weight from an abandoned design, now replaced with an AES-GCM probe |
| 44 | **No UUIDs. Ids are 16 raw bytes from `getRandomValues`, and the scanned payload is binary, not JSON** | `crypto.randomUUID`; JSON then base64url; carrying the TV name in the QR | Owner's observation that `getRandomValues` is far better supported. It is also *more* random (128 bits versus UUID v4's 122, six being fixed markers) and shorter to encode. Dropping JSON and the name — which plan §6.3 already sends over the data channel — cuts the scanned URL from 190 to 94 characters and the QR from **73×73 to 53×53 modules at ecc=H** (measured with `uqr`, 14.3). That is 37% larger modules on screen, aimed squarely at the weakest link: a webcam reading a glossy panel from sofa distance. Field renamed `roomUuid` → `roomId` so nobody reaches for `randomUUID` again |
| 45 | **File formats are a Mode B concern only; the library audit comes off the critical path** | Audit the library early, as the plan originally had it | In Mode A the Source decodes the file and re-encodes it as a WebRTC stream, so the TV never sees the container or file codec — only VP8/VP9/AV1/H.264, settled at runtime by `capabilities` (decision 42). Owner's correction: "It literally doesn't matter the format of the videos because Mode A works by sending a stream." The plan had scheduled work for a decision that may never be taken. Script kept at `scripts/audit-library.sh` for the gate that probably never opens |
| 46 | **Field device reports: no backend, never silent, over the existing data channel** | A collection endpoint; silent background reporting | The Portal sends a `device-report` to the Source; the Source displays the exact payload and offers to send it as a prefilled GitHub issue or email from the user's own account. Keeps the "no backend of our own" goal (plan §1) intact and avoids quietly shipping data off a TV, which would undercut the privacy claim the product is actually sold on. Capabilities only: no filenames, no credentials, and deliberately no persistent identifier. Plan §12. ***Superseded by #54 and #55:** a collector endpoint now exists, and the live app sends after a one-time opt-in rather than per report* |
| 47 | **A Source tab joins only the room of the TV it has claimed, never every paired TV's room** | Join all paired rooms so the selector can show live online status | Joining all of them put two tabs in the same TV's room as two Sources — the exact cross-connection decision 8 exists to prevent — and wasted connections on the weakest device. Found by auditing plan §3 against plan §11.1's one-TV-per-tab rule, which contradicted it. Accepted cost: the TV selector cannot show online status before you pick a TV; it shows "Connecting…" instead |
| 48 | **No `deviceId` anywhere** | Keep it in storage and in `hello` / `pair-ack` | It was stored and transmitted but never read. The room *is* the identity (plan §6.5) because each pairing mints a room nothing else can enter, so a separate id adds nothing. A leftover from the abandoned per-device-token scheme (§7.10). Removed rather than left to mislead whoever implements it |
| 49 | **Keep two documents but stop them overlapping. The plan is the sole source of truth for the design; this file holds research, history and the decision log only, and the log is append-only** | Merge both into one file; keep both as they were | A consistency review on 2 October found the plan sound but eleven stale passages here, nearly all places this file restated the design and was not updated when the plan changed. Merging would produce one ~1,500-line file mixing current design with history. Removing the restatements (§2, §3.2–3.3, §6, §10, §11 now point at the plan) and never rewording old entries means a design change touches one plan section and adds one log line |
| 50 | **Remote pairing mirrors Source↔Portal pairing: ephemeral `/remote/pair#…` QR, then a permanent `/remote#…` bookmark** | The Source's QR carries permanent credentials directly | The plan contradicted itself — `remote-pair` was specified as an ephemeral-room message while §11.3 said the scanned URL could be shared between phones. Making the QR single-use and short-lived matches the TV threat model (plan §5.3) and keeps the scanned URL at 49 bytes; sharing applies only to the permanent bookmark afterwards. Unlike `/pair`, `/remote/pair` joins on open, because the phone that scans it is the intended Remote |
| 51 | **The Source owns the queue; the Portal holds a mirror** | Portal owns the queue as part of playback state; no stated owner | Plan §3 said the Portal owns playback state, including `status.queue`, while §11.1 persisted the working playlist on the Source — two owners, no tie-break. The Source holds the files, is where the drawer edits happen and survives the TV wiping its storage, so it is the authority; it re-sends the whole queue on every connect and change. The Portal still owns what is loaded, play state and position |
| 52 | **Heartbeats come from the foreground device; the Source never pings** | Source pings its Remotes | The protocol had the Source pinging Remotes, which needs a timer — exactly what plan §9 rule 1 forbids in a background tab. A Remote is in the foreground whenever it is being used, so it pings the Source, the same way the Portal does |
| 53 | **Pairing links live 10 minutes, not 90 seconds; still single-use** | 90 s; 15 minutes to 1 hour; no expiry at all | 90 s only worked on the sofa. The phase 3 friend flow sends pairing links over chat in both directions (their TV's link to me, my Remote link to them), and 90 s meant being on a call together. Guessing was never the threat — a 256-bit password cannot be guessed at any lifetime. What expiry protects against is a link left unused in a chat history, email or screenshot being opened later by whoever finds it. Single-use already kills a link the moment it pairs, so the window only matters for links nobody used; 10 minutes covers "send it, they open it" without leaving them lying around for hours. Owner's call |
| 54 | **Reports go to a Google Apps Script that appends to a Google Sheet. `/check` gets a Send report button** | Copy to clipboard only; build pairing first and relay via the Source (decision 46); Firebase, PostHog or Sentry; our own server | Found on the first real device: TV Bro on a Chromecast TV has no clipboard that reaches anyone, so `/check` results were stuck on the TV. Apps Script is free at this volume, needs no server, and never exposes the sender's IP to the script. Firebase and the analytics platforms are more setup for less fit; relaying through pairing would block `/check` data on weeks of work. This is the "separate decision needing an endpoint" plan §12 had anticipated; the endpoint is public, so the script validates the shape, caps cells and neutralises formula injection. Plan §12.1–12.2 |
| 55 | **Live-app telemetry is relayed Portal → Source → collector, sent automatically after a one-time opt-in on the Source, and never re-sent for the same payload** | The Portal posts directly; per-report consent (decision 46); a device fingerprint to recognise a TV that forgot itself | Owner's direction: the Source is the device that remembers, so it can stop a TV that keeps wiping its storage from reporting on every visit, and consent belongs to the person at the laptop. Per-report prompts would be ignored or resented; one clear opt-in, off by default, with the payload viewable, keeps it honest. A fingerprint was considered for de-duplication and is **not** adopted: it is the persistent identifier plan §12.4 forbids. Leading alternative, still open: de-duplicate by a hash of the payload's content. Plan §12.3 |

---

## 13. Sources

Retrieved 28–29 September 2026.

- Trystero — https://github.com/dmotz/trystero
- Browsercast — https://github.com/johanholmerin/browsercast (demo: https://johanholmerin.github.io/browsercast/)
- CastBrowser web receiver — https://castbrowser.tv/guides/cast-to-browser
- Web Video Caster — https://apps.apple.com/us/app/-/id1400866497 ; https://play.google.com/store/apps/details?id=com.instantbits.cast.webvideo ; https://archive.org/details/web-video-caster-for-desktop-v0.0.15
- Camera Cast — https://github.com/ctbot000/camera-cast
- CineLink — https://github.com/SanjayB29/Watch-Together
- Fizzy444 watch-together — https://github.com/Fizzy444/watch-together
- movie-night-together — https://github.com/finpro56-hash/movie-night-together
- LocalMovieSync — https://github.com/r2dapps/LocalMovieSync
- WatchWithMe — https://github.com/ssd71/watchwithme
- SyncWatch — https://github.com/Semro/syncwatch
- FileParty — https://fileparty.co/watch-local-videos-with-friends-online/
- Video Party — https://videoparty.app/
- Movmash — https://movmash.com/watch-together
- devx-cast — https://github.com/DEVxNetwork/devx-cast
- awesome-webrtc (lists Picklecast, PairDrop) — https://github.com/nuzulul/awesome-webrtc
- LocalSend Web — https://localsend.cc/local-send/
- Snapdrop on Android TV — https://www.droidthunder.com/transfer-files-to-android-tv/
- 1001 TVs — https://www.1001tvs.com/send-files-to-tv-from-pc-mac/
- Go2TV — https://github.com/alexballas/Go2TV
- FCast — https://fcast.org/
- PlayBridge — https://github.com/playbridgeapp/playbridge
- Self-hosted TV-browser signage — https://github.com/Mjebreen/signage
- AbleSign web player — https://www.ablesign.tv/digital-signage/web-player/
- Juuno browser signage guide — https://juuno.co/blog/digital-signage-browser
- AWS GameLift Streams browser compatibility — https://docs.aws.amazon.com/gameliftstreams/latest/developerguide/compatible-devices-browsers.md
- Service Worker range requests — https://web.dev/articles/sw-range-requests
- MDN browser-compat-data (queried directly, 30 Sep 2026) — https://github.com/mdn/browser-compat-data : `api/HTMLMediaElement.json`, `api/BarcodeDetector.json`, `api/HTMLCanvasElement.json`, `api/MediaStreamAudioDestinationNode.json`, `api/AudioContext.json`, `api/Window.json`, `api/FileSystemHandle.json`, `api/WakeLock.json`, `api/HTMLVideoElement.json`, `api/LockManager.json`, `api/BroadcastChannel.json`
- Mantine — https://mantine.dev
- React UI library comparison the owner supplied — https://medium.com/@appstitch.dev/shadcn-ui-vs-radix-ui-vs-mantine-vs-mui-vs-headless-ui-vs-ark-ui-which-react-ui-library-should-7c19ac7adf24 — **not read**, Medium returned HTTP 403. The library assessment in decision 27 is from general knowledge, not this article
- npm registry metadata (queried directly, 30 Sep 2026) — `barcode-detector`, `zxing-wasm`, `uqr`, `jsqr`, `@zxing/library`, `qrcode`
- Scanbot survey of open-source JS barcode scanners (vendor blog; see 14.3) — https://scanbot.io/blog/popular-open-source-javascript-barcode-scanners/
- Service Workers as media proxies — https://www.mux.com/blog/service-workers-are-underrated
- W3C issue on WebRTC-backed Service Workers — https://github.com/w3c/ServiceWorker/issues/1522
- Google Cast Web Receiver overview — https://developers.google.com/cast/docs/caf_receiver

---

## 14. Verified browser and library facts (30 September 2026)

Checked by direct lookup, not recalled. These override anything earlier in this file. Sources in section 13.

### 14.1 `HTMLMediaElement.captureStream()` — the Mode A constraint

From MDN browser-compat-data (`api/HTMLMediaElement.json`):

```
chrome                   62
chrome_android           mirror → 62
edge                     mirror → 62
firefox                  149 (unprefixed)
                         moz-prefixed 15–149, partial_implementation
safari                   false        ← never shipped
safari_ios               mirror → false
webview_ios              mirror → false
```

Consequences:
- **Safari cannot run Mode A as built for Chrome and Firefox** — desktop or iOS, in any browser, since all iOS browsers are WebKit. It is not locked out of Mode A altogether: the canvas route (14.5) works, but it is a **second implementation** with its own capture path, its own audio graph and our own A/V sync, so the plan names it **Mode A-canvas** rather than treating it as a fallback. Corrected here after an earlier overstatement that Safari "can't do Mode A at all".
- Firefox needs `captureStream ?? mozCaptureStream`. MDN flags the prefixed path `partial_implementation`, with notes that tracks only exist while playing and that behaviour changed across versions. Expect Firefox audio to be the fragile part.
- This is a bigger deal than "check Safari support": Mode A first means a Chrome-only product on day one. **[decision]** Accepted.

### 14.2 `BarcodeDetector` — why the ponyfill is needed

From MDN browser-compat-data (`api/BarcodeDetector.json`), status `experimental`:

```
chrome            88+  ⚠ ChromeOS and macOS only  (no Windows, no Linux)
chrome_android    83+  ✓
edge              83+  ⚠ macOS only
firefox           ✗    (bugzil.la/1553738)
safari            17+  behind a "Shape Detection API" preference flag
```

Desktop Chrome on Windows — likely the most common Source — does not have it. Hence `barcode-detector`, which implements the standard API and falls back to WASM.

### 14.3 Library choices, from npm metadata

| Package | Version | Modified | Licence | Note |
|---|---|---|---|---|
| `barcode-detector` | 3.2.2 | 2026-08-16 | MIT | **Chosen for scanning.** Ponyfill of the standard API, ZXing-C++ WASM inside |
| `zxing-wasm` | 3.1.4 | 2026-09-10 | MIT | The engine underneath; use directly only if the ponyfill disappoints |
| `uqr` | 0.1.3 | 2026-04-03 | MIT | **Chosen for generation.** Zero dependencies, SVG output — scales to any TV resolution without canvas |
| `jsQR` | 1.4.0 | 2025-11-13 | Apache-2.0 | Small and works, but effectively dormant. Was the original plan |
| `@zxing/library` | 0.23.0 | 2026-04-29 | Apache-2.0 | Upstream in maintenance mode |
| `qrcode` | 1.5.4 | 2025-11-13 | MIT | **Avoid** — drags in `yargs`, `pngjs`, `dijkstrajs` |

Note the scanning case is the easy one: we generate the QR ourselves, so we control size, quiet zone and error correction, and we read a bright screen rather than a crumpled label. Any of these libraries would decode it. The deciding factor was one code path and active maintenance.

The Scanbot survey the owner supplied is a vendor blog (they sell a commercial SDK) and concludes that every open-source option is dormant. Its facts about `jsQR`, `html5-qrcode` and `@zxing/library` check out; it omits `zxing-wasm` and `barcode-detector`, which are both actively maintained.

### 14.3b QR payload size, measured

Measured locally with `uqr` (the library the Portal and Source will use), encoding a full `https://portalcast.net/pair#…` URL at three error-correction levels:

| Encoding | URL | ecc=H | ecc=Q | ecc=M |
|---|---|---|---|---|
| JSON, UUID string, + TV name | 190 ch | 73×73 | 65×65 | 57×57 |
| JSON, raw 16 bytes, + TV name | 171 ch | 69×69 | 61×61 | 53×53 |
| **Binary, 49 bytes, no name** | **94 ch** | **53×53** | 49×49 | 41×41 |

The chosen binary form at **ecc=H** is coarser than the original JSON form at **ecc=M** — so robustness and module size improve together rather than trading off. On a 1080p panel showing an 800 px QR: 15.1 px per module versus 11.0, a 37% increase.

This is the only concrete mitigation found for the scanning-ergonomics risk flagged when the QR design was adopted (§7.10) — everything else about that risk is procedural (quiet zone, contrast, beep on success).

### 14.4 WebRTC quality control — what is and isn't reachable

**Reachable** via `getPeers()[peerId].getSenders()` → `setParameters()`: `maxBitrate`, `scaleResolutionDownBy`, `degradationPreference`. Via the track: `contentHint` (`'motion'` for video, `'music'` for audio — the audio one matters a lot, since default Opus in WebRTC is speech-grade and roughly mono). Via `setCodecPreferences()` on the transceiver: VP9 instead of the VP8 default, roughly 30–50% better quality per bit **[knowledge]** — but the TV must decode it, and AV1 on Tizen/webOS is patchy.

**Not reachable through any JavaScript API**: Opus `stereo=1` and `maxaveragebitrate`. SDP editing is the only route, in every browser. See 5.1.

**Not controllable at all**: `maxBitrate` is a ceiling, not a floor — congestion control always lowers the rate on loss or delay, and the standard API has no `minBitrate`. Realtime encoders also skip B-frames, so WebRTC video at a given bitrate is worse than a file encoded at the same bitrate. On a LAN, compensate with headroom; over the internet, you cannot.

**Assessment [knowledge]:** a typical 1080p library file is 5–10 Mbps H.264. A tuned Mode A at a higher ceiling in VP9 is being fed more bits than the source had, in a more efficient codec, so generation loss on a LAN should be close to invisible. Mode B's unique wins are therefore laptop CPU, 4K, and HDR — not 1080p quality. Measure with `getStats()` before trusting this.

### 14.5 Mode A-canvas (Safari) — every piece exists

From MDN browser-compat-data:

```
HTMLCanvasElement.captureStream         safari 11+   iOS ✓
MediaStreamAudioDestinationNode         safari 11+   iOS ✓
AudioContext.createMediaElementSource   safari  6+   iOS ✓
requestVideoFrameCallback               Safari since 2024  [owner, unverified here]
```

Also verified: `requestVideoFrameCallback` is Safari **15.4+** (earlier than the owner's recollection of 2024), `playsInline` is Safari 10+, and `WakeLock.request` is Safari 16.4 desktop but **iOS 18.4** only.

**[decision]** The motivation for this path is **iOS specifically** — WebKit is the only engine permitted there, so it is the only way a phone can ever be a Source. Desktop Safari is incidental. Owner: "If it's hard, well then screw Safari." Timeboxed, built last.

**The binding constraint is lifecycle, not capture.** iOS Safari suspends JavaScript within seconds of backgrounding or screen lock and WebRTC drops with it. Wake Lock can hold the screen on but only from iOS 18.4, so older devices have no answer. So even a flawless Mode A-canvas yields "casts while unlocked, awake and plugged in" — fine for a clip, not an unattended film. Weigh that before spending effort.

So it is viable: draw frames to a canvas, capture it for video, route the element's audio through Web Audio into a stream destination, merge the tracks. Treat it as a separate implementation, not a fallback — prefer native `captureStream()` wherever it exists, because the browser keeps audio and video locked together for free. Two honest problems: A/V sync becomes ours to maintain against `video.currentTime`, since canvas frames and audio run on separate clocks (real `captureStream()` keeps them locked); and `requestAnimationFrame` is the wrong clock — it fires at display refresh, not frame rate, so `requestVideoFrameCallback` must be used.

### 14.6 Browsercast — what it actually does

From its README (github.com/johanholmerin/browsercast, MIT, 12 commits, 6 stars):
- Casts local files to **Chromecast** from the browser, no install. "Instead of fetching the video over HTTP, a WebRTC connection is established between the sender and the receiver."
- Service Worker intercepts range requests and forwards them to the sender. Chose this over MSE because MSE "is complicated to implement and only supports fragmented MP4".
- Supports MP4, WebM, MP3, AAC, WAV, SRT/VTT subtitles, and WebTorrent streaming. Files: `receiver/`, `sender/`, `shared/`, `sw.js`.
- Stated limitation: "Initial load and seeking can be slower compared to using a server. This seems to be caused by the size limit of packets." Normal playback is fine.
- **Our reading of that limitation:** it is the per-chunk request/response model, not packet size. See 3.3 — one streaming response with backpressure should avoid it.
- The receiver is launched and paired through Google's Cast system, which is exactly the part PortalCast replaces.

### 14.7 File System Access — why files cannot be remembered outside Chromium

From MDN browser-compat-data:

```
showOpenFilePicker                    chrome 86   firefox ✗     safari ✗
showDirectoryPicker                   chrome 86   firefox ✗     safari ✗
showSaveFilePicker                    chrome 86   firefox ✗     safari ✗
FileSystemHandle (interface)          chrome 86   firefox 111   safari 15.2
FileSystemHandle.queryPermission      chrome 86   firefox ✗     safari ✗
FileSystemHandle.requestPermission    chrome 86   firefox ✗     safari ✗
```

**The `FileSystemHandle` row is a trap.** Firefox and Safari have the interface, but reachable only through `navigator.storage.getDirectory()` — the **origin-private filesystem**, a sandboxed area belonging to our own origin. Neither browser has any API to obtain a handle to a file the *user* owns. That is also why they lack `requestPermission`: OPFS needs no permission.

So outside Chromium there is no mechanism at all, and the alternatives are worse:
- Copying the `File` into IndexedDB works everywhere and needs no encoding (`File` and `Blob` store directly), but a `Blob` is an immutable snapshot by spec, so it duplicates the library — a 2 GB film costs 2 GB of quota. Unusable for video.
- A Service Worker does not help; it intercepts requests and has no filesystem access.
- `localStorage` cannot hold a handle at all: it stringifies, so a handle becomes `"[object FileSystemFileHandle]"`. IndexedDB is the only web storage that structured-clones.
- A browser extension polyfill was considered and rejected for now: extensions need "Allow access to file URLs" (off by default) *and* a filesystem path, which `<input>` never gives — `File.name` is a name, `webkitRelativePath` is relative to the picked folder. Revisit in phase 2 only if asked for.

**[decision]** Persist metadata and thumbnails everywhere, handles in Chromium, re-pick on demand elsewhere, and tell Firefox and Safari users once. Plan §8.

### 14.8 Cross-tab coordination APIs

From MDN browser-compat-data — universally available, so the Web Locks approach carries no compatibility risk:

```
LockManager / LockManager.request     chrome 69   firefox 96   safari 15.4   iOS ✓
BroadcastChannel                      chrome 54   firefox 38   safari 15.4   iOS ✓
```

`navigator.locks` releases a held lock automatically when its tab or worker goes away, which is the property that makes it correct here and a `localStorage` flag wrong: a crashed tab leaves no residue. `ifAvailable: true` turns the request into an instant success-or-fail test rather than a queue.

### 14.9 Still to verify on real hardware

Ordered by how much depends on them. Mode A and pairing first; Mode B items last, since they only matter if its gate opens (decision 45).

1. **Does `localStorage` survive a restart on each target TV?** Decides whether bookmarking is a convenience or the only pairing record.
2. **Do URL fragments survive on each target TV browser?** Some are thin webview wrappers. If fragments are mangled, the storage-wipe fallback has no answer.
3. **Is Opus stereo reachable through Trystero's `rtcPolyfill`?** Decides whether Mode A is acceptable for films at all. Proven end-to-end with `getStats()` in milestone 3 and recorded in `docs/quality.md`; `/check` can only show whether a TV's receiver *advertises* it.
4. **`crypto.getRandomValues` and `crypto.subtle` AES-GCM on old TV browsers** — `subtle` needs a secure context, which we have; availability on a 2019 Tizen is unknown. Both are fatal if missing (plan §6.1). `randomUUID` is never called (decision 44).
5. **Does `addStream` need re-sending on `onPeerJoin`?** The README says it does; confirm against the source, because it shapes the upstream PR.
6. **Scanning ergonomics:** real laptop webcams against real TV panels, at angles, with glare.
7. **Codec audit — Mode B only (decision 45).** `canPlayType()` against real codec strings on each TV, plus a scan of an actual library.
8. **Service Worker ranged media on a real TV — Mode B only.** Tizen/webOS are Chromium so it should work, but it is unverified and Mode B depends on it entirely.

**What `/check` covers:** items 1, 2 and 4, the TV half of 3 (advertised stereo) and of 7 (`canPlayType`), and 8's Service Worker registration — for our own TVs and emulators (decision 25). For devices we will never touch, decision 46's field reports are the mechanism.

---

### 14.10 TV remote input — standard DOM keyboard events

Supplied by the owner, 30 September. Not independently verified here, but consistent with how the signage projects in §8.6 operate, and `/check` is built to confirm it per device.

> "Smart TV browsers (like Samsung Tizen, LG webOS, or Android TV) map physical remote buttons to standard DOM keyboard events."

`event.key` values: `ArrowUp`/`Down`/`Left`/`Right`, `Enter`, `Escape` and `Backspace` (Back), and `MediaPlay`, `MediaPlayPause`, `MediaStop`, `MediaRewind`, `MediaFastForward`.

Two platform cautions, both worth more than the happy path:
- **Older Tizen and webOS engines may supply only legacy numeric `keyCode`s** — 13 for Enter, **10009 for Back on Tizen**. Read `event.key` first, fall back to `keyCode`, never rely on `key` alone.
- **Focus must be set explicitly** with `element.focus()`, or directional keys have nothing to act on. TV browsers do not maintain a useful default focus.

This makes receiving remote input straightforward and removes one of the three reasons originally given for deferring Portal playback controls — see decision 36, which has been corrected.

---

## 15. Deferred: profile privacy

**Status: wanted, not designed. Build nothing until this is settled.**

The ask was a password gate on a profile — enough to stop a family member or guest idly opening a profile containing adult content. The owner's initial framing was "no extreme security needed, it's simply a gate; hash the password for privacy, encrypting the contents is overkill."

**Why a simple gate does not do the job.** Three problems, in increasing order of difficulty:

1. **A hashed password is a lock on a door with no walls.** Anyone with devtools reads `localStorage` and IndexedDB directly, so filenames and thumbnails remain visible whether or not the gate is passed. Hashing only protects the password itself from being read in the clear.
2. **It contradicts the blur-thumbnail feature.** Blur exists because the owner cares about shoulder-surfing. A gate that leaves the underlying data readable is a mismatch of intent.
3. **The existence of a password is itself the disclosure.** The owner's own observation, and the sharp one: "the fact that there is a password is itself a giveaway they are hiding something." No amount of password strength fixes this.

**The shape that would work.** The profile is not listed anywhere, and its storage key is *derived* from a name plus a password. Type the right pair and it appears; otherwise there is no record that it exists. This requires encrypting that profile's metadata and thumbnails with a key derived from the same pair — because unencrypted IndexedDB keys or an entry in a profile index would reveal its existence.

So the hidden case and the encrypted case turn out to be **the same feature**, and "encryption is overkill" stops being true once deniability rather than access control is the goal. WebCrypto (AES-GCM plus a slow KDF) is enough; the files themselves are never encrypted, only names and thumbnails.

**Rejected interim idea:** exposing a hidden profile via a URL. Right instinct — leave no visible trace — but a URL lands in browser history and address-bar autocomplete, which is its own giveaway.

**Owner's decision:** defer. "Maybe we do the password thing later and give the solution some more thought."

---

## 16. Review findings and owner answers — 30 September 2026 (verbatim, APPLIED)

**Status: APPLIED to `portalcast-plan.md` on 30 September 2026.** Kept verbatim as the raw record of how these decisions were reached.

> **Section and line numbers quoted below are stale by design.** The plan was renumbered twice afterwards (decision 41, then promoting §11a to §12), and three of the resolutions here were revised the same day — see the list at the end of this status block. Read the quoted numbers as "wherever that content lives now", and treat the plan as authoritative. A fresh session re-read both documents, reported gaps, and the owner answered; both sides are recorded word for word.

What the application produced:
- Answer 1 → plan **§10b** (Portal UI) and **§10c** (Remote UI); **§6.6** rewritten, since an always-present selector dissolves that question; decisions 35, 36, 38.
- Answer 1's 3-minute timeout → plan **§6.7** now has both thresholds, ~20 s to warn and 3 min to give up; decision 37.
- Answer 1's "no playback controls" vs the old §10 promise → resolved in favour of **no on-screen transport, but honour the TV remote's media keys**; decision 36.
- Answer 2 → **§10a** diagram glyph fixed to a list icon.
- Answer 3 → plan **§3** rewritten to the narrower no-cross-connection rule; **decision 8** reworded; a new threat-model row added to **§5.3** for the Remote's direct channel to the Source, which the finding was right to flag even though its framing was wrong.
- Answer 4 → subtitles remain open in plan **§13**, with both options and the embedded-MKV gap spelled out.
- Answer 5 → Mode B left parked. The `desiredSize`-versus-credit-scheme contradiction is **knowingly retained** in a dormant section; it gets fixed only if the Mode B gate opens.
- Answers 6, 7, 8 → storage keying stated (`roomId` is the key, `activeSourceId` renamed `activeRoomId`); the `+` question added to the open list; `portalcast.net` labelled a placeholder in §6.2.

**Three of those resolutions were then revised the same day**, after the owner reviewed them:
- **The 3-minute auto-fall-through was dropped.** One threshold only: warn at ~20 s with Retry / Remove / *Pair a new source*, then retry forever. A TV left on must never abandon its pairing on its own and start showing a QR code to the room. Decision 37.
- **TV-remote media keys were deferred, not kept.** "Remote keys without UI? How does that even work?" is the right question: the mechanism is `navigator.mediaSession` and no TV browser is verified to deliver it *[later corrected: the mechanism is ordinary `keydown` events, which are easy to receive — see decision 36 and §14.10. The deferral stands on the other two reasons]*, a local pause would desync Mode A, and keys with no feedback feel broken. A probe went into `/check` instead. Decision 36.
- **The Remote topology was decided** rather than left open: the Remote pairs directly with the Source in its own room. Decision 39, reasoning in plan §3.

Section numbering in the plan was also reflowed at the same time (decision 41): the old "Page requirements" section was dissolved into the UI specs it duplicated, and the letter-suffixed sections became §8 and §11.1–11.4. **Line and section numbers quoted verbatim above therefore no longer resolve** — they refer to the document as it stood before the renumber.

### Reviewer's findings, as written

> **1. Portal UI has no design.** §13 open question. D-pad spatial nav model unspecified, and "when does the active-Source list appear without interrupting playback" (§6.6) is unanswered. Only screen with zero design. This is the thing to pick up next.
>
> **2. Diagram contradicts decision 32.** Plan `portalcast-plan.md:443` ASCII layout shows `[☰ 4]` in the top bar — a hamburger. Decision 32 and §10a text both say "use a queue/list icon, **not** a hamburger". Diagram needs the icon changed.
>
> **3. Two-peer invariant breaks in phase 3, and the consequence isn't stated.** §3 calls it "an invariant"; `portalcast-plan.md:86` then says a Remote makes three peers. Trystero is full mesh, so a friend's Remote gets a **direct data channel to my laptop** — the `fileId` allowlist is then the only guard, not room isolation. §13 asks about revocable Remote credentials but doesn't name this as the reason. Worth promoting from open question to an explicit threat-model row in §5.3.
>
> **4. Embedded subtitle tracks unaddressed.** `portalcast-context.md:75` flags that users will immediately expect embedded tracks. Plan only handles sidecar `.srt`/`.vtt` (milestone 5, protocol `subtitles`). MKV-embedded extraction lands nowhere — not milestone 5, not the ffmpeg.wasm remux note. LocalMovieSync already does it (§8.2), so it's table stakes.
>
> **5. Mode B flow control specified twice, differently.** §7 says answer with one `ReadableStream`, backpressure free via `controller.desiredSize`. Protocol table `stream-data` says "credit-based flow control". Credit scheme never defined. Reconcile — desiredSize is the page-side signal, but the data channel still needs its own window.
>
> **6. Portal storage schema mismatch.** `portalcast-plan.md:158-159`: `sources: [{roomId, roomPassword, sourceName, pairedAt, lastSeen}]` plus `activeSourceId` — but no entry has an `id`. Presumably keyed by `roomId`; say so.
>
> **7. `+` behaviour still open.** §10a leaves the two-item-menu alternative unresolved, marked `*(Open: …)*`. Not in §13's list, so it'd get lost.
>
> **8. Domain unresolved** but `portalcast.net` is hardcoded in the QR payload examples (§6.2). Fine as placeholder; note it.

### Owner's answers, as written

> 1. We should talk about design, so the Portal (TV) is basic. The flow should be like this:
> -. Show a small faded top bar across the view, with a source selector on the right (kinda like the profile selector). The source selector when clicked brings down a menu with the various sources and an add new source button. Long pressing on it brings up a remove option.
> A. Check if the TV was previously paired with a Source, if so try to reach out to the source. Show a small loader in the center of the screen. If success skip to a screen that says "waiting the cast".
> B. If not paired previously or last source becomes inaccessible for more than 3 minutes, show a small text saying "Ready to pair with a new source" and a giant QR code, but leave the menu button active so the user can simply click the menu to change source. If the last source is not accessible, add a small line towards the bottom saying that last source <name> was not accessible, with a retry and remove buttons.
> That's it for now. I'm not sure if we want to add playback controls, I think that should be kept on the source and the remote control.
>
> As for the remote control UI, it's ideally the same as the source, except with something that indicates it is the remote control (perhaps remove the profile switcher and put a remote icon which gives the remote control the option to disconnect). The source and remote control basically share the same UI except actions done on the remote are forwarded to the source. The remote ideally works by QR code that opens a url directly on the mobile, but we might also want to provide an option to copy the QR code url instead (in the source UI) so that it can be manually send somewhere if need be. Or we can all any number of remote controls just via the url, not sure yet.
>
> 2. Correct, we are not using a hamburger, we are using a list icon on the right instead to bring up the playlist.
>
> 3. What? Two peer is not an invariant, it's just that we don't want unknown sources or unknown TVs cross connecting. A remote is welcome to get placed in the same room as a TV or to have its own two peer relationship directly with the source (probably a little easier than moving a remote between rooms?)
>
> 4. Not sure about subtitles, should we just add them to the video and steam, or should we put them over the top on the TV side?
>
> 5. Mode B is kinda of abandoned for now, but should be left there. I am confused why the AI did not create a consistent planned doc.
>
> 6, 7: Unsure.
>
> 8. Yes domain TBD

### What each answer changes

Derived from the above, for whoever edits the plan next. Not owner words.

1. **Portal design is now specified** and replaces "no design yet". It is a **three-state screen**, not the settings-screen model §6.6 implied:
   - **Persistent faded top bar** across every state, holding a **Source selector on the right** — the Portal's mirror of the Source's profile selector. Click → drop-down listing paired Sources plus "Add a new source". **Long press → Remove.** So the list is *always* reachable, which answers plan §13's "when should the active-Source list appear?" — always, in the top bar, never as a modal interruption.
   - **State A, reconnecting:** small centre loader while it reaches the stored Source. On success → **"waiting for the cast"** screen.
   - **State B, pairing:** reached when never paired, *or* when the last Source has been unreachable for **3 minutes**. Small "Ready to pair with a new source" caption plus the giant QR. The top-bar menu stays live. If it got here by failure, a line near the bottom names the Source — "last source ‹name› was not accessible" — with **Retry** and **Remove**.
   - **No playback controls on the Portal** (tentative). Transport lives on the Source and Remote. Note this partly contradicts plan §10's "basic play/pause/seek via the physical TV remote should work even without a phone" — needs resolving, since the TV remote's own keys are free and cost nothing to honour.
   - The 3-minute unreachable timeout is new and should replace or qualify the "~20 s" timeout in plan §6.7.
2. **Confirmed.** The `[☰ 4]` glyph in the §10a layout diagram is simply wrong; it is a list/queue icon on the right. Diagram fix only, no design change.
3. **Finding rejected, and the plan's own wording is the error.** "Two-peer rooms are an invariant" overstates what the owner ever wanted. The real rule is narrower: **no cross-connection between Sources or TVs that do not know each other.** A Remote is a known, invited party, so a third peer in a TV's room is fine. The owner also floats a second topology — **the Remote pairs directly with the Source as its own two-peer room** — and suspects it is easier than moving a Remote between rooms. Undecided. Consequence: plan §3's invariant paragraph and decision 8 both need rewording to the narrower rule, and §13's Remote-revocation question stays open under either topology.
4. **Still open, now with the two options named:** burn subtitles into the Mode A capture on the Source (works on any TV, costs a canvas compositing step, unstyleable and un-toggleable at the TV), versus render them as a text overlay on the Portal (toggleable, styleable, needs the cue list shipped over the data channel and TV-side timing). The existing `subtitles` protocol message already assumes the second. Embedded-MKV-track extraction remains unaddressed either way.
5. **Mode B is parked, not deleted** — keep the design recorded as-is. The `stream-data` credit-scheme-versus-`desiredSize` contradiction therefore stays as a known inconsistency in a dormant section; fix it if and when the Mode B gate ever opens. The owner separately notes the documents should have been internally consistent in the first place; treat cross-document consistency as a requirement of any future edit, not an optional pass.
6, 7, 8. **Left open.** Portal storage keying (6) is an implementation detail that will settle itself when the code is written. The `+` two-item-menu alternative (7) should be added to plan §13 so it is not lost. Domain remains TBD, with `portalcast.net` explicitly a placeholder.
