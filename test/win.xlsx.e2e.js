'use strict';
// Importing an Excel workbook through the page, and proof that the file never leaves the computer.
// Uses test/fixtures/gestionale-finto.xlsx (invented people). Run: node test/win.xlsx.e2e.js
process.env.GYMART_AGGIORNAMENTI_NO_AUTO = '1'; // the tests never go on the internet to look for an update
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-xlsx-'));
const DATI = path.join(TMP, 'dati'), BIN = path.join(TMP, 'gymart');
const OUT = path.join(ROOT, 'out');
const FIXTURE = path.join(__dirname, 'fixtures', 'gestionale-finto.xlsx');

(async () => {
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'ignore' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  fs.mkdirSync(OUT, { recursive: true });
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', DATI]);
  const apri = await new Promise((res, rej) => { let b = ''; proc.stdout.on('data', (d) => { b += d; const a = /Apri: (\S+)/.exec(b); if (a) res(a[1]); }); setTimeout(() => rej(new Error('no start')), 10000); });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'it-IT', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('gymart-aperto', '1'); } catch (e) {} }); // settings sections open
  await ctx.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); sessionStorage.setItem('gymart-avvio', '1'); } catch (e) {} }); // no guided tour in the way
  const pg = await ctx.newPage();
  const requests = [], problems = [];
  pg.on('request', (r) => requests.push({ url: r.url(), size: (r.postData() || '').length, method: r.method(), body: r.postDataBuffer() }));
  pg.on('pageerror', (e) => problems.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Content Security Policy/.test(m.text())) problems.push(m.text()); }); // the blocked attempts to reach the internet are made on purpose
  const dialogs = []; pg.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.error('FAILED - ' + name); await pg.screenshot({ path: path.join(OUT, 'win-xlsx-errore.png'), fullPage: true }).catch(() => {}); proc.kill(); throw e; } console.log('ok - ' + name); };
  const toast = (text) => pg.waitForFunction((t) => { const e = document.getElementById('toast'); return e.className.includes('on') && e.textContent.includes(t); }, text);

  await pg.goto(apri); await pg.waitForSelector('.tile');
  await step('the Excel workbook is read and summarised before anything is written', async () => {
    await pg.evaluate(() => { location.hash = 'impostazioni'; });
    await pg.waitForSelector('input[type=file][multiple]');
    assert.ok((await pg.textContent('#view')).includes('Il file resta su questo computer'));
    await pg.setInputFiles('input[type=file][multiple]', FIXTURE);
    await pg.waitForSelector('.note-ok:has-text("ANAGRAFICA")');
    const notes = await pg.$$eval('#view .note', (ns) => ns.map((x) => x.textContent));
    const joined = notes.join('\n');
    assert.ok(joined.includes('ANAGRAFICA') && joined.includes('44 allieve nuove.'), joined.slice(0, 600));
    assert.ok(/ISCRIZIONI[\s\S]*iscrizioni nuove/.test(joined) && /PAGAMENTI[\s\S]*pagamenti nuovi/.test(joined), joined.slice(0, 900));
    assert.ok(joined.includes('foglio DASHBOARD') && joined.includes('non viene importato'), 'the other sheets are named and skipped');
    assert.equal(fs.existsSync(path.join(DATI, 'archivio.json')), false, 'nothing is written before the confirmation');
    await pg.screenshot({ path: path.join(OUT, 'win-xlsx-riepilogo.png'), fullPage: true });
  });
  await step('importing writes the archive, with a log, and the home shows the real numbers', async () => {
    await pg.getByRole('button', { name: 'Importa nell\'archivio' }).click();
    await toast('Importazione completata.');
    const db = JSON.parse(fs.readFileSync(path.join(DATI, 'archivio.json'), 'utf8')).db;
    assert.equal(db.allieve.length, 44);
    assert.ok(db.iscrizioni.length >= 50 && db.pagamenti.length >= 35, `${db.iscrizioni.length} enrollments, ${db.pagamenti.length} payments`);
    assert.ok(fs.readFileSync(path.join(DATI, 'registro.jsonl'), 'utf8').split('\n').filter(Boolean).length > 100, 'every imported value is in the log');
    assert.ok(db.allieve.every((a) => /^[A-ZÀ-Ý]/.test(a.name)), 'names were tidied');
    assert.ok(db.allieve.some((a) => a.nascita === '' || /^\d{4}-\d{2}-\d{2}$/.test(a.nascita)));
    // the snapshot of the day exists after the first save, with the log inside
    assert.ok(fs.readdirSync(path.join(DATI, 'giornaliere')).length >= 1);
    await pg.evaluate(() => { location.hash = 'inizio'; });
    await pg.waitForSelector('.tile');
    const tiles = await pg.$$eval('.tile', (ts) => Object.fromEntries(ts.map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent])));
    assert.equal(tiles['Allieve'], '44');
    await pg.screenshot({ path: path.join(OUT, 'win-xlsx-inizio.png'), fullPage: true });
    // the same file again changes nothing
    await pg.evaluate(() => { location.hash = 'impostazioni'; });
    await pg.waitForSelector('input[type=file][multiple]');
    await pg.setInputFiles('input[type=file][multiple]', FIXTURE);
    await pg.waitForSelector('#view .note:has-text("0 allieve nuove")');
  });
  await step('the file never leaves the computer: every request is to this program, none carries the workbook, the page cannot reach the internet', async () => {
    const hosts = [...new Set(requests.map((r) => new URL(r.url).host))];
    assert.deepEqual(hosts.filter((h) => !/^127\.0\.0\.1:\d+$/.test(h)), [], 'requests to other hosts: ' + hosts);
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    assert.equal(requests.some((r) => r.body && r.body.includes(zip)), false, 'the workbook (a zip file) was sent somewhere');
    const fixture = fs.readFileSync(FIXTURE);
    assert.equal(requests.some((r) => r.body && r.body.length >= fixture.length / 2 && !r.url.includes('/api/salva')), false, 'a request as big as the workbook');
    // the page itself may not open a connection to anywhere else: the security policy blocks it
    const csp = await pg.evaluate(() => fetch('/').then((r) => r.headers.get('content-security-policy')));
    assert.ok(/default-src 'self'/.test(csp) && !/connect-src/.test(csp), csp);
    const esterno = await pg.evaluate(() => fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'raggiunto', () => 'bloccato'));
    assert.equal(esterno, 'bloccato');
    const img = await pg.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => res('caricata'); i.onerror = () => res('bloccata'); i.src = 'https://example.com/x.png'; }));
    assert.equal(img, 'bloccata', 'not even an image (a way to leak data in a URL) can be loaded from outside');
  });
  await step('a file that is not Excel is refused with a clear message', async () => {
    await pg.evaluate(() => { location.hash = 'impostazioni'; });
    await pg.waitForSelector('input[type=file][multiple]');
    const bad = path.join(TMP, 'foto.xlsx'); fs.writeFileSync(bad, 'questo non è un file excel');
    dialogs.length = 0;
    await pg.setInputFiles('input[type=file][multiple]', bad);
    await pg.waitForFunction(() => true); await pg.waitForTimeout(400);
    assert.ok(dialogs.some((d) => d.includes('archivio Excel')), String(dialogs));
    const old = path.join(TMP, 'vecchio.xls'); fs.writeFileSync(old, 'x');
    dialogs.length = 0;
    await pg.setInputFiles('input[type=file][multiple]', old);
    await pg.waitForTimeout(400);
    assert.ok(dialogs.some((d) => d.includes('.xlsx')), String(dialogs));
  });

  await browser.close(); proc.kill();
  assert.deepEqual(problems, [], 'errors seen by the browser');
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OK - Excel import and privacy checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
