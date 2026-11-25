'use strict';
// Il programma vero e la sua pagina su ogni archivio delle versioni passate (test/fixtures/archivi, fatti da test/make_archivi_vecchi.js):
// è quello che succede alla segreteria quando il programma si aggiorna da solo e riapre i dati di prima.
// Per ogni archivio: si copia in una cartella dei dati nuova, si avvia il programma, si apre la pagina, si visitano tutte le pagine (nessun errore
// nel browser, nessun «undefined» o «NaN» sullo schermo), si fa un salvataggio vero e si controlla il disco (niente perso, registro intatto,
// una copia giornaliera, nessun errore nel diario tecnico).   node test/win.migrazione.e2e.js [versione ...]
process.env.GYMART_AGGIORNAMENTI_NO_AUTO = '1';
const { execFileSync, spawn } = require('child_process');
const assert = require('assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'archivi');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-migrazione-'));
const BIN = path.join(TMP, 'gymart');
const PAGINE = ['inizio', 'allieve', 'allieva/0001', 'allieva/0003', 'allieva/0006', 'allieva/0007', 'iscrizioni', 'iscrizione/0001', 'iscrizione/0004', 'iscrizione/0006', 'corsi', 'pagamenti', 'pagamenti/incassi',
  'pagamenti/da-incassare', 'pagamenti/verifica', 'analisi', 'scadenze', 'scadenze/abb-scaduti', 'scadenze/abb-in-scadenza', 'scadenze/cert-mancanti', 'scadenze/cert-attesa', 'calendario', 'calendario/note', 'certificati',
  'promemoria', 'stagione', 'registro', 'impostazioni', 'guida', 'assistente', 'aggiornamenti', 'altro'];

function avvia(dati) {
  const proc = spawn(BIN, ['-senza-finestra', '-porta', '0', '-dati', dati]);
  const uscito = new Promise((res) => proc.on('exit', (c) => res(c)));
  const url = new Promise((res, rej) => {
    let b = '';
    proc.stdout.on('data', (d) => { b += d; const a = /Apri: (\S+)/.exec(b), u = /Gym Art Segreteria: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(b); if (a && u) res({ apri: a[1], base: u[1] }); });
    uscito.then((c) => rej(new Error('il programma si è fermato all\'avvio, codice ' + c)));
    setTimeout(() => rej(new Error('il programma non è partito')), 15000);
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  return url.then((u) => Object.assign({ proc, uscito }, u));
}

(async () => {
  const indice = JSON.parse(fs.readFileSync(path.join(FIX, 'INDICE.json'), 'utf8')).versioni;
  const scelte = process.argv.slice(2);
  execFileSync('node', ['build_win.js', '--solo-copia'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('go', ['build', '-o', BIN, '.'], { cwd: path.join(ROOT, 'win'), stdio: 'inherit' });
  const browser = await chromium.launch();
  let fatti = 0;
  for (const v of indice) {
    if (scelte.length && !scelte.some((s) => v.usataDa.includes(s) || v.dir === s)) continue;
    const dati = path.join(TMP, 'dati-' + v.dir);
    fs.cpSync(path.join(FIX, v.dir), dati, { recursive: true });
    const prima = JSON.parse(fs.readFileSync(path.join(dati, 'archivio.json'), 'utf8')), righePrima = fs.readFileSync(path.join(dati, 'registro.jsonl'), 'utf8').trim().split('\n').length;
    const app = await avvia(dati);
    const problemi = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'it-IT', reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('gymart-tutorial', 'fatto'); localStorage.setItem('gymart-aperto', '1'); sessionStorage.setItem('gymart-avvio', '1'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => problemi.push('errore della pagina: ' + e.message));
    pg.on('console', (m) => { if (m.type() === 'error' && !/(4\d\d|500) \(/.test(m.text())) problemi.push('console: ' + m.text()); });
    pg.on('response', (r) => { if (r.status() >= 400 && !(r.status() === 404 && /favicon|\.map$/.test(r.url()))) problemi.push(r.status() + ' ' + r.url().replace(/\?.*/, '')); });
    pg.on('dialog', (d) => { problemi.push('finestra di dialogo: ' + d.message()); d.dismiss(); });
    try {
      await pg.goto(app.apri); await pg.waitForSelector('.breve');
      const stato = await pg.evaluate(() => ({ fatale: S.fatal, allieve: S.db && S.db.allieve.length, iscrizioni: S.db && S.db.iscrizioni.length, pagamenti: S.db && S.db.pagamenti.length, versione: S.versione }));
      assert.equal(stato.fatale, '', 'la pagina non apre l\'archivio: ' + stato.fatale);
      assert.deepEqual([stato.allieve, stato.iscrizioni, stato.pagamenti], [prima.db.allieve.length, prima.db.iscrizioni.length, (prima.db.pagamenti || []).length], 'quello che la pagina vede');
      for (const h of PAGINE) {
        await pg.evaluate((x) => { location.hash = x; }, h);
        await pg.waitForFunction((x) => location.hash === '#' + x, h);
        await pg.waitForFunction(() => document.querySelector('#view') && document.querySelector('#view').children.length > 0);
        await pg.waitForTimeout(60);
        const avvisi = await pg.$$eval('dialog.avviso[open]', (ds) => ds.map((d) => d.innerText.replace(/\s+/g, ' ')));
        avvisi.forEach((t) => problemi.push('finestra di avviso del programma su #' + h + ': ' + t)); // since 1.25 the program shows its own windows, not the browser's
        const testo = await pg.evaluate(() => document.getElementById('view').innerText);
        const guasto = /undefined|NaN|\[object|Invalid Date|null null/.exec(testo);
        assert.ok(!guasto, 'nella pagina #' + h + ' c\'è «' + (guasto && testo.slice(Math.max(0, guasto.index - 30), guasto.index + 30).replace(/\s+/g, ' ')) + '»');
        assert.ok(!(await pg.evaluate(() => S.fatal)), 'pagina #' + h + ' in errore: ' + (await pg.evaluate(() => S.fatal)));
      }
      assert.deepEqual(problemi, [], 'errori visti dal browser');
      // i documenti scansionati (dalla 1.15) si aprono
      for (const d of (prima.db.documenti || [])) assert.equal(await pg.evaluate((f) => fetch('/api/documento/' + f + '?t=' + encodeURIComponent(TOKEN)).then((r) => r.status), d.file), 200, 'documento ' + d.file);
      // un salvataggio vero, come lo fa la pagina: la nota arriva sul disco, il resto resta com'era
      assert.equal(await pg.evaluate(() => commit(L.salvaNota(S.db, null, { testo: 'Prova di migrazione', data: today() }, nowIso(), today()), 'Salvato.')), true, 'il salvataggio');
      const dopo = JSON.parse(fs.readFileSync(path.join(dati, 'archivio.json'), 'utf8')).db;
      for (const k of ['allieve', 'iscrizioni', 'pagamenti']) assert.deepEqual(dopo[k].slice(0, (prima.db[k] || []).length), prima.db[k] || [], k + ' dopo il salvataggio');
      assert.equal(dopo.note.length, (prima.db.note || []).length + 1, 'la nota nuova');
      const righeDopo = fs.readFileSync(path.join(dati, 'registro.jsonl'), 'utf8').trim().split('\n');
      assert.ok(righeDopo.length > righePrima && righeDopo.slice(0, righePrima).join('\n') === fs.readFileSync(path.join(FIX, v.dir, 'registro.jsonl'), 'utf8').trim(), 'il registro vecchio resta e ne arriva di nuovo');
      assert.ok(fs.readdirSync(path.join(dati, 'giornaliere')).length >= 1, 'una copia giornaliera');
      // il registro si legge con la pagina di oggi (le righe di allora hanno meno campi)
      await pg.evaluate(() => { location.hash = 'registro'; });
      await pg.waitForSelector('tbody tr');
      assert.ok((await pg.locator('tbody tr').count()) > 5, 'il registro');
      assert.deepEqual(problemi, [], 'errori visti dal browser dopo il salvataggio');
      // il diario tecnico del programma di oggi non ha annotato errori
      const diario = fs.readFileSync(path.join(dati, 'diario-tecnico.log'), 'utf8');
      assert.ok(!/\| ERRORE \|/.test(diario), 'il diario ha errori:\n' + diario.split('\n').filter((l) => /\| ERRORE \|/.test(l)).join('\n'));
    } catch (e) {
      console.error('FALLITO - ' + v.dir + (v.usataDa.length > 1 ? ' (= ' + v.usataDa.join(', ') + ')' : ''));
      await pg.screenshot({ path: path.join(TMP, 'errore-' + v.dir + '.png') }).catch(() => {});
      app.proc.kill(); await browser.close();
      console.error('schermata in ' + path.join(TMP, 'errore-' + v.dir + '.png'));
      throw e;
    }
    await ctx.close(); app.proc.kill(); await app.uscito;
    fatti++; console.log('ok ' + fatti + ' - ' + v.dir.padEnd(15) + (v.usataDa.length > 1 ? ' (= ' + v.usataDa.join(', ') + ')' : '') + ': ' + prima.db.allieve.length + ' allieve, ' + prima.db.iscrizioni.length + ' iscrizioni, ' + (prima.db.pagamenti || []).length + ' pagamenti, ' + PAGINE.length + ' pagine');
  }
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('OK - ' + fatti + ' archivi di versioni passate: il programma e la pagina di oggi li aprono, ci lavorano e non perdono niente.');
})().catch((e) => { console.error(e); process.exit(1); });
