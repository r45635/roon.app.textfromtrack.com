#!/bin/zsh
# make_ad5.sh <out-basename> <end-card.png> <clip.mp4:start:dur>...
# Cut the clips (hard cuts), fit each on a 1280×720 dark canvas, end on the card (3 s, fade in).
set -e
out=$1; card=$2; shift 2
args=(); filters=""; n=0
for spec in "$@"; do
  f=${spec%%:*}; rest=${spec#*:}; ss=${rest%%:*}; dur=${rest#*:}
  args+=(-ss $ss -t $dur -i $f)
  filters+="[$n:v]fps=25,scale=1240:680:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x171715,setsar=1,format=yuv420p[v$n];"
  n=$((n+1))
done
args+=(-loop 1 -t 3 -i $card)
filters+="[$n:v]fps=25,scale=1280:720,setsar=1,format=yuv420p,fade=t=in:st=0:d=0.4[v$n];"
concat=""; for i in $(seq 0 $n); do concat+="[v$i]"; done
filters+="${concat}concat=n=$((n+1)):v=1:a=0[out]"
mkdir -p "$(dirname "$out")"
ffmpeg -loglevel error -y "${args[@]}" -filter_complex "$filters" -map "[out]" -c:v libx264 -crf 20 -preset slow -movflags +faststart "$out.mp4"
ffmpeg -loglevel error -y -i "$out.mp4" -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" "$out.gif"
ls -la "$out.mp4" "$out.gif" | awk '{print $5, $9}'
ffprobe -v error -show_entries format=duration -of csv=p=0 "$out.mp4"
