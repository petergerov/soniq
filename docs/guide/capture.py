"""Takes the screenshots for the guide from the running app.

Starts an invisible Chrome with an empty temporary profile (your normal Chrome is untouched) and writes:

    images/form.png      header + form, with numbered markers   (using-the-app.md)
    images/song-row.png  one song row of the library, numbered   (using-the-app.md)
    images/folders.png   the folder bar                          (using-the-app.md)

The markers are drawn into the page before the screenshot, so the images need no post-processing.
Two sample folders are shown in the folder bar for the picture only; nothing is saved.

Usage (the app must be running and have at least one finished song):
    uv run --with websockets python docs/guide/capture.py [http://127.0.0.1:8765/]
"""
import base64
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from websockets.sync.client import connect

IMAGES = Path(__file__).parent / "images"
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WIDTH, HEIGHT, SCALE = 900, 1700, 2   # CSS pixels; images are rendered at double resolution
ROW_LEGEND_SPACE = 34                 # room below the song row for its markers

# Runs before the page loads: English interface, "All" view, and two sample folders in /api/folders.
INIT_JS = r"""
localStorage.setItem('ui_lang', 'en');
localStorage.setItem('folder', '');
localStorage.setItem('layout', 'stack');
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  if (!String(input).startsWith('/api/folders') || (init && init.method && init.method !== 'GET')) return res;
  const data = await res.json();
  data.folders = [{ id: 'f1', name: 'Trip hop', count: 6 }, { id: 'f2', name: 'Film music', count: 3 }];
  data.none = Math.max(0, data.all - 9);
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
};
"""

# Runs on the loaded page: tidies it up, draws the markers and returns the areas to capture (CSS pixels).
PAGE_JS = r"""
(() => {
  document.querySelectorAll('details').forEach(d => d.open = false);
  document.activeElement && document.activeElement.blur();
  window.scrollTo(0, 0);
  const R = (el) => { const r = el.getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height}; };
  const text = (el) => { const g = document.createRange(); g.selectNodeContents(el); return R({getBoundingClientRect: () => g.getBoundingClientRect()}); };
  const q = (sel) => document.querySelector(sel);
  const label = (key) => text(q(`[data-i18n="${key}"]`));
  const bpm = [...document.querySelectorAll('.lbl')].find(e => e.textContent.trim().toLowerCase() === 'bpm');

  const done = [...document.querySelectorAll('.song')].filter(s => s.querySelector('.download'));
  const song = done.find(s => s.querySelector('[data-a=lyrics]')) || done[0];
  if (song) song.style.marginBottom = '__ROWSPACE__px';   // room for the row markers

  const marker = (n, x, y) => {
    const m = document.createElement('div');
    m.textContent = n;
    Object.assign(m.style, {
      position: 'absolute', left: `${x - 11}px`, top: `${y - 11}px`, width: '22px', height: '22px', zIndex: 50,
      borderRadius: '50%', display: 'grid', placeItems: 'center', font: '700 12px/1 system-ui, sans-serif', color: '#fff',
      background: '#f43f5e', boxShadow: '0 0 0 3px rgba(8, 8, 11, .9), 0 4px 10px rgba(0, 0, 0, .5)',
    });
    document.body.append(m);
  };
  const right = (r, gap = 22) => [r.x + r.w + gap, r.y + r.h / 2];
  const left = (r, gap = 22) => [r.x - gap, r.y + r.h / 2];

  // Form: numbers next to the elements, not on top of them (order = legend in using-the-app.md)
  const logo = R(q('.logo-wrap'));
  const gen = R(q('#genBtn'));
  const gear = R(q('#btnSettings'));
  [
    [logo.x + logo.w / 2, logo.y + logo.h + 14],
    left(R(q('#titleDice'))),
    left(R(q('#diceBtn'))),
    right(label('style')),
    right(label('length')),
    right(text(bpm)),
    right(text(q('#lyricsBox summary > span'))),
    right(text(q('summary[data-i18n="advanced"]'))),
    [gen.x + gen.w - 14, gen.y - 16],
    [gear.x + gear.w / 2, gear.y + gear.h + 14],
  ].forEach(([x, y], i) => marker(i + 1, x, y));

  // Song row: numbers under its buttons
  let row = null;
  if (song) {
    row = R(song);
    ['.round', '[data-a=fav]', '.download', '[data-a=lyrics]', '[data-a=move]', '[data-a=more]', '[data-a=reuse]', '[data-a=del]']
      .map(s => song.querySelector(s)).filter(Boolean)
      .forEach((el, i) => { const r = R(el); marker(i + 1, r.x + r.w / 2, row.y + row.h + __ROWSPACE__ / 2); });
  }
  const card = R(q('.card'));
  return JSON.stringify({ card, row, bar: R(q('#folderBar')) });
})()
"""


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Cdp:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, js):
        r = self.call("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def shot(self, path, x, y, w, h):
        r = self.call("Page.captureScreenshot", format="png", clip={"x": x, "y": y, "width": w, "height": h, "scale": 1})
        Path(path).write_bytes(base64.b64decode(r["data"]))


def capture(cdp):
    cdp.call("Page.enable")
    cdp.call("Emulation.setDeviceMetricsOverride", width=WIDTH, height=HEIGHT, deviceScaleFactor=SCALE, mobile=False)
    cdp.call("Page.addScriptToEvaluateOnNewDocument", source=INIT_JS)
    cdp.call("Page.navigate", url=URL)
    ready = "document.readyState === 'complete' && !!document.querySelector('.song .download') && !!document.querySelector('.chip.fold[data-f=f1]')"
    for _ in range(60):
        if cdp.eval(ready):
            break
        time.sleep(0.5)
    else:
        sys.exit(f"The app does not respond or has no finished song yet. Is it running at {URL} ?")
    time.sleep(1.0)
    d = json.loads(cdp.eval(PAGE_JS.replace("__ROWSPACE__", str(ROW_LEGEND_SPACE))))
    time.sleep(0.3)

    IMAGES.mkdir(exist_ok=True)
    card = d["card"]
    cdp.shot(IMAGES / "form.png", 0, 0, WIDTH, card["y"] + card["h"] + 8)   # down to just below the form
    row = d["row"]
    cdp.shot(IMAGES / "song-row.png", row["x"] - 4, row["y"] - 4, row["w"] + 8, row["h"] + ROW_LEGEND_SPACE + 4)
    bar = d["bar"]
    cdp.shot(IMAGES / "folders.png", bar["x"] - 6, bar["y"] - 6, bar["w"] + 12, bar["h"] + 6)
    print("ok:", ", ".join(p.name for p in sorted(IMAGES.glob("*.png"))))


def main():
    profile = tempfile.mkdtemp(prefix="soniq-capture-")
    port = free_port()
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
         "--no-first-run", "--hide-scrollbars", "--disable-gpu", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1))
                if any(t.get("type") == "page" for t in targets):
                    break
            except OSError:
                pass
            time.sleep(0.5)
        else:
            sys.exit("Chrome did not start.")
        page = next(t for t in targets if t.get("type") == "page")
        with connect(page["webSocketDebuggerUrl"], max_size=None) as ws:
            capture(Cdp(ws))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


main()
