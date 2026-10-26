// shoot.mjs — drive a headless Chrome over CDP and grab full-resolution frames of the companion UI.
// usage: node shoot.mjs <port> <outdir> <steps.json>
// steps: [{nav:url} | {eval:js} | {wait:ms} | {frames:n, every:ms, prefix} | {click:[x,y]} | {key:"f"} | {move:[x,y]}]
import fs from 'node:fs';
import path from 'node:path';

const [port, outdir, stepsFile] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
fs.mkdirSync(outdir, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1468, height: 739, deviceScaleFactor: 1, mobile: false });

let count = 0;
for (const s of steps) {
  if (s.nav) { await send('Page.navigate', { url: s.nav }); await sleep(2500); }
  else if (s.eval) {
    const r = await send('Runtime.evaluate', { expression: s.eval, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.text} ${s.eval.slice(0, 80)}`);
    if (s.log) console.log('eval:', JSON.stringify(r.result.value));
  }
  else if (s.wait) await sleep(s.wait);
  else if (s.move) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.move[0], y: s.move[1] });
  else if (s.click || s.clickSel) {
    let x, y;
    if (s.click) [x, y] = s.click;
    else {
      // clickSel: CSS selector, optional text: the visible element whose text matches
      const expr = `(() => { const els = [...document.querySelectorAll(${JSON.stringify(s.clickSel)})]
        .filter(e => ${JSON.stringify(s.text || '')} === '' || e.textContent.trim() === ${JSON.stringify(s.text || '')});
        const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2]; })()`;
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (!r.result.value) throw new Error(`nothing matches ${s.clickSel} ${s.text || ''}`);
      [x, y] = r.result.value;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  else if (s.key) {
    const k = s.key;
    const code = k.length === 1 ? `Key${k.toUpperCase()}` : k;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k.length === 1 ? k : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
  }
  else if (s.frames) {
    for (let i = 0; i < s.frames; i++) {
      const t0 = Date.now();
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outdir, `${s.prefix || 'f'}-${String(++count).padStart(3, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      const left = (s.every || 1000) - (Date.now() - t0);
      if (left > 0) await sleep(left);
    }
  }
}
console.log(`frames: ${count}`);
ws.close();
