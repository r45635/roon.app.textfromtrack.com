# Doc and promo media

How the screenshots, clips and the AD5 cut in `docs/media` and `docs/marketing` are made.
Always shoot in **Screenshot mode** (neutral names) and check every frame before committing.

1. Start a headless Chrome with a debugging port, in the UI language you want:

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
     --remote-debugging-port=9333 --user-data-dir=/tmp/tft-shoot --lang=fr about:blank &
   ```

2. Describe the shot as JSON steps and run `node shoot.mjs 9333 <outdir> <steps.json>`. Steps:
   `{nav}` · `{eval}` (set `localStorage` `tft:privacy`, `i18nextLng`, `tft:theme`, or call the
   API with `fetch`) · `{wait}` · `{clickSel, text}` · `{click:[x,y]}` · `{key}` · `{move}` ·
   `{frames, every, prefix}`. The viewport is 1468×739 at 1×, the size the existing crops assume.
3. Assemble: `make_clip.sh <out> <sec-per-frame> <x> <y> <w> <h> frames…` (MP4 + 800 px GIF,
   hard cuts — crossfades ghost scrolling lyrics), and
   `make_ad5.sh <out> <end-card.png> clip.mp4:start:dur…` for the promo cut. The end card is
   `docs/marketing/visuals/template.html?f=end&lang=en|fr`, rendered with `--screenshot`.

Crops used so far (x y w h): player and lyrics `220 0 1028 738` with the page scaled 0.7;
timing `287 262 894 476`; zones `287 0 894 560`; full screen `0 0 1468 738` unscaled.
Music: Josh Woodward, CC BY 4.0 — credit it with every picture.
