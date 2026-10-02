# Mode A quality measurements

`getStats()` readings from real runs. See `portalcast-plan.md` §7 for the tuning levers and
§14 for the testing plan.

**This file holds the number the Mode B gate turns on.** Mode B is parked (plan §7); it only
gets built if the measurements here show Mode A falling short at 1080p on a LAN. Record the
numbers even when they look fine, so the decision rests on evidence rather than recollection.

---

## What to record per run

| Field | Where from |
|---|---|
| Date, Source browser + version, Portal device | — |
| Source file: resolution, codec, bitrate | `ffprobe` |
| Negotiated video codec | `getStats()` `outbound-rtp` → `codecId` |
| Outgoing bitrate, resolution, framerate | `getStats()` `outbound-rtp` |
| **Audio channel count** | `getStats()` `outbound-rtp` (kind=audio) — **not** the SDP |
| Audio bitrate | `getStats()` `outbound-rtp` (kind=audio) |
| Packet loss, round-trip time | `getStats()` `remote-inbound-rtp` |
| Laptop CPU %, and battery drain over a full film | Activity Monitor |
| Subjective picture quality on the TV | Eyes |
| Subjective audio quality on the TV | Ears, with music, not dialogue |

Run each case **twice**: once with the §7 tuning set applied, once without. The delta is the
point — WebRTC defaults assume a video call, so the untuned run is the baseline to beat.

---

## The two go/no-go questions

1. **Is stereo, music-grade Opus reachable through Trystero at all?** This is the single
   biggest risk to Mode A (plan §7). It needs SDP editing via the `rtcPolyfill` workaround,
   and if it cannot be done the audio sounds like a conference call for films regardless of
   how good the picture is. Confirm from `getStats()` channel count, not from the SDP.
2. **Is 1080p visibly acceptable on a real TV at a LAN-sized bitrate?** If yes, Mode B is
   never built and the library's file formats never matter.

---

## Results

_No measurements yet._

<!--
## YYYY-MM-DD — Chrome 1xx (MacBook) → Samsung Tizen
Source file: 1080p h264 8 Mbps, stereo AAC

| Metric | Untuned | Tuned |
|---|---|---|
| Video codec | | |
| Bitrate | | |
| Resolution held | | |
| Framerate | | |
| Audio channels | | |
| Audio bitrate | | |
| CPU % | | |
| Picture | | |
| Audio | | |

Verdict:
-->
