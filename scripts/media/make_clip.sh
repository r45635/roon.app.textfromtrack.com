#!/bin/zsh
# make_clip.sh <out-basename> <seconds-per-frame> <x> <y> <w> <h> <frame.jpg>...
# Assemble captured frames into <out>.mp4 (H.264, hard cuts: blending ghosts scrolling text) and <out>.gif (800 px wide).
set -e
out=$1; spf=$2; x=$3; y=$4; w=$5; h=$6; shift 6
tmp=$(mktemp -d); list=$tmp/list.txt
for f in "$@"; do echo "file '$f'" >> $list; echo "duration $spf" >> $list; done
echo "file '${@[-1]}'" >> $list   # concat demuxer needs the last file twice
mkdir -p "$(dirname "$out")"
ffmpeg -loglevel error -y -f concat -safe 0 -i $list \
  -vf "crop=$w:$h:$x:$y,scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=25,format=yuv420p" \
  -c:v libx264 -crf 20 -preset slow -movflags +faststart "$out.mp4"
ffmpeg -loglevel error -y -i "$out.mp4" -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "$out.gif"
rm -rf $tmp
ls -la "$out.mp4" "$out.gif" | awk '{print $5, $9}'
ffprobe -v error -show_entries format=duration -of csv=p=0 "$out.mp4"
