'use strict';
// Dati ostili: la logica dell'archivio alimentata con quello che si può davvero scrivere in un modulo o trovare in un file sbagliato
// (caratteri di controllo, emoji, testi lunghissimi, nomi come "__proto__", segni dei modelli come "$&" e "{nome}", importi e date strani,
// formule di Excel). Controlla che nulla si rompa: nessuna eccezione imprevista, l'archivio resta coerente, tutte le pagine (le funzioni che
// le calcolano) si leggono sempre, gli elenchi CSV tornano uguali quando si rileggono e i file Excel restano ben formati.
// Uso: node test/win.ostile.js [semi=3] [operazioni=600]      (ogni dato è inventato)
process.env.GYMART_AGGIORNAMENTI_NO_AUTO = '1';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');
const XlsxOut = require('../win/web/xlsxout.js');
const { controlla } = require('./invarianti.js');

const SEMI = parseInt(process.argv[2], 10) || 3, OPS = parseInt(process.argv[3], 10) || 600;
const USCITA = process.env.OSTILE_USCITA || ''; // una cartella dove lasciare i file Excel fatti (per guardarli con altri programmi)

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function addDays(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }

const LUNGHI = ['x'.repeat(5000), 'y'.repeat(40000), 'z'.repeat(300) + '😀'.repeat(200)]; // rari: un testo enorme incollato per sbaglio
const OSTILI = ['', ' ', '   ', '\t', '\n', 'a\nb', 'a\r\nb', 'riga1\nriga2\nriga3', 'k'.repeat(301), '😀', '👩‍👧‍👦', 'Zoë', 'e\u0301', '\u202Eevil', '\u200B', '\u200D', '\u00A0', 'a\u0000b', '\u0007', '\u001F', '\u007F', '\u0085', '\u2028', '\u2029', '\uFEFFx',
  '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '&amp;', '&lt;b&gt;', '\'; DROP TABLE x;--', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', '{nome}', '{genitore}{corso}', '$&', '$1', '$$', "$'", '$`', '%s', '%d', '${x}',
  '0', '-0', 'NaN', 'Infinity', '-Infinity', '1e309', '0x10', '=1+1', '+39 333 1234567', '@SUM(A1)', '-2+3', "'=cmd|' /C calc'!A0", '\uD800', '\uDFFF', '\uFFFE', '\uFFFF', "L'Aquila", 'Dell’Orto', 'O\'Brien', '"citata"', 'con, virgola', 'con; punto e virgola', '\\', '\\n', '/', '..', '../..', 'C:\\x', 'a|b', 'a"b"c', '`', '(', ')', '[', ']', '*', '+', '?', '^', '$', '.*'];
const INCASSI = [0, -5, 1e-9, 0.004, 0.005, 12.345, 1e15, 1e21, NaN, Infinity, -Infinity, '', ' ', 'abc', '12,50', '12.50', '1.234,56', '1,234.56', '12,5€', '€ 12', '1e3', '0x1F', '٣٤', '35,50', '9999999999', '--5', '1,2,3'];
const DATE = ['', ' ', '2026-02-31', '2026-13-01', '2026-00-10', '0000-01-01', '9999-12-31', '31/02/2026', '1/1/26', '2026/11/19', '19.11.2026', 'ieri', '1e3', '2026-11-19T10:00:00', '2026-11-19 ', '٢٠٢٦-١١-١٩', '+002026-11-19', 'NaN', '99999999999'];

async function simula(seme) {
  const r = rng(seme), pick = (a) => a[Math.floor(r() * a.length)], chance = (p) => r() < p, int = (a, b) => a + Math.floor(r() * (b - a + 1));
  let oggi = '2026-11-18';
  const adesso = () => oggi + 'T10:' + String(int(0, 59)).padStart(2, '0') + ':00';
  const o = () => (chance(0.02) ? pick(LUNGHI) : chance(0.5) ? pick(OSTILI) : chance(0.5) ? pick(OSTILI) + pick(OSTILI) : 'Normale ' + int(1, 99));
  /** Una scheda giusta con uno o due campi ostili: così molte schede passano i controlli e arrivano in archivio. */
  const guasta = (base, campi) => { const f = Object.assign({}, base); for (let k = int(1, 2); k > 0; k--) { const c = pick(campi); f[c] = c === 'nascita' || c.startsWith('cert') ? pick(DATE) : o(); } return f; };
  const nome = () => (chance(0.3) ? o() : ['Rossi', 'Verdi', "D'Angelo", 'De Luca'][int(0, 3)] + ' ' + (chance(0.4) ? o() : ['Giulia', 'Sofia', 'Anna'][int(0, 2)]));
  let db = L.nuovoArchivio(oggi);
  const stats = {}, rifiuti = {};
  const conta = (k) => { stats[k] = (stats[k] || 0) + 1; };
  // i rifiuti "normali" dei controlli sono errori semplici con un messaggio in italiano; un TypeError, un RangeError o simili sono errori di programmazione
  const ops = {
    nuovaAllieva() {
      const base = { name: pick(['Rossi', 'Verdi', "D'Angelo"]) + ' ' + pick(['Giulia', 'Sofia', 'Anna']) + ' ' + int(1, 9999), nascita: addDays(oggi, -int(2200, 6500)), tel: '3' + int(100000000, 999999999), genitore: 'Paolo Rossi', citta: 'Avezzano', indirizzo: 'Via Roma 1', email: 'a' + int(1, 999) + '@example.com', note: '', privacy: 'Sì' };
      const f = chance(0.85) ? guasta(base, ['name', 'genitore', 'citta', 'indirizzo', 'note', 'email', 'tel', 'tel2', 'cf', 'cfGenitore', 'nascita']) : Object.assign(base, { name: nome(), nascita: pick(DATE), tel: o(), genitore: o(), citta: o(), cf: o() });
      const c = L.controllaAllieva(db, f, null, oggi);
      if (c.errors.length) return conta('allieva rifiutata dai controlli');
      return L.salvaAllieva(db, null, f, adesso());
    },
    modificaAllieva() {
      const a = pick(db.allieve); if (!a) return null;
      const f = Object.assign({}, a, pick([{ name: nome() }, { tel: o() }, { email: o() }, { note: o() }, { citta: o() }, { genitore: o() }, { indirizzo: o() }, { nascita: pick(DATE) }, { certRilascio: pick(DATE), certTipo: pick(['Agonistico', 'Non Agonistico', o()]) }]));
      const c = L.controllaAllieva(db, f, a.id, oggi);
      if (c.errors.length) return conta('modifica rifiutata dai controlli');
      return L.salvaAllieva(db, a.id, f, adesso());
    },
    nuovaIscrizione() {
      const a = pick(db.allieve.filter((x) => !x.archiviata)); if (!a || !db.tariffario.length) return null;
      const base = { allievaId: a.id, corso: pick(db.liste.corsi), giorni: pick([['Lun', 'Mer'], ['Sab'], ['Mar', 'Gio', 'Sab']]), fascia: '16:00-17:00', pacchetto: pick(db.tariffario).chiave, tipo: pick(['Mensile', 'Trimestrale', 'Annuale']), inizio: addDays(oggi, int(-40, 20)), quota: '', note: '' };
      const f = chance(0.8) ? guasta(base, ['note', 'note', 'quota', 'fascia', 'inizio']) : Object.assign(base, { corso: o(), giorni: pick([[], ['__proto__'], [o()]]), pacchetto: o(), tipo: o(), inizio: pick(DATE), quota: pick(INCASSI.map(String)) });
      const c = L.controllaIscrizione(db, f, null);
      if (c.errors.length) return conta('iscrizione rifiutata dai controlli');
      return L.salvaIscrizione(db, null, f, adesso());
    },
    pagamento() {
      const e = pick(db.iscrizioni.filter((x) => !x.annullata)); if (!e) return null;
      const base = { iscrizioneId: e.id, data: addDays(oggi, -int(0, 12)), importo: pick([10, 35.5, '35,50', '12.25', 90]), metodo: pick(['Contanti', 'Bonifico', 'POS']), note: '' };
      return L.salvaPagamento(db, chance(0.7) ? Object.assign(base, { note: o() }) : Object.assign(base, pick([{ data: pick(DATE) }, { importo: pick(INCASSI) }, { metodo: o() }])), adesso());
    },
    eliminaPagamento() { const p = pick(db.pagamenti); return p ? L.eliminaPagamento(db, p.id) : null; },
    certificato() {
      const a = pick(db.allieve); if (!a) return null;
      const base = { allievaId: a.id, tipo: pick(['Agonistico', 'Non Agonistico', 'Ludico-motoria']), rilascio: addDays(oggi, -int(1, 400)), scadenza: '', note: '' };
      const f = chance(0.7) ? Object.assign(base, { note: o() }) : Object.assign(base, { tipo: pick(['Agonistico', o()]), rilascio: pick(DATE), scadenza: pick(['', ...DATE]), note: o() });
      const c = L.controllaCertificato(db, f, oggi);
      if (c.errors && c.errors.length) return conta('certificato rifiutato dai controlli');
      return L.salvaCertificato(db, f, adesso(), oggi);
    },
    nota() {
      const n = pick(db.note || []);
      const f = { testo: o() || 'x', data: chance(0.9) ? addDays(oggi, int(-12, 40)) : pick(DATE), dataFine: chance(0.8) ? '' : pick([addDays(oggi, int(40, 60)), ...DATE]), allievaId: chance(0.8) ? (db.allieve.length ? pick(db.allieve).id : '') : pick(['', '9999', '__proto__']) };
      return L.salvaNota(db, chance(0.4) && n ? n.id : null, f, adesso(), oggi);
    },
    segnaNota() { const n = pick(db.note || []); return n ? L.segnaNota(db, n.id, chance(0.5), adesso()) : null; },
    eliminaNota() { const n = pick(db.note || []); return n ? L.eliminaNota(db, n.id) : null; },
    archivia() { const a = pick(db.allieve); return a ? L.archiviaAllieva(db, a.id, !a.archiviata, adesso()) : null; },
    eliminaAllieva() { if (!chance(0.3)) return null; const a = pick(db.allieve); return a ? L.eliminaAllieva(db, a.id) : null; },
    promemoria() { const el = L.elencoPromemoria(db, oggi, { contatto: 'tutte' }); const x = pick(el.righe); return x ? L.segnaPromemoria(db, { tipo: x.tipo, rif: x.rif, scadenza: x.scadenza, on: chance(0.8) }, adesso(), oggi) : null; },
    tariffe() {
      const f = { stagione: db.impostazioni.stagione, preavvisoAbb: pick(['30', '5', '0', '-3', '1e9', o()]), preavvisoCert: pick(['30', '60', o()]), corsi: pick([db.liste.corsi.join('\n'), o(), o() + '\n' + o()]), fasce: db.liste.fasce.join('\n'), metodi: pick([db.liste.metodi.join('\n'), o()]), tariffario: db.tariffario.map((p) => ({ pacchetto: p.pacchetto, frequenza: p.frequenza, Mensile: String(p.Mensile), Trimestrale: String(p.Trimestrale), Annuale: String(p.Annuale), quotaIscrizione: String(p.quotaIscrizione || '') })), ente: pick(['A.S.D. Gym Art', o()]), messaggioScadenza: pick(['', o()]), messaggioAbbScaduto: pick(['', o()]) };
      if (L.controllaImpostazioni(f).length) return conta('impostazioni rifiutate dai controlli');
      return L.salvaImpostazioni(db, f);
    },
    importa() {
      // un file CSV scritto con testi ostili tra virgolette (il formato lo scrive Excel o Google Fogli)
      const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      const righe = [['Cognome e Nome', 'Data di nascita', 'Telefono', 'Genitore', 'Email', 'Note']];
      for (let i = int(1, 4); i > 0; i--) righe.push([nome(), pick([addDays(oggi, -3000), ...DATE]), o(), o(), o(), o()]);
      const testo = (chance(0.5) ? '\uFEFF' : '') + righe.map((x) => x.map(q).join(chance(0.7) ? ',' : ';')).join(chance(0.5) ? '\n' : '\r\n');
      const rows = L.leggiCsv(testo); const f = L.riconosciFoglio(rows);
      if (!f || !f.vals) return conta('csv non riconosciuto');
      return L.importaAnagrafica(db, f.vals, adesso());
    },
    giorno() { oggi = addDays(oggi, int(0, 3)); return null; }
  };

  /** Tutto quello che le pagine calcolano: non deve mai lanciare un errore, qualunque cosa ci sia nell'archivio. */
  function leggi() {
    L.riepilogo(db, oggi); L.scadenze(db, oggi); L.analisi(db, oggi, '12mesi'); L.analisi(db, oggi, 'stagione'); L.corsiRiepilogo(db); L.previsioneRinnovi(db, oggi, 6); L.compleanni(db, oggi, 0); L.compleanni(db, oggi, 30);
    L.daIncassare(db); L.incassi(db, { dal: '', al: '', metodo: '', q: '' }); L.incassi(db, { dal: '2026-01-01', al: '2026-12-31', metodo: 'Contanti', q: pick(OSTILI) });
    L.elencoCertificati(db, oggi, {}); L.elencoNote(db, oggi); L.elencoNote(db, oggi, { stato: 'tutte', q: pick(OSTILI) });
    for (const m of [10, 11, 0]) L.calendarioMese(db, oggi, 2026, m, L.CAL_TIPI);
    const el = L.elencoPromemoria(db, oggi, {}); el.righe.forEach((x) => { void x.testo; });
    L.elencoPromemoria(db, oggi, { contatto: 'tutte', q: pick(OSTILI) });
    for (const q of [pick(OSTILI), pick(OSTILI), '(', '[', '*', '\\']) for (const fl of ['', 'con', 'senza', 'archiviate']) L.cercaAllieve(db, q, fl);
    db.allieve.forEach((a) => { L.contoAllieva(db, a.id); L.famiglia(db, a.id); L.statoCertificato(db, a, oggi); L.iscrizioniDi(db, a.id); L.nomeAllieva(db, a.id); L.noteDi(db, a.id); L.documentiDi(db, a.id); });
    db.iscrizioni.forEach((e) => { L.conto(db, e); L.statoIscrizione(e, oggi); L.scadenza(e); L.corrente(e); L.pagamentiDi(db, e.id); });
    L.noteInArrivo(db, oggi);
  }

  /** I messaggi per i genitori portano il testo scritto dalla persona, parola per parola (niente "$&" interpretato, niente segnaposto che si rimpiazzano due volte). */
  function controllaMessaggi() {
    const a = { name: pick(['Rossi $& Mia', 'Verdi {genitore} Ada', 'Neri $1 Eva', "Bianchi $' Zoe"]), genitore: pick(['Paolo $&', '{nome}', 'Anna $$']) };
    const t = L.testoAvviso(db, { tipo: 'abbonamento', stato: 'SCADUTO', allieva: a, iscrizione: null, corso: 'Base', scadenza: oggi, giorni: -3 }, 10);
    assert.ok(t.includes(a.name.replace(/ {2,}/g, ' ')), 'il nome nel messaggio deve restare com\'è: ' + JSON.stringify(a.name) + ' -> ' + JSON.stringify(t));
  }

  for (let i = 0; i < OPS; i++) {
    const nomeOp = pick(Object.keys(ops).flatMap((n) => Array(n === 'giorno' ? 4 : n === 'nuovaAllieva' || n === 'nota' || n === 'pagamento' ? 4 : 2).fill(n))), prima = JSON.stringify(db);
    let res;
    try { res = ops[nomeOp](); } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      if (e.constructor !== Error) throw new Error('operazione "' + nomeOp + '" ha rotto qualcosa (seme ' + seme + ', passo ' + i + '): ' + (e.stack || e.message));
      rifiuti[nomeOp] = (rifiuti[nomeOp] || 0) + 1; assert.equal(JSON.stringify(db), prima, 'un\'operazione rifiutata ha cambiato l\'archivio'); continue;
    }
    if (!res || !res.db) continue;
    assert.equal(JSON.stringify(db), prima, nomeOp + ' ha modificato l\'archivio di partenza (deve restituirne uno nuovo)');
    db = res.db; conta(nomeOp);
    try { assert.equal(L.validaArchivio(db), '', 'archivio non valido dopo ' + nomeOp); controlla(db, oggi, nomeOp + ' #' + i); if (i % 4 === 0 || i === OPS - 1) leggi(); } catch (e) { throw new Error('dopo "' + nomeOp + '" (seme ' + seme + ', passo ' + i + '): ' + (e.stack || e.message)); }
    // l'archivio sopravvive al salvataggio su disco (JSON) e alla rilettura
    if (i % 50 === 0) { const copia = JSON.parse(JSON.stringify(db)); assert.equal(L.validaArchivio(copia), ''); assert.deepEqual(L.completa(copia, oggi).allieve, db.allieve, 'completa() non deve cambiare i dati già a posto'); controllaMessaggi(); }
  }
  return { stats, rifiuti, db, oggi };
}

/** Un file .xlsx fatto dal programma: lo zip è intero (CRC), e ogni pezzo di XML è ben formato (niente caratteri vietati, tag chiusi, entità valide). */
function controllaXlsx(bytes, etichetta) {
  const b = Buffer.from(bytes), voci = [];
  const fine = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fine >= 0, etichetta + ': nessun elenco finale nello zip');
  const n = b.readUInt16LE(fine + 10); let p = b.readUInt32LE(fine + 16);
  for (let i = 0; i < n; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, etichetta + ': voce rovinata');
    const metodo = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), comp = b.readUInt32LE(p + 20), orig = b.readUInt32LE(p + 24), ln = b.readUInt16LE(p + 28), le = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const nome = b.slice(p + 46, p + 46 + ln).toString('utf8');
    const lh = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const dati = b.slice(lh, lh + comp), testo = metodo === 8 ? zlib.inflateRawSync(dati) : dati;
    assert.equal(testo.length, orig, etichetta + ': ' + nome + ' ha la lunghezza sbagliata'); assert.equal(zlib.crc32(testo), crc, etichetta + ': ' + nome + ' ha il CRC sbagliato');
    voci.push([nome, testo.toString('utf8')]); p += 46 + ln + le + lc;
  }
  assert.ok(voci.length >= 7, etichetta + ': mancano dei file nello zip');
  for (const [nome, xml] of voci) {
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(xml), etichetta + ': ' + nome + ' ha caratteri vietati nell\'XML');
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(xml), etichetta + ': ' + nome + ' ha mezzi caratteri');
    for (const m of xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)) assert.ok(m[1].replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, '.').length <= 32767, etichetta + ': ' + nome + ' ha una cella di più di 32.767 caratteri (Excel non la apre)');
    const pila = []; let ultimo = 0;
    for (const m of xml.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\?[^>]*\?>/g)) {
      const fra = xml.slice(ultimo, m.index); assert.ok(!/<|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(fra), etichetta + ': ' + nome + ' ha testo non valido: ' + fra.slice(0, 60)); ultimo = m.index + m[0].length;
      if (m[0].startsWith('<?')) continue;
      if (m[1]) { assert.equal(pila.pop(), m[2], etichetta + ': ' + nome + ' ha un tag chiuso male (' + m[2] + ')'); } else if (!m[4]) pila.push(m[2]);
    }
    assert.equal(pila.length, 0, etichetta + ': ' + nome + ' ha tag aperti');
  }
}

/** Gli elenchi CSV, riletti, danno gli stessi dati (virgolette, a capo, virgole e punti e virgola dentro i testi). */
function controllaCsv(db, etichetta) {
  const righe = L.leggiCsv('\uFEFF' + L.csvAllieve(db));
  const f = L.riconosciFoglio(righe);
  assert.ok(f && f.vals, etichetta + ': il CSV delle allieve non si riconosce più');
  assert.equal(f.vals.length - 1 >= 0 ? f.vals.length : 0, f.vals.length);
  const comeScritto = (nome) => (/^[=+\-@\t\r]/.test(nome) && !/^-?\d+([.,]\d+)?$/.test(nome) ? "'" : '') + nome; // il CSV mette un apice davanti a quello che Excel prenderebbe per una formula
  const nomi = db.allieve.map((a) => comeScritto(a.name).replace(/\r\n?|\n/g, ' ').trim()).filter(Boolean).sort();
  const col = f.vals[0] ? f.vals[0].findIndex((t) => /cognome|nome/i.test(String(t))) : -1;
  assert.ok(col >= 0 || !db.allieve.length, etichetta + ': manca la colonna del nome');
  if (col >= 0) {
    const letti = f.vals.slice(1).map((r) => String(r[col] === undefined ? '' : r[col]).replace(/\r\n?|\n/g, ' ').trim()).filter(Boolean).sort();
    assert.deepEqual(letti, nomi, etichetta + ': i nomi riletti dal CSV non sono quelli scritti');
  }
}

(async () => {
  let tot = 0;
  for (let seme = 1; seme <= SEMI; seme++) {
    const r = await simula(seme * 104729);
    tot += OPS;
    const eseguite = Object.values(r.stats).reduce((s, v) => s + v, 0);
    console.log(`seme ${seme}: ${eseguite} operazioni riuscite, ${Object.values(r.rifiuti).reduce((s, v) => s + v, 0)} rifiutate come previsto, archivio finale: ${r.db.allieve.length} allieve, ${r.db.iscrizioni.length} iscrizioni, ${r.db.pagamenti.length} pagamenti, ${r.db.note.length} note`);
    if (seme === 1) console.log('   operazioni eseguite:', JSON.stringify(r.stats));
    const tabelle = L.tabelleExcel(r.db, r.oggi);
    const bytes = await XlsxOut.crea(tabelle);
    controllaXlsx(bytes, 'seme ' + seme);
    const nudi = await XlsxOut.crea(tabelle, { senzaCompressione: true });
    controllaXlsx(nudi, 'seme ' + seme + ' (senza compressione)');
    if (USCITA) { fs.mkdirSync(USCITA, { recursive: true }); fs.writeFileSync(path.join(USCITA, 'ostile-' + seme + '.xlsx'), Buffer.from(bytes)); }
    controllaCsv(r.db, 'seme ' + seme);
  }
  console.log('OK - ' + tot + ' passi con dati ostili: nessuna eccezione, archivio coerente, pagine leggibili, CSV ed Excel validi');
})().catch((e) => { console.error('FALLITA:', e.message); process.exit(1); });
