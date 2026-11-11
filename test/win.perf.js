'use strict';
// How the Windows program behaves with a large archive: node test/win.perf.js [students]
// Builds an archive of invented people, starts the program on it and times the page with Playwright.
// Fails only on generous limits: it is a guard against something becoming really slow, not a benchmark.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const L = require('../win/web/logic.js'), C = require('../win/web/core.js');

const ROOT = path.join(__dirname, '..');
const N = parseInt(process.argv[2], 10) || 1500;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-perf-'));
const DATI = path.join(TMP, 'dati'), BIN = path.join(TMP, process.platform === 'win32' ? 'gymart.exe' : 'gymart');
const LIMITS = { apertura: 2500, default: 1500 };

const COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo',
  'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Martinelli', 'Vitale', 'Lombardo', 'Serra', 'Coppola', 'Del Bosco'];
const NOMI = ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma', 'Giorgia', 'Greta', 'Beatrice', 'Anna', 'Vittoria', 'Matilde', 'Noemi', 'Francesca', 'Sara', 'Chiara', 'Martina', 'Nicole', 'Bianca', 'Gaia',
  'Arianna', 'Rebecca', 'Elena', 'Camilla', 'Ludovica', 'Viola', 'Marta', 'Elisa', 'Adele', 'Irene', 'Maria', 'Azzurra', 'Asia', 'Mia', 'Cecilia', 'Diana', 'Carlotta', 'Isabel', 'Emily', 'Margherita'];

function build() {
  const today = C.todayIso(), now = today + 'T09:00:00', db = L.nuovoArchivio(today);
  const tipi = ['Mensile', 'Trimestrale', 'Trimestrale', 'Annuale'], corsi = [['Propedeutico', 'Corso Propedeutico · 1 giorno/settimana', ['Sab']], ['Base', 'Corso Base e Avanzato · 2 giorni/settimana', ['Lun', 'Mer']],
    ['Avanzato', 'Corso Base e Avanzato · 3 giorni/settimana', ['Lun', 'Mer', 'Ven']], ['Agonismo', 'Corso Agonistico · 3 giorni/settimana', ['Mar', 'Gio', 'Sab']]];
  let e = 0;
  for (let i = 0; i < N; i++) {
    const id = String(i + 1).padStart(4, '0'), cognome = COGNOMI[i % COGNOMI.length], nome = NOMI[Math.floor(i / COGNOMI.length) % NOMI.length] + (i >= 1600 ? ' ' + NOMI[(i * 7) % NOMI.length] : '');
    db.allieve.push({ id, name: cognome + ' ' + nome, nascita: (2008 + (i % 14)) + '-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), luogo: 'Avezzano', cf: '', indirizzo: 'Via dei Mille ' + (1 + i % 90), citta: 'Avezzano', cap: '67051',
      genitore: cognome + ' ' + ['Paolo', 'Luca', 'Marco', 'Anna', 'Laura'][i % 5], cfGenitore: '', tel: '333' + String(1000000 + i * 37).slice(0, 7), tel2: '', email: 'famiglia' + i + '@example.com', privacy: 'Sì', liberatoria: 'Sì', dataModulo: '', tessera: '', note: '', archiviata: i % 40 === 39, creata: now, modificata: now });
    // a closed period for most, an open one for nearly all
    const c = corsi[i % corsi.length], inizio = C.addMonths(today, -(i % 5)).slice(0, 8) + String(1 + (i % 27)).padStart(2, '0');
    const base = { allievaId: id, corso: c[0], giorni: c[2], fascia: i % 2 ? '17:00-18:30' : '16:00-17:00', pacchetto: c[1], quota: i % 9 === 0 ? 150 : null, annullata: false, note: '', creata: now, modificata: now };
    if (i % 3) db.iscrizioni.push(Object.assign({ id: String(++e).padStart(4, '0'), tipo: 'Trimestrale', inizio: C.addMonths(inizio, -3), storica: true }, base));
    if (i % 10) db.iscrizioni.push(Object.assign({ id: String(++e).padStart(4, '0'), tipo: tipi[i % tipi.length], inizio, storica: false }, base));
  }
  db.prossimi = { allieva: N + 1, iscrizione: e + 1 };
  if (L.validaArchivio(db)) throw new Error(L.validaArchivio(db));
  fs.mkdirSync(DATI, { recursive: true });
  const raw = JSON.stringify({ rev: 1, salvato: now + '+01:00', db });
  fs.writeFileSync(path.join(DATI, 'archivio.json'), raw);
  return { allieve: db.allieve.length, iscrizioni: db.iscrizioni.length, kb: Math.round(raw.length / 1024) };
}

(async () => {
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  const size = build();
  console.log('archive: ' + size.allieve + ' students, ' + size.iscrizioni + ' enrollments, ' + size.kb + ' KB');
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI]);
  const url = await new Promise((res, rej) => { let b = ''; proc.stdout.on('data', (d) => { b += d; const m = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(b); if (m) res(m[1]); }); setTimeout(() => rej(new Error('the program did not start')), 10000); });
  const browser = await chromium.launch();
  const pg = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; pg.on('pageerror', (e) => errors.push(e.message));
  const times = {};
  // time until the page has drawn after an action done inside it
  const drawn = (action, arg) => pg.evaluate(async ([src, a]) => {
    const t = performance.now();
    await (new Function('a', 'return (' + src + ')(a)'))(a);
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    return Math.round(performance.now() - t);
  }, [action.toString(), arg]);
  const toHash = (h) => new Promise((r) => { window.addEventListener('hashchange', () => setTimeout(r, 0), { once: true }); location.hash = h; });
  const typeIn = ([sel, text, wait]) => new Promise((r) => { const i = document.querySelector(sel); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(r, wait); });

  let t = Date.now();
  await pg.goto(url); await pg.waitForSelector('.tile');
  times.apertura = Date.now() - t;
  times['elenco allieve'] = await drawn(toHash, 'allieve');
  times['ricerca (dopo la pausa di 120 ms)'] = await drawn(typeIn, ['input[type=search]', 'ros gi', 130]) - 130;
  times['elenco iscrizioni'] = await drawn(toHash, 'iscrizioni');
  times['corsi'] = await drawn(toHash, 'corsi');
  times['scadenze'] = await drawn(toHash, 'scadenze');
  times['scheda allieva'] = await drawn(toHash, 'allieva/0001');
  times['un tasto nella scheda'] = await drawn(typeIn, ['.fields input', 'Rossi Giulia Maria', 0]);
  times['nuova allieva: un tasto'] = await (async () => { await drawn(toHash, 'allieva/nuova'); return drawn(typeIn, ['.fields input', 'Rossi Giuli', 0]); })();
  await pg.evaluate(() => { S.dirty = false; });
  await drawn(toHash, 'allieva/0002');
  await pg.getByLabel('CAP', { exact: true }).fill('67100');
  t = Date.now();
  await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
  await pg.waitForFunction(() => document.getElementById('toast').textContent.includes('Modifiche salvate.'));
  times.salvataggio = Date.now() - t;
  await pg.evaluate(() => { S.fa.q = ''; }); // the search above would hide most rows
  await drawn(toHash, 'allieve');
  times['elenco allieve, tutte le righe'] = await drawn(() => new Promise((r) => { [].find.call(document.querySelectorAll('button'), (b) => b.textContent === 'mostra tutte').click(); setTimeout(r, 0); }));
  const shown = await pg.$$eval('tbody tr', (rs) => rs.length);
  if (shown < N * 0.9) throw new Error('"mostra tutte" showed only ' + shown + ' rows');
  // timings of the pure logic, without the page
  Object.assign(times, await pg.evaluate(() => {
    const out = {}, time = (k, f) => { const t = performance.now(); f(); out[k] = Math.round(performance.now() - t); };
    time('logica: riepilogo + scadenze', () => { L.riepilogo(S.db, C.todayIso()); L.scadenze(S.db, C.todayIso()); });
    time('logica: controllo di una nuova allieva', () => L.controllaAllieva(S.db, { name: 'Rossi Giulia', tel: '3331234567' }, null, C.todayIso()));
    time('logica: copia dell\'archivio per una modifica', () => L.salvaAllieva(S.db, '0003', Object.assign({}, L.byId(S.db.allieve, '0003'), { cap: '67100' }), 'x'));
    return out;
  }));

  await browser.close(); proc.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  let slow = 0;
  for (const [k, ms] of Object.entries(times)) { const lim = LIMITS[k] || LIMITS.default; if (ms > lim) slow++; console.log(String(ms).padStart(6) + ' ms  ' + k + (ms > lim ? '   <-- over ' + lim + ' ms' : '')); }
  if (errors.length) { console.error('page errors:', errors); process.exit(1); }
  if (slow) { console.error(slow + ' step(s) over the limit'); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
