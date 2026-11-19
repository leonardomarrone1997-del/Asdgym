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

function start(env) {
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI], env ? { env: Object.assign({}, process.env, env) } : undefined);
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
  await ctx.addInitScript(() => { try { localStorage.setItem('gymart-aperto', '1'); } catch (e) {} }); // this window shows every optional field open (the simple default is tested in its own step)
  await ctx.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); } catch (e) {} }); // the guided tour is shown once, on a first start: here it would be in the way (it has its own step)
  const problems = [];
  const expected = [[409, '/api/salva'], [400, '/api/decifra'], [401, '/api/decifra'], [401, '/api/sblocca'], [401, '/api/password'], [400, '/api/copie2'], [500, '/api/copie2/adesso'], [415, '/api/logo']]; // refusals the steps ask for
  let dialogs = [], answer = true;
  function watch(pg) {
    // some steps provoke a refusal on purpose (a stale window: 409, a file that is not a copy: 400, a wrong password: 401); the browser reports them on its console
    pg.on('console', (m) => { if (m.type() === 'error' && !/(4\d\d|500) \(/.test(m.text())) problems.push('console: ' + m.text()); });
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
    assert.deepEqual(await tiles(), { 'Incassi del mese': 0, 'Allieve': 0, 'Iscrizioni aperte': 0, 'Certificati registrati': 0 }); // nothing to do: no "to do" tiles
    assert.equal(fs.existsSync(path.join(DATI, 'archivio.json')), false, 'nothing is written before the first save');
    assert.ok((await pg.evaluate(() => getComputedStyle(document.body).fontFamily)).includes('Segoe UI'), 'the system font stack is in use');
    assert.equal(await pg.locator('#protezione').count(), 0, 'no password card: protection cannot be switched on from the page');
    assert.equal(await pg.getByRole('button', { name: /Attiva la protezione/ }).count(), 0);
  });

  await step('new student: checks, save, file on disk', async () => {
    await go('allieva/nuova'); // the full student form (every optional field) is reached by its address: the button of the top bar opens "Nuova iscrizione"
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
    await pg.getByRole('link', { name: 'Iscrivi a un corso' }).click();
    await pg.waitForSelector('h1:has-text("Nuova iscrizione")');
    assert.equal(await lab('Cognome e Nome').count(), 0, 'from the student\'s page the student is already chosen: no fields for a new one');
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
    assert.deepEqual(await tiles(), { 'Incassi del mese': 0, 'Allieve': 1, 'Iscrizioni aperte': 1, 'Certificati registrati': 0, 'In scadenza': 1, 'Certificati mancanti': 1, 'Da incassare (1 iscrizione)': 170, 'Promemoria da contattare': 2 });
    assert.ok((await pg.textContent('.note-warn')).includes('Non hai ancora scaricato una copia di sicurezza.'));
    await go('corsi'); assert.equal((await tiles())['Base'], 1, 'students per course are in the Corsi page'); await go('inizio');
  });

  await step('renewal from the deadlines page', async () => {
    await go('scadenze');
    assert.ok((await pg.textContent('#view')).includes('Del Bosco Giulia'));
    assert.equal(await pg.getByRole('link', { name: 'WhatsApp', exact: true }).count(), 0, 'no WhatsApp link in the rows: one "Avvisa" button opens the dialog');
    await pg.getByRole('button', { name: 'Avvisa', exact: true }).first().click(); // the reminder of the subscription; further down there is the one for the certificate
    const dlgA = pg.locator('dialog.modale'); await dlgA.waitFor();
    const testo = await dlgA.locator('textarea').inputValue();
    assert.match(testo, new RegExp('^(Buongiorno|Buonasera), vi ricordiamo che l.abbonamento trimestrale di Del Bosco Giulia al corso Base scade il ' + C.isoToIt(isoPlus(TODAY, 10)).replace(/\//g, '\\/') + ' \\(tra 10 giorni\\)\\. Per rinnovarlo passate in segreteria\\. Grazie, A\\.S\\.D\\. Gym Art Avezzano$'));
    const wa = dlgA.getByRole('link', { name: 'Apri WhatsApp' });
    assert.equal(await wa.getAttribute('href'), 'https://wa.me/393470001122?text=' + encodeURIComponent(testo));
    assert.equal(await wa.getAttribute('target'), '_blank');
    await dlgA.locator('textarea').fill('Ciao, testo cambiato a mano'); // the text can be changed before sending: the link follows
    assert.equal(await wa.getAttribute('href'), 'https://wa.me/393470001122?text=' + encodeURIComponent('Ciao, testo cambiato a mano'));
    assert.ok((await dlgA.textContent()).includes('Del Bosco Giulia') && (await dlgA.textContent()).includes('De Luca Antonella'), 'the person and the parent are shown');
    await dlgA.getByRole('button', { name: 'Annulla' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    assert.equal((readArchive().db.promemoria || []).length, 0, 'closing the dialog does not mark anybody as warned');
    dialogs = [];
    await pg.getByRole('button', { name: 'Rinnova' }).click();
    await toast('Abbonamento rinnovato.');
    assert.ok(dialogs[0].includes('Il nuovo periodo parte dal ' + C.isoToIt(isoPlus(TODAY, 10))));
    const isc = readArchive().db.iscrizioni;
    assert.deepEqual(isc.map((e) => [e.id, e.storica, e.inizio]), [['0001', true, INIZIO], ['0002', false, isoPlus(TODAY, 10)]]);
    assert.equal(await pg.getByRole('tab', { name: /^Abbonamenti/ }).count(), 0, 'no subscription left to follow: its tabs are gone');
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
    const sum = (await pg.$$eval(IMPORTA + ' .note', (ns) => ns.map((x) => x.textContent))).filter((x) => !x.startsWith('Il file resta su questo computer')); // the first note is the reassurance
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
    await lab('Abbonamento in scadenza').fill('Ciao, l\'abbonamento di {nome} ({corso}) scade il {scadenza}.');
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
    assert.ok((await pg.textContent('.row:has(h3:has-text("Certificato medico"))')).includes('In scadenza'));
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
    await pg.getByRole('tab', { name: /^Certificati in scadenza/ }).click();
    assert.ok((await pg.textContent('#scad-pannello')).includes('Del Bosco Giulia'));
    await pg.locator('#scad-pannello').getByRole('button', { name: 'Avvisa', exact: true }).click();
    const dlgC = pg.locator('dialog.modale'); await dlgC.waitFor();
    assert.match(await dlgC.locator('textarea').inputValue(), new RegExp('^(Buongiorno|Buonasera), vi ricordiamo che il certificato medico di Del Bosco Giulia scade il ' + C.isoToIt(SCAD).replace(/\//g, '\\/') + ' \\(tra \\d+ giorni\\)\\. Vi chiediamo di consegnare in segreteria quello nuovo\\. Grazie, A\\.S\\.D\\. Gym Art Avezzano$'));
    await dlgC.getByRole('button', { name: 'Annulla' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    await pg.getByRole('tab', { name: /^Certificati mancanti/ }).click();
    const manca = await pg.textContent('#scad-pannello');
    assert.ok(manca.includes('Cappelletti Elia') && !manca.includes('Rossi Maria'), 'only students with an open enrollment are chased: ' + manca);
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
    d = await scarica(() => pg.getByRole('button', { name: 'Modulo in bianco (PDF)' }).click());
    t = pdfText(d.file);
    assert.ok(t.includes('MODULO DI ISCRIZIONE - STAGIONE ' + stagione) && !t.includes('Del Bosco'), 'blank form');
    await go('pagamenti');
    d = await scarica(() => pg.getByRole('button', { name: 'Ricevuta (PDF)' }).first().click());
    assert.ok(pdfText(d.file).includes('Codice fiscale 90012345678'));
  });

  await step('second folder: a copy at every save, a missing folder is reported and never blocks', async () => {
    const oggi = path.join(CHIAVETTA, 'ultima', 'archivio.json'); // the newest archive; the log and the daily copies are beside it
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
    assert.ok(dialogs[0].includes('Non riesco ad aggiornare'), String(dialogs));
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
    await phoneCtx.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); } catch (e) {} });
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
    for (const x of ['Dati su questo computer', 'Accesso dal telefono', 'Importa dal file Excel o dal foglio Google', 'Seconda copia']) assert.equal(imp.includes(x), false, x + ' should not be offered on a phone');
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
    assert.equal(await pg.locator('.cols2 .card').first().evaluate((e) => getComputedStyle(e).borderRadius), '4px'); // the default style (Gestionale)
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

  await step('appearance: menu by width, three styles, light and dark, no sideways scroll, contrast of the colours', async () => {
    await go('inizio');
    assert.equal(await pg.locator('#esci').isVisible(), false, 'the "Esci" button is only for a phone: on this computer it would log the window out for good');
    // wide window: a short menu on the left (only what is used every day), no bottom bar
    assert.equal(await pg.locator('.side').isVisible(), true);
    assert.equal(await pg.locator('#bottom').isVisible(), false);
    // the label is the first <span> of an entry; a small number beside it says how many things wait (the "Scadenze" number is not asked for here: it depends on the data)
    const voce = () => pg.locator('#tabs a[aria-current="page"] span').first().innerText();
    assert.deepEqual(await pg.$$eval('#tabs a', (e) => e.map((x) => x.querySelector('span').textContent.trim())), ['Inizio', 'Allieve', 'Iscrizioni', 'Pagamenti', 'Scadenze', 'Certificati', 'Grafici', 'Altro'], 'the menu has only the daily things');
    assert.equal(await pg.locator('#tabs .nav-titolo').count(), 0, 'no group titles');
    assert.equal(await voce(), 'Inizio');
    // a page reached from a section is shown under it; what is not used every day lives under "Altro"
    await go('promemoria');
    await pg.waitForSelector('#view h1:has-text("Promemoria")');
    assert.equal(await voce(), 'Scadenze');
    await go('analisi'); assert.equal(await voce(), 'Grafici', 'the charts have their own entry');
    for (const [h, t] of [['registro', 'Registro'], ['corsi', 'Corsi'], ['stagione', 'Nuova stagione'], ['guida', 'Manuale']]) {
      await go(h);
      assert.equal(await voce(), 'Altro', t + ' is shown under "Altro"');
    }
    await go('altro');
    await pg.waitForSelector('#view h1:has-text("Altro")');
    assert.deepEqual(await pg.$$eval('#view .list-item .grow > a', (e) => e.map((x) => x.textContent.trim())), ['Corsi', 'Promemoria', 'Registro', 'Nuova stagione', 'Impostazioni', 'Manuale']);
    await pg.locator('#view .list-item', { hasText: 'Registro' }).getByRole('link', { name: 'Apri' }).click();
    await pg.waitForSelector('#view h1:has-text("Registro")');
    assert.equal(await pg.evaluate(() => location.hash), '#registro');
    // the style is chosen in Settings, kept on this device, and only changes the look
    const stile = () => pg.evaluate(() => [document.documentElement.dataset.stile, document.documentElement.dataset.scheme, localStorage.getItem('gymart-stile')]);
    const raggio = () => pg.locator('details.gruppo').first().evaluate((e) => getComputedStyle(e).borderRadius); // a settings group is a card of the style
    await go('impostazioni');
    assert.deepEqual((await stile()).slice(0, 1), ['sobrio'], 'the default style is the plain "Gestionale"');
    assert.equal(await raggio(), '4px');
    const arch = fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8');
    await pg.getByRole('button', { name: /^Morbido/ }).click();
    await toast('Stile "Morbido" attivo');
    assert.deepEqual(await stile(), ['morbido', (await stile())[1], 'morbido']);
    assert.equal(await raggio(), '20px');
    await pg.reload(); await pg.waitForSelector('#view h1:has-text("Impostazioni")');
    assert.equal((await stile())[0], 'morbido', 'the choice survives a reload');
    await pg.getByRole('button', { name: /^Gestionale/ }).click();
    assert.equal(await raggio(), '4px');
    const tema = pg.getByRole('group', { name: 'Chiaro o scuro' });
    await tema.getByRole('button', { name: 'Scuro', exact: true }).click();
    assert.equal((await stile())[1], 'dark');
    const sfondoScuro = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await tema.getByRole('button', { name: 'Chiaro', exact: true }).click();
    assert.equal((await stile())[1], 'light');
    assert.notEqual(await pg.evaluate(() => getComputedStyle(document.body).backgroundColor), sfondoScuro);
    await shot('stile-sobrio', true);
    await pg.getByRole('button', { name: /^Gym Art/ }).click();
    assert.equal((await stile())[0], 'club');
    assert.equal(await raggio(), '10px');
    await pg.getByRole('button', { name: /^Liquid Glass/ }).click();
    await tema.getByRole('button', { name: 'Automatico', exact: true }).click();
    assert.equal((await stile())[0], 'vetro');
    assert.equal(await raggio(), '28px');
    assert.equal(fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8'), arch, 'the look never touches the data');
    // contrast of every pair of colours, in each style and in light and dark (text 4.5:1, borders and chart colours 3:1)
    const PAIRS = [['ink', 'surface', 4.5], ['ink', 'bg', 4.5], ['ink-2', 'surface', 4.5], ['ink-2', 'bg', 4.5], ['ink-2', 'surface-2', 4.5], ['ink-2', 'sunken', 4.5], ['head', 'surface', 4.5], ['head', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent', 'bg', 4.5],
      ['primary-ink', 'primary', 4.5], ['primary-ink', 'primary-hover', 4.5], ['ok', 'ok-bg', 4.5], ['warn', 'warn-bg', 4.5], ['bad', 'bad-bg', 4.5], ['ink-2', 'mute-bg', 4.5], ['ok', 'surface', 4.5], ['warn', 'surface', 4.5], ['bad', 'surface', 4.5],
      ['hero-ink', 'hero-a', 4.5], ['hero-ink', 'hero-b', 4.5], ['on-accent', 'accent', 4.5], ['ink', 'panel', 4.5], ['ink-2', 'panel', 4.5], ['accent', 'panel', 4.5], ['ok', 'panel', 4.5], ['warn', 'panel', 4.5], ['bad', 'panel', 4.5], ['line-strong', 'panel', 3], ['grigio', 'panel', 3],
      ['c1', 'panel', 3], ['c2', 'panel', 3], ['c3', 'panel', 3], ['c4', 'panel', 3], ['c5', 'panel', 3], ['c6', 'panel', 3], ['side-ink', 'side-bg', 4.5], ['side-ink-2', 'side-bg', 4.5], ['side-ink', 'side-active', 4.5], ['side-ink-2', 'side-hover', 4.5], ['ink-2', 'top-bg', 4.5], ['head', 'top-bg', 4.5],
      ['line-strong', 'surface', 3], ['line-strong', 'bg', 3], ['focus', 'surface', 3], ['focus', 'bg', 3], ['c1', 'surface', 3], ['c2', 'surface', 3], ['c3', 'surface', 3], ['c4', 'surface', 3], ['c5', 'surface', 3], ['c6', 'surface', 3], ['grigio', 'surface', 3]];
    const bassi = await pg.evaluate((pairs) => {
      const root = document.documentElement, was = [root.dataset.stile, root.dataset.scheme], out = [], probe = document.createElement('i');
      document.body.appendChild(probe);
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      for (const st of ['vetro', 'club', 'morbido', 'sobrio']) for (const sc of ['light', 'dark']) {
        root.dataset.stile = st; root.dataset.scheme = sc;
        const cs = getComputedStyle(root), rgb = (n) => { probe.style.color = ''; probe.style.color = cs.getPropertyValue('--' + n).trim(); return getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); };
        // a colour with transparency (hover, active) is laid over the background it sits on before it is compared
        const solid = (n) => { const c = rgb(n); if (c.length < 4 || c[3] >= 1) return c; const base = solid(n === 'side-bg' || n.indexOf('panel') === 0 ? 'bg' : n.indexOf('side-') === 0 ? 'side-bg' : 'surface'); return [0, 1, 2].map((i) => Math.round(c[i] * c[3] + base[i] * (1 - c[3]))); };
        for (const [a, b, min] of pairs) { const la = lum(solid(a)), lb = lum(solid(b)), r = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); if (r < min) out.push(st + '/' + sc + ' ' + a + ' su ' + b + ' = ' + r.toFixed(2)); }
      }
      probe.remove(); root.dataset.stile = was[0]; root.dataset.scheme = was[1];
      return out;
    }, PAIRS);
    assert.deepEqual(bassi, [], 'contrast too low: ' + bassi.join(' | '));
    // widths: menu on the left, narrow menu on a tablet, bottom bar on a phone; never a sideways scroll, in every style
    const pagine = ['inizio', 'allieve', 'allieva/0001', 'iscrizioni', 'corsi', 'pagamenti', 'analisi', 'scadenze', 'certificati', 'promemoria', 'stagione', 'registro', 'impostazioni', 'guida', 'altro'];
    const problemi = [];
    for (const st of ['vetro', 'club', 'morbido', 'sobrio']) {
      await pg.evaluate((x) => Aspetto.imposta({ stile: x }), st);
      for (const [w, h] of [[390, 844], [768, 1000], [1280, 860]]) {
        await pg.setViewportSize({ width: w, height: h });
        for (const v of pagine) {
          await go(v);
          const m = await pg.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, side: getComputedStyle(document.querySelector('.side')).display !== 'none', bottom: getComputedStyle(document.getElementById('bottom')).display !== 'none', rail: document.querySelector('.side').getBoundingClientRect().width }));
          if (m.over > 0) problemi.push(st + ' ' + w + ' ' + v + ': scroll orizzontale ' + m.over + 'px');
          if (w < 700 ? m.side || !m.bottom : !m.side || m.bottom) problemi.push(st + ' ' + w + ' ' + v + ': menu sbagliato');
          if (w === 768 && m.rail > 100) problemi.push(st + ' ' + w + ': la barra stretta è larga ' + m.rail);
          if (w === 1280 && m.rail < 200) problemi.push(st + ' ' + w + ': il menu completo è largo ' + m.rail);
        }
        if (w === 768) { await go('stagione'); await pg.waitForSelector('table.tab-card select'); const sel = await pg.locator('table.tab-card select').first().evaluate((e) => e.getBoundingClientRect().width); if (sel < 120) problemi.push(st + ' 768: il menu "Cosa fare" è largo ' + sel + 'px'); }
      }
    }
    await pg.setViewportSize({ width: 1280, height: 860 });
    await pg.evaluate(() => Aspetto.imposta({ stile: 'sobrio', tema: 'auto' }));
    assert.deepEqual(problemi, []);
  });

  let ctx2 = null, p2 = null; // a second window with the movement switched on (the main one follows "reduce motion")
  const vai2 = async (h) => { await p2.evaluate((x) => { location.hash = x; }, h); await p2.waitForFunction((x) => location.hash === '#' + x, h); await p2.waitForTimeout(150); await p2.waitForFunction(() => document.documentElement.dataset.entrata === 'fine', null, { timeout: 15000 }); };
  await step('movement: GSAP entrance, digits that roll, smooth scroll, nothing stays hidden, three levels', async () => {
    // nothing chosen yet (a new device): the plain style and only soft fades, no rolling digits, no smooth-scroll takeover
    const c4 = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', reducedMotion: 'no-preference' });
    await c4.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); } catch (e) {} });
    await c4.addCookies(await ctx.cookies());
    const p4 = await c4.newPage(); watch(p4);
    await p4.goto(app.url); await p4.waitForSelector('.tile');
    assert.deepEqual(await p4.evaluate(() => [document.documentElement.dataset.stile, document.documentElement.dataset.movimento, Movimento.lenisAttivo(), document.querySelectorAll('.od').length, document.querySelectorAll('.hero').length, getComputedStyle(document.querySelector('.fondo')).display]), ['sobrio', 'ridotto', false, 0, 0, 'none'], 'by default: style "Gestionale", calm movement, no hero, no glass background');
    await p4.evaluate(() => { S.dirty = false; }); await p4.close(); await c4.close();
    ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', reducedMotion: 'no-preference' });
    await ctx2.addCookies(await ctx.cookies());
    await ctx2.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); } catch (e) {} });
    await ctx2.addInitScript(() => { try { if (!localStorage.getItem('gymart-movimento')) localStorage.setItem('gymart-movimento', 'pieno'); } catch (e) {} }); // the full movement is a choice of the person: here it is chosen
    p2 = await ctx2.newPage(); watch(p2);
    await p2.goto(app.url); await p2.waitForSelector('.tile');
    const stato = () => p2.evaluate(() => [document.documentElement.dataset.motore, document.documentElement.dataset.movimento, Movimento.attivo(), Movimento.lenisAttivo()]);
    assert.deepEqual(await stato(), ['gsap', 'pieno', true, true], 'libraries loaded, full movement, smooth scroll with a mouse');
    assert.deepEqual(await p2.evaluate(() => [!!window.gsap, !!window.ScrollTrigger, !!window.SplitText, !!window.Lenis]), [true, true, true, true]);
    // while the page comes in the numbers roll (digits in columns); at the end they are plain text again and the heading is whole again
    await p2.waitForFunction(() => document.documentElement.dataset.entrata === 'in-corso', null, { timeout: 4000 });
    assert.ok(await p2.locator('.tile b .od').count() > 0, 'digits that roll while the page comes in');
    assert.equal((await p2.locator('.tile b').first().evaluate((e) => e.textContent.replace(/\s+/g, ''))).length > 0, true, 'a screen reader still finds the number');
    await p2.waitForFunction(() => document.documentElement.dataset.entrata === 'fine', null, { timeout: 15000 });
    assert.equal(await p2.locator('.od').count(), 0, 'no digit column is left');
    await go('inizio');
    const lettura = (p) => p.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent])));
    const num = await lettura(p2), ref = await lettura(pg);
    assert.deepEqual(num, ref, 'the same numbers with and without movement');
    assert.ok(Object.keys(ref).length >= 5);
    // what is below the fold appears when it is scrolled to; after the safety time nothing is hidden anyway
    const dimmed = () => p2.evaluate(() => [].filter.call(document.querySelectorAll('#view > *'), (e) => parseFloat(getComputedStyle(e).opacity) < 1).length);
    await p2.setViewportSize({ width: 1280, height: 300 }); // a short window: the page is taller than it (the Home is short on purpose)
    await p2.waitForTimeout(200);
    const alto = await p2.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < alto; y += 400) { await p2.mouse.move(640, 200); await p2.mouse.wheel(0, 400); await p2.waitForTimeout(160); }
    await p2.waitForTimeout(1500);
    const corsa = await p2.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    assert.ok(corsa > 100, 'the page is taller than the window: ' + corsa + 'px');
    assert.ok(await p2.evaluate(() => window.scrollY) > corsa * 0.6, 'the wheel scrolls the page (smooth scroll on): ' + await p2.evaluate(() => window.scrollY) + ' of ' + corsa);
    assert.equal(await dimmed(), 0, 'after scrolling nothing is left dimmed');
    await p2.setViewportSize({ width: 1280, height: 860 });
    // other pages: the entrance plays, ends, and leaves no trace on the elements
    for (const h of ['allieve', 'analisi', 'scadenze', 'impostazioni', 'inizio']) {
      await vai2(h);
      // what is below the fold is dimmed until it is scrolled to: scroll to the end, then back
      await p2.evaluate(() => window.scrollTo(0, 1e6)); await p2.waitForTimeout(1400); await p2.evaluate(() => window.scrollTo(0, 0)); await p2.waitForTimeout(200);
      const resto = await p2.evaluate(() => [].filter.call(document.querySelectorAll('#view *'), (e) => e.style && (e.style.opacity !== '' || /blur/.test(e.style.filter || '') || (e.style.transform && !e.closest('svg') && !e.classList.contains('btn-magnete')))).map((e) => e.tagName + '.' + e.className).slice(0, 5));
      assert.deepEqual(resto, [], 'traces of the animation on ' + h);
    }
    // the three levels: full, reduced (only fades), off (nothing moves, no blur)
    await p2.evaluate(() => Aspetto.imposta({ movimento: 'ridotto' }));
    assert.deepEqual(await stato(), ['gsap', 'ridotto', false, false]);
    await vai2('allieve'); await vai2('inizio');
    assert.equal(await p2.locator('.od').count(), 0);
    await p2.evaluate(() => Aspetto.imposta({ stile: 'vetro' }));
    const sfocatura = () => p2.locator('.tile').first().evaluate((e) => getComputedStyle(e).backdropFilter);
    assert.notEqual(await sfocatura(), 'none', 'the glass style blurs what is behind it');
    await p2.evaluate(() => Aspetto.imposta({ movimento: 'spento' }));
    assert.deepEqual(await stato(), ['gsap', 'spento', false, false]);
    assert.equal(await sfocatura(), 'none', 'with the movement off the glass is not blurred');
    await p2.evaluate(() => Aspetto.imposta({ stile: 'sobrio' }));
    // "automatic" follows the system: reduce motion -> off; an explicit choice wins over the system
    await p2.evaluate(() => Aspetto.imposta({ movimento: 'auto' }));
    assert.equal((await stato())[1], 'ridotto', '"automatic" is the calm level');
    await p2.emulateMedia({ reducedMotion: 'reduce' });
    await p2.waitForFunction(() => document.documentElement.dataset.movimento === 'spento');
    assert.equal((await stato())[3], false);
    await p2.evaluate(() => Aspetto.imposta({ movimento: 'pieno' }));
    assert.equal((await stato())[1], 'pieno', 'an explicit choice wins over the system');
    await p2.emulateMedia({ reducedMotion: 'no-preference' });
    await p2.evaluate(() => Aspetto.imposta({ movimento: 'auto' }));
    await vai2('inizio');
    await shot('movimento', false);
  });

  await step('readability measured on the pixels: every text against what is really behind it (glass, gradients, chips, charts)', async () => {
    const { leggibilita } = require('./leggibilita.js');
    const bassi = []; let testi = 0;
    await p2.evaluate(() => { Aspetto.imposta({ movimento: 'pieno' }); localStorage.setItem('gymart-anteprime', '0'); localStorage.setItem('gymart-anteprime-ritardo', '300'); }); // the most demanding case: entrance with blur, glass. The previews of the hover are off (they would appear in the middle of a measure) and measured on their own below
    for (const st of ['sobrio', 'club', 'morbido', 'vetro']) for (const sc of ['chiaro', 'scuro']) {
      await p2.evaluate(([s, t]) => Aspetto.imposta({ stile: s, tema: t }), [st, sc]);
      for (const h of ['inizio', 'allieve', 'analisi', 'scadenze', 'certificati', 'impostazioni', 'altro']) {
        await vai2(h);
        const r = await leggibilita(p2);
        testi += r.controllati;
        r.problemi.forEach((x) => bassi.push(st + '/' + sc + ' #' + h + ': ' + x));
        // with the pointer over a row or a tile the hover colours are read as well
        const sopra = h === 'allieve' ? 'tbody tr.link' : h === 'inizio' ? 'a.tile' : null;
        if (sopra) {
          await p2.hover(sopra); await p2.waitForTimeout(350);
          const r2 = await leggibilita(p2);
          testi += r2.controllati;
          r2.problemi.forEach((x) => bassi.push(st + '/' + sc + ' #' + h + ' (puntatore sopra): ' + x));
          await p2.mouse.move(3, 3);
        }
        if (h === 'inizio' || h === 'allieve') { // the preview that opens when the pointer stops on something: its texts, and the page around it
          await p2.evaluate(() => localStorage.setItem('gymart-anteprime', '1'));
          await p2.hover(h === 'allieve' ? 'tbody tr.link' : 'a.tile'); await p2.waitForSelector('.anteprima'); await p2.waitForTimeout(400);
          const r3 = await leggibilita(p2);
          testi += r3.controllati;
          r3.problemi.forEach((x) => bassi.push(st + '/' + sc + ' #' + h + ' (anteprima aperta): ' + x));
          if (r3.problemi.length) { // what is on top at the first spot, and a picture: so that the cause can be seen
            const m = /\(a (\d+),(\d+),/.exec(r3.problemi[0]);
            if (m) bassi.push('   pila: ' + await p2.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 5).map((e) => e.tagName + '.' + String(e.className).slice(0, 40)).join(' > '), [+m[1], +m[2]]));
            await p2.screenshot({ path: path.join(OUT, 'win-leggibilita-' + st + '-' + sc + '-anteprima.png') });
          }
          await p2.mouse.move(3, 3); await p2.waitForFunction(() => !document.querySelector('.anteprima'));
          await p2.evaluate(() => localStorage.setItem('gymart-anteprime', '0'));
        }
      }
      // the search box with its list open: the quick list (empty box) and a search with one result chosen
      await vai2('inizio');
      for (const testo of ['', 'pag']) {
        await p2.click('#cerca'); if (testo) await p2.keyboard.type(testo);
        await p2.waitForFunction((t) => document.getElementById('cerca-ris').hidden === false && (t ? /Incassi e ricevute/.test(document.getElementById('cerca-ris').textContent) : !!document.querySelector('#cerca-ris .cerca-gruppo')), testo);
        const r4 = await leggibilita(p2);
        testi += r4.controllati;
        r4.problemi.forEach((x) => bassi.push(st + '/' + sc + ' (ricerca aperta' + (testo ? ' con "' + testo + '"' : '') + '): ' + x));
        await p2.keyboard.press('Escape');
      }
    }
    await p2.evaluate(() => { Aspetto.imposta({ stile: 'sobrio', tema: 'auto', movimento: 'auto' }); localStorage.removeItem('gymart-anteprime'); localStorage.removeItem('gymart-anteprime-ritardo'); });
    assert.ok(testi > 800, 'the texts were found: ' + testi);
    assert.deepEqual(bassi, [], 'text that is hard to read:\n' + bassi.slice(0, 8).join('\n'));
    await p2.close(); await ctx2.close(); ctx2 = null; p2 = null; // the page says goodbye to the program (otherwise it would think a window is still open)
  });

  await step('menu: quick search (Ctrl+K), keys, no HTML from what is typed, narrow menu remembered', async () => {
    await go('inizio');
    await pg.keyboard.press('Control+k');
    assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.id), 'cerca');
    await pg.keyboard.type('Del Bosco');
    await pg.waitForFunction(() => document.getElementById('cerca-ris').textContent.includes('Del Bosco Giulia')); // the empty box shows the quick list: wait for the result of the search
    assert.ok((await pg.textContent('#cerca-ris')).includes('Del Bosco Giulia'));
    assert.equal(await pg.locator('#cerca-ris .cerca-gruppo').count(), 0, 'a name is not a section: only students are listed');
    assert.equal(await pg.locator('#cerca').getAttribute('aria-expanded'), 'true');
    await pg.keyboard.press('Enter');
    await pg.waitForSelector('#view h1:has-text("Del Bosco Giulia")');
    assert.equal(await pg.evaluate(() => location.hash), '#allieva/0001');
    // nothing found, then a text that looks like HTML: it is only text
    await pg.keyboard.press('Control+k');
    await pg.keyboard.type('zzzzqq');
    await pg.waitForFunction(() => document.getElementById('cerca-ris').textContent.includes('Nessun risultato.'));
    await pg.keyboard.press('Control+a'); await pg.keyboard.type('<img src=x onerror=window.__xss2=1>');
    await pg.waitForTimeout(200);
    assert.equal(await pg.locator('#cerca-ris img').count(), 0);
    assert.equal(await pg.evaluate(() => window.__xss2), undefined);
    await pg.keyboard.press('Escape');
    assert.equal(await pg.locator('#cerca-ris').isVisible(), false);
    assert.equal(await pg.inputValue('#cerca'), '');
    // the box also knows the sections and their subsections: the quick list when it is empty, then a search for them; the arrows choose
    await pg.keyboard.press('Control+k');
    await pg.waitForSelector('#cerca-ris .cerca-gruppo');
    const lista = await pg.$$eval('#cerca-ris a[role=option]', (e) => e.map((x) => x.querySelector('b').textContent));
    for (const t of ['Allieve', 'Iscrizioni', 'Nuova iscrizione', 'Pagamenti', 'Da incassare', 'Bonifici da verificare', 'Scadenze', 'Abbonamenti scaduti', 'Certificati mancanti', 'Promemoria in blocco', 'Altro', 'Corsi', 'Impostazioni', 'Manuale', 'Visita guidata (tutorial)']) assert.ok(lista.includes(t), t + ' is in the quick list: ' + lista.join(', '));
    assert.equal(await pg.locator('#cerca-ris a[aria-selected="true"]').count(), 0, 'nothing is chosen until an arrow is pressed');
    const prima = await pg.evaluate(() => location.hash);
    await pg.keyboard.press('Enter');
    assert.equal(await pg.evaluate(() => location.hash), prima, 'Enter on the empty box opens nothing');
    await pg.keyboard.type('verifica');
    await pg.waitForFunction(() => /Bonifici da verificare/.test(document.getElementById('cerca-ris').textContent) && !document.querySelector('#cerca-ris .cerca-testa')); // the list of sections has headers, the result of a search has none
    assert.ok((await pg.locator('#cerca-ris a[role=option]').first().innerText()).includes('Bonifici da verificare'));
    await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => location.hash === '#pagamenti/verifica');
    await pg.waitForSelector('#view h1:has-text("Pagamenti")');
    await pg.keyboard.press('Control+k'); await pg.keyboard.type('pag');
    await pg.waitForFunction(() => /Incassi e ricevute/.test(document.getElementById('cerca-ris').textContent) && !document.querySelector('#cerca-ris .cerca-testa'));
    await pg.keyboard.press('ArrowDown');
    assert.equal(await pg.locator('#cerca-ris a[aria-selected="true"] b').innerText(), 'Incassi e ricevute', 'the arrow moves the choice');
    await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => location.hash === '#pagamenti/incassi'); // the one chosen with the arrow, not the first
    await pg.keyboard.press('Control+k'); await pg.keyboard.type('backup');
    await pg.waitForFunction(() => /Copie di sicurezza/.test(document.getElementById('cerca-ris').textContent));
    await pg.keyboard.press('Enter');
    await pg.waitForFunction(() => location.hash === '#impostazioni/sicurezza');
    await pg.waitForSelector('details.gruppo[data-sez="sicurezza"][open]');
    await pg.keyboard.press('Control+k'); await pg.keyboard.type('excel');
    await pg.waitForFunction(() => /Importa dal file Excel/.test(document.getElementById('cerca-ris').textContent) && /Esporta per Excel/.test(document.getElementById('cerca-ris').textContent));
    await pg.keyboard.press('Escape');
    // many matches: "see all" takes the text to the list of students
    await pg.keyboard.press('Control+k'); await pg.keyboard.type('a');
    await pg.keyboard.press('Control+a'); await pg.keyboard.type('Ro');
    await pg.waitForTimeout(250);
    // the button that narrows the menu: icons only, remembered, and the shortcut still works
    const larg = () => pg.locator('.side').evaluate((e) => Math.round(e.getBoundingClientRect().width));
    assert.ok(await larg() > 200);
    await pg.keyboard.press('Escape');
    await pg.locator('#side-toggle').click();
    await pg.waitForFunction(() => document.querySelector('.side').getBoundingClientRect().width < 140);
    assert.equal(await pg.evaluate(() => localStorage.getItem('gymart-menu')), 'stretto');
    assert.equal(await pg.locator('#side-toggle').getAttribute('aria-label'), 'Allarga il menu');
    assert.equal(await pg.locator('#cerca-box').isVisible(), false, 'the search box is hidden in the narrow menu');
    await pg.reload(); await pg.waitForSelector('#view h1');
    assert.ok(await larg() < 140, 'the narrow menu survives a reload');
    await pg.keyboard.press('Control+k');
    await pg.waitForFunction(() => location.hash === '#allieve');
    await pg.waitForFunction(() => document.activeElement && document.activeElement.type === 'search');
    await pg.locator('#side-toggle').click();
    await pg.waitForFunction(() => document.querySelector('.side').getBoundingClientRect().width > 200);
    assert.equal(await pg.evaluate(() => localStorage.getItem('gymart-menu')), 'esteso');
    assert.equal(await pg.locator('#tabs a[aria-current="page"] span').first().innerText(), 'Allieve');
    await go('inizio');
  });

  await step('very long words (e-mail, a text without spaces) break instead of widening the page, on a phone and on a computer', async () => {
    const lungo = 'x'.repeat(3000);
    await pg.evaluate((x) => { // only in the page (nothing is saved): every text field of the people and the enrollments gets a very long word
      S.db.allieve.forEach((a) => { ['name', 'genitore', 'indirizzo', 'citta', 'note', 'email'].forEach((k) => { a[k] = x; }); });
      S.db.iscrizioni.forEach((e) => { e.note = x; e.corso = x; });
    }, lungo);
    const guai = [];
    for (const [w, h] of [[390, 844], [768, 1000], [1280, 860]]) {
      await pg.setViewportSize({ width: w, height: h });
      for (const hash of ['inizio', 'allieve', 'iscrizioni', 'corsi', 'scadenze', 'certificati', 'promemoria', 'pagamenti', 'analisi', 'allieva/0001', 'iscrizione/0001']) {
        await go(hash);
        const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (over > 1) guai.push(w + ' #' + hash + ': ' + over + 'px');
      }
    }
    await pg.setViewportSize({ width: 1280, height: 860 });
    await pg.evaluate(() => { S.dirty = false; return load(); }); // back to what is on disk
    await go('inizio');
    assert.deepEqual(guai, [], 'a long word makes the page wider');
    assert.equal((await tiles()).Allieve, 3, 'the real archive is untouched');
  });

  await step('simple by default: only the essential fields, the rest under "Altri dati"; "Dettaglio" opens everything; a calm Home and Settings', async () => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'it-IT', reducedMotion: 'reduce' }); // no "everything open" switch here
    await c3.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); } catch (e) {} });
    await c3.addCookies(await ctx.cookies());
    const p3 = await c3.newPage(); watch(p3);
    await p3.goto(app.url); await p3.waitForSelector('.tile');
    assert.equal(await p3.evaluate(() => document.documentElement.dataset.stile), 'sobrio', 'a new device gets the plain style');
    assert.deepEqual(await p3.$$eval('#tabs a', (e) => e.length), 8, 'eight entries in the menu');
    const campi = (sel) => p3.$$eval(sel + ' input:not([type=hidden]):not([type=checkbox]), ' + sel + ' select, ' + sel + ' textarea', (els) => els.filter((e) => (e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null)).map((e) => (e.labels && e.labels[0] ? e.labels[0].textContent : e.id))); // a closed "details" keeps boxes: checkVisibility knows they are not shown
    // new student: four fields
    await p3.goto(app.url + '#allieva/nuova'); await p3.waitForSelector('h1:has-text("Nuova allieva")');
    assert.deepEqual(await campi('#view form'), ['Cognome e Nome', 'Data di nascita', 'Telefono', 'Genitore / Referente']);
    assert.equal(await p3.locator('details.altri').first().getAttribute('open'), null, 'the optional data are closed');
    assert.ok((await p3.textContent('details.altri summary')).includes('Altri dati'));
    // nothing to correct about an empty name until she tries to save; then the message is about the name, not about hidden fields
    await p3.getByRole('button', { name: 'Salva la nuova allieva' }).click();
    await p3.waitForSelector('.note-bad');
    assert.ok((await p3.textContent('.note-bad')).includes('cognome e nome'));
    assert.equal(await p3.locator('details.altri').first().getAttribute('open'), null, 'an error about the name does not open the optional data');
    // the optional data open with a click (and the fields are there)
    await p3.locator('details.altri summary').first().click();
    const tutti = await campi('#view form');
    assert.ok(tutti.length >= 15 && tutti.includes('Codice fiscale') && tutti.includes('Email') && tutti.includes('Indirizzo'), 'optional fields: ' + tutti.join(', '));
    // a wrong optional field opens the section by itself
    await p3.reload(); await p3.waitForSelector('h1:has-text("Nuova allieva")');
    await p3.getByLabel('Cognome e Nome', { exact: true }).fill('Rossi Maria');
    await p3.locator('details.altri summary').first().click();
    await p3.getByLabel('CAP', { exact: true }).fill('12');
    await p3.locator('details.altri summary').first().click(); // closed again, on purpose
    assert.equal(await p3.locator('details.altri').first().getAttribute('open'), null);
    await p3.getByLabel('Cognome e Nome', { exact: true }).fill('Rossi Maria Luisa'); // any change checks the form again
    await p3.waitForSelector('.note-bad');
    assert.notEqual(await p3.locator('details.altri').first().getAttribute('open'), null, 'an error in an optional field opens the section');
    // new enrollment: allieva, corso, tipo, giorni, inizio
    await p3.evaluate(() => { S.dirty = false; location.hash = 'iscrizione/nuova'; }); await p3.waitForSelector('h1:has-text("Nuova iscrizione")');
    assert.deepEqual(await campi('#view form'), ['Allieva', 'Cognome e Nome', 'Data di nascita', 'Telefono', 'Genitore / Referente', 'Corso', 'Tipo abbonamento', 'Data inizio', 'Il certificato medico']);
    assert.equal(await p3.locator('details.altri').first().getAttribute('open'), null);
    // payment: three fields, the note is optional
    await p3.evaluate(() => { S.dirty = false; location.hash = 'iscrizione/0001'; }); await p3.waitForSelector('#pagamenti');
    assert.deepEqual(await campi('#pagamenti'), ['Data del pagamento', 'Importo', 'Metodo']);
    await p3.locator('#pagamenti details.altri summary').click();
    assert.ok((await campi('#pagamenti')).includes('Note del pagamento'));
    // lists: the main columns; "Dettaglio" adds the others and opens every optional section
    await p3.evaluate(() => { S.dirty = false; location.hash = 'allieve'; }); await p3.waitForSelector('thead');
    const colonne = () => p3.$$eval('thead th', (t) => t.map((x) => x.textContent.trim()).filter(Boolean));
    const base = await colonne();
    assert.ok(!base.includes('Email') && !base.includes('Genitore / Referente') && base.length <= 6, 'main columns: ' + base.join(', '));
    await p3.evaluate(() => { S.dirty = false; location.hash = 'iscrizioni'; }); await p3.waitForSelector('thead');
    const baseIsc = await colonne();
    assert.ok(baseIsc.length <= 7 && !baseIsc.includes('Fascia') && !baseIsc.includes('Giorni'), 'main columns: ' + baseIsc.join(', '));
    await p3.locator('#det').click();
    assert.ok((await colonne()).includes('Fascia') && (await colonne()).includes('Giorni'), '"Dettaglio" shows the other columns');
    await p3.evaluate(() => { S.dirty = false; location.hash = 'allieva/nuova'; }); await p3.waitForSelector('h1:has-text("Nuova allieva")');
    assert.notEqual(await p3.locator('details.altri').first().getAttribute('open'), null, '"Dettaglio" opens the optional data');
    await p3.locator('#det').click(); // back to simple
    // Home: no "to do" tile at zero; Settings: closed groups
    await p3.evaluate(() => { S.dirty = false; location.hash = 'inizio'; }); await p3.waitForSelector('.tile');
    const tess = await p3.$$eval('.tile', (ts) => ts.map((t) => t.querySelector('b').textContent.trim()));
    assert.ok(!tess.includes('0'), 'a tile at zero is not shown: ' + tess.join(', '));
    assert.ok(await p3.locator('#view > *').count() < 14, 'the Home has few blocks');
    await p3.evaluate(() => { S.dirty = false; location.hash = 'impostazioni/aspetto'; }); await p3.waitForSelector('details.gruppo');
    assert.equal(await p3.locator('details.gruppo[open]').count(), 1, 'the address of a group opens only that group');
    assert.equal(await p3.locator('details.gruppo[open]').getAttribute('data-sez'), 'aspetto');
    await p3.evaluate(() => { S.dirty = false; location.hash = 'impostazioni'; }); await p3.waitForSelector('details.gruppo');
    assert.ok(await p3.locator('details.gruppo').count() >= 6);
    assert.equal(await p3.locator('details.gruppo[open]').count(), 0, 'the settings groups are closed');
    await p3.locator('details.gruppo summary').first().click();
    assert.equal(await p3.locator('details.gruppo[open]').count(), 1);
    await p3.evaluate(() => { S.dirty = false; }); await p3.close(); await c3.close();
  });

  await step('deadlines: the lists are gathered in tabs, one at a time, ten rows and "Mostra tutte", fewer on a phone', async () => {
    await go('inizio');
    const prima = await pg.evaluate(() => L.scadenze(S.db, today()).scadute.length); // what is already expired in this archive
    await pg.evaluate(() => { // only in the page (nothing is saved): twelve more students with an expired subscription and no certificate
      const a0 = S.db.allieve[0], e0 = S.db.iscrizioni[S.db.iscrizioni.length - 1];
      for (let i = 0; i < 12; i++) {
        const id = '90' + String(i).padStart(2, '0');
        S.db.allieve.push(Object.assign({}, a0, { id, name: 'Prova' + i + ' Scaduta', archiviata: false, certTipo: '', certRilascio: '', certScadenza: '' }));
        S.db.iscrizioni.push(Object.assign({}, e0, { id, allievaId: id, inizio: '2026-01-05', tipo: 'Mensile', storica: false, annullata: false }));
      }
    });
    const N = prima + 12;
    await go('scadenze');
    const abb = pg.getByRole('tab', { name: /^Abbonamenti scaduti/ });
    assert.equal(await abb.getAttribute('aria-selected'), 'true', 'the first tab with something is open');
    assert.equal((await abb.textContent()).replace(/\s+/g, ' ').trim(), 'Scaduti ' + N);
    assert.ok(await pg.getByRole('tab').count() >= 2, 'tabs for the lists that have something');
    const righe = () => pg.locator('#scad-pannello .list-item').count();
    assert.equal(await righe(), 10, 'ten rows at first');
    await pg.getByRole('button', { name: 'Mostra tutte (' + N + ')' }).click();
    assert.equal(await righe(), N);
    await pg.getByRole('button', { name: 'Mostra solo le prime 10' }).click();
    assert.equal(await righe(), 10);
    // another tab: one list at a time, the open one is marked, the arrows move between the tabs, the focus stays on the tab
    await pg.getByRole('tab', { name: /^Certificati mancanti/ }).click();
    assert.equal(await abb.getAttribute('aria-selected'), 'false');
    assert.ok(await pg.locator('#scad-pannello .list-item:has-text("Manca")').count() > 0 && await pg.locator('#scad-pannello .list-item:has-text("Scaduto da")').count() === 0, 'the other list is shown, not this one');
    await pg.getByRole('tab', { name: /^Abbonamenti scaduti/ }).click();
    assert.equal(await righe(), 10, 'the rows are the first ten again');
    await pg.keyboard.press('ArrowRight');
    assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('role')), 'tab', 'the focus stays on a tab');
    assert.equal(await abb.getAttribute('aria-selected'), 'false', 'the arrow opened the next tab');
    await pg.keyboard.press('ArrowLeft');
    assert.equal(await abb.getAttribute('aria-selected'), 'true');
    // a link from the Home opens the right tab; a plain visit starts again from the first
    await pg.evaluate(() => { location.hash = 'scadenze/cert-mancanti'; });
    await pg.waitForSelector('[role=tab][aria-selected=true]:has-text("Mancanti")');
    await pg.evaluate(() => { location.hash = 'inizio'; }); await pg.waitForSelector('#view h1:has-text("Inizio")');
    await go('scadenze');
    assert.equal(await pg.getByRole('tab', { name: /^Abbonamenti scaduti/ }).getAttribute('aria-selected'), 'true');
    // phone: the rows are short and only six at first
    await pg.setViewportSize({ width: 390, height: 844 });
    await go('inizio'); await go('scadenze'); // the page is drawn again with the narrow window (setting the same address would not draw it)
    assert.equal(await righe(), 6, 'six rows at first on a phone');
    const alta = (await pg.locator('#scad-pannello .list-item').first().boundingBox()).height;
    assert.ok(alta < 170, 'a row is short: ' + alta + 'px');
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await pg.setViewportSize({ width: 1280, height: 860 });
    await pg.evaluate(() => { S.dirty = false; return load(); }); // back to what is on disk
    await go('inizio');
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
    // one at a time: the first person, "Salta" to the next, the last one has no "next"; nobody is marked
    const coda = await pg.getByRole('button', { name: /^Avvisa uno alla volta \(\d+\)$/ }).innerText(), nCoda = +/\d+/.exec(coda)[0];
    assert.ok(nCoda >= 2, coda);
    await pg.getByRole('button', { name: /^Avvisa uno alla volta/ }).click();
    const uno = pg.locator('dialog.modale'); await uno.waitFor();
    assert.ok((await uno.textContent()).includes('Dopo questo: ' + (nCoda - 1) + ' altr') && await uno.getByRole('link', { name: 'Apri WhatsApp e passa al prossimo' }).count() === 1, await uno.textContent());
    const nomePrimo = await uno.locator('b').first().innerText();
    await uno.getByRole('button', { name: 'Salta' }).click();
    await pg.waitForFunction((n) => { const d = document.querySelector('dialog.modale'); return d && d.querySelector('b') && d.querySelector('b').textContent !== n; }, nomePrimo);
    await pg.locator('dialog.modale').getByRole('button', { name: nCoda > 2 ? 'Ferma' : 'Annulla' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    assert.equal((readArchive().db.promemoria || []).length, 0, 'skipping marks nobody');
    // search, then the message in the link
    await pg.locator('#view input[type=search]').fill('Del Bosco');
    await pg.waitForFunction(() => document.querySelectorAll('.list-item').length === 1 || (document.querySelectorAll('.list-item').length > 0 && [].every.call(document.querySelectorAll('.list-item'), (i) => i.textContent.includes('Del Bosco'))));
    const riga = pg.locator('.list-item', { hasText: 'Certificato' }).first();
    assert.ok((await riga.textContent()).includes('Da contattare'));
    await shot('promemoria', true);
    await riga.getByRole('button', { name: 'Avvisa', exact: true }).click();
    const dlg = pg.locator('dialog.modale'); await dlg.waitFor();
    const wa = dlg.getByRole('link', { name: 'Apri WhatsApp' }), href = await wa.getAttribute('href');
    assert.ok(href.startsWith('https://wa.me/393470001122?text=') && href.includes(encodeURIComponent('il certificato medico di Del Bosco Giulia')), href);
    // opening the chat opens WhatsApp in another tab and notes the contact; nothing is sent by the program
    const [pop] = await Promise.all([ctx.waitForEvent('page'), wa.click()]);
    await pop.close();
    await toast('Segnata come contattata.');
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
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
    await pg.locator('#view input[type=search]').fill('Cappelletti');
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
    assert.deepEqual(fs.readdirSync(DATI).filter((f) => !f.startsWith('rete')).sort(), ['archivio.json', 'copie', 'giornaliere', 'impostazioni-pc.json', 'registro.jsonl']); // rete*: settings and certificate of the phone access
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

  await step('data safety: daily snapshots with the log, checks, restore from the list, a damaged archive is put back at start', async () => {
    const giorn = path.join(DATI, 'giornaliere'), dirs = fs.readdirSync(giorn);
    assert.ok(dirs.length >= 1 && dirs.every((d) => /^\d{4}-\d{2}-\d{2}(-\d{6})?$/.test(d)), String(dirs));
    const man = JSON.parse(fs.readFileSync(path.join(giorn, dirs[0], 'MANIFEST.json'), 'utf8'));
    assert.equal(man.archivioSha256.length, 64);
    assert.ok(fs.existsSync(path.join(giorn, dirs[0], 'registro.jsonl')), 'the change log is in the snapshot');
    assert.ok(fs.readFileSync(path.join(CHIAVETTA, 'ultima', 'registro.jsonl'), 'utf8').length > 0, 'and in the second folder');
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    const prima = readArchive().db;
    assert.equal(await pg.locator('.note-bad').count(), 0, 'with a second folder that works there is nothing to warn about');
    await go('impostazioni');
    const sic = pg.locator('.card', { hasText: 'Sicurezza dei dati' }).first();
    assert.ok((await sic.textContent()).includes('Copia di oggi fatta e controllata'));
    await shot('sicurezza', true);
    // every copy is read back, here and in the second folder
    await sic.getByRole('button', { name: 'Controlla tutte le copie' }).click();
    await sic.locator('.note-ok').first().waitFor();
    const esito = await sic.textContent();
    assert.ok(esito.includes('tutte integre') && esito.includes('Nella seconda cartella'), esito.slice(-300));
    await sic.getByRole('button', { name: 'Fai una copia ora' }).click();
    await toast('Copia fatta e controllata.');
    // the list of copies, and a restore: first a copy of what is there, then the archive of that day
    await sic.getByText('Elenco delle copie giornaliere e ripristino').click();
    const righe = sic.locator('table tbody tr');
    await righe.first().waitFor();
    assert.ok(await righe.count() >= 2);
    const copieP = fs.readdirSync(path.join(DATI, 'copie')).length;
    await righe.first().getByRole('button', { name: /Ripristina/ }).click();
    await toast('Archivio ripristinato.');
    assert.deepEqual(readArchive().db.allieve.length, prima.allieve.length);
    assert.ok(fs.readdirSync(path.join(DATI, 'copie')).length > copieP, 'a restore makes a copy of the current archive first');
    await go('registro');
    await pg.waitForFunction(() => document.querySelector('#view table'));
    assert.ok((await pg.textContent('#view table')).includes('Ripristino da copia'));
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);

    // the archive is damaged (cut in the middle, as after a power cut): the program starts anyway and puts back the newest good copy
    const rotto = '{"rev": 99, "salvato": "x", "db": {"allieve": [{"id":"00';
    fs.writeFileSync(path.join(DATI, 'archivio.json'), rotto);
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    assert.equal((await tiles()).Allieve, prima.allieve.length, 'the students are all there');
    const avviso = await pg.textContent('.note-bad');
    assert.ok(avviso.includes('danneggiato ed è stato rimesso da una copia') && avviso.includes('archivio.json.danneggiato-'), avviso);
    const tenuto = fs.readdirSync(DATI).filter((f) => f.startsWith('archivio.json.danneggiato-'));
    assert.equal(tenuto.length, 1);
    assert.equal(fs.readFileSync(path.join(DATI, tenuto[0]), 'utf8'), rotto, 'the damaged file is kept untouched');
    await shot('recupero');
    await pg.getByRole('button', { name: 'Ho letto' }).click();
    await pg.waitForFunction(() => !document.querySelector('.note-bad'));
    assert.ok(!fs.existsSync(path.join(DATI, 'recupero.json')));
    await go('registro');
    await pg.waitForFunction(() => document.querySelector('#view table'));
    assert.ok((await pg.textContent('#view table')).includes('Recupero automatico'));
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await step('one entry for a new person: "Nuova iscrizione" saves the student and her enrollment together; no repeated buttons', async () => {
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    const prima = readArchive().db, nA = prima.allieve.length, nI = prima.iscrizioni.length;
    // one button for what is new, always in the top bar, never repeated in the page; no separate "new student"
    for (const h of ['inizio', 'allieve', 'iscrizioni', 'pagamenti', 'scadenze']) {
      await go(h);
      assert.equal(await pg.getByRole('link', { name: /^Nuova (allieva|iscrizione)$/ }).count(), 1, 'one "new" button on #' + h);
      assert.equal(await pg.locator('#nuova').isVisible(), true);
    }
    assert.equal(await pg.getByRole('link', { name: 'Nuova allieva' }).count(), 0, 'no separate "new student" button');
    await go('inizio'); assert.equal(await pg.locator('#det').isVisible(), false, '"Dettaglio" is not shown where it changes nothing');
    await go('allieve'); assert.equal(await pg.locator('#det').isVisible(), true);
    // the new student and the enrollment in one form
    await pg.locator('#nuova').click(); await pg.waitForSelector('h1:has-text("Nuova iscrizione")');
    assert.equal(await pg.locator('.note').count(), 0, 'no reproach before typing');
    await lab('Cognome e Nome').fill('bianchi sara'); await lab('Data di nascita').fill('2015-05-06'); await lab('Telefono').fill('333 222 3344'); await lab('Genitore / Referente').fill('bianchi marco');
    assert.ok(await pg.getByRole('button', { name: 'Salva solo l\'allieva' }).isVisible(), 'nothing written about the enrollment yet: only the student would be saved');
    await lab('Corso').selectOption('Base'); await pg.getByLabel('Mar', { exact: true }).check(); await pg.getByLabel('Gio', { exact: true }).check();
    await lab('Tipo abbonamento').selectOption('Mensile'); await lab('Data inizio').fill(TODAY);
    await shot('nuova-iscrizione-unica', true);
    await pg.getByRole('button', { name: 'Salva allieva e iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    await toast('Allieva e iscrizione salvate.');
    let arch = readArchive().db; const a = arch.allieve[arch.allieve.length - 1], e = arch.iscrizioni[arch.iscrizioni.length - 1];
    assert.deepEqual([arch.allieve.length, arch.iscrizioni.length], [nA + 1, nI + 1]);
    assert.deepEqual([a.name, a.tel, a.genitore, a.privacy, e.allievaId, e.corso, e.giorni, e.tipo], ['Bianchi Sara', '3332223344', 'Bianchi Marco', 'Sì', a.id, 'Base', ['Mar', 'Gio'], 'Mensile']);
    assert.ok((await pg.textContent('h1')).includes('Iscrizione n. ' + e.id), 'it lands on the enrollment, where the payment is registered');
    const reg = fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(reg.some((r) => r.operazione === 'Nuova allieva' && r.allieva === 'Bianchi Sara') && reg.some((r) => r.operazione === 'Nuova iscrizione' && r.allieva === 'Bianchi Sara'), 'both are in the log');
    // an error in the student's data stops the save and says what to correct
    await pg.locator('#nuova').click(); await pg.waitForSelector('h1:has-text("Nuova iscrizione")');
    await lab('Cognome e Nome').fill('neri luca'); await lab('Telefono').fill('12');
    await pg.waitForSelector('.note-bad'); // the wrong phone is reported while typing, and saving is blocked until it is corrected
    assert.ok((await pg.textContent('.note-bad')).toLowerCase().includes('telefono'), await pg.textContent('.note-bad'));
    assert.equal(await pg.getByRole('button', { name: 'Salva solo l\'allieva' }).isDisabled(), true);
    assert.equal(readArchive().db.allieve.length, nA + 1, 'nothing was saved');
    // only the student: the enrollment is left empty
    await lab('Telefono').fill('333 444 5566');
    await pg.getByRole('button', { name: 'Salva solo l\'allieva' }).click();
    await pg.waitForFunction(() => /^#allieva\/\d{4}$/.test(location.hash));
    assert.deepEqual([readArchive().db.allieve.length, readArchive().db.iscrizioni.length], [nA + 2, nI + 1], 'a student without an enrollment');
    // an existing student: the fields of a new one go away, the enrollment is required, then it is saved for her
    await pg.locator('#nuova').click(); await pg.waitForSelector('h1:has-text("Nuova iscrizione")');
    await lab('Allieva').selectOption(a.id);
    assert.equal(await lab('Cognome e Nome').isVisible(), false);
    await pg.getByRole('button', { name: 'Salva l\'iscrizione' }).click();
    await pg.waitForSelector('.note-bad'); assert.ok((await pg.textContent('.note-bad')).includes('Scegli il corso'));
    await lab('Corso').selectOption('Propedeutico'); await lab('Tipo abbonamento').selectOption('Mensile');
    await pg.getByRole('button', { name: 'Salva l\'iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    arch = readArchive().db;
    assert.deepEqual([arch.allieve.length, arch.iscrizioni.length, arch.iscrizioni[arch.iscrizioni.length - 1].allievaId], [nA + 2, nI + 2, a.id], 'a second enrollment for the same student');
    await pg.evaluate(() => { S.dirty = false; });
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await step('medical certificate: scan (fake scanner), file or photo, type and dates, document on disk, the type always in view', async () => {
    // an invented certificate drawn here: a JPEG for the fake scanner and a PNG for the chosen file
    const gen = await ctx.newPage();
    const url = await gen.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 600; cv.height = 800; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 800); x.fillStyle = '#123'; x.font = 'bold 36px sans-serif'; x.fillText('CERTIFICATO MEDICO (prova)', 30, 80); return cv.toDataURL('image/jpeg', 0.9); });
    const png = await gen.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 400; cv.getContext('2d').fillRect(10, 10, 100, 100); return cv.toDataURL('image/png'); });
    await gen.close();
    const scan = path.join(TMP, 'scansione.jpg'); fs.writeFileSync(scan, Buffer.from(url.split(',')[1], 'base64'));
    app = await start({ GYMART_SCANNER_PROVA: scan });
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    const docs = () => (fs.existsSync(path.join(DATI, 'documenti')) ? fs.readdirSync(path.join(DATI, 'documenti')) : []).filter((f) => !f.endsWith('.tmp'));
    const dlg = () => pg.locator('dialog.modale');
    const dl = (t) => dlg().getByLabel(t, { exact: true });
    const id = readArchive().db.allieve.find((x) => x.name === 'Del Bosco Giulia').id;
    await go('allieva/' + id); await pg.waitForSelector('#certificato');
    const card = pg.locator('#certificato');
    assert.deepEqual(await card.locator('.btn').allInnerTexts(), ['Scansiona', 'Allega un file', 'Solo i dati'], 'with a scanner: scan, choose a file or write only the data (no camera button on a computer without touch)');
    // scan: the window of the scanner is the fake one, the result is the file; the data are asked, the expiry is proposed one year on
    await card.getByRole('button', { name: 'Scansiona' }).click();
    await dlg().waitFor();
    assert.equal(await dlg().locator('img.doc-anteprima').count(), 1, 'a preview of the scan');
    assert.equal(docs().length, 1, 'the scan is already a file on disk');
    await dl('Tipo di certificato').selectOption(''); // the student already has a type: it is proposed; here it is taken away to see that one is required
    await dlg().getByRole('button', { name: 'Salva il certificato' }).click();
    await dlg().locator('.note-bad').waitFor();
    const errori = await dlg().locator('.note-bad').textContent();
    assert.ok(errori.includes('Scegli il tipo') && errori.includes('rilascio'), 'a type and the dates are required: ' + errori);
    await dl('Tipo di certificato').selectOption('Agonistico'); await dl('Data di rilascio').fill('2026-10-05');
    assert.equal(await dl('Scadenza').inputValue(), '2027-10-05', 'the expiry is proposed one year after');
    await dlg().getByRole('button', { name: 'Salva il certificato' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    await toast('Certificato salvato.');
    let arch = readArchive().db, a = arch.allieve.find((x) => x.id === id);
    assert.deepEqual([a.certTipo, a.certRilascio, a.certScadenza], ['Agonistico', '2026-10-05', '2027-10-05'], 'the certificate of the student is the one of the document');
    assert.equal(arch.documenti.length, 1); const d = arch.documenti[0];
    assert.deepEqual([d.allievaId, d.tipo, d.certTipo, d.file.endsWith('.jpg'), docs().includes(d.file)], [id, 'certificato', 'Agonistico', true, true]);
    assert.equal(arch.prossimi.documento, 2);
    const reg = fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(reg.some((r) => r.operazione === 'Nuovo documento' && r.allieva === 'Del Bosco Giulia'), 'the document is in the log');
    // the type is in view: the header and the card show it, the list too
    assert.deepEqual(await pg.locator('#certificato .chip').allInnerTexts().then((t) => t.slice(0, 2)), ['Agonistico', 'Valido']);
    assert.equal(await pg.locator('.head-row .chip:has-text("Agonistico")').count(), 1);
    await go('allieve');
    assert.ok((await pg.textContent('tbody tr:has-text("Del Bosco Giulia")')).includes('Agonistico'), 'the type is in the list of students');
    // the document opens with the token in the address: right type, and the address alone (no token) is refused
    await go('allieva/' + id);
    const href = await pg.locator('#certificato .doc-lista a.name').getAttribute('href');
    const r1 = await pg.request.get(new URL(href, app.url).href); assert.equal(r1.status(), 200); assert.equal(r1.headers()['content-type'], 'image/jpeg');
    assert.equal((await pg.request.get(new URL(href.split('?')[0], app.url).href)).status(), 401, 'without the token the document is not served');
    // a file chosen (PNG) and then cancelled: nothing stays on disk
    await pg.locator('#cert-file').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await dlg().waitFor(); assert.equal(docs().length, 2);
    await dlg().getByRole('button', { name: 'Annulla' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    await pg.waitForFunction((n) => true, 0); await pg.waitForTimeout(400);
    assert.equal(docs().length, 1, 'a cancelled document leaves nothing on disk');
    // a file that is not allowed
    await pg.locator('#cert-file').setInputFiles({ name: 'prova.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') });
    await pg.waitForTimeout(400); assert.equal(await dlg().count(), 0); assert.equal(docs().length, 1);
    // a second document without touching the data of the student (the box is un-ticked)
    await pg.locator('#cert-file').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await dlg().waitFor();
    await dl('Tipo di certificato').selectOption('Non Agonistico'); await dl('Data di rilascio').fill('2026-10-20');
    await dlg().locator('input[type=checkbox]').uncheck();
    await dlg().getByRole('button', { name: 'Salva il certificato' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.modale'));
    await toast('Certificato salvato.');
    arch = readArchive().db; a = arch.allieve.find((x) => x.id === id);
    assert.deepEqual([arch.documenti.length, a.certTipo], [2, 'Agonistico'], 'the student keeps her certificate');
    assert.equal(await pg.locator('#certificato .doc-lista .list-item').count(), 2);
    // the page of the certificates: everybody with an open enrollment, the type, the filters, the document
    await go('certificati'); await pg.waitForSelector('#view table');
    assert.equal(await pg.locator('#tabs a[aria-current="page"] span').first().innerText(), 'Certificati');
    const riga = pg.locator('tbody tr:has-text("Del Bosco Giulia")');
    assert.ok((await riga.textContent()).includes('Agonistico') && (await riga.textContent()).includes('Valido') && (await riga.textContent()).includes('Apri'), await riga.textContent());
    await pg.getByRole('tab', { name: /^Agonistici/ }).click();
    assert.ok((await pg.textContent('tbody')).includes('Del Bosco Giulia'));
    await pg.getByRole('tab', { name: /^Non agonistici/ }).click();
    assert.ok(!(await pg.textContent('#view')).includes('Del Bosco Giulia') || (await pg.locator('tbody tr').count()) === 0, 'she is not among the non-agonistic ones');
    await pg.getByRole('tab', { name: /^Senza documento/ }).click();
    assert.ok(!(await pg.textContent('#view')).includes('Del Bosco Giulia'), 'she has a document');
    await pg.evaluate(() => { location.hash = 'certificati/agonistico'; }); await pg.waitForSelector('[role=tab][aria-selected=true]:has-text("Agonistici")');
    // the Home counts them, the quick search finds the page
    await go('inizio'); assert.equal((await tiles())['Certificati registrati'] >= 1, true);
    await pg.keyboard.press('Control+k'); await pg.keyboard.type('scanner');
    await pg.waitForFunction(() => /Certificati/.test(document.getElementById('cerca-ris').textContent) && !document.querySelector('#cerca-ris .cerca-testa'));
    await pg.keyboard.press('Escape');
    // delete: the card goes and so does the file
    await go('allieva/' + id);
    const primo = arch.documenti.map((x) => x.file);
    answer = true; dialogs = [];
    await pg.locator('#certificato .doc-lista .list-item').first().getByRole('button', { name: 'Elimina' }).click();
    await pg.waitForFunction(() => document.querySelectorAll('#certificato .doc-lista .list-item').length === 1);
    await pg.waitForTimeout(400);
    arch = readArchive().db;
    assert.equal(arch.documenti.length, 1); assert.equal(docs().length, 1); assert.ok(primo.includes(docs()[0]));
    assert.ok(dialogs.some((m) => m.includes('Eliminare questo documento')));
    // the file is in the second copy when the folder is set
    const chiave = path.join(TMP, 'chiavetta-doc');
    await pg.evaluate(async (dir) => { await api('POST', '/api/copie2', { cartella: dir }); }, chiave);
    await pg.evaluate(() => api('POST', '/api/copie2/adesso'));
    assert.deepEqual(fs.readdirSync(path.join(chiave, 'documenti')).filter((f) => !f.endsWith('.tmp')), docs(), 'the second folder has the documents too');
    await pg.evaluate(() => { S.dirty = false; });
  });

  await step('messages for the parents: six texts in Settings, an example under each, a wrong placeholder is refused, the default is not stored', async () => {
    await go('impostazioni/messaggi');
    const gruppo = pg.locator('details.gruppo[data-sez="messaggi"]'); await gruppo.waitFor();
    assert.equal(await gruppo.locator('textarea').count(), 6);
    assert.deepEqual(await gruppo.locator('textarea').evaluateAll((t) => t.map((x) => x.getAttribute('aria-label'))), ['Abbonamento in scadenza', 'Abbonamento scaduto', 'Certificato in scadenza', 'Certificato scaduto', 'Certificato da consegnare', 'Certificato mancante']);
    assert.ok((await gruppo.locator('.muted.small', { hasText: 'Esempio:' }).first().textContent()).includes('Rossi Maria'), 'an example with an invented student under the text');
    const scaduto = pg.getByLabel('Abbonamento scaduto', { exact: true });
    assert.match(await scaduto.inputValue(), /^\{saluto\}, l'abbonamento \{tipo\} di \{nome\} al corso \{corso\} è scaduto il \{scadenza\}/, 'the text of the situation, with its placeholders');
    // the example follows what is typed; a placeholder that does not exist is refused
    await pg.getByLabel('Certificato scaduto', { exact: true }).fill('{saluto} {genitore}, il certificato di {nom} è scaduto il {scadenza}.');
    await pg.getByRole('button', { name: 'Salva i messaggi' }).click();
    await pg.waitForSelector('.note-bad');
    assert.ok((await pg.textContent('.note-bad')).includes('segnaposto che non esiste: {nom}'), await pg.textContent('.note-bad'));
    await pg.getByLabel('Certificato scaduto', { exact: true }).fill('{saluto} {genitore}, il certificato di {nome} è scaduto il {scadenza} ({giorni}).');
    assert.match(await gruppo.locator('.muted.small', { hasText: 'Esempio:' }).nth(3).textContent(), /Rossi Paolo, il certificato di Rossi Maria è scaduto il \d\d\/\d\d\/\d{4} \(da 5 giorni\)\./);
    const arch0 = readArchive().db.impostazioni;
    await pg.getByRole('button', { name: 'Salva i messaggi' }).click();
    await toast('Impostazioni salvate.');
    const imp = readArchive().db.impostazioni;
    assert.equal(imp.messaggioCertScaduto, '{saluto} {genitore}, il certificato di {nome} è scaduto il {scadenza} ({giorni}).', 'a changed text is stored');
    assert.equal(imp.messaggioAbbScaduto || '', '', 'a text left as the default is not stored: it follows the program');
    assert.equal(arch0.messaggioScadenza, imp.messaggioScadenza);
    // back to the starting texts
    await go('impostazioni/messaggi');
    await pg.getByRole('button', { name: 'Ripristina i testi di partenza' }).click();
    await pg.getByRole('button', { name: 'Salva i messaggi' }).click();
    await toast('Impostazioni salvate.');
    const dopo = readArchive().db.impostazioni;
    assert.deepEqual(['messaggioScadenza', 'messaggioAbbScaduto', 'messaggioCertificato', 'messaggioCertScaduto', 'messaggioCertAttesa', 'messaggioCertMancante'].map((k) => dopo[k] || ''), ['', '', '', '', '', ''], 'all the starting texts: nothing stored');
  });

  await step('gym logo: chosen in Settings, stays on the computer, in the menu and as a blurred background, choices per device', async () => {
    const png = await pg.evaluate(() => { const cv = document.createElement('canvas'); cv.width = 300; cv.height = 300; const x = cv.getContext('2d'); x.lineWidth = 40; x.strokeStyle = '#1C95D0'; x.beginPath(); x.arc(150, 150, 110, 0, Math.PI * 2); x.stroke(); x.fillStyle = '#1B2F6A'; x.font = 'bold 60px sans-serif'; x.textAlign = 'center'; x.fillText('GYM', 150, 170); return cv.toDataURL('image/png'); });
    await go('impostazioni/aspetto'); await pg.waitForSelector('details.gruppo[data-sez="aspetto"]');
    assert.equal(await pg.locator('.logo-prova').count(), 0, 'no logo yet');
    assert.deepEqual(await pg.evaluate(() => [document.documentElement.getAttribute('data-logo-sfondo'), document.documentElement.getAttribute('data-logo-marchio')]), ['0', '0']);
    assert.equal(await pg.locator('#logo-file').count(), 1);
    // a file that is not an image is refused and nothing is saved
    await pg.locator('#logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('non sono un\'immagine') });
    await pg.waitForTimeout(500); assert.equal(fs.existsSync(path.join(DATI, 'logo.png')), false);
    // a real one: kept in the data folder, shown in the menu and as a blurred background, in the page of this device
    await pg.locator('#logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await pg.waitForSelector('img.logo-prova'); await toast('Logo salvato.');
    assert.equal(fs.existsSync(path.join(DATI, 'logo.png')), true);
    assert.deepEqual(await pg.evaluate(() => [document.documentElement.getAttribute('data-logo-sfondo'), document.documentElement.getAttribute('data-logo-marchio'), getComputedStyle(document.querySelector('.logo-fondo')).display, getComputedStyle(document.querySelector('.brand-mark')).backgroundImage.includes('/api/logo')]), ['1', '1', 'block', true]);
    const src = await pg.locator('img.logo-prova').getAttribute('src');
    const r1 = await pg.request.get(new URL(src, app.url).href); assert.equal(r1.status(), 200); assert.equal(r1.headers()['content-type'], 'image/png');
    assert.equal((await pg.request.get(new URL(src.split('?')[0], app.url).href)).status(), 401, 'without the token the logo is not served');
    // the choices are for this device: switched off, a different strength, they stay after a reload
    await pg.getByLabel('Mostra il logo come sfondo, al centro, sfocato').uncheck();
    assert.equal(await pg.evaluate(() => [document.documentElement.getAttribute('data-logo-sfondo'), getComputedStyle(document.querySelector('.logo-fondo')).display]).then((a) => a.join()), '0,none');
    await pg.getByLabel('Mostra il logo come sfondo, al centro, sfocato').check();
    await pg.getByLabel('Visibilità dello sfondo').evaluate((e) => { e.value = '30'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await pg.getByLabel('Sfocatura dello sfondo').evaluate((e) => { e.value = '3'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.deepEqual(await pg.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--logo-op').trim(), getComputedStyle(document.documentElement).getPropertyValue('--logo-blur').trim(), localStorage.getItem('gymart-logo-visibilita')]), ['0.3', '3px', '30']);
    await pg.reload(); await pg.waitForSelector('#view h1');
    assert.equal(await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--logo-op').trim()), '0.3', 'the choice survives a reload');
    // even at the strongest the text stays readable (measured on the pixels), in light and dark
    const { leggibilita } = require('./leggibilita.js');
    for (const tema of ['chiaro', 'scuro']) {
      await pg.evaluate((t) => Aspetto.imposta({ tema: t }), tema);
      for (const h of ['inizio', 'allieve', 'certificati']) { await go(h); const r = await leggibilita(pg); assert.deepEqual(r.problemi, [], 'text hard to read with the logo (' + tema + ' #' + h + '): ' + r.problemi.slice(0, 3).join(' | ')); }
    }
    await pg.evaluate(() => { Aspetto.imposta({ tema: 'auto' }); Aspetto.impostaLogo({ sfocatura: 8, visibilita: 12 }); });
    // the quick search finds it
    await go('inizio'); await pg.keyboard.press('Control+k'); await pg.keyboard.type('logo');
    await pg.waitForFunction(() => /Logo della palestra/.test(document.getElementById('cerca-ris').textContent) && !document.querySelector('#cerca-ris .cerca-testa'));
    await pg.keyboard.press('Escape');
    // taking it away: the file goes, the page goes back to the colourful ring
    await go('impostazioni/aspetto');
    answer = true; dialogs = [];
    await pg.getByRole('button', { name: 'Togli il logo' }).click();
    await toast('Logo tolto.');
    assert.equal(fs.existsSync(path.join(DATI, 'logo.png')), false);
    assert.deepEqual(await pg.evaluate(() => [document.documentElement.getAttribute('data-logo-sfondo'), document.documentElement.getAttribute('data-logo-marchio')]), ['0', '0']);
    assert.ok(dialogs.some((m) => m.includes('Togliere il logo')));
    await pg.evaluate(() => { S.dirty = false; });
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await step('certificate "in attesa": enrolled without it, awaited for 15 days, registered later from the list or brought at once; a late one is missing; Home, tabs, filter, search, message', async () => {
    app = await start();
    pg = await ctx.newPage(); watch(pg);
    await pg.goto(app.apri); await pg.waitForSelector('.tile');
    const entro = C.isoToIt(isoPlus(TODAY, 15));
    const blocco = pg.locator('.cert-blocco');
    const apriNuova = async () => { await pg.locator('#nuova').click(); await pg.waitForSelector('h1:has-text("Nuova iscrizione")'); };
    const compila = async (nome, nascita, inizio) => {
      await lab('Cognome e Nome').fill(nome); await lab('Data di nascita').fill(nascita); await lab('Telefono').fill('333 100 2000'); await lab('Genitore / Referente').fill('genitore ' + nome);
      await lab('Corso').selectOption('Base'); await pg.getByLabel('Mar', { exact: true }).check(); await lab('Tipo abbonamento').selectOption('Mensile'); await lab('Data inizio').fill(inizio);
    };
    // 1. enrolled without the certificate: the usual answer is "Lo porta dopo"; the day is said before and after saving
    await apriNuova();
    await compila('attesa anna', '2015-03-04', TODAY);
    assert.equal(await blocco.isVisible(), true);
    assert.equal(await lab('Il certificato medico').inputValue(), 'attesa', 'by default: it will be brought later');
    assert.equal(await lab('Tipo di certificato').isVisible(), false, 'the type and dates are asked only if it was brought');
    assert.ok((await blocco.textContent()).includes('"in attesa" fino al ' + entro), await blocco.textContent());
    await shot('certificato-in-attesa-modulo', true);
    await pg.getByRole('button', { name: 'Salva allieva e iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    await toast('Certificato medico atteso entro il ' + entro);
    let arch = readArchive().db; const anna = arch.allieve.find((x) => x.name === 'Attesa Anna');
    assert.equal(anna.certTipo || '', '', 'no certificate written: the student is awaited');
    // 2. the list of the awaited ones: a tab with the number, the day on the chip, the student card says it too
    await go('scadenze/cert-attesa');
    await pg.waitForSelector('#scad-pannello .riga-scad');
    assert.equal(await pg.locator('#scad-cert-attesa').getAttribute('aria-selected'), 'true');
    const riga = pg.locator('#scad-pannello .riga-scad', { hasText: 'Attesa Anna' });
    assert.ok((await riga.textContent()).includes('In attesa · entro ' + entro.slice(0, 5)), await riga.textContent());
    assert.ok((await riga.textContent()).includes('da consegnare entro il ' + entro));
    await shot('certificato-in-attesa-scadenze');
    // the message to the parents for the awaited certificate
    await riga.getByRole('button', { name: 'Avvisa' }).click();
    await pg.waitForSelector('dialog.modale textarea');
    assert.match(await pg.locator('dialog.modale textarea').inputValue(), new RegExp('serve il certificato medico: potete consegnarlo in segreteria entro il ' + entro.replace(/\//g, '\\/') + ' \\(tra 15 giorni\\)'));
    await pg.keyboard.press('Escape');
    await pg.waitForFunction(() => !document.querySelector('dialog.modale[open]'));
    // 3. the certificate arrives: "Registra certificato" on the same row, type and date, the expiry is proposed a year on; the row goes away
    await riga.getByRole('button', { name: 'Registra certificato' }).click();
    const dlg = pg.locator('dialog.modale');
    await dlg.waitFor();
    assert.equal(await dlg.getByRole('button', { name: 'Salva il certificato' }).isVisible(), true);
    assert.equal(await dlg.locator('img, .doc-anteprima').count(), 0, 'no document here: only type and dates');
    await dlg.getByLabel('Tipo di certificato', { exact: true }).selectOption('Non Agonistico');
    await dlg.getByLabel('Data di rilascio', { exact: true }).fill(TODAY);
    assert.equal(await dlg.getByLabel('Scadenza', { exact: true }).inputValue(), C.addYears(TODAY, 1));
    await dlg.getByRole('button', { name: 'Salva il certificato' }).click();
    await toast('Certificato salvato.');
    await pg.waitForFunction(() => !document.querySelector('dialog.modale[open]'));
    await pg.waitForFunction(() => !/Attesa Anna/.test(document.getElementById('view').textContent), null, { timeout: 8000 });
    arch = readArchive().db;
    assert.deepEqual([arch.allieve.find((x) => x.id === anna.id).certTipo, arch.allieve.find((x) => x.id === anna.id).certScadenza], ['Non Agonistico', C.addYears(TODAY, 1)]);
    assert.equal(L.statoCertificato(arch, arch.allieve.find((x) => x.id === anna.id), TODAY).stato, 'VALIDO');
    // 4. brought at once: the type and dates are asked; saving is blocked until they are written
    await apriNuova();
    await compila('subito carla', '2014-06-07', TODAY);
    await lab('Il certificato medico').selectOption('consegnato');
    assert.equal(await lab('Tipo di certificato').isVisible(), true);
    await pg.waitForSelector('.note-bad');
    assert.ok((await pg.textContent('.note-bad')).includes('oppure indica che lo porta dopo'), await pg.textContent('.note-bad'));
    assert.equal(await pg.getByRole('button', { name: 'Salva allieva e iscrizione' }).isDisabled(), true);
    await lab('Tipo di certificato').selectOption('Agonistico'); await lab('Data di rilascio').fill(TODAY);
    assert.equal(await lab('Scadenza').inputValue(), C.addYears(TODAY, 1));
    await pg.waitForFunction(() => !document.querySelector('.note-bad'));
    await pg.getByRole('button', { name: 'Salva allieva e iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    await toast('Allieva e iscrizione salvate.');
    arch = readArchive().db; const carla = arch.allieve.find((x) => x.name === 'Subito Carla');
    assert.deepEqual([carla.certTipo, carla.certRilascio, carla.certScadenza], ['Agonistico', TODAY, C.addYears(TODAY, 1)]);
    assert.ok(!(await pg.locator('#toast').textContent()).includes('atteso'), 'with the certificate nothing is awaited');
    // 5. a student already here who has none: the question is asked for her too, and what is brought goes on her record, with the log
    const sara = arch.allieve.find((x) => x.name === 'Bianchi Sara');
    await apriNuova();
    await lab('Allieva').selectOption(sara.id);
    assert.ok((await blocco.textContent()).includes('già atteso'), await blocco.textContent());
    await lab('Corso').selectOption('Propedeutico'); await lab('Tipo abbonamento').selectOption('Mensile');
    await lab('Il certificato medico').selectOption('consegnato');
    await lab('Tipo di certificato').selectOption('Non Agonistico'); await lab('Data di rilascio').fill(TODAY);
    await pg.getByRole('button', { name: 'Salva l\'iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    arch = readArchive().db;
    assert.deepEqual([arch.allieve.find((x) => x.id === sara.id).certTipo, arch.allieve.find((x) => x.id === sara.id).certScadenza], ['Non Agonistico', C.addYears(TODAY, 1)]);
    const reg = fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(reg.some((r) => r.allieva === 'Bianchi Sara' && r.operazione === 'Modifica allieva' && r.campo === 'Certificato medico' && r.dopo === 'Non Agonistico'), 'the certificate is in the log');
    // a student who has a valid certificate is not asked: it is only said
    await apriNuova();
    await lab('Allieva').selectOption(sara.id);
    assert.equal(await lab('Il certificato medico').isVisible(), false);
    assert.ok((await blocco.textContent()).includes('valido fino al ' + C.isoToIt(C.addYears(TODAY, 1))), await blocco.textContent());
    await pg.evaluate(() => { S.dirty = false; });
    // 6. a start date long ago: the time is already over, the form says so and she is among the missing
    await apriNuova();
    await compila('ritardo rita', '2013-09-10', isoPlus(TODAY, -20));
    assert.ok((await blocco.textContent()).includes('è già passato'), await blocco.textContent());
    await pg.getByRole('button', { name: 'Salva allieva e iscrizione' }).click();
    await pg.waitForFunction(() => /^#iscrizione\/\d{4}$/.test(location.hash));
    arch = readArchive().db; const rita = arch.allieve.find((x) => x.name === 'Ritardo Rita');
    const st = L.statoCertificato(arch, rita, TODAY);
    assert.deepEqual([st.stato, st.ritardo, st.consegna], ['MANCANTE', 5, isoPlus(TODAY, -5)]);
    await go('scadenze/cert-mancanti');
    await pg.waitForSelector('#scad-pannello .riga-scad');
    const rigaR = pg.locator('#scad-pannello .riga-scad', { hasText: 'Ritardo Rita' });
    assert.ok((await rigaR.textContent()).includes('era da consegnare entro il ' + C.isoToIt(isoPlus(TODAY, -5))), await rigaR.textContent());
    // 7. Home: the awaited ones are a quiet tile, the missing ones keep their own; the filter and the number on the Certificati page
    await go('inizio'); await pg.waitForSelector('.tile');
    const t = await tiles();
    assert.ok(t['Certificati mancanti'] >= 1);
    assert.equal(await pg.locator('.tile', { hasText: 'Certificati da consegnare' }).count(), t['Certificati da consegnare'] === undefined ? 0 : 1);
    await go('certificati'); await pg.waitForSelector('.tab-bar button');
    assert.ok((await pg.locator('.tab-bar button', { hasText: 'In attesa' }).count()) === 1);
    await pg.locator('.tab-bar button', { hasText: 'Mancanti' }).click();
    assert.ok((await pg.locator('#view table tbody').textContent()).includes('Ritardo Rita'));
    // 8. the quick search finds the list
    await go('inizio'); await pg.keyboard.press('Control+k'); await pg.keyboard.type('in attesa');
    await pg.waitForFunction(() => /Certificati in attesa/.test(document.getElementById('cerca-ris').textContent) && !document.querySelector('#cerca-ris .cerca-testa'));
    await pg.keyboard.press('Escape');
    // 9. the number of days is a setting: wrong values are refused, 30 is kept
    await go('impostazioni/tariffe');
    const campo = lab('Giorni per consegnare il certificato');
    await campo.fill('x'); await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    await pg.waitForSelector('.note-bad'); assert.ok((await pg.textContent('.note-bad')).includes('consegnare il certificato'));
    await campo.fill('30'); await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    await toast('Impostazioni salvate.');
    assert.equal(readArchive().db.impostazioni.giorniCertificato, 30);
    await go('impostazioni/tariffe');
    assert.equal(await lab('Giorni per consegnare il certificato').inputValue(), '30');
    await campo.fill('15'); await pg.getByRole('button', { name: 'Salva le impostazioni' }).click();
    await toast('Impostazioni salvate.');
    await pg.evaluate(() => { S.dirty = false; });
    await pg.close();
    assert.equal(await within(app.exited, 12000), 0);
  });

  await browser.close();
  assert.deepEqual(problems, [], 'errors seen by the browser');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OK - ' + n + ' steps passed. Screenshots in ' + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
