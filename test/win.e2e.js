'use strict';
// End-to-end check of the Windows program: node test/win.e2e.js
// Builds the program for this machine, starts it on a temporary folder and drives its page with Playwright.
// Every person is invented. Screenshots go to out/ (ignored by git).
const { execFileSync, spawn } = require('child_process');
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const C = require('../win/web/core.js');

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
function csvLine(cells) { return cells.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(','); }

function start() {
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI]);
  const exited = new Promise((res) => proc.on('exit', (code) => res(code)));
  const url = new Promise((res, rej) => {
    let buf = '';
    proc.stdout.on('data', (d) => { buf += d; const m = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(buf); if (m) res(m[1]); });
    exited.then((c) => rej(new Error('the program stopped at start, code ' + c)));
    setTimeout(() => rej(new Error('the program did not start')), 10000);
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  return url.then((u) => ({ proc, url: u, exited }));
}
function within(promise, ms) { return Promise.race([promise, new Promise((res) => setTimeout(() => res('timeout'), ms))]); }

(async () => {
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  fs.mkdirSync(OUT, { recursive: true });

  let app = await start();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', acceptDownloads: true });
  const problems = [];
  const expected = [[409, '/api/salva'], [400, '/api/decifra'], [401, '/api/decifra'], [401, '/api/sblocca'], [401, '/api/password'], [400, '/api/copie2'], [500, '/api/copie2/adesso']]; // refusals the steps ask for
  let dialogs = [], answer = true;
  function watch(pg) {
    // some steps provoke a refusal on purpose (a stale window: 409, a file that is not a copy: 400, a wrong password: 401); the browser reports them on its console
    pg.on('console', (m) => { if (m.type() === 'error' && !/40[019] \(/.test(m.text())) problems.push('console: ' + m.text()); });
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
    await pg.goto(app.url); await pg.waitForSelector('.tile');
    assert.ok((await pg.textContent('#view')).includes('L\'archivio è vuoto.'));
    assert.deepEqual(await tiles(), { 'Allieve': 0, 'Iscrizioni aperte': 0, 'In scadenza': 0, 'Scadute': 0, 'Da completare': 0, 'Senza iscrizione': 0, 'Certificati da rinnovare': 0, 'Certificati mancanti': 0, 'Da incassare (0 iscrizioni)': 0 });
    assert.equal(fs.existsSync(path.join(DATI, 'archivio.json')), false, 'nothing is written before the first save');
    assert.equal(await pg.evaluate(() => document.fonts.check('16px Barlow')), true, 'the font is served by the program');
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
    const r2 = await ctx.request.post(app.url + 'api/salva', { data: { rev: 0, db: {} }, headers: { 'X-Gymart-Token': 'x' } });
    assert.equal(r2.status(), 401);
    problems.splice(0, problems.length, ...problems.filter((p) => !p.startsWith('401 ')));
  });

  await step('narrow window', async () => {
    await pg.setViewportSize({ width: 390, height: 800 });
    for (const h of ['inizio', 'allieve', 'allieva/0001', 'iscrizione/0002', 'corsi', 'corsi/Base', 'scadenze', 'impostazioni']) {
      await go(h);
      assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'page scrolls sideways at ' + h);
    }
    await shot('stretta');
    await pg.setViewportSize({ width: 1280, height: 860 });
  });

  await step('reload keeps the program running; closing the last window stops it', async () => {
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
    assert.deepEqual(fs.readdirSync(DATI).sort(), ['archivio.json', 'copie', 'registro.jsonl']);
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.url); await pg.waitForSelector('.tile');
    assert.equal((await tiles()).Allieve, 3);
    assert.ok((await pg.textContent('#conn')).startsWith('Salvato il '));
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await browser.close();
  assert.deepEqual(problems, [], 'errors seen by the browser');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OK - ' + n + ' steps passed. Screenshots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
