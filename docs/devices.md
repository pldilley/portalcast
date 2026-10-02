# Device results

Paste `/check` reports here, one section per device. See `portalcast-plan.md` §13 milestone 1b
for what `/check` probes and §14 for the wider testing plan.

This is a development log for **our own** devices, the Tizen and webOS emulators, and any
friend who runs it. Field data from devices we will never touch is a separate mechanism —
plan §12.

---

## Summary

Fill in as results arrive. The four rows that change design decisions are marked.

| Device | Browser | `localStorage` survives restart ★ | URL fragment survives ★ | Receive codecs ★ | Remote key map ★ | Notes |
|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | |

★ Why these four matter:
- **`localStorage` survives a restart** — decides whether bookmarking is a convenience or the *only* pairing record (plan §6.5).
- **URL fragment survives** — if a TV's browser mangles fragments, the storage-wipe fallback has no answer at all.
- **Receive codecs** — whether `setCodecPreferences` can ask for VP9, or must settle for VP8 (plan §7).
- **Remote key map** — the input map for the Portal, including whether Tizen reports Back as `keyCode` 10009 with no useful `key` (plan §11.2).

---

## Reports

<!--
Paste raw /check output below, newest first, under a heading naming the device.

## Samsung UE55... (Tizen 6.0, 2021)
Collected: YYYY-MM-DD

```
PortalCast /check report
========================
...
```
-->

_No reports yet._
