'use strict';
// Le regole del movimento (skill «animate» di Emil Kowalski, riassunte in CLAUDE.md) come prove sul foglio di stile e su movimento.js.
// Chi aggiunge un movimento deve passare di qui: la tabella «Never ship» della skill diventa un controllo, non un buon proposito.
// Il logo (momenti di marchio) sta tra i marcatori «=== LOGO» e «=== fine LOGO» del foglio di stile ed è fuori da queste regole.
//   node --test test/win.movimento.test.js
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs'), path = require('path');

const WEB = process.env.GYMART_WEB || path.join(__dirname, '..', 'win', 'web'); // (GYMART_WEB: una copia con un difetto messo apposta, per vedere che la prova lo trova)
const leggi = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const css = leggi('gymart.css');
const mov = leggi('movimento.js'), app = leggi('app.js');

const LOGO = /\/\* === LOGO[\s\S]*?\/\* === fine LOGO === \*\//;
assert.ok(LOGO.test(css), 'i marcatori del logo mancano nel foglio di stile');
const nuda = css.replace(LOGO, '').replace(/\/\*[\s\S]*?\*\//g, ''); // senza il logo e senza commenti

/** Le regole una per una, con il contesto (@media, @supports, @starting-style) in cui stanno. */
function regole(testo, ctx) {
  const out = []; let i = 0;
  while (i < testo.length) {
    const apre = testo.indexOf('{', i); if (apre < 0) break;
    const testa = testo.slice(i, apre).trim();
    let prof = 1, j = apre + 1;
    while (j < testo.length && prof) { if (testo[j] === '{') prof++; else if (testo[j] === '}') prof--; j++; }
    const dentro = testo.slice(apre + 1, j - 1);
    if (/^@(media|supports|starting-style|layer|container)/.test(testa)) out.push.apply(out, regole(dentro, (ctx || '') + ' ' + testa));
    else out.push({ sel: testa, corpo: dentro, ctx: ctx || '' });
    i = j;
  }
  return out;
}
const tutte = regole(nuda, '');
const variabili = {}; // --t-press: 160ms, ecc.
(nuda.match(/--[\w-]+\s*:\s*[^;}]+/g) || []).forEach((d) => { const m = /^(--[\w-]+)\s*:\s*(.+)$/.exec(d.trim()); if (m && !(m[1] in variabili)) variabili[m[1]] = m[2].trim(); });
/** Tutte le dichiarazioni transition / animation (abbreviate) con il loro valore. */
function dichiarazioni(nome) {
  const r = []; const re = new RegExp('(?:^|[;{\\s])' + nome + '\\s*:\\s*([^;}]+)', 'g');
  tutte.forEach((x) => { let m; re.lastIndex = 0; while ((m = re.exec(x.corpo))) r.push({ sel: x.sel, valore: m[1].trim() }); });
  return r;
}
const transizioni = dichiarazioni('transition'), animazioni = dichiarazioni('animation');
const tempi = (v) => { // i tempi di un valore, in ms, con le variabili --t-* sciolte
  const sciolto = v.replace(/var\((--[\w-]+)\)/g, (_, n) => variabili[n] || '');
  return (sciolto.match(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g) || []).map((t) => /ms$/.test(t) ? parseFloat(t) : parseFloat(t) * 1000);
};

test('movimento: le sole due curve della skill, e come variabili', () => {
  assert.equal(variabili['--ease-out'], 'cubic-bezier(.23,1,.32,1)');
  assert.equal(variabili['--ease-in-out'], 'cubic-bezier(.77,0,.175,1)');
  assert.equal((nuda.match(/cubic-bezier\(/g) || []).length, 2, 'nessuna curva a mano: ci sono solo --ease-out e --ease-in-out');
  assert.ok(!/--ease\s*:/.test(nuda) && !/var\(--ease\)/.test(nuda), 'la vecchia --ease non c\'è più');
});

test('movimento: mai «transition: all», mai scale(0), mai ease-in, mai ease-out della libreria del browser', () => {
  transizioni.forEach((x) => assert.ok(!/(^|,)\s*all\b/.test(x.valore), 'transition: all in ' + x.sel));
  assert.ok(!/(?<![XYZ3d])scale\(\s*0\s*[,)]/i.test(nuda), 'scale(0): si parte da scale(.95–.97) e dissolvenza');
  transizioni.concat(animazioni).forEach((x) => {
    assert.ok(!/(?<![-\w])ease-in(?![-\w])/.test(x.valore), 'ease-in in ' + x.sel + ': parte piano proprio quando la persona guarda');
    assert.ok(!/(?<![-\w])ease-out(?![-\w])/.test(x.valore), 'ease-out del browser in ' + x.sel + ': troppo debole, si usa var(--ease-out)');
  });
});

test('movimento: ogni durata e ogni ritardo restano sotto i 300 ms (il giro continuo del caricamento è l\'unica eccezione)', () => {
  const lunghi = [];
  transizioni.concat(animazioni).forEach((x) => { if (/\binfinite\b/.test(x.valore)) return; tempi(x.valore).forEach((t) => { if (t > 300) lunghi.push(x.sel + ' → ' + t + ' ms'); }); });
  assert.deepEqual(lunghi, [], 'durate sopra i 300 ms');
  Object.keys(variabili).filter((n) => /^--t-/.test(n)).forEach((n) => assert.ok(tempi(variabili[n])[0] <= 300, n));
  assert.ok(tempi(variabili['--t-esce'])[0] < tempi(variabili['--t-modal'])[0], 'l\'uscita è più corta dell\'ingresso');
});

test('movimento: i movimenti sul passaggio del mouse stanno dietro (hover: hover) and (pointer: fine)', () => {
  const senza = tutte.filter((x) => /:hover/.test(x.sel) && /transform|animation|translate|scale|rotate/.test(x.corpo) && !/\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/.test(x.ctx));
  assert.deepEqual(senza.map((x) => x.sel), [], 'un :hover che muove qualcosa su un telefono scatta al tocco');
});

test('movimento: la ricerca veloce (Ctrl+K) non si anima, l\'avviso non usa i fotogrammi', () => {
  tutte.filter((x) => /\.cerca-ris/.test(x.sel)).forEach((x) => assert.ok(!/transition|animation/.test(x.corpo), 'la ricerca si apre da tastiera, decine di volte: nessuna animazione (' + x.sel + ')'));
  tutte.filter((x) => /\.toast/.test(x.sel)).forEach((x) => assert.ok(!/animation/.test(x.corpo), 'l\'avviso usa transizioni (si può rimettere mentre esce): ' + x.sel));
  assert.ok(!/@keyframes\s+toast/.test(nuda));
});

test('movimento: i fotogrammi sono pochi e dichiarati (chi ne aggiunge uno aggiorna questa lista sapendo perché)', () => {
  const nomi = (nuda.match(/@keyframes\s+([\w-]+)/g) || []).map((s) => s.replace(/@keyframes\s+/, '')).sort();
  assert.deepEqual(nomi, ['crescita', 'giro', 'larghezza', 'rise', 'sp'], 'ingresso della pagina (rise), grafici (crescita, larghezza, giro), caricamento (sp)');
});

test('movimento: la pressione dei pulsanti è scale(.97) in 160 ms, e con il movimento spento non c\'è', () => {
  assert.match(nuda, /\.btn:active\{transform:scale\(\.97\)\}/);
  assert.equal(variabili['--t-press'], '160ms');
  assert.match(nuda, /\.btn\{[^}]*transform var\(--t-press\) var\(--ease-out\)/);
  assert.match(nuda, /html\[data-movimento="spento"\] :is\(\.btn[^)]*\):active\{transform:none\}/);
});

test('movimento: «ridotto» è solo dissolvenza, «spento» è niente, il sistema che chiede meno movimento è rispettato', () => {
  ['--pose-pop', '--pose-menu', '--pose-modal', '--pose-toast', '--pose-pagina'].forEach((n) => assert.ok(variabili[n] && variabili[n] !== 'none', n + ' (la posa di partenza con il movimento pieno)'));
  const livelli = tutte.find((x) => x.sel === 'html[data-movimento="ridotto"],html[data-movimento="spento"]');
  assert.ok(livelli, 'ridotto e spento tolgono ogni posa');
  ['--pose-pop', '--pose-menu', '--pose-modal', '--pose-toast', '--pose-pagina'].forEach((n) => assert.ok(new RegExp(n + ':none').test(livelli.corpo), n + ' senza movimento'));
  const spento = tutte.find((x) => /html\[data-movimento="spento"\] \*,/.test(x.sel));
  assert.ok(spento && /animation:none !important/.test(spento.corpo) && /transition:none !important/.test(spento.corpo) && /::backdrop/.test(spento.sel), 'spento ferma anche lo sfondo delle finestre');
  const sistema = tutte.find((x) => /prefers-reduced-motion:\s*reduce/.test(x.ctx) && /^\*/.test(x.sel));
  assert.ok(sistema && /transition-duration:\.001ms !important/.test(sistema.corpo) && /transition-delay:0s !important/.test(sistema.corpo) && /::backdrop/.test(sistema.sel), 'prefers-reduced-motion');
});

test('movimento: avviso, finestre, anteprime e foglio del telefono entrano e escono con transizioni, partendo dalle pose', () => {
  const sel = (s) => tutte.filter((x) => x.sel === s);
  const una = (s) => { const r = sel(s); assert.ok(r.length >= 1, 'manca la regola ' + s); return r.map((x) => x.corpo).join(';'); };
  assert.match(una('.toast'), /visibility:hidden[^}]*transform:var\(--pose-toast\)[^}]*visibility 0s linear var\(--t-esce\)/s);
  assert.match(una('.toast.on'), /opacity:1;visibility:visible/);
  assert.match(una('dialog.modale'), /transform:var\(--pose-modal\)[^}]*overlay var\(--t-esce\) allow-discrete,display var\(--t-esce\) allow-discrete/s);
  assert.match(una('dialog.modale[open]'), /transition-duration:var\(--t-modal\)/);
  assert.ok(tutte.some((x) => /@starting-style/.test(x.ctx) && x.sel === 'dialog.modale[open]'), 'la finestra parte da @starting-style');
  assert.ok(tutte.some((x) => /@starting-style/.test(x.ctx) && x.sel === 'dialog.modale[open]::backdrop'), 'lo sfondo parte da @starting-style');
  assert.match(una('.anteprima'), /transition:opacity var\(--t-tip\) var\(--ease-out\),transform var\(--t-tip\) var\(--ease-out\)/);
  assert.match(una('.anteprima.esce'), /opacity:0;transform:var\(--pose-pop\)/);
  assert.match(una('.sheet[hidden] .sheet-in'), /transform:var\(--pose-menu\)/);
  assert.match(una('.view.enter > *'), /animation:rise var\(--t-pagina\) var\(--ease-out\) both/);
});

test('movimento: movimento.js non ha rimbalzi, sfocature decorative né rivelazioni allo scorrimento', () => {
  const codice = mov.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/back\.(out|in)|elastic|bounce/.test(codice), 'niente rimbalzi: la skill li riserva ai gesti');
  assert.ok(!/blur\(/.test(codice), 'niente sfocature per entrare');
  assert.ok(!/ST\.batch|ScrollTrigger\.batch|onEnter/.test(codice), 'niente rivelazioni allo scorrimento: la segreteria legge dati ogni giorno');
  assert.ok(!/M\.avviso|animaGrafici/.test(codice), 'avviso e grafici sono CSS');
  assert.match(codice, /cifreFatte/, 'le cifre che scorrono solo la prima volta');
  assert.ok(!/Movimento\.avviso/.test(app), 'app.js non chiama più il rimbalzo dell\'avviso');
});

test('movimento: l\'anteprima si apre dall\'angolo vicino al puntatore, e esce in dissolvenza solo se il puntatore se ne va', () => {
  assert.match(app, /box\.style\.transformOrigin\s*=/);
  assert.match(app, /function chiudi\(dolce\)/);
  assert.match(app, /setTimeout\(function \(\) \{ chiudi\(true\); \}, 250\)/);
  assert.match(app, /classList\.add\('esce'\)/);
});

test('movimento: la finestra esce con la sua dissolvenza e poi lascia la pagina (subito se il movimento è spento)', () => {
  assert.match(app, /transitionDuration\)\s*\|\|\s*0;\s*\n\s*if \(dur > 0\.01\) setTimeout\(function \(\) \{ d\.remove\(\); \}/);
});
