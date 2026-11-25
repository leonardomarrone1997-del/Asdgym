// node tools/icona.js -> the icon of the program from the logo of the start screen (coloured ring and gymnast, logo.js):
// win/web/icon.svg (the window and the tab) and win/winres/icon*.png (the .exe, through go-winres). A white disc inside the ring keeps the gymnast visible on a dark taskbar.
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const WEB = path.join(__dirname, '..', 'win', 'web'), RES = path.join(__dirname, '..', 'win', 'winres');
const logo = fs.readFileSync(path.join(WEB, 'logo.js'), 'utf8');
const blocco = logo.slice(logo.indexOf('var PERCORSI'), logo.indexOf('var LETTERE')); // (COLORI, before it, has keys with the same names)
const d = (k) => { const m = new RegExp(k + ": '(M[^']+)'").exec(blocco); if (!m) throw new Error('path ' + k + ' not found in logo.js'); return m[1]; };
const COL = { rosa: '#EA6CB1', giallo: '#FBD84C', blu: '#316FB5', azzurro: '#54AFC4' };
const A = /ANELLO = \{ cx: ([\d.]+), cy: ([\d.]+), r: ([\d.]+) \}/.exec(logo);
const cx = +A[1], cy = +A[2], r = +A[3];
const m = 290, vb = [cx - m, cy - m, 2 * m, 2 * m].map((x) => x.toFixed(1)).join(' '); // a little margin around the ring (its brush strokes reach the edge of the mark)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><circle cx="${cx}" cy="${cy}" r="${(r - 4).toFixed(1)}" fill="#FFFFFF"/>` +
  ['rosa', 'giallo', 'blu', 'azzurro'].map((k) => `<path fill="${COL[k]}" fill-rule="evenodd" d="${d(k)}"/>`).join('') +
  `<path fill="#151318" fill-rule="evenodd" d="${d('atleta')}"/></svg>\n`;
fs.writeFileSync(path.join(WEB, 'icon.svg'), svg);
(async () => {
  const br = await chromium.launch(), pg = await br.newPage();
  for (const [n, f] of [[256, 'icon.png'], [48, 'icon48.png'], [32, 'icon32.png'], [16, 'icon16.png']]) {
    await pg.setViewportSize({ width: n, height: n });
    await pg.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${n}px;height:${n}px;display:block}</style>` + svg);
    await pg.screenshot({ path: path.join(RES, f), omitBackground: true });
  }
  await br.close();
  console.log('icona: web/icon.svg e winres/icon*.png');
})();
