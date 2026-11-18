'use strict';
// "Utente scimmia": un robot che usa il programma vero in modo disordinato: clicca a caso, scrive valori strani (anche malevoli), cambia
// larghezza e stile, preme tasti, accetta ogni conferma. Dopo ogni passo controlla che la pagina non abbia errori, non scorra di lato,
// non esegua codice iniettato; ogni tanto controlla l'archivio sul disco e le copie.  Uso: node test/win.scimmia.js [seme=1] [passi=400]
// L'archivio di partenza viene dal file Excel finto (persone inventate).
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium } = require('playwright');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');
const X = require('../win/web/xlsx.js');
const { controlla } = require('./invarianti.js');

const SEME = parseInt(process.argv[2], 10) || 1, PASSI = parseInt(process.argv[3], 10) || 400;
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-scimmia-'));
const DATI = path.join(TMP, 'dati'), BIN = path.join(TMP, 'gymart'), OUT = path.join(ROOT, 'out');
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(SEME * 104729), pick = (a) => a[Math.floor(r() * a.length)], int = (a, b) => a + Math.floor(r() * (b - a + 1));

const STRANI = ['', ' ', 'a', 'Rossi Maria', 'Ñandú Ærø Özdemir', '日本語の名前', '🙂🙂🙂', 'x'.repeat(3000), '0', '-1', '1e308', '99999999999', '12,50', '12.50', '1.234,56', 'abc',
  '<img src=x onerror="window.__xss=1">', '"><script>window.__xss=1</script>', "'; DROP TABLE allieve; --", '${7*7}', '{{constructor.constructor("window.__xss=1")()}}', '=cmd|\' /C calc\'!A0', '+39 333 123 4567', '3331234567',
  '2026-02-30', '31/02/2026', '29/02/2028', '01/01/1900', '2099-01-01', '12/10/2013', 'RSSMRA15D45A345X', 'm@example.com', 'm@', '‮evil', '\u0000', 'a\nb\tc', 'ʼ'.repeat(50)];

(async () => {
  // starting archive: the invented workbook, imported with the program's own logic and written as the program would
  const sheets = await X.leggiXlsx(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/gestionale-finto.xlsx'))));
  const get = (n) => L.riconosciFoglio(sheets.find((s) => s.nome === n).rows).vals;
  const today = C.todayIso(), adesso = today + 'T08:00:00';
  let db = L.nuovoArchivio(today);
  db = L.importaAnagrafica(db, get('ANAGRAFICA'), adesso).db; db = L.importaIscrizioni(db, get('ISCRIZIONI'), adesso).db; db = L.importaPagamenti(db, get('PAGAMENTI'), adesso).db;
  fs.mkdirSync(DATI, { recursive: true });
  fs.writeFileSync(path.join(DATI, 'archivio.json'), JSON.stringify({ rev: 1, salvato: adesso + 'Z', db }, null, 1));
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI]);
  proc.stderr.on('data', () => {});
  const apri = await new Promise((res, rej) => { let b = ''; proc.stdout.on('data', (d) => { b += d; const a = /Apri: (\S+)/.exec(b); if (a) res(a[1]); }); setTimeout(() => rej(new Error('no start')), 10000); });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', acceptDownloads: true, reducedMotion: 'no-preference' }); // the movement is on, like for most people: the robot chooses it too
  await ctx.addInitScript(() => { try { localStorage.setItem('gymart-aperto', '1'); } catch (e) {} }); // optional fields open: the robot types in every field
  const pg = await ctx.newPage();
  const problemi = [];
  pg.on('pageerror', (e) => problemi.push('errore nella pagina: ' + e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/\b(40[0-9]|50[0-9]) \(|Content Security Policy|Failed to load resource/.test(m.text())) problemi.push('console: ' + m.text()); });
  pg.on('dialog', (d) => d.accept(d.type() === 'prompt' ? pick(STRANI).slice(0, 40) : undefined).catch(() => {}));
  ctx.on('page', (p) => { if (p !== pg) p.close().catch(() => {}); }); // a WhatsApp tab or similar
  await pg.goto(apri); await pg.waitForSelector('.tile');
  await pg.evaluate(() => { window.__xss = 0; });

  const ids = { allieve: db.allieve.map((a) => a.id), isc: db.iscrizioni.map((e) => e.id) };
  const PAGINE = ['inizio', 'allieve', 'iscrizioni', 'corsi', 'pagamenti', 'analisi', 'scadenze', 'promemoria', 'stagione', 'registro', 'impostazioni', 'guida', 'allieva/nuova', 'iscrizione/nuova'];
  const LARGHEZZE = [390, 430, 768, 1024, 1280, 1440];
  const azioni = {};
  let dettaglio = '';
  const conta = (k) => { azioni[k] = (azioni[k] || 0) + 1; };

  async function vai() { const h = r() < 0.3 ? pick(['allieva/', 'iscrizione/']) + pick(r() < 0.5 ? ids.allieve : ids.isc) : pick(PAGINE); conta('pagina'); await pg.evaluate((x) => { location.hash = x; }, h.startsWith('allieva/') && !/\/\d/.test(h) ? h : h.replace(/^iscrizione\/(\d+)$/, 'iscrizione/$1')); }
  async function scrivi() {
    const campi = await pg.$$('#view input:not([type=checkbox]):not([type=file]):not([type=hidden]):not([disabled]), #view textarea, #view select');
    if (!campi.length) return conta('nessun campo');
    const c = pick(campi), tag = await c.evaluate((e) => e.tagName), tipo = await c.evaluate((e) => e.type);
    conta('scrive');
    if (tag === 'SELECT') { const o = await c.$$eval('option', (os) => os.map((x) => x.value)); await c.selectOption(pick(o), { timeout: 800 }); return; }
    if (tipo === 'date') { await c.fill(pick(['2026-05-04', '1999-12-31', '2030-01-01', '', '2024-02-29']), { timeout: 800 }); return; }
    if (tipo === 'search') conta('cerca');
    await c.fill(pick(STRANI), { timeout: 800 });
  }
  async function clicca() {
    const els = await pg.$$('#view button:not([disabled]), #view a[href^="#"], #view .btn, #view tr.link, #view summary, #view input[type=checkbox], .side a, .bottom a, .bottom button, .top button');
    if (!els.length) return conta('nessun elemento');
    const e = pick(els), testo = ((await e.textContent()) || '').trim();
    if (/Esci|Attiva l'accesso|Togli la protezione|Scegli…|Ripristina|Avvia la procedura|Conferma la nuova stagione/.test(testo) && r() < 0.8) return conta('evitato'); // avoided most of the time: they leave the page or rewrite everything
    conta('clic'); dettaglio = testo.slice(0, 40) + ' <' + (await e.evaluate((n) => n.tagName + (n.id ? '#' + n.id : '') + '.' + n.className)) + '>'; await e.click({ timeout: 800, noWaitAfter: true });
  }
  async function tasto() { conta('tasto'); await pg.keyboard.press(pick(['Tab', 'Tab', 'Shift+Tab', 'Enter', 'Escape', 'ArrowDown', 'Space', 'PageDown'])); }
  async function larghezza() { conta('larghezza'); await pg.setViewportSize({ width: pick(LARGHEZZE), height: pick([700, 844, 900]) }); }
  async function aspetto() { conta('aspetto'); await pg.evaluate(([s, t, d, m]) => { Aspetto.imposta({ stile: s, tema: t, movimento: m }); if (d && document.getElementById('det').getAttribute('aria-checked') !== 'true') document.getElementById('det').click(); }, [pick(['vetro', 'vetro', 'club', 'morbido', 'sobrio']), pick(['auto', 'chiaro', 'scuro']), r() < 0.3, pick(['auto', 'pieno', 'pieno', 'ridotto', 'spento'])]); }
  // the search box of the menu, the button that narrows it, the shortcut: the robot types strange things and presses keys
  async function cercaRapida() {
    conta('ricerca veloce');
    const box = pg.locator('#cerca');
    if (!(await box.isVisible())) return;
    await box.click({ timeout: 800 }); await box.fill(pick(STRANI.slice(0, 12)), { timeout: 800 });
    await pg.waitForTimeout(int(0, 140));
    await pg.keyboard.press(pick(['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab']));
  }
  async function menuStretto() { conta('menu stretto'); const b = pg.locator('#side-toggle'); if (await b.isVisible()) await b.click({ timeout: 800, noWaitAfter: true }); }
  async function scorciatoia() { conta('Ctrl K'); await pg.keyboard.press(pick(['Control+k', 'Control+K', 'Meta+k'])); }
  async function salva() { const b = await pg.$$('#view button.btn-primary:not([disabled])'); if (b.length) { conta('salva'); await pick(b).click({ timeout: 800, noWaitAfter: true }); } }
  // actions that fill a form properly and save it: without them a robot almost never gets a student or a payment through
  const lab = (t) => pg.getByLabel(t, { exact: true }).first();
  async function andare(h) { await pg.evaluate((x) => { S.dirty = false; location.hash = x; }, h); await pg.waitForTimeout(60); }
  async function nuovaAllieva() {
    conta('allieva valida'); await andare('allieva/nuova');
    await lab('Cognome e Nome').fill(pick(['Rossi', 'Bianchi', 'Verdi', "D'Angelo", 'Ñandú']) + ' ' + pick(['Giulia', 'Sofia', 'Aurora', 'Maria Luisa']), { timeout: 800 });
    await lab('Data di nascita').fill(pick(['2012-03-04', '2016-11-30', '2009-07-15', '2019-01-01']), { timeout: 800 });
    await lab('Telefono').fill('333' + int(1000000, 9999999), { timeout: 800 });
    await pg.getByRole('button', { name: 'Salva la nuova allieva' }).click({ timeout: 800 });
  }
  async function nuovaIscrizione() {
    conta('iscrizione valida'); await andare('iscrizione/nuova');
    const sel = lab('Allieva'); const o = await sel.evaluate((e) => [...e.options].map((x) => x.value).filter(Boolean));
    await sel.selectOption(pick(o), { timeout: 800 });
    const c = await lab('Corso').evaluate((e) => [...e.options].map((x) => x.value).filter(Boolean)); await lab('Corso').selectOption(pick(c), { timeout: 800 });
    await lab('Tipo abbonamento').selectOption(pick(['Mensile', 'Trimestrale', 'Annuale']), { timeout: 800 });
    await lab('Data inizio').fill(pick(['2026-09-15', '2026-11-02', '2026-12-01']), { timeout: 800 });
    await pg.getByRole('button', { name: /^Salva/ }).first().click({ timeout: 800 });
  }
  async function pagamento() {
    conta('pagamento valido'); await andare('iscrizione/' + pick(ids.isc));
    await lab('Data del pagamento').fill(C.todayIso(), { timeout: 800 }); await lab('Importo').fill(pick(['10', '35,50', '70', '12.25', '150']), { timeout: 800 });
    await lab('Metodo').selectOption(pick(['Contanti', 'Bonifico', 'POS']), { timeout: 800 });
    await pg.getByRole('button', { name: 'Registra il pagamento' }).click({ timeout: 800 });
  }
  async function rinnovo() { conta('rinnovo'); await andare('scadenze'); const b = await pg.$$('#view button:has-text("Rinnova")'); if (b.length) await pick(b).click({ timeout: 800 }); }
  async function nuovaStagione() { if (r() > 0.04) return conta('stagione saltata'); conta('nuova stagione'); await andare('stagione'); await pg.getByRole('button', { name: 'Conferma la nuova stagione' }).click({ timeout: 800 }); }
  async function copie() { conta('copie'); await andare('impostazioni'); await pg.getByRole('button', { name: pick(['Fai una copia ora', 'Controlla tutte le copie']) }).click({ timeout: 800 }); }
  const mosse = [[vai, 14], [scrivi, 30], [clicca, 26], [tasto, 6], [larghezza, 4], [aspetto, 3], [cercaRapida, 3], [menuStretto, 1], [scorciatoia, 1], [salva, 18], [nuovaAllieva, 5], [nuovaIscrizione, 5], [pagamento, 8], [rinnovo, 3], [nuovaStagione, 2], [copie, 2]];
  const borsa = mosse.flatMap(([f, p]) => Array(p).fill(f));

  async function controllaPagina(passo, ultima) {
    if (!(await pg.evaluate(() => !!document.getElementById('view')))) { problemi.push(`passo ${passo}: la pagina non ha più il programma dentro: ${pg.url()} dopo ${ultima} (${dettaglio})`); return; }
    const m = await pg.evaluate(() => ({ xss: window.__xss, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, vw: innerWidth, h: location.hash, vuota: !document.getElementById('view').children.length, rotto: (() => { const t = document.getElementById('view').innerText, m = /[\s\S]{0,30}(undefined|\bNaN\b|\[object|\bnull\b)[\s\S]{0,30}/.exec(t); return m ? m[0].replace(/\s+/g, ' ') : ''; })() }));
    if (m.xss) problemi.push(`passo ${passo}: CODICE INIETTATO ESEGUITO (${ultima})`);
    if (m.over > 1 && m.vw < 1000) problemi.push(`passo ${passo}: scroll orizzontale ${m.over}px a ${m.vw}px su ${m.h} dopo ${ultima}`);
    if (m.vuota) problemi.push(`passo ${passo}: pagina vuota su ${m.h} dopo ${ultima}`);
    if (m.rotto) problemi.push(`passo ${passo}: testo rotto "${m.rotto}" su ${m.h} dopo ${ultima}`);
  }
  async function aggiornaIds() { const x = await pg.evaluate(() => (typeof S !== 'undefined' && S.db) ? { a: S.db.allieve.map((v) => v.id), i: S.db.iscrizioni.map((v) => v.id) } : null); if (x && x.a.length && x.i.length) { ids.allieve = x.a; ids.isc = x.i; } }
  async function controllaDisco(passo) {
    await pg.waitForTimeout(250);
    const raw = JSON.parse(fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8'));
    try { controlla(raw.db, C.todayIso(), 'passo ' + passo); } catch (e) { problemi.push(`passo ${passo}: l'archivio sul disco non è coerente: ${e.message.split('\n')[0]}`); }
    const reg = fs.existsSync(path.join(DATI, 'registro.jsonl')) ? fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').split('\n').filter(Boolean) : [];
    for (const l of reg) { try { JSON.parse(l); } catch (e) { problemi.push(`passo ${passo}: riga del registro illeggibile`); break; } }
    return raw;
  }

  let ultima = '', revPrima = 1;
  for (let passo = 1; passo <= PASSI; passo++) {
    const f = pick(borsa); ultima = f.name;
    try { await f(); await pg.waitForTimeout(int(0, 30)); } catch (e) { if (!/Timeout|detached|not attached|not visible|intercept|Target|Execution context|navigat/i.test(e.message)) problemi.push(`passo ${passo}: ${f.name} ha fatto fallire il robot: ${e.message.split('\n')[0]}`); }
    await controllaPagina(passo, ultima);
    if (passo % 40 === 0) {
      await aggiornaIds();
      const raw = await controllaDisco(passo);
      if (raw.rev < revPrima) problemi.push(`passo ${passo}: la revisione è tornata indietro`);
      revPrima = raw.rev;
      const stato = await pg.evaluate(() => (typeof S !== 'undefined' && S.db) ? { a: S.db.allieve.length, i: S.db.iscrizioni.length, p: S.db.pagamenti.length, dirty: S.dirty, busy: S.busy } : null);
      if (stato && !stato.dirty && !stato.busy && (stato.a !== raw.db.allieve.length || stato.i !== raw.db.iscrizioni.length || stato.p !== raw.db.pagamenti.length)) problemi.push(`passo ${passo}: la pagina e il disco non coincidono (${JSON.stringify(stato)} contro ${raw.db.allieve.length}/${raw.db.iscrizioni.length}/${raw.db.pagamenti.length})`);
      if (problemi.length) { await pg.screenshot({ path: path.join(OUT, 'win-scimmia-problema.png'), fullPage: true }).catch(() => {}); break; }
    }
    if (problemi.length) { await pg.screenshot({ path: path.join(OUT, 'win-scimmia-problema.png'), fullPage: true }).catch(() => {}); break; }
  }
  await pg.setViewportSize({ width: 1280, height: 860 });
  await pg.waitForTimeout(600);
  const finale = problemi.length ? null : await controllaDisco('finale');
  // after the safety time of the entrance (7 s) nothing may stay hidden, dimmed or blurred by an animation that did not end
  await pg.evaluate(() => { Aspetto.imposta({ movimento: 'pieno' }); location.hash = 'inizio'; }).catch(() => {});
  await pg.waitForTimeout(9500);
  const nascosti = await pg.evaluate(() => [].filter.call(document.querySelectorAll('#view *'), (e) => e.style && (e.style.opacity === '0' || /blur/.test(e.style.filter || ''))).map((e) => e.tagName + '.' + e.className).slice(0, 5)).catch(() => []);
  if (nascosti.length) problemi.push('dopo 9 secondi restano elementi nascosti o sfocati da un\'animazione: ' + nascosti.join(', '));
  // the copies still check, here and in the daily folder, after all this
  if (!(await pg.evaluate(() => typeof TOKEN !== 'undefined').catch(() => false))) { problemi.push('alla fine la pagina non è più il programma: ' + pg.url() + ' (ultima azione: ' + ultima + ')'); }
  const chk = problemi.length ? { locali: { errori: [] } } : await pg.evaluate(() => fetch('/api/sicurezza/controlla', { method: 'POST', headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()));
  if (chk.locali.errori.length) problemi.push('copie non integre: ' + chk.locali.errori.join('; '));
  await browser.close(); proc.kill();
  console.log(`seme ${SEME}: ${PASSI} passi, azioni ${JSON.stringify(azioni)}${finale ? `, archivio finale ${finale.db.allieve.length} allieve / ${finale.db.iscrizioni.length} iscrizioni / ${finale.db.pagamenti.length} pagamenti, revisione ${finale.rev}` : ''}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  if (problemi.length) { console.error('PROBLEMI:\n - ' + [...new Set(problemi)].slice(0, 15).join('\n - ')); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error('FALLITA:', e.message); process.exit(1); });
