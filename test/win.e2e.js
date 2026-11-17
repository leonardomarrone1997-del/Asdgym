'use strict';
// End-to-end check of the Windows program: node test/win.e2e.js
// Builds the program for this machine, starts it on a temporary folder and drives its page with Playwright.
// Every person is invented. Screenshots go to out/ (ignored by git).
const { execFileSync, spawn } = require('child_process');
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium, devices } = require('playwright');
const C = require('../win/web/core.js');
const L = require('../win/web/logic.js');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-e2e-'));
const DATI = path.join(TMP, 'dati'), OUT = path.join(ROOT, 'out');
const BIN = path.join(TMP, process.platform === 'win32' ? 'gymart.exe' : 'gymart');
const PAC2 = 'Corso Base e Avanzato · 2 giorni/settimana';
const IMPORTA = '.card:has(input[type=file][multiple])'; // the import card: other cards have notes of their own
const TODAY = C.todayIso();
// a quarterly subscription that ends in 10 days
const INIZIO = C.addMonths(isoPlus(TODAY, 10), -3);

function isoPlus(iso, days) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + days)); return d.toISOString().slice(0, 10); }
function readArchive() { return JSON.parse(fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8')); }
function copies() { return fs.readdirSync(path.join(DATI, 'copie')).length; }
const CHIAVETTA = path.join(TMP, 'chiavetta', 'Copie Gym Art'); // the second folder
const PW1 = 'segreta-2026', PW2 = 'ancora-piu-segreta', PHONEPW = 'palestra-telefono-26';
// every file under a folder, joined: what someone who opens the files would read
function sulDisco(dir) {
  let all = '';
  for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, it.name);
    all += it.isDirectory() ? sulDisco(p) : fs.readFileSync(p, 'latin1');
  }
  return all;
}
function pdfText(file) { return execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { encoding: 'utf8' }).replace(/\s+/g, ' '); }
function csvLine(cells) { return cells.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(','); }

function start() {
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI]);
  const exited = new Promise((res) => proc.on('exit', (code) => res(code)));
  const url = new Promise((res, rej) => {
    let buf = '';
    // the program prints the address of the page and the one-use address its own window opens
    proc.stdout.on('data', (d) => { buf += d; const m = /Gym Art Segreteria: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(buf), a = /Apri: (\S+)/.exec(buf); if (m && a) res({ url: m[1], apri: a[1] }); });
    exited.then((c) => rej(new Error('the program stopped at start, code ' + c)));
    setTimeout(() => rej(new Error('the program did not start')), 10000);
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  return url.then((u) => ({ proc, url: u.url, apri: u.apri, exited }));
}
function within(promise, ms) { return Promise.race([promise, new Promise((res) => setTimeout(() => res('timeout'), ms))]); }

(async () => {
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  fs.mkdirSync(OUT, { recursive: true });

  let app = await start();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', acceptDownloads: true, reducedMotion: 'reduce' });
  const problems = [];
  const expected = [[409, '/api/salva'], [400, '/api/decifra'], [401, '/api/decifra'], [401, '/api/sblocca'], [401, '/api/password'], [400, '/api/copie2'], [500, '/api/copie2/adesso']]; // refusals the steps ask for
  let dialogs = [], answer = true;
  function watch(pg) {
    // some steps provoke a refusal on purpose (a stale window: 409, a file that is not a copy: 400, a wrong password: 401); the browser reports them on its console
    pg.on('console', (m) => { if (m.type() === 'error' && !/(40[019]|500) \(/.test(m.text())) problems.push('console: ' + m.text()); });
    pg.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    pg.on('response', (r) => { if (r.status() >= 400 && !expected.some((e) => r.status() === e[0] && r.url().endsWith(e[1]))) problems.push(r.status() + ' ' + r.url()); });
    pg.on('dialog', (d) => { dialogs.push(d.message()); if (answer) d.accept(); else d.dismiss(); });
  }
  let pg = await ctx.newPage(); watch(pg);
  const shot = (name, full) => pg.screenshot({ path: path.join(OUT, 'win-' + name + '.png'), fullPage: !!full });
  const go = async (hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForFunction((h) => location.hash === '#' + h, hash); await pg.waitForTimeout(80); };
  const lab = (text) => pg.getByLabel(text, { exact: true });
  // numbers as numbers, amounts ("170,00 €") as euros
  const tiles = () => pg.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('span').textContent, parseFloat(t.querySelector('b').textContent.replace(/\./g, '').replace(',', '.'))])));
  const toast = async (text) => { await pg.waitForFunction((t) => { const e = document.getElementById('toast'); return e.className.includes('on') && e.textContent.includes(t); }, text); };
  // clicks something that makes the page hand out a file; returns { name, file }
  const scarica = async (click) => {
    const [dl] = await Promise.all([pg.waitForEvent('download'), click()]);
    const file = path.join(TMP, 'scaricato-' + dl.suggestedFilename());
    await dl.saveAs(file);
    return { name: dl.suggestedFilename(), file };
  };
  let n = 0;
  const step = async (name, fn) => {
    try { await fn(); } catch (e) {
      console.error('FAILED - ' + name + ' at ' + (await pg.evaluate(() => location.hash).catch(() => '?')));
      await shot('errore', true).catch(() => {});
      app.proc.kill();
      throw e;
    }
    n++; console.log('ok ' + n + ' - ' + name);
  };

  await step('empty archive', async () => {
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    assert.ok((await pg.textContent('#view')).includes('L\'archivio è vuoto.'));
    assert.deepEqual(await tiles(), { 'Allieve': 0, 'Iscrizioni aperte': 0, 'In scadenza': 0, 'Scadute': 0, 'Da completare': 0, 'Senza iscrizione': 0, 'Certificati da rinnovare': 0, 'Certificati mancanti': 0, 'Da incassare (0 iscrizioni)': 0 });
    assert.equal(fs.existsSync(path.join(DATI, 'archivio.json')), false, 'nothing is written before the first save');
    assert.ok((await pg.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Segoe UI'), 'the system font stack is in use');
    assert.equal(await pg.locator('#protezione').count(), 0, 'no password card: protection cannot be switched on from the page');
    assert.equal(await pg.getByRole('button', { name: /Attiva la protezione/ }).count(), 0);
  });

  await step('new student: checks, save, file on disk', async () => {
    await pg.getByRole('link', { name: 'Nuova allieva' }).last().click();
    await pg.waitForSelector('h1:has-text("Nuova allieva")');
    assert.equal(await pg.locator('.note').count(), 0, 'no reproach before typing');
    await lab('Cognome e Nome').fill('del bosco giulia');
    await lab('Data di nascita').fill('2013-10-12');
    await lab('Codice fiscale').fill('DLBGLI13R52A345X');
    assert.ok((await pg.textContent('.note-bad')).includes('Carattere di controllo errato'));
    assert.equal(await pg.getByRole('button', { name: 'Salva la nuova allieva' }).isDisabled(), true);
    await lab('Codice fiscale').fill('dlb gli13r52 a345d');
    assert.equal(await pg.textContent('.hint.h-ok'), 'Codice fiscale valido.');
    await lab('Telefono').fill('+39 347 000 1122');
    await lab('Genitore / Referente').fill('de luca antonella');
    await shot('scheda-nuova', true);
    await pg.getByRole('button', { name: 'Salva la nuova allieva' }).click();
    await pg.waitForFunction(() => location.hash === '#allieva/0001');
    assert.equal(await pg.textContent('h1'), 'Del Bosco Giulia');
    const file = readArchive(), a = file.db.allieve[0];
    assert.equal(file.rev, 1);
    assert.deepEqual([a.id, a.name, a.nascita, a.cf, a.tel, a.genitore, a.privacy], ['0001', 'Del Bosco Giulia', '2013-10-12', 'DLBGLI13R52A345D', '3470001122', 'De Luca Antonella', 'Sì']);
    const reg = fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(reg[0].operazione, 'Nuova allieva');
    assert.ok(reg.every((r) => /^\d{4}-\d{2}-\d{2}T/.test(r.quando)));
  });

  await step('unsaved changes are protected', async () => {
    await lab('Telefono').fill('3331234567');
    answer = false; dialogs = [];
    await pg.getByRole('link', { name: 'Iscrizioni', exact: true }).click();
    await pg.waitForTimeout(200);
    assert.equal(dialogs.length, 1);
    assert.ok(dialogs[0].includes('modifiche non salvate'));
    assert.equal(await pg.evaluate(() => location.hash), '#allieva/0001');
    assert.equal(await lab('Telefono').inputValue(), '3331234567', 'what was typed is still there');
    answer = true;
    await pg.getByRole('button', { name: 'Annulla' }).click();
    await pg.waitForTimeout(100);
    assert.equal(await lab('Telefono').inputValue(), '3470001122');
    assert.equal(readArchive().rev, 1);
  });

  await step('new enrollment: suggested fee, computed expiry', async () => {
    await pg.getByRole('link', { name: 'Nuova iscrizione' }).click();
    await pg.waitForSelector('h1:has-text("Nuova iscrizione")');
    await lab('Corso').selectOption('Base');
    await pg.getByLabel('Lun').check(); await pg.getByLabel('Mer').check();
    assert.equal(await lab('Tariffa / Pacchetto').inputValue(), PAC2);
    await lab('Tipo abbonamento').selectOption('Trimestrale');
    await lab('Data inizio').fill(INIZIO);
    await lab('Fascia oraria').fill('17:00-18:30');
    const info = await pg.textContent('.info-line');
    assert.ok(info.includes('Scadenza: ' + C.isoToIt(isoPlus(TODAY, 10))), info);
    assert.ok(info.includes('Quota da tariffario: 170,00 €'), info);
    await shot('iscrizione-nuova', true);
    await pg.getByRole('button', { name: 'Salva l\'iscrizione' }).click();
    await pg.waitForFunction(() => location.hash === '#allieva/0001');
    const item = await pg.textContent('.list-item');
    assert.ok(item.includes('Base') && item.includes('IN SCADENZA') && item.includes('170,00 €'), item);
    const e = readArchive().db.iscrizioni[0];
    assert.deepEqual([e.id, e.allievaId, e.corso, e.giorni, e.fascia, e.pacchetto, e.tipo, e.inizio, e.quota], ['0001', '0001', 'Base', ['Lun', 'Mer'], '17:00-18:30', PAC2, 'Trimestrale', INIZIO, null]);
    await shot('scheda', true);
    await go('inizio');
    assert.deepEqual(await tiles(), { 'Allieve': 1, 'Iscrizioni aperte': 1, 'In scadenza': 1, 'Scadute': 0, 'Da completare': 0, 'Senza iscrizione': 0, 'Certificati da rinnovare': 0, 'Certificati mancanti': 1, 'Da incassare (1 iscrizione)': 170 });
    assert.ok((await pg.textContent('.note-warn')).includes('Non hai ancora scaricato una copia di sicurezza.'));
    assert.ok((await pg.textContent('#view')).includes('Base · 1'), 'students per course on the first page');
  });

  await step('renewal from the deadlines page', async () => {
    await go('scadenze');
    assert.ok((await pg.textContent('#view')).includes('Del Bosco Giulia'));
    const wa = pg.getByRole('link', { name: 'WhatsApp' }).first(); // the reminder of the subscription; further down there is the one for the certificate
    const testo = 'Buongiorno, vi ricordiamo che l\'abbonamento di Del Bosco Giulia al corso Base ha scadenza il ' + C.isoToIt(isoPlus(TODAY, 10)) + '. Grazie, A.S.D. Gym Art Avezzano';
    assert.equal(await wa.getAttribute('href'), 'https://wa.me/393470001122?text=' + encodeURIComponent(testo));
    assert.equal(await wa.getAttribute('target'), '_blank');
    dialogs = [];
    await pg.getByRole('button', { name: 'Rinnova' }).click();
    await toast('Abbonamento rinnovato.');
    assert.ok(dialogs[0].includes('Il nuovo periodo parte dal ' + C.isoToIt(isoPlus(TODAY, 10))));
    const isc = readArchive().db.iscrizioni;
    assert.deepEqual(isc.map((e) => [e.id, e.storica, e.inizio]), [['0001', true, INIZIO], ['0002', false, isoPlus(TODAY, 10)]]);
    assert.ok((await pg.textContent('#view')).includes('Nessun abbonamento scaduto.') && (await pg.textContent('#view')).includes('Nessun abbonamento in scadenza.'), 'no subscription left to follow');
  });

  await step('import from the Google sheet (CSV)', async () => {
    const ana = [['ANAGRAFICA'], ['ID', 'Cognome e Nome', 'Telefono', 'Genitore / Referente', 'Email', 'Data di nascita', 'Luogo di nascita', 'Codice fiscale', 'Città', 'CAP', 'Note'],
      ['0034', 'DEL BOSCO GIULIA', '333 9998877', '', 'm@example.com', '12/10/2013', "L'AQUILA", '', 'Magliano dei Marsi', '67062', 'nota, con virgola'],
      ['0035', 'Cappelletti Elia', '3337654321', 'Cappelletti Mario', '', '02/07/2019', 'Avezzano', '', 'Avezzano', '67051', ''],
      ['0036', 'Rossi Maria', '3331234567', '', '', '05/04/2015', '', '', '', '', ''],
      ['0037', '', '', '', '', '', '', '', '', '', '']];
    const isc = [['ID', 'Allieva', 'Corso', 'Fascia oraria', 'Giorni', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Scadenza', 'Stato abbonamento', 'Quota concordata (sostituisce il tariffario)', 'Annullata?', 'Note'],
      ['0012', 'Cappelletti Elia', 'Propedeutico', '16:00', 'Sab', 'Corso Propedeutico · 1 giorno/settimana', 'Annuale', '15/09/2026', '15/09/2027', 'ATTIVO', '280,00 €', '', ''],
      ['0013', 'Greco Fabiola', 'Base', '', '', '', 'Mensile', '01/11/2026', '', 'ATTIVO', '', '', '']];
    const f1 = path.join(TMP, 'Gestionale - ANAGRAFICA.csv'), f2 = path.join(TMP, 'Gestionale - ISCRIZIONI.csv');
    fs.writeFileSync(f1, ana.map(csvLine).join('\r\n')); fs.writeFileSync(f2, isc.map(csvLine).join('\r\n'));
    await go('impostazioni');
    await pg.setInputFiles('input[type=file][multiple]', [f2, f1]);
    await pg.waitForSelector(IMPORTA + ' .note-warn');
    // the summary is left there, the archive is changed elsewhere, then the user comes back
    await go('allieva/0001');
    await lab('Secondo telefono').fill('333 111 2233');
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await toast('Modifiche salvate.');
    await go('impostazioni');
    assert.equal(await pg.getByRole('button', { name: 'Importa nell\'archivio' }).count(), 0, 'a summary prepared on the old archive is dropped');
    await pg.setInputFiles('input[type=file][multiple]', [f2, f1]);
    await pg.waitForSelector(IMPORTA + ' .note-warn');
    const sum = await pg.$$eval(IMPORTA + ' .note', (ns) => ns.map((x) => x.textContent));
    assert.ok(sum[0].includes('ANAGRAFICA') && sum[0].includes('2 allieve nuove.') && sum[0].includes('1 allieva già presente completata') && sum[0].includes('Telefono'), sum[0]);
    assert.ok(sum[1].includes('ISCRIZIONI') && sum[1].includes('1 iscrizione nuova.') && sum[1].includes('"Greco Fabiola" non è nell\'archivio'), sum[1]);
    assert.equal(readArchive().db.allieve.length, 1, 'nothing is written before the confirmation');
    await shot('importazione', true);
    const before = copies();
    await pg.getByRole('button', { name: 'Importa nell\'archivio' }).click();
    await toast('Importazione completata.');
    assert.equal(copies(), before + 1, 'an import always keeps a copy of the archive as it was');
    const db = readArchive().db;
    assert.equal(db.allieve[0].tel2, '3331112233', 'the change made in between is still there');
    assert.deepEqual(db.allieve.map((a) => [a.id, a.name, a.tel]), [['0001', 'Del Bosco Giulia', '3470001122'], ['0035', 'Cappelletti Elia', '3337654321'], ['0036', 'Rossi Maria', '3331234567']]);
    assert.deepEqual([db.allieve[0].email, db.allieve[0].cap, db.allieve[0].note], ['m@example.com', '67062', 'nota, con virgola']);
    assert.deepEqual(db.iscrizioni.map((e) => [e.id, e.allievaId, e.quota]), [['0001', '0001', null], ['0002', '0001', null], ['0012', '0035', 280]]);
  });

  await step('lists and search', async () => {
    await go('allieve');
    assert.equal(await pg.locator('tbody tr').count(), 3);
    // a click on a column title sorts by it, a second click reverses
    await pg.getByRole('button', { name: 'Età' }).click();
    assert.deepEqual(await pg.$$eval('tbody tr a.name', (as) => as.map((a) => a.textContent)), ['Cappelletti Elia', 'Rossi Maria', 'Del Bosco Giulia'], 'youngest first');
    assert.equal(await pg.getAttribute('th[aria-sort]', 'aria-sort'), 'ascending');
    await pg.getByRole('button', { name: 'Età' }).click();
    assert.deepEqual(await pg.$$eval('tbody tr a.name', (as) => as.map((a) => a.textContent)), ['Del Bosco Giulia', 'Rossi Maria', 'Cappelletti Elia']);
    await pg.getByRole('button', { name: 'Allieva' }).click();
    assert.deepEqual(await pg.$$eval('tbody tr a.name', (as) => as.map((a) => a.textContent)), ['Cappelletti Elia', 'Del Bosco Giulia', 'Rossi Maria']);
    await pg.getByLabel('Cerca', { exact: true }).fill('cappel');
    await pg.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    assert.ok((await pg.textContent('tbody tr')).includes('Cappelletti Elia'));
    await lab('Mostra').selectOption('senza');
    await pg.getByLabel('Cerca', { exact: true }).fill('');
    await pg.waitForTimeout(250);
    assert.deepEqual(await pg.$$eval('tbody tr a.name', (as) => as.map((a) => a.textContent)), ['Rossi Maria']);
    await lab('Mostra').selectOption('tutte');
    await shot('allieve');
    await go('iscrizioni');
    assert.equal(await pg.locator('tbody tr').count(), 2, 'open enrollments only');
    await lab('Stato').selectOption('tutte');
    assert.equal(await pg.locator('tbody tr').count(), 3);
    await pg.getByRole('button', { name: 'Dovuto' }).click();
    assert.deepEqual(await pg.$$eval('tbody tr', (rs) => rs.map((r) => [].map.call(r.querySelectorAll('td.num'), (t) => t.textContent))), [['170,00 €', '170,00 €'], ['170,00 €', '170,00 €'], ['280,00 €', '280,00 €']]);
    await pg.getByRole('button', { name: 'Allieva' }).click();
    await shot('iscrizioni');
  });

  await step('courses: class list and attendance sheet', async () => {
    await go('corsi');
    assert.deepEqual(await tiles(), { 'Propedeutico': 1, 'Base': 1 });
    assert.equal(await pg.locator('tbody tr').count(), 2);
    await pg.locator('a.tile', { hasText: 'Base' }).click();
    await pg.waitForFunction(() => location.hash === '#corsi/Base' && document.querySelectorAll('tbody tr').length === 1);
    assert.deepEqual(await pg.$$eval('tbody tr a.name', (as) => as.map((a) => a.textContent)), ['Del Bosco Giulia']);
    await lab('Giorno').selectOption('Mar');
    assert.equal(await pg.locator('tbody tr').count(), 0);
    assert.equal(await pg.getByRole('button', { name: 'Stampa il foglio presenze' }).isDisabled(), true);
    await lab('Giorno').selectOption('Lun');
    assert.equal(await pg.locator('tbody tr').count(), 1);
    // the print dialog cannot be driven here: check what would go on paper
    await pg.evaluate(() => { window.print = () => { window.__carta = { stampa: document.body.classList.contains('stampa'), testo: document.getElementById('print').innerText, caselle: document.querySelectorAll('#print td.box').length }; }; });
    await pg.getByRole('button', { name: 'Stampa il foglio presenze' }).click();
    let carta = await pg.evaluate(() => window.__carta);
    assert.equal(carta.stampa, true);
    assert.equal(carta.caselle, 12);
    assert.ok(carta.testo.includes('A.S.D. Gym Art Avezzano') && carta.testo.includes('Corso Base · lunedì') && carta.testo.includes('1 iscritta') && carta.testo.includes('Del Bosco Giulia'), carta.testo);
    assert.equal(carta.testo.includes('3470001122'), false, 'the attendance sheet carries names only');
    await pg.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await pg.evaluate(() => document.body.classList.contains('stampa') || document.getElementById('print').childElementCount > 0), false);
    await pg.getByRole('button', { name: 'Stampa l\'elenco' }).click();
    carta = await pg.evaluate(() => window.__carta);
    assert.ok(carta.testo.includes('3470001122') && carta.testo.includes('De Luca Antonella') && carta.testo.includes('12/10/2013'), carta.testo);
    await pg.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await lab('Giorno').selectOption('');
    await shot('corsi');
  });

  let copia;
  await step('export, safety copy, restore', async () => {
    await go('impostazioni');
    let [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByRole('button', { name: 'Elenco allieve (.csv)' }).click()]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(/^allieve-\d{8}-\d{4}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    assert.ok(csv.startsWith('﻿N.;Cognome e Nome;Data di nascita'), csv.slice(0, 60));
    assert.ok(csv.includes('0035;Cappelletti Elia;02/07/2019'));
    [dl] = await Promise.all([pg.waitForEvent('download'), pg.getByRole('button', { name: 'Scarica una copia di sicurezza' }).click()]);
    copia = path.join(TMP, dl.suggestedFilename()); await dl.saveAs(copia);
    assert.equal(JSON.parse(fs.readFileSync(copia, 'utf8')).db.allieve.length, 3);
    await toast('Copia scaricata');
    assert.equal(readArchive().db.impostazioni.ultimaCopia, TODAY);
    assert.ok((await pg.textContent('#view')).includes('Ultima copia di sicurezza scaricata: ' + C.isoToIt(TODAY)));
    await go('inizio');
    assert.equal(await pg.locator('.note-warn').count(), 0, 'no reminder right after a copy');

    await go('allieva/0036');
    const n0 = copies();
    await pg.getByRole('button', { name: 'Elimina' }).click();
    await toast('Allieva eliminata.');
    assert.equal(readArchive().db.allieve.length, 2);
    assert.equal(copies(), n0 + 1, 'a deletion always keeps a copy of the archive as it was');
    await go('impostazioni');
    dialogs = [];
    const prima = copies();
    await pg.setInputFiles('input[type=file][accept*=json]', copia);
    await toast('Archivio ripristinato.');
    assert.equal(copies(), prima + 1, 'a restore always keeps a copy of the archive it replaces');
    assert.ok(dialogs[0].includes('2 allieve') && dialogs[0].includes('3 allieve'), dialogs[0]);
    assert.equal(readArchive().db.allieve.length, 3);
    // a file that is not an archive is refused and nothing changes
    const bad = path.join(TMP, 'altro.json'); fs.writeFileSync(bad, '{"ciao":1}');
    const rev = readArchive().rev; dialogs = [];
    await go('impostazioni'); // a restore ends on the first page
    await pg.setInputFiles('input[type=file][accept*=json]', bad);
    await pg.waitForTimeout(200);
    assert.ok(dialogs[0].includes('non è una copia dell\'archivio'), dialogs[0]);
    assert.equal(readArchive().rev, rev);
  });

  await step('settings', async () => {
    await go('impostazioni');
    await lab('Giorni di preavviso per gli abbonamenti').fill('abc');
    await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    assert.ok((await pg.textContent('.note-bad')).includes('Giorni di preavviso'));
    await lab('Giorni di preavviso per gli abbonamenti').fill('45');
    await lab('Fasce orarie').fill('16:00\n17:00-18:30');
    await lab('Promemoria di scadenza per WhatsApp').fill('Ciao, l\'abbonamento di {nome} ({corso}) scade il {scadenza}.');
    await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    await toast('Impostazioni salvate.');
    const db = readArchive().db;
    assert.equal(db.impostazioni.preavvisoAbb, 45);
    assert.deepEqual(db.liste.fasce, ['16:00', '17:00-18:30']);
    assert.equal(db.impostazioni.messaggioScadenza, 'Ciao, l\'abbonamento di {nome} ({corso}) scade il {scadenza}.');
    await shot('impostazioni', true);
  });

  await step('change log', async () => {
    await go('registro');
    await pg.waitForSelector('tbody tr');
    const text = await pg.textContent('tbody');
    for (const op of ['Nuova allieva', 'Nuova iscrizione', 'Rinnovo', 'Importazione', 'Allieva eliminata', 'Ripristino da copia', 'Impostazioni modificate']) assert.ok(text.includes(op), op);
    await pg.getByLabel('Cerca nel registro').fill('rinnovo');
    assert.equal(await pg.locator('tbody tr').count(), 2);
    await shot('registro');
  });

  await step('family, foreign phone number, Roman numerals in the address', async () => {
    await go('allieva/nuova');
    await lab('Cognome e Nome').fill('del bosco anna');
    await lab('Genitore / Referente').fill('antonella de luca');
    await lab('Telefono').fill('00355 69 123 4567');
    await lab('Indirizzo').fill('via xx settembre 4');
    assert.equal(await pg.locator('.note-bad').count(), 0, 'a number from another country is accepted');
    await pg.getByRole('button', { name: 'Salva la nuova allieva' }).click();
    await pg.waitForFunction(() => /^#allieva\/\d{4}$/.test(location.hash));
    const id = (await pg.evaluate(() => location.hash)).slice(-4), a = readArchive().db.allieve.find((x) => x.id === id);
    assert.deepEqual([a.name, a.tel, a.indirizzo], ['Del Bosco Anna', '+355691234567', 'Via XX Settembre 4']);
    assert.equal(await pg.getByRole('link', { name: 'WhatsApp' }).getAttribute('href'), 'https://wa.me/355691234567');
    const fam = await pg.textContent('.card:has(h2:has-text("Stessa famiglia"))');
    assert.ok(fam.includes('Del Bosco Giulia') && fam.includes('Base'), fam);
    assert.equal(fam.includes('Rossi Maria'), false);
    await shot('famiglia', true);
    await go('allieva/0001');
    assert.ok((await pg.textContent('.card:has(h2:has-text("Stessa famiglia"))')).includes('Del Bosco Anna'));
    await go('allieva/' + id);
    await pg.getByRole('button', { name: 'Elimina' }).click();
    await toast('Allieva eliminata.');
    await go('allieva/0001');
    assert.equal(await pg.locator('h2:has-text("Stessa famiglia")').count(), 0);
  });

  const RIL = isoPlus(TODAY, -350), SCAD = C.addYears(RIL, 1); // a certificate that expires in about two weeks
  await step('medical certificates: proposed expiry, status, deadlines', async () => {
    await go('allieva/0001');
    await lab('Tipo').selectOption('Non Agonistico');
    await lab('Data di rilascio').fill(RIL);
    assert.equal(await lab('Scadenza').inputValue(), SCAD, 'one year from the issue date is proposed');
    assert.ok((await pg.textContent('.row:has(h2:has-text("Certificato medico"))')).includes('In scadenza'));
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await toast('Modifiche salvate.');
    const a = readArchive().db.allieve[0];
    assert.deepEqual([a.certTipo, a.certRilascio, a.certScadenza], ['Non Agonistico', RIL, SCAD]);
    // a certificate without its dates is refused when it is entered
    await go('allieva/0035');
    await lab('Tipo').selectOption('Agonistico');
    assert.ok((await pg.textContent('.note-bad')).includes('Certificato: Data di rilascio mancante'));
    assert.equal(await pg.getByRole('button', { name: 'Salva le modifiche' }).isDisabled(), true, 'saving is blocked');
    await pg.getByRole('button', { name: 'Annulla' }).click();
    await go('scadenze');
    assert.ok((await pg.textContent('#cert-in-scadenza')).includes('Del Bosco Giulia'));
    const manca = await pg.textContent('#cert-mancanti');
    assert.ok(manca.includes('Cappelletti Elia') && !manca.includes('Rossi Maria'), 'only students with an open enrollment are chased: ' + manca);
    const wa = await pg.locator('#cert-in-scadenza').getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    assert.ok(wa.includes(encodeURIComponent('il certificato medico di Del Bosco Giulia ha scadenza il ' + C.isoToIt(SCAD))), wa);
    await go('allieve');
    assert.ok((await pg.textContent('tbody tr:has-text("Del Bosco Giulia")')).includes('In scadenza'));
    await go('inizio');
    const t = await tiles();
    assert.deepEqual([t['Certificati da rinnovare'], t['Certificati mancanti']], [1, 1]);
    await shot('scadenze-certificati');
  });

  await step('payments: due, paid, receipts numbered and never reused', async () => {
    const card = pg.locator('#pagamenti');
    await go('iscrizione/0002');
    let txt = await card.textContent();
    assert.ok(txt.includes('Dovuto: 170,00 €') && txt.includes('Resta da pagare: 170,00 €') && txt.includes('Nessun pagamento registrato.'), txt);
    assert.equal(await lab('Importo').inputValue(), '170', 'what is left is proposed');
    await pg.getByRole('button', { name: 'Registra il pagamento' }).click();
    assert.ok((await card.locator('.note-bad').textContent()).includes('metodo di pagamento'), 'no method, no payment');
    assert.equal((readArchive().db.pagamenti || []).length, 0);
    await lab('Importo').fill('70');
    await lab('Metodo').selectOption('Bonifico');
    await lab('Note del pagamento').fill('acconto');
    await pg.getByRole('button', { name: 'Registra il pagamento' }).click();
    await toast('Pagamento registrato.');
    await pg.waitForFunction(() => document.querySelectorAll('#pagamenti tbody tr').length === 1);
    txt = await card.textContent();
    assert.ok(txt.includes('RIC-0002-1') && txt.includes('Pagato in parte') && txt.includes('Resta da pagare: 100,00 €'), txt);
    const p = readArchive().db.pagamenti[0];
    assert.deepEqual([p.id, p.iscrizioneId, p.data, p.importo, p.metodo, p.ricevuta, p.note], ['0001', '0002', TODAY, 70, 'Bonifico', 'RIC-0002-1', 'acconto']);

    const ric = await scarica(() => card.getByRole('button', { name: 'Ricevuta (PDF)' }).click());
    assert.equal(ric.name, 'Ricevuta_RIC-0002-1_Del_Bosco_Giulia.pdf');
    const testo = pdfText(ric.file);
    for (const t of ['RICEVUTA DI PAGAMENTO', 'RIC-0002-1', C.isoToIt(TODAY), 'De Luca Antonella', 'Del Bosco Giulia', 'DLBGLI13R52A345D', '12/10/2013', 'Corso Base, abbonamento trimestrale dal ' + C.isoToIt(isoPlus(TODAY, 10)),
      '70,00 €', 'settanta/00', 'Bonifico', 'Note: acconto', 'Resta da versare: 100,00 €']) assert.ok(testo.includes(t), 'receipt without "' + t + '": ' + testo);

    assert.equal(await lab('Importo').inputValue(), '100');
    await lab('Metodo').selectOption('Contanti');
    await pg.getByRole('button', { name: 'Registra il pagamento' }).click();
    await pg.waitForFunction(() => document.querySelectorAll('#pagamenti tbody tr').length === 2);
    assert.ok((await card.textContent()).includes('Saldato'));
    // deleting the last payment keeps a copy and does not free its receipt number
    const prima = copies();
    dialogs = [];
    await card.locator('tbody tr').nth(1).getByRole('button', { name: 'Elimina' }).click();
    await toast('Pagamento eliminato.');
    assert.ok(dialogs[0].includes('RIC-0002-2') && dialogs[0].includes('non verrà riusato'), dialogs[0]);
    assert.equal(copies(), prima + 1);
    await pg.waitForFunction(() => document.querySelectorAll('#pagamenti tbody tr').length === 1);
    await lab('Metodo').selectOption('Contanti');
    await pg.getByRole('button', { name: 'Registra il pagamento' }).click();
    await pg.waitForFunction(() => document.querySelectorAll('#pagamenti tbody tr').length === 2);
    assert.deepEqual(readArchive().db.pagamenti.map((x) => [x.ricevuta, x.importo, x.metodo]), [['RIC-0002-1', 70, 'Bonifico'], ['RIC-0002-3', 100, 'Contanti']]);
    // an enrollment with payments cannot be deleted
    dialogs = [];
    await pg.locator('form.card').getByRole('button', { name: 'Elimina' }).click();
    await pg.waitForTimeout(200);
    assert.ok(dialogs.some((d) => d.includes('ha dei pagamenti registrati')), String(dialogs));
    assert.equal(readArchive().db.iscrizioni.length, 3);

    await go('pagamenti');
    txt = await pg.textContent('#view');
    for (const t of ['2 pagamenti · incassato: 170,00 €', 'Bonifico: 70,00 €', 'Contanti: 100,00 €', '2 iscrizioni con un residuo · totale: 450,00 €']) assert.ok(txt.includes(t), 'payments page without "' + t + '"');
    const daInc = await pg.textContent('#da-incassare');
    assert.ok(daInc.includes('Cappelletti Elia') && daInc.includes('280,00 €') && daInc.includes('Del Bosco Giulia'), daInc);
    await lab('Metodo').selectOption('Bonifico');
    assert.equal(await pg.locator('.card:has(h2:has-text("Incassi")) tbody tr').count(), 1);
    await lab('Metodo').selectOption('');
    // the transfer of 70 € waits for a check: in the list, in the summary, on the first page and in the card of the enrollment
    const dvTxt = await pg.textContent('#da-verificare');
    assert.ok(dvTxt.includes('Bonifici da verificare (1)') && dvTxt.includes('70,00 €') && dvTxt.includes('Il programma non lo verifica mai da solo'), dvTxt);
    assert.ok(txt.includes('di cui da verificare: 70,00 €'), 'the summary says how much is unchecked');
    await go('inizio');
    assert.equal((await tiles())['Bonifici da verificare'], 1);
    await go('iscrizione/0002');
    assert.ok((await card.locator('tbody tr').first().textContent()).includes('Da verificare'));
    assert.equal(await card.getByRole('button', { name: 'Segna verificato' }).count(), 1, 'only the transfer has the button, not the cash payment');
    dialogs = [];
    await card.getByRole('button', { name: 'Segna verificato' }).click();
    await toast('Bonifico segnato come verificato.');
    assert.ok(dialogs[0].includes('estratto conto') && dialogs[0].includes('70,00 €'), dialogs[0]);
    let pv = readArchive().db.pagamenti[0];
    assert.deepEqual([pv.daVerificare, pv.verificatoIl], [false, TODAY]);
    assert.equal(await card.getByRole('button', { name: 'Segna verificato' }).count(), 0);
    assert.ok((await card.locator('tbody tr').first().textContent()).includes('Verificato il'));
    await go('pagamenti');
    assert.equal(await pg.locator('#da-verificare').count(), 0, 'nothing left to check');
    await go('inizio');
    assert.equal((await tiles())['Bonifici da verificare'], undefined);
    // a confirmation can be taken back, then given again
    await go('iscrizione/0002');
    await card.getByRole('button', { name: 'Annulla verifica' }).click();
    await toast('Verifica annullata.');
    assert.equal(readArchive().db.pagamenti[0].daVerificare, true);
    await card.getByRole('button', { name: 'Segna verificato' }).click();
    await pg.waitForFunction(() => document.getElementById('toast').textContent.includes('Bonifico segnato come verificato.'));
    for (let i = 0; i < 30 && readArchive().db.pagamenti[0].daVerificare; i++) await pg.waitForTimeout(100);
    assert.equal(readArchive().db.pagamenti[0].daVerificare, false);
    const reg = fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8');
    assert.ok(reg.includes('Bonifico verificato') && reg.includes('Verifica annullata'), 'the log keeps who confirmed what');
    await go('pagamenti');
    await shot('pagamenti', true);
  });

  await step('registration fee from the price list; payments imported from the sheet', async () => {
    await go('iscrizione/nuova/0036');
    await lab('Corso').selectOption('FitKid');
    await pg.getByLabel('Sab').check();
    assert.equal(await lab('Tariffa / Pacchetto').inputValue(), 'FitKid (1 giorno) · 1 giorno/settimana');
    assert.equal(await lab('Iscrizione e tesseramento').inputValue(), '10', 'the fee of the price list is proposed');
    await lab('Tipo abbonamento').selectOption('Mensile');
    assert.ok((await pg.textContent('.info-line')).includes('Totale dovuto: 35,00 €'));
    await pg.getByRole('button', { name: 'Salva l\'iscrizione' }).click();
    await pg.waitForFunction(() => location.hash === '#allieva/0036');
    const e = readArchive().db.iscrizioni.find((x) => x.allievaId === '0036');
    assert.deepEqual([e.corso, e.quotaIscrizione, e.quota], ['FitKid', 10, null]);
    assert.ok((await pg.textContent('.list-item')).includes('dovuto 35,00 €'));

    const pag = [['PAGAMENTI'], ['Data pagamento', "Iscrizione (scegli dall'elenco)", 'Importo', 'Metodo', 'N. ricevuta', 'Note', 'ID iscrizione', 'Allieva', 'Corso'],
      ['15/09/2026', '0012 · Cappelletti Elia · Propedeutico', '100,00 €', 'POS', 'RIC-012-1', 'prima rata', '0012', 'Cappelletti Elia', 'Propedeutico'],
      ['16/09/2026', '', '50,00 €', 'Contanti', '', '', '0099', 'Greco Fabiola', 'Base']];
    const f = path.join(TMP, 'Gestionale - PAGAMENTI.csv');
    fs.writeFileSync(f, pag.map(csvLine).join('\r\n'));
    await go('impostazioni');
    await pg.setInputFiles('input[type=file][multiple]', f);
    await pg.waitForSelector(IMPORTA + ' .note-warn');
    const sum = await pg.textContent(IMPORTA + ' .note-warn');
    assert.ok(sum.includes('PAGAMENTI') && sum.includes('1 pagamento nuovo per 100,00 €') && sum.includes('Greco Fabiola') && sum.includes('non trovo l\'iscrizione'), sum);
    await pg.getByRole('button', { name: 'Importa nell\'archivio' }).click();
    await toast('Importazione completata.');
    const p = readArchive().db.pagamenti.find((x) => x.iscrizioneId === '0012');
    assert.deepEqual([p.data, p.importo, p.metodo, p.ricevuta, p.note], ['2026-09-15', 100, 'POS', 'RIC-012-1', 'prima rata']);
    await go('iscrizione/0012');
    assert.ok((await pg.textContent('#pagamenti')).includes('Resta da pagare: 180,00 €'));
  });

  await step('printable forms: enrollment form, certificate request, receipt with the club data', async () => {
    await go('impostazioni');
    await lab('Legale rappresentante').fill('Mario Bianchi');
    await lab('Ente di affiliazione').fill('CSEN');
    await lab('Codice di affiliazione').fill('AQ-123');
    await lab('Codice fiscale dell\'associazione').fill('90012345678');
    await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    await toast('Impostazioni salvate.');
    const stagione = L.stagioneDi(TODAY);
    await go('allieva/0001');
    let d = await scarica(() => pg.getByRole('button', { name: 'Modulo di iscrizione', exact: true }).click());
    assert.equal(d.name, 'Modulo_iscrizione_Del_Bosco_Giulia.pdf');
    let t = pdfText(d.file);
    for (const x of ['MODULO DI ISCRIZIONE - STAGIONE ' + stagione, 'Del Bosco Giulia', '12/10/2013', 'DLBGLI13R52A345D', 'De Luca Antonella', '3470001122', '17:00-18:30']) assert.ok(t.includes(x), 'form without "' + x + '"');
    d = await scarica(() => pg.getByRole('button', { name: 'Richiesta certificato agonistico' }).click());
    t = pdfText(d.file);
    for (const x of ["L'IDONEITÀ", 'Mario Bianchi', 'CSEN', 'AQ-123', 'Del Bosco Giulia', 'stagione sportiva ' + stagione]) assert.ok(t.includes(x), 'request without "' + x + '"');
    d = await scarica(() => pg.getByRole('button', { name: 'Richiesta certificato non agonistico' }).click());
    assert.ok(pdfText(d.file).includes('ATTIVITÀ SPORTIVA NON AGONISTICA'));
    await go('allieve');
    d = await scarica(() => pg.getByRole('button', { name: 'Modulo di iscrizione in bianco (PDF)' }).click());
    t = pdfText(d.file);
    assert.ok(t.includes('MODULO DI ISCRIZIONE - STAGIONE ' + stagione) && !t.includes('Del Bosco'), 'blank form');
    await go('pagamenti');
    d = await scarica(() => pg.getByRole('button', { name: 'Ricevuta (PDF)' }).first().click());
    assert.ok(pdfText(d.file).includes('Codice fiscale 90012345678'));
  });

  await step('second folder: a copy at every save, a missing folder is reported and never blocks', async () => {
    const oggi = path.join(CHIAVETTA, 'gymart-' + TODAY.replace(/-/g, '') + '.json');
    await go('impostazioni');
    dialogs = [];
    await lab('Cartella della seconda copia').fill('Copie');
    await pg.getByRole('button', { name: 'Salva la cartella' }).click();
    await pg.waitForTimeout(300);
    assert.ok(dialogs[0].includes('percorso completo'), String(dialogs));
    await lab('Cartella della seconda copia').fill(CHIAVETTA);
    await pg.getByRole('button', { name: 'Salva la cartella' }).click();
    await toast('Seconda cartella salvata.');
    assert.ok(fs.readFileSync(oggi, 'utf8').includes('Del Bosco Giulia'), 'the copy is made at once');
    assert.ok((await pg.textContent('#view')).includes('Ultima copia nella seconda cartella: ' + C.isoToIt(TODAY)));
    // every save refreshes it
    await go('allieva/0036');
    await lab('Luogo di nascita').fill('avezzano');
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await toast('Modifiche salvate.');
    await pg.waitForTimeout(1600);
    assert.ok(JSON.parse(fs.readFileSync(oggi, 'utf8')).db.allieve.some((a) => a.id === '0036' && a.luogo === 'Avezzano'), 'the copy follows the archive');
    // the stick is pulled out: here the folder becomes a file
    fs.rmSync(CHIAVETTA, { recursive: true });
    fs.writeFileSync(CHIAVETTA, 'x');
    await pg.waitForTimeout(300); // the page redraws after the previous save
    await lab('Luogo di nascita').fill('roma');
    const rev0 = readArchive().rev;
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await pg.waitForFunction(() => document.getElementById('toast').className.includes('on'));
    for (let i = 0; i < 50 && readArchive().rev === rev0; i++) await pg.waitForTimeout(100);
    assert.equal(readArchive().db.allieve.find((a) => a.id === '0036').luogo, 'Roma', 'the save does not depend on the second folder');
    await pg.waitForTimeout(1600);
    await go('inizio');
    assert.ok((await pg.textContent('.note-bad')).includes('La copia sulla seconda cartella non riesce.'));
    await go('impostazioni');
    dialogs = [];
    await pg.getByRole('button', { name: 'Copia adesso' }).click();
    await pg.waitForTimeout(400);
    assert.ok(dialogs[0].includes('Non riesco a scrivere'), String(dialogs));
    // back in place
    fs.rmSync(CHIAVETTA);
    await pg.getByRole('button', { name: 'Copia adesso' }).click();
    await toast('Copia fatta nella seconda cartella.');
    assert.ok(fs.readFileSync(oggi, 'utf8').includes('Roma'));
    await go('inizio');
    assert.equal(await pg.locator('.note-bad').count(), 0);
    assert.equal(await pg.locator('.note-warn').count(), 0, 'a working second folder is a safety copy: no reminder');
  });

  await step('phone access: network switched on from the PC, login, phone layout, logout, switched off', async () => {
    const porta = await new Promise((res) => { const srv = require('net').createServer().listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); }); });
    await go('impostazioni');
    await pg.evaluate((p) => fetch('/api/rete', { method: 'POST', headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ attiva: false, porta: p }) }), porta); // the test picks a free port
    await go('inizio'); await go('impostazioni');
    const card = pg.locator('#rete');
    await card.getByRole('button', { name: 'Attiva l\'accesso dal telefono' }).waitFor();
    await card.getByLabel('Password della segreteria').fill('corta');
    await card.getByLabel('Ripeti la password').fill('corta');
    await card.getByRole('button', { name: 'Attiva l\'accesso dal telefono' }).click();
    assert.ok((await card.locator('.note-bad').textContent()).includes('almeno 8 caratteri'));
    await card.getByLabel('Password della segreteria').fill(PHONEPW);
    await card.getByLabel('Ripeti la password').fill(PHONEPW);
    await card.getByRole('button', { name: 'Attiva l\'accesso dal telefono' }).click();
    await card.locator('.chip-ok:has-text("Attivo")').waitFor();
    const txt = await card.textContent();
    assert.ok(txt.includes('https://192.0.2.2:' + porta) && txt.includes('Impronta:'), txt);
    assert.equal(await card.locator('a[href="/certificato"]').count(), 1);
    await shot('impostazioni-telefono', true);

    // the phone: another browser, from another address, over HTTPS with the program's own certificate
    // The browsers of this sandbox cannot reach the machine's own network address, so a small tunnel carries the browser's TLS to it:
    // the program then sees a client coming from 192.0.2.2, which is not this computer's loopback, exactly as a phone would be.
    const tunnel = require('net').createServer((c) => { const u = require('net').connect(porta, '192.0.2.2'); c.pipe(u); u.pipe(c); c.on('error', () => u.destroy()); u.on('error', () => c.destroy()); c.on('close', () => u.destroy()); });
    await new Promise((res) => tunnel.listen(0, '127.0.0.1', res));
    const phoneCtx = await browser.newContext({ ...devices['iPhone 13'], ignoreHTTPSErrors: true, locale: 'it-IT', reducedMotion: 'reduce', acceptDownloads: true });
    const ph = await phoneCtx.newPage();
    const phProblems = []; ph.on('pageerror', (e) => phProblems.push(e.message));
    ph.on('dialog', (d) => d.accept()); // the warning "more than what is left" asks for a confirmation
    const base = 'https://127.0.0.1:' + tunnel.address().port + '/';
    await ph.goto(base);
    await ph.waitForSelector('#f');
    assert.ok(ph.url().endsWith('/login'), 'sent to the login page: ' + ph.url());
    assert.equal(await ph.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    // nothing about the data is reachable before the login
    const raw = (path, o) => ph.evaluate(([p, opt]) => fetch(p, opt).then((r) => r.status), [path, o || {}]);
    assert.equal(await raw('/api/stato', { headers: { 'X-Gymart-Token': 'x' } }), 401);
    const cert = await ph.evaluate(() => fetch('/certificato').then((r) => r.text()));
    assert.ok(cert.startsWith('-----BEGIN CERTIFICATE-----'));
    await shot('telefono-login');
    await ph.screenshot({ path: path.join(OUT, 'win-telefono-login.png') });
    // wrong password, then the right one
    await ph.locator('#p').fill('sbagliata-di-sicuro');
    await ph.getByRole('button', { name: 'Entra' }).click();
    await ph.waitForSelector('.note-bad');
    assert.ok((await ph.textContent('#msg')).includes('Password errata.'));
    await ph.locator('#p').fill(PHONEPW);
    await ph.getByRole('button', { name: 'Entra' }).click();
    await ph.waitForSelector('.tile');
    assert.equal(await ph.evaluate(() => document.body.classList.contains('remoto')), true);
    assert.ok((await ph.textContent('#view')).includes('Allieve'));

    // phone layout: bottom bar instead of the top tabs, no sideways scroll, big touch targets
    assert.equal(await ph.locator('#bottom').isVisible(), true);
    assert.equal(await ph.locator('#tabs').isVisible(), false);
    for (const h of ['inizio', 'allieve', 'allieva/0001', 'iscrizione/0002', 'iscrizioni', 'corsi', 'corsi/Base', 'pagamenti', 'analisi', 'scadenze', 'registro', 'impostazioni', 'guida']) {
      await ph.evaluate((x) => { location.hash = x; }, h);
      await ph.waitForTimeout(120);
      const over = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, 'page scrolls sideways on the phone at ' + h + ' (' + over + ' px)');
    }
    const small = await ph.$$eval('button.btn, a.btn, .bottom a, .bottom button', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 34).map((e) => e.textContent.trim().slice(0, 30)));
    assert.deepEqual(small, [], 'touch targets under 34 px');
    // a row of a list is a card, with the title of each value
    await ph.evaluate(() => { location.hash = 'allieve'; });
    await ph.waitForSelector('table.tab-card tbody tr');
    assert.equal(await ph.locator('table.tab-card thead').isVisible(), false);
    assert.ok((await ph.locator('table.tab-card tbody tr').first().locator('td').evaluateAll((t) => t.map((x) => x.getAttribute('data-label')))).includes('Telefono'), 'each value carries the title of its column');
    assert.equal(await ph.locator('table.tab-card tbody tr').first().locator('td').nth(1).evaluate((e) => getComputedStyle(e, '::before').content), '"' + (await ph.locator('table.tab-card tbody tr').first().locator('td').nth(1).getAttribute('data-label')) + '"', 'the title is drawn before the value');
    await ph.screenshot({ path: path.join(OUT, 'win-telefono-allieve.png') });
    // the PC-only parts of Settings are not there, and their requests are refused
    await ph.evaluate(() => { location.hash = 'impostazioni'; });
    await ph.waitForSelector('h1:has-text("Impostazioni")');
    const imp = await ph.textContent('#view');
    for (const x of ['Dati su questo computer', 'Accesso dal telefono', 'Importa dal foglio Google', 'Seconda copia']) assert.equal(imp.includes(x), false, x + ' should not be offered on a phone');
    for (const p of ['/api/rete', '/api/copia', '/api/copie2', '/api/password']) assert.equal(await raw(p, { headers: { 'X-Gymart-Token': await ph.evaluate(() => TOKEN) } }), 403, p);
    // work from the phone: a payment, saved on the PC
    await ph.evaluate(() => { location.hash = 'iscrizione/0002'; });
    await ph.waitForSelector('#pagamenti');
    const n0 = (readArchive().db.pagamenti || []).length;
    await ph.locator('#pagamenti').getByLabel('Importo').fill('5');
    await ph.locator('#pagamenti').getByLabel('Metodo').selectOption('Contanti');
    await ph.locator('#pagamenti').getByRole('button', { name: 'Registra il pagamento' }).click();
    await ph.waitForFunction((n) => document.querySelectorAll('#pagamenti tbody tr').length === n + 1, n0 || 0, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 40 && (readArchive().db.pagamenti || []).length === n0; i++) await ph.waitForTimeout(100);
    assert.equal((readArchive().db.pagamenti || []).length, n0 + 1, 'a payment made from the phone reached the PC');
    // the PC sees it at once, after a reload of its own page
    await pg.reload(); await pg.waitForSelector('h1');
    await ph.screenshot({ path: path.join(OUT, 'win-telefono-iscrizione.png') });

    // the menu "Altro" and the logout
    await ph.evaluate(() => { location.hash = 'inizio'; });
    await ph.locator('#bottom .altro').click();
    await ph.getByRole('button', { name: 'Esci da questo telefono' }).click();
    await ph.waitForSelector('#f');
    assert.ok(ph.url().endsWith('/login'));
    assert.equal(await raw('/api/stato', { headers: { 'X-Gymart-Token': 'x' } }), 401);
    // after five wrong passwords the address has to wait
    for (let i = 0; i < 5; i++) { await ph.locator('#p').fill('no-' + i); await ph.getByRole('button', { name: 'Entra' }).click(); await ph.waitForSelector('.note-bad'); await ph.waitForFunction(() => !document.querySelector('button').disabled); }
    await ph.locator('#p').fill(PHONEPW);
    await ph.getByRole('button', { name: 'Entra' }).click();
    await ph.waitForFunction(() => document.querySelector('#msg').textContent.includes('Troppi tentativi'));
    assert.deepEqual(phProblems, []);

    // from the PC: devices logged in, change of password, switch off
    await go('inizio'); await go('impostazioni');
    await card.locator('.chip-ok:has-text("Attivo")').waitFor();
    assert.ok((await card.textContent()).includes('dispositivo ha fatto l\'accesso') || (await card.textContent()).includes('dispositivi hanno fatto'));
    dialogs = [];
    await card.getByRole('button', { name: 'Spegni l\'accesso dal telefono' }).click();
    await card.locator('.chip-mute:has-text("Spento")').waitFor();
    assert.ok(dialogs[0].includes('Spegnere'));
    await phoneCtx.close(); tunnel.close();
    const gone = await new Promise((res) => { const c = require('net').connect(porta, '192.0.2.2'); c.on('connect', () => { c.destroy(); res('answers'); }); c.on('error', () => res('refused')); });
    assert.equal(gone, 'refused', 'nothing listens on the network after switching off');
  });

  await step('two windows: the second save is refused and reloaded, nothing is lost', async () => {
    const pg2 = await ctx.newPage(); watch(pg2);
    await pg2.goto(app.url + '#allieva/0036'); await pg2.waitForSelector('h1:has-text("Rossi Maria")');
    await go('allieva/0035');
    await pg2.getByLabel('CAP', { exact: true }).fill('67051');
    await pg2.getByRole('button', { name: 'Salva le modifiche' }).click();
    await pg2.waitForFunction(() => document.getElementById('toast').textContent.includes('Modifiche salvate.'));
    const rev = readArchive().rev;
    await lab('Secondo telefono').fill('3339998877');
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await toast('modificato da un\'altra finestra');
    assert.equal(readArchive().rev, rev, 'the stale window wrote nothing');
    await pg.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Cappelletti Elia');
    await lab('Secondo telefono').fill('3339998877');
    await pg.getByRole('button', { name: 'Salva le modifiche' }).click();
    await toast('Modifiche salvate.');
    const db = readArchive().db;
    assert.equal(db.allieve.find((a) => a.id === '0036').cap, '67051');
    assert.equal(db.allieve.find((a) => a.id === '0035').tel2, '3339998877');
    await pg2.close();
  });

  await step('the archive is closed to strangers', async () => {
    const r1 = await ctx.request.get(app.url + 'api/stato');
    assert.equal(r1.status(), 401);
    // the page itself is not handed to someone who just asks for it: only to the window the program opened
    const estraneo = await browser.newContext();
    const r0 = await estraneo.request.get(app.url);
    assert.equal(r0.status(), 403);
    assert.equal((await r0.text()).includes('gymart-token'), false, 'no token for strangers');
    const r00 = await estraneo.request.get(app.apri); // a one-use address works once...
    assert.equal(r00.status(), 403, 'the launch address of the window was already used');
    await estraneo.close();
    const r2 = await ctx.request.post(app.url + 'api/salva', { data: { rev: 0, db: {} }, headers: { 'X-Gymart-Token': 'x' } });
    assert.equal(r2.status(), 401);
    problems.splice(0, problems.length, ...problems.filter((p) => !p.startsWith('401 ')));
  });

  await step('narrow window', async () => {
    await pg.setViewportSize({ width: 390, height: 800 });
    for (const h of ['inizio', 'allieve', 'allieva/0001', 'iscrizione/0002', 'corsi', 'corsi/Base', 'analisi', 'pagamenti', 'scadenze', 'impostazioni']) {
      await go(h);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'page scrolls sideways at ' + h);
    }
    await shot('stretta');
    await pg.setViewportSize({ width: 1280, height: 860 });
  });

  await step('analysis page: figures, charts, period, detail view', async () => {
    await go('analisi');
    await pg.waitForSelector('svg.chart');
    const t = await tiles();
    assert.equal(t['Incassato'], 275, 'payments of the season: 70 + 100 + the 100 imported from the sheet + 5 made from the phone');
    assert.equal(t['Da incassare'] > 0, true);
    assert.ok((await pg.textContent('#view')).includes('Incassi per mese') && (await pg.textContent('#view')).includes('Prossime 8 settimane'));
    assert.ok(await pg.locator('svg.chart rect.bar').count() > 5, 'bars are drawn');
    assert.ok(await pg.locator('svg.chart circle.fetta').count() >= 2, 'the donut has its slices');
    assert.equal(await pg.locator('svg.chart rect.bar').first().evaluate((e) => getComputedStyle(e).fill.startsWith('url') || e.getAttribute('fill').startsWith('url(#')), true);
    const defs = await pg.$$eval('svg.chart defs linearGradient', (g) => g.length);
    assert.ok(defs >= 1, 'the gradients exist, otherwise the bars would be invisible');
    assert.equal(await pg.locator('.cols2 .card').first().evaluate((e) => getComputedStyle(e).borderRadius), '20px');
    // the detailed view adds values, number tables and notes; the choice is remembered
    assert.equal(await pg.locator('svg.chart text.vlab').count(), 0);
    assert.equal(await pg.locator('table.dati').first().isVisible(), false);
    await pg.locator('#det').click();
    assert.equal(await pg.locator('#det').getAttribute('aria-checked'), 'true');
    assert.ok(await pg.locator('svg.chart text.vlab').count() > 0, 'values on the bars');
    assert.equal(await pg.locator('table.dati').first().isVisible(), true);
    assert.ok((await pg.textContent('.tile')).includes('pagament'), 'sub-line in the tiles');
    await shot('analisi', true);
    await pg.reload(); await pg.waitForSelector('svg.chart');
    assert.equal(await pg.locator('#det').getAttribute('aria-checked'), 'true', 'the choice survives a reload');
    // the other period
    await pg.getByRole('tab', { name: 'Ultimi 12 mesi' }).click();
    await pg.waitForFunction(() => document.querySelector('.head-row p').textContent.startsWith('Ultimi 12 mesi'));
    assert.equal((await tiles())['Incassato'], 275);
    // detail columns in a list
    await go('allieve');
    assert.ok((await pg.textContent('thead')).includes('Codice fiscale') && (await pg.textContent('thead')).includes('Email'));
    await pg.getByRole('button', { name: 'Allieva' }).click(); // sorting still works with more columns
    await pg.locator('#det').click();
    assert.equal((await pg.textContent('thead')).includes('Codice fiscale'), false);
    assert.equal(await pg.locator('#det').getAttribute('aria-checked'), 'false');
    // birthdays and the student's own totals
    await go('allieva/0001');
    assert.ok((await pg.textContent('.riepilogo-allieva')).includes('Pagato in totale: 175,00 €'));
  });

  await step('reminders in bulk: one list, WhatsApp with the text, contact noted only by the person, taken back', async () => {
    assert.equal((readArchive().db.promemoria || []).length, 0);
    await go('scadenze');
    await pg.getByRole('link', { name: 'Promemoria in blocco' }).click();
    await pg.waitForSelector('#view h1:has-text("Promemoria")');
    await pg.waitForSelector('.list-item');
    const t = await tiles();
    assert.ok(t['Da contattare'] >= 2, 'the certificate expiring and the one missing are listed: ' + JSON.stringify(t));
    assert.ok((await pg.textContent('#view')).includes('Promemoria') && (await pg.textContent('#view')).includes('Cappelletti Elia'));
    // search, then the message in the link
    await pg.locator('input[type=search]').fill('Del Bosco');
    await pg.waitForFunction(() => document.querySelectorAll('.list-item').length === 1 || (document.querySelectorAll('.list-item').length > 0 && [].every.call(document.querySelectorAll('.list-item'), (i) => i.textContent.includes('Del Bosco'))));
    const riga = pg.locator('.list-item', { hasText: 'Certificato' }).first();
    assert.ok((await riga.textContent()).includes('Da contattare'));
    const href = await riga.getByRole('link', { name: 'WhatsApp' }).getAttribute('href');
    assert.ok(href.startsWith('https://wa.me/393470001122?text=') && href.includes(encodeURIComponent('il certificato medico di Del Bosco Giulia')), href);
    await shot('promemoria', true);
    // opening the chat opens WhatsApp in another tab and notes the contact; nothing is sent by the program
    const [pop] = await Promise.all([ctx.waitForEvent('page'), riga.getByRole('link', { name: 'WhatsApp' }).click()]);
    await pop.close();
    await toast('Segnata come contattata.');
    let reg = readArchive().db.promemoria;
    assert.equal(reg.length, 1);
    assert.deepEqual([reg[0].tipo, reg[0].rif, reg[0].quando], ['certificato', '0001', TODAY]);
    assert.equal(await pg.locator('.list-item', { hasText: 'Del Bosco' }).filter({ hasText: 'Certificato' }).count(), 0, 'it leaves the "to do" list');
    // it is in "already contacted", with the day, and can be taken back
    await pg.getByLabel('Stato', { exact: true }).selectOption('contattate');
    const fatta = pg.locator('.list-item', { hasText: 'Del Bosco' }).filter({ hasText: 'Certificato' });
    await fatta.waitFor();
    assert.ok((await fatta.textContent()).includes('Contattata il ' + C.isoToIt(TODAY).slice(0, 5)));
    await fatta.getByRole('button', { name: 'Annulla' }).click();
    await toast('Segno tolto.');
    assert.equal(readArchive().db.promemoria.length, 0);
    // someone phoned: "Fatto"; the log has both
    await pg.getByLabel('Stato', { exact: true }).selectOption('fare');
    await pg.locator('input[type=search]').fill('Cappelletti');
    const cap = pg.locator('.list-item', { hasText: 'Cappelletti Elia' }).first();
    await cap.waitFor();
    await cap.getByRole('button', { name: 'Fatto' }).click();
    await toast('Segnata come contattata.');
    assert.equal(readArchive().db.promemoria.length, 1);
    await go('registro');
    await pg.waitForFunction(() => document.querySelector('#view table'));
    await pg.locator('#view input[type=search]').fill('Promemoria');
    await pg.waitForTimeout(300);
    const log = await pg.textContent('#view table');
    assert.ok(log.includes('Contattata il') && log.includes('Del Bosco Giulia') && log.includes('Cappelletti Elia'), log.slice(0, 300));
    // put it back as it was: later steps expect the same data
    await go('promemoria');
    await pg.waitForSelector('#view h1:has-text("Promemoria")');
    await pg.getByLabel('Stato', { exact: true }).selectOption('contattate');
    await pg.locator('.list-item', { hasText: 'Cappelletti Elia' }).first().getByRole('button', { name: 'Annulla' }).click();
    await toast('Segno tolto.');
    assert.equal(readArchive().db.promemoria.length, 0);
  });

  await step('new season: choices per enrollment, preview, one save with a copy, log, nothing lost', async () => {
    const prima = readArchive().db, copieP = copies();
    const aperte = prima.iscrizioni.filter((e) => !e.annullata && !e.storica);
    const pagamentiP = prima.pagamenti.length;
    assert.ok(aperte.length >= 2, 'the archive has open enrollments');
    await go('impostazioni');
    await pg.getByRole('link', { name: 'Avvia la procedura' }).click();
    await pg.waitForSelector('table.tab-card select');
    assert.equal(await pg.locator('table.tab-card tbody tr').count(), aperte.length);
    assert.equal(await lab('Nuova stagione').inputValue(), '2027/2028');
    assert.equal(await lab('I nuovi periodi partono dal').inputValue(), '2027-09-01');
    // nothing was written just by looking
    assert.equal(readArchive().db.iscrizioni.length, prima.iscrizioni.length);
    // choose by hand: the first closes, the second stays, the others renew
    await pg.getByRole('button', { name: 'Rinnova tutte' }).click();
    const sel = pg.locator('table.tab-card select');
    await sel.nth(0).selectOption('chiudi');
    await sel.nth(1).selectOption('lascia');
    const ids = await pg.$$eval('table.tab-card tbody tr a.name', (as) => as.map((a) => a.getAttribute('href').split('/')[1])); // rows are in name order
    const attese = aperte.length - 2;
    assert.ok((await pg.textContent('#view')).includes(attese + ' da rinnovare · 1 da chiudere · 1 lasciate come sono'));
    assert.ok((await pg.textContent('#view')).includes('Cosa succede se confermi'));
    await lab('I nuovi periodi partono dal').fill('2027-09-15');
    await shot('nuova-stagione', true);
    // a wrong season is refused before anything is written
    await lab('Nuova stagione').fill('2027');
    assert.ok((await pg.textContent('.note-bad')).includes('Stagione'));
    assert.equal(await pg.getByRole('button', { name: 'Conferma la nuova stagione' }).count(), 0);
    await lab('Nuova stagione').fill('2027/2028');
    dialogs = [];
    await pg.getByRole('button', { name: 'Conferma la nuova stagione' }).click();
    await toast('Nuova stagione 2027/2028 pronta.');
    assert.ok(dialogs.some((d) => d.includes('Confermi?') && d.includes('copia')));
    const dopo = readArchive().db;
    assert.equal(dopo.impostazioni.stagione, '2027/2028');
    assert.equal(dopo.iscrizioni.length, prima.iscrizioni.length + attese);
    assert.equal(dopo.pagamenti.length, pagamentiP, 'no payment is touched');
    const nuove = dopo.iscrizioni.slice(prima.iscrizioni.length);
    assert.ok(nuove.every((e) => e.inizio === '2027-09-15' && !e.storica && !e.annullata));
    assert.equal(dopo.iscrizioni.filter((e) => !e.annullata && !e.storica).length, attese + 1, 'the renewed ones plus the one left as it was');
    assert.equal(dopo.iscrizioni.find((e) => e.id === ids[0]).storica, true);
    assert.equal(dopo.iscrizioni.find((e) => e.id === ids[1]).storica, false);
    assert.ok(copies() > copieP, 'a copy of the archive was made before writing');
    assert.equal(await pg.evaluate(() => location.hash), '#iscrizioni');
    assert.equal(await pg.locator('#stagione').textContent(), '2027/2028');
    // the log has it, with the previous value of the season
    await go('registro');
    await pg.waitForFunction(() => document.querySelector('#view table'));
    await pg.locator('#view input[type=search]').fill('Nuova stagione');
    await pg.waitForTimeout(300);
    const reg = await pg.textContent('#view table');
    assert.ok(reg.includes('2026/2027') && reg.includes('2027/2028') && reg.includes('chiusa, non rinnovata'));
    // the same season again with nothing chosen: the page says there is nothing to do
    await go('stagione');
    await pg.waitForSelector('table.tab-card select');
    await lab('Nuova stagione').fill('2027/2028');
    await pg.getByRole('button', { name: 'Lascia tutte' }).click();
    assert.ok((await pg.textContent('.note-bad')).includes('nulla da fare'));
  });

  await step('protected archive (set from an older version): files unreadable, encrypted copies', async () => {
    assert.ok(sulDisco(DATI).includes('Del Bosco') && sulDisco(CHIAVETTA).includes('Del Bosco'), 'readable before the password');
    // version 1.2 let the user switch it on; the request still exists in the program, the page no longer offers it
    const prot = (body) => pg.evaluate((b) => fetch('/api/password', { method: 'POST', headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status), body);
    assert.equal(await prot({ attuale: '', nuova: PW1 }), 200);
    await pg.reload(); await pg.waitForSelector('h1');
    await go('impostazioni');
    const card = pg.locator('#protezione');
    assert.ok((await card.textContent()).includes('non si può più attivare da qui'));
    assert.equal(await card.getByRole('button', { name: 'Cambia la password' }).count(), 0, 'no change of password in the page');
    await pg.waitForTimeout(1600); // the second folder follows
    for (const [dove, dir] of [['data folder', DATI], ['second folder', CHIAVETTA]]) {
      const t = sulDisco(dir);
      for (const x of ['Del Bosco', 'Cappelletti', 'DLBGLI13R52A345D', '3470001122', 'RIC-0002-1']) assert.equal(t.includes(x), false, x + ' is readable in the ' + dove);
    }
    assert.ok(fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8').includes('"gymart":"cifrato"'));
    // the program still works on the same data
    await go('allieve');
    assert.equal(await pg.locator('tbody tr').count(), 3);
    await go('registro');
    await pg.waitForSelector('tbody tr');
    await pg.getByLabel('Cerca nel registro').fill(''); // the search of the earlier log step is still there
    await pg.waitForTimeout(250);
    const logTxt = await pg.textContent('#view');
    assert.ok(logTxt.includes('Pagamento registrato'), 'the log written before the password is still readable: ' + logTxt.slice(0, 600));
    // a safety copy is encrypted, and can be restored without typing the password again
    await go('impostazioni');
    const copia = await scarica(() => pg.getByRole('button', { name: 'Scarica una copia di sicurezza' }).click());
    await toast('è cifrata');
    const raw = fs.readFileSync(copia.file, 'utf8');
    assert.ok(raw.includes('"gymart":"cifrato"') && !raw.includes('Del Bosco'), 'the downloaded copy is not encrypted');
    await go('impostazioni');
    dialogs = [];
    await pg.setInputFiles('input[type=file][accept*=json]', copia.file);
    await toast('Archivio ripristinato.');
    assert.ok(dialogs[0].includes('3 allieve'), dialogs[0]);
    // the old password is needed to change it (through the program's request)
    assert.equal(await prot({ attuale: 'non-la-ricordo', nuova: PW2 }), 401);
    assert.equal(await prot({ attuale: PW1, nuova: PW2 }), 200);
    await shot('impostazioni-protetto', true);
  });

  await step('reload keeps the program running; closing the last window stops it', async () => {
    await go('impostazioni');
    await pg.reload(); await pg.waitForSelector('h1:has-text("Impostazioni")'); // a reload stays on the same page
    await pg.waitForTimeout(6000); // longer than the grace period after a page goes away
    assert.equal(app.proc.exitCode, null, 'the program must survive a reload');
    await go('inizio');
    assert.equal((await tiles()).Allieve, 3);
    await shot('inizio');
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0, 'the program stops by itself when the last window is closed');
  });

  await step('restart: same data, automatic copies', async () => {
    const copies = fs.readdirSync(path.join(DATI, 'copie'));
    assert.ok(copies.length >= 1 && copies.every((c) => /^archivio-\d{8}-\d{6}(-\d+)?\.json$/.test(c)), String(copies));
    assert.deepEqual(fs.readdirSync(DATI).filter((f) => !f.startsWith('rete')).sort(), ['archivio.json', 'copie', 'impostazioni-pc.json', 'registro.jsonl']); // rete*: settings and certificate of the phone access
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    // the archive is protected: nothing is shown before the password, and the old one no longer works
    await pg.goto(app.apri); await pg.waitForSelector('h1:has-text("Archivio protetto")');
    await shot('blocco');
    assert.equal(await pg.locator('.tile').count(), 0);
    assert.equal(await pg.locator('#tabs a').count(), 0);
    const stato = await pg.evaluate(() => fetch('/api/stato', { headers: { 'X-Gymart-Token': TOKEN } }).then((r) => r.json()));
    assert.deepEqual(Object.keys(stato).sort(), ['bloccato', 'cartella', 'versione'], 'no data before the password');
    await lab('Password').fill(PW1);
    await pg.getByRole('button', { name: 'Apri l\'archivio' }).click();
    await pg.waitForSelector('.note-bad');
    assert.ok((await pg.textContent('.note-bad')).includes('Password errata.'));
    await lab('Password').fill(PW2);
    await pg.getByRole('button', { name: 'Apri l\'archivio' }).click();
    await pg.waitForSelector('.tile');
    assert.equal((await tiles()).Allieve, 3);
    // the password can be taken away again: the files go back to plain text
    await go('impostazioni');
    await lab('Password attuale').fill(PW2);
    await pg.getByRole('button', { name: 'Togli la protezione' }).click();
    await toast('Protezione tolta.');
    assert.ok(readArchive().db.allieve.length === 3 && sulDisco(path.join(DATI, 'copie')).includes('Del Bosco'), 'plain again');
    await go('inizio');
    assert.ok((await pg.textContent('#conn')).startsWith('Salvato il '));
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await browser.close();
  assert.deepEqual(problems, [], 'errors seen by the browser');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OK - ' + n + ' steps passed. Screenshots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
