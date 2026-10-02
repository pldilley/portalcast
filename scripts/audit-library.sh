#!/usr/bin/env bash
#
# Library audit — answers "does Mode B have any point for this library?"
#
# Mode B sends original file bytes and the TV decodes them itself, so it only
# works for files the TV can actually play. If most of a library is MKV or HEVC,
# Mode B is worthless without remuxing and the effort belongs in ffmpeg.wasm
# instead. See portalcast-plan.md §7 (Mode B decision gate) and §13.
#
# Usage:  scripts/audit-library.sh ~/Videos [more dirs...]
#
# Reads only. Nothing is modified, nothing leaves the machine.

set -uo pipefail

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe not found. Install it with:  brew install ffmpeg" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <directory> [more directories...]" >&2
  echo "Example: $0 ~/Videos ~/Movies" >&2
  exit 1
fi

TMP="$(mktemp -t pc-audit)"
trap 'rm -f "$TMP"' EXIT

echo "Scanning for video files..." >&2

# Collect files first so we can show progress and a total.
FILES="$(mktemp -t pc-files)"
trap 'rm -f "$TMP" "$FILES"' EXIT
for dir in "$@"; do
  if [ ! -d "$dir" ]; then
    echo "  skipping '$dir' (not a directory)" >&2
    continue
  fi
  find "$dir" -type f \( \
    -iname '*.mkv' -o -iname '*.mp4' -o -iname '*.m4v' -o -iname '*.avi' \
    -o -iname '*.mov' -o -iname '*.webm' -o -iname '*.wmv' -o -iname '*.flv' \
    -o -iname '*.ts' -o -iname '*.m2ts' -o -iname '*.mpg' -o -iname '*.mpeg' \
    \) -print0 2>/dev/null
done > "$FILES"

TOTAL=$(tr -cd '\0' < "$FILES" | wc -c | tr -d ' ')
if [ "$TOTAL" -eq 0 ]; then
  echo "No video files found in: $*" >&2
  exit 1
fi
echo "Found $TOTAL files. Probing (this can take a while on a large library)..." >&2

N=0
while IFS= read -r -d '' f; do
  N=$((N + 1))
  printf '\r  %d/%d' "$N" "$TOTAL" >&2

  # Two targeted calls, because ffprobe emits codec_name BEFORE codec_type and
  # gives no stream delimiter without wrappers — so parsing a combined dump
  # silently attributes the audio codec to the video stream. Ask per stream.
  vinfo=$(ffprobe -v error -select_streams v:0 -show_entries \
      stream=codec_name,width,height,pix_fmt,color_transfer \
      -of csv=p=0:nk=1 "$f" 2>/dev/null | head -1)
  acodec=$(ffprobe -v error -select_streams a:0 -show_entries \
      stream=codec_name -of csv=p=0:nk=1 "$f" 2>/dev/null | head -1)

  IFS=',' read -r vcodec width height pixfmt transfer <<< "$vinfo"

  ext=$(printf '%s' "${f##*.}" | tr '[:upper:]' '[:lower:]')
  : "${vcodec:=unknown}" "${acodec:=none}" "${height:=0}" "${transfer:=}" "${pixfmt:=}"
  [ "$transfer" = "unknown" ] && transfer=""

  # Resolution bucket
  if   [ "$height" -ge 1600 ] 2>/dev/null; then res="4K"
  elif [ "$height" -ge 1000 ] 2>/dev/null; then res="1080p"
  elif [ "$height" -ge 700  ] 2>/dev/null; then res="720p"
  elif [ "$height" -gt 0    ] 2>/dev/null; then res="SD"
  else res="?"; fi

  # HDR: PQ (smpte2084) or HLG (arib-std-b67), or a 10-bit pixel format
  hdr="SDR"
  case "$transfer" in smpte2084|arib-std-b67) hdr="HDR" ;; esac
  case "$pixfmt" in *10le|*10be|*12le|*12be) [ "$hdr" = "SDR" ] && hdr="10bit" ;; esac

  printf '%s\t%s\t%s\t%s\t%s\n' "$ext" "$vcodec" "$res" "$hdr" "$acodec" >> "$TMP"
done < "$FILES"
printf '\r' >&2
echo "" >&2

bar() { # bar <count> <total>
  local n=$1 t=$2 w=28 filled
  filled=$(( t > 0 ? n * w / t : 0 ))
  printf '%*s' "$filled" '' | tr ' ' '#'
  printf '%*s' $(( w - filled )) ''
}

section() {
  local title=$1 col=$2
  echo "$title"
  sort "$TMP" | cut -f"$col" | sort | uniq -c | sort -rn | while read -r count value; do
    printf '  %-16s %5d  %5.1f%%  %s\n' "$value" "$count" \
      "$(echo "$count $TOTAL" | awk '{printf "%.1f", $1*100/$2}')" "$(bar "$count" "$TOTAL")"
  done
  echo ""
}

echo "========================================================"
echo " PortalCast library audit — $TOTAL files"
echo "========================================================"
echo ""
section "CONTAINER"      1
section "VIDEO CODEC"    2
section "RESOLUTION"     3
section "COLOUR"         4
section "AUDIO CODEC"    5

# --- The actual decision input -------------------------------------------
# A conservative TV plays MP4/M4V containing H.264 with AAC. That is the floor
# every target TV should manage. Count how much of the library clears it.
SAFE=$(awk -F'\t' '
  ($1=="mp4" || $1=="m4v") && $2=="h264" && ($5=="aac" || $5=="mp3") {n++}
  END{print n+0}' "$TMP")
MKV=$(awk -F'\t' '$1=="mkv"{n++} END{print n+0}' "$TMP")
HEVC=$(awk -F'\t' '$2=="hevc"{n++} END{print n+0}' "$TMP")
UHD=$(awk -F'\t' '$3=="4K"{n++} END{print n+0}' "$TMP")
HDRN=$(awk -F'\t' '$4=="HDR"{n++} END{print n+0}' "$TMP")
pct() { echo "$1 $TOTAL" | awk '{printf "%.0f", $1*100/$2}'; }

echo "========================================================"
echo " WHAT THIS MEANS"
echo "========================================================"
echo ""
printf '  Playable directly on a basic TV (MP4 + H.264 + AAC):  %d of %d  (%s%%)\n' \
  "$SAFE" "$TOTAL" "$(pct "$SAFE")"
printf '  In an MKV container (often unplayable as-is):          %d  (%s%%)\n' "$MKV" "$(pct "$MKV")"
printf '  HEVC / H.265 video (patchy TV support):                %d  (%s%%)\n' "$HEVC" "$(pct "$HEVC")"
printf '  4K (out of scope — plan §1):                           %d  (%s%%)\n' "$UHD" "$(pct "$UHD")"
printf '  HDR (out of scope, and lost in Mode A anyway):          %d  (%s%%)\n' "$HDRN" "$(pct "$HDRN")"
echo ""

if [ "$(pct "$SAFE")" -lt 40 ]; then
  echo "  VERDICT: Mode B would serve a minority of this library."
  echo "  Most files need remuxing before a TV could play the bytes, so"
  echo "  ffmpeg.wasm remux outranks the Service Worker bridge. Mode A"
  echo "  stays the only mode that works on everything."
elif [ "$(pct "$SAFE")" -lt 75 ]; then
  echo "  VERDICT: Mode B would serve a decent share, but not most of it."
  echo "  Worth revisiting only if Mode A's quality or CPU cost disappoints."
else
  echo "  VERDICT: most of this library would play directly on a TV, so"
  echo "  Mode B is technically viable. It still only earns its place if"
  echo "  Mode A measurably falls short (plan §7 decision gate)."
fi
echo ""
echo "  Nothing was modified. Paste this output back into the plan's §13."
echo ""
