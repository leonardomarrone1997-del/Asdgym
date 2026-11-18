'use strict';
// Real contrast of every piece of text on the screen, measured on the pixels.
// leggibilita(page): collects the text that is visible in the window, hides it, takes a screenshot of what is behind it (background,
// glass over the gradient, blobs, charts) and compares, for every line of text, its colour with the worst pixel under it.
// Text needs 4.5:1 (3:1 when it is large: 24 px, or 18.66 px in bold). Returns { controllati, problemi: [text] }.
// Used by win.e2e.js; the page must be still (not in the middle of an entrance animation).

/** Runs in the page: the pieces of text on screen, with the rectangle of each line and its colour. */
function raccogli() {
  const out = [], w = window.innerWidth, h = window.innerHeight;
  const barre = [].filter.call(document.querySelectorAll('.top,.bottom'), (e) => getComputedStyle(e).display !== 'none').map((e) => e.getBoundingClientRect());
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const e = n.parentElement;
    if (!e || /^(SCRIPT|STYLE|OPTION|NOSCRIPT|TITLE)$/i.test(e.tagName) || e.closest('[hidden],.sr-only,.salta,.od')) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    // what is inside a closed "details" (except its title) is not on the screen, even if the browser still gives it a box
    let chiuso = false;
    for (let a = e.parentElement; a; a = a.parentElement) { if (a.tagName === 'DETAILS' && !a.open) { const s = a.querySelector(':scope > summary'); if (!(s && s.contains(e))) { chiuso = true; break; } } }
    if (chiuso) continue;
    let o = 1, p = e; while (p && p !== document.documentElement) { o *= parseFloat(getComputedStyle(p).opacity); p = p.parentElement; }
    if (o < 0.5) continue; // not shown (yet): nothing to read
    const range = document.createRange(); range.selectNodeContents(n);
    // what an ancestor cuts away (a long text with "...") is not seen: the line is clipped to it
    const tagli = []; for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(hidden|clip|auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) tagli.push(a.getBoundingClientRect()); }
    const rects = [].map.call(range.getClientRects(), (r) => {
      let l = r.left, t = r.top, rr = r.right, b = r.bottom;
      tagli.forEach((q) => { l = Math.max(l, q.left); t = Math.max(t, q.top); rr = Math.min(rr, q.right); b = Math.min(b, q.bottom); });
      // the bars that stay on screen (top, bottom) hide what slides under them: only the part that is really visible is measured
      if (!e.closest('.top,.bottom,.side,.sheet,.toast')) barre.forEach((q) => { if (q.top > t && q.top < b) b = q.top; if (q.bottom > t && q.bottom < b) t = q.bottom; });
      l = Math.max(0, Math.floor(l)); t = Math.max(0, Math.floor(t)); rr = Math.min(w, Math.ceil(rr)); b = Math.min(h, Math.ceil(b));
      return { x: l, y: t, w: rr - l, h: b - t };
    }).filter((r) => r.w > 2 && r.h > 4).filter((r) => {
      // a line that is under something else (the bar at the bottom of a phone, a message) is not read there: it is skipped
      const cima = document.elementFromPoint(Math.min(w - 1, r.x + r.w / 2), Math.min(h - 1, r.y + r.h / 2));
      return !!cima && (e.contains(cima) || cima.contains(e));
    });
    if (!rects.length) continue;
    const svg = e instanceof SVGElement, color = svg ? cs.fill : cs.color;
    if (!color || color === 'none') continue;
    out.push({ t: t.slice(0, 40), el: e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''), rects, color, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400, op: o });
  }
  return out;
}

/** Runs in the page: compares each text with the pixels behind it. Two screenshots: with the text and without it; the pixels that differ are the letters. */
async function misura(arg) {
  async function leggi(b64) {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    return { px: cx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width };
  }
  const vis = await leggi(arg.visibile), hid = await leggi(arg.nascosto), W = hid.w;
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const probe = document.createElement('i'); document.body.appendChild(probe);
  const problemi = [];
  for (const it of arg.testi) {
    probe.style.color = ''; probe.style.color = it.color;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number), a = m.length > 3 ? m[3] * it.op : it.op;
    let worst = Infinity, where = null, lettere = 0;
    for (const r of it.rects) {
      let sr = 0, sg = 0, sb = 0, k = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const i = (y * W + x) * 4; sr += hid.px[i]; sg += hid.px[i + 1]; sb += hid.px[i + 2]; k++; }
      if (!k) continue;
      const bg = [sr / k, sg / k, sb / k], t = [0, 1, 2].map((i) => Math.round(m[i] * a + bg[i] * (1 - a))), lt = lum(t[0], t[1], t[2]);
      let trovate = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * W + x) * 4, d = Math.abs(vis.px[i] - hid.px[i]) + Math.abs(vis.px[i + 1] - hid.px[i + 1]) + Math.abs(vis.px[i + 2] - hid.px[i + 2]);
        if (d < 6) continue; // not a letter
        trovate++;
        const lb = lum(hid.px[i], hid.px[i + 1], hid.px[i + 2]), q = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
        if (q < worst) { worst = q; where = [x, y, 'sfondo ' + hid.px[i] + ',' + hid.px[i + 1] + ',' + hid.px[i + 2]]; }
      }
      lettere += trovate;
      if (trovate < 3) { // nothing of the text can be told apart from the background: it is as if it were not there
        const lb = lum(bg[0], bg[1], bg[2]), q = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
        if (q < worst) { worst = q; where = [r.x, r.y, 'sfondo medio ' + bg.map(Math.round).join(',')]; }
      }
    }
    if (worst === Infinity) continue;
    const grande = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700), min = grande ? 3 : 4.5;
    if (worst < min) problemi.push(it.el + ' "' + it.t + '" ' + it.size + 'px ' + it.color + ': ' + worst.toFixed(2) + ' < ' + min + ' (a ' + where[0] + ',' + where[1] + ', ' + where[2] + ')');
  }
  probe.remove();
  return problemi;
}

async function leggibilita(pg, opzioni) {
  // the entrance animation of the page (blur, opacity) must be over: what is measured is the page at rest
  await pg.waitForTimeout(150);
  await pg.waitForFunction(() => document.documentElement.dataset.entrata === 'fine', null, { timeout: 15000 });
  await pg.waitForTimeout(250);
  const testi = await pg.evaluate(raccogli);
  const visibile = await pg.screenshot();
  // the glyphs are hidden, the rest stays as it is ("color" stays: what is drawn with it, chips and borders, stays too)
  await pg.evaluate(() => {
    const s = document.createElement('style'); s.id = 'nascondi-testo';
    s.textContent = '*,*::before,*::after{-webkit-text-fill-color:transparent !important;text-decoration-color:transparent !important;text-shadow:none !important;caret-color:transparent !important}svg text{fill:transparent !important}::placeholder{-webkit-text-fill-color:transparent !important}';
    document.head.appendChild(s);
  });
  let nascosto;
  try { nascosto = await pg.screenshot(); } finally { await pg.evaluate(() => { const s = document.getElementById('nascondi-testo'); if (s) s.remove(); }); }
  if (opzioni && opzioni.salva) require('fs').writeFileSync(opzioni.salva, nascosto);
  const problemi = await pg.evaluate(misura, { visibile: visibile.toString('base64'), nascosto: nascosto.toString('base64'), testi });
  return { controllati: testi.length, problemi };
}
module.exports = { leggibilita };
