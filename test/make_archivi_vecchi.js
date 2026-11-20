'use strict';
// Archivi INVENTATI fatti dal codice vero di ogni versione passata del programma per Windows (logic.js e core.js presi dalla storia di git), per
// provare che la versione di oggi li apre e ci lavora (test/win.migrazione.test.js e test/win.migrazione.e2e.js).
// Uso, solo in sviluppo e con tutta la storia di git:   node test/make_archivi_vecchi.js
// Ogni momento ha la sua cartella in test/fixtures/archivi/<versione>@<commit>/ con archivio.json (nel formato del file vero: { rev, salvato, db }),
// registro.jsonl (nel formato del registro vero) e, se c'è un documento scansionato, documenti/. I momenti che hanno lo stesso codice dei dati
// hanno un archivio solo (vedi INDICE.json). Va rifatto a ogni versione che cambia la forma dei dati (logic.js o core.js), dopo il commit.
// 
// Ogni persona è inventata. Mai metterci dati veri.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs'), os = require('os'), path = require('path');

const ROOT = path.join(__dirname, '..');
const USCITA = path.join(__dirname, 'fixtures', 'archivi');
const OGGI = '2026-11-10', ADESSO = '2026-11-10T15:40:00';
const FILE_DOC = 'doc-0123456789abcdef.pdf';
// un PDF minimo ma vero (una pagina bianca): serve perché il documento dell'archivio abbia un file da aprire
const PDF_MINIMO = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n';

function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }); }
function confronta(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

/** I momenti da provare: [{ sha, ver }], dal più vecchio. Per ogni versione due: il commit in cui `var version` (win/main.go) cambia numero e l'ultimo
 *  prima che passi alla versione dopo (per l'ultima versione, HEAD). Le prime versioni cambiavano numero a lavoro finito, le ultime a lavoro iniziato:
 *  con i due momenti c'è sempre quello in cui la versione è stata consegnata. */
function versioni() {
  const cambi = new Map();
  for (const sha of git('log', '--format=%h', '-G^var version = "', '--', 'win/main.go').trim().split('\n').filter(Boolean)) {
    const m = /^var version = "([^"]+)"/m.exec(git('show', sha + ':win/main.go'));
    if (m && !cambi.has(m[1])) cambi.set(m[1], sha); // il commit in cui la versione cambia numero
  }
  const ord = [...cambi].map(([ver, sha]) => ({ ver, sha })).sort((a, b) => confronta(a.ver, b.ver)), out = [];
  ord.forEach((v, i) => {
    out.push({ ver: v.ver, sha: v.sha });
    out.push({ ver: v.ver, sha: git('rev-parse', '--short', i + 1 < ord.length ? ord[i + 1].sha + '^' : 'HEAD').trim() });
  });
  const visti = new Set();
  return out.filter((x) => !visti.has(x.sha) && visti.add(x.sha));
}

/** Il codice dei dati di una versione, scritto in una cartella di prova e caricato. */
function carica(v) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymart-vecchio-' + v.ver + '-'));
  const h = crypto.createHash('sha256');
  for (const f of ['core.js', 'logic.js']) { const t = git('show', v.sha + ':win/web/' + f); fs.writeFileSync(path.join(dir, f), t); h.update(t); }
  return { dir, hash: h.digest('hex'), L: require(path.join(dir, 'logic.js')), C: require(path.join(dir, 'core.js')) };
}

/* Le persone sono inventate; i campi che una versione non conosce, quella versione li ignora. */
const PERSONE = [
  { name: 'Rossi Maria', nascita: '2015-04-05', tel: '3331234567', genitore: 'Rossi Paolo', indirizzo: 'Via Roma 12', citta: 'Avezzano', cap: '67051', email: 'genitore.rossi@example.com', privacy: 'Sì', liberatoria: 'Sì',
    dataModulo: '2026-09-10', certTipo: 'Non Agonistico', certRilascio: '2026-03-10', certScadenza: '2027-03-10' },
  { name: 'Rossi Lia', nascita: '2012-09-20', tel: '3331234567', genitore: 'Rossi Paolo', indirizzo: 'Via Roma 12', citta: 'Avezzano', cap: '67051', tessera: 'FGI-0042',
    certTipo: 'Agonistico', certRilascio: '2025-10-01', certScadenza: '2026-10-01' },
  { name: 'Del Bosco Giulia', nascita: '2013-10-12', luogo: 'Avezzano', cf: 'DLBGLI13R52A345D', tel: '+39 347 000 1122', genitore: 'De Luca Antonella', citta: 'Magliano dei Marsi', cap: '67062',
    dataModulo: '2026-09-01', note: 'Prima iscrizione', certTipo: 'Non Agonistico', certRilascio: '2026-08-20', certScadenza: '2027-08-20' },
  { name: 'Bianchi Sara', nascita: '2015-05-06', tel: '+44 7700 900123', genitore: 'Bianchi Marco', indirizzo: 'Via XX Settembre 4', citta: 'Celano', cap: '67043',
    certTipo: 'Ludico-motoria', certRilascio: '2026-10-01', certScadenza: '2027-10-01' },
  { name: 'D\'Angelo Chiara', nascita: '2017-01-30', tel: '3470001122', tel2: '0863 123456', genitore: 'D\'Angelo Rosa', citta: 'Avezzano' },
  { name: 'Neri Daniela', nascita: '2010-12-25', tel: '3339998877', genitore: 'Neri Franca', certTipo: 'Non Agonistico', certRilascio: '2025-11-01', certScadenza: '2026-11-01' },
  { name: 'Verdi Anna', nascita: '2009-02-14', tel: '' }
];

/** Le iscrizioni: a = nome della persona. Le date sono vicine a OGGI per avere abbonamenti in corso, in scadenza e scaduti. */
const ISCRIZIONI = [
  { a: 'Rossi Maria', corso: 'Base', giorni: ['Lun', 'Mer'], tipo: 'Trimestrale', inizio: '2026-09-14', pac: 1 },
  { a: 'Rossi Lia', corso: 'Avanzato', giorni: ['Mar', 'Gio'], tipo: 'Mensile', inizio: '2026-10-20', pac: 1 },
  { a: 'Del Bosco Giulia', corso: 'Base', giorni: ['Lun'], tipo: 'Annuale', inizio: '2026-09-01', pac: 0 },
  { a: 'Bianchi Sara', corso: 'Propedeutico', giorni: ['Sab'], tipo: 'Trimestrale', inizio: '2026-08-01', pac: 0 },
  { a: 'D\'Angelo Chiara', corso: 'Propedeutico', giorni: ['Sab'], tipo: 'Mensile', inizio: '2026-11-03', pac: 0 },
  { a: 'Neri Daniela', corso: 'Base', giorni: ['Gio'], tipo: 'Trimestrale', inizio: '2026-08-20', pac: 0, annullata: true },
  { a: 'Verdi Anna', corso: 'Base', giorni: ['Ven'], tipo: 'Semestrale', inizio: '2026-03-01', pac: 0, soloSeEsiste: 'Semestrale' }
];

function scenario(vers, versioneL) {
  const { L, C } = versioneL, saltati = [], registro = [];
  let db = L.nuovoArchivio(OGGI), documento = false;
  const ids = {}, isc = {};
  const passo = (nome, fn) => { try { fn(); } catch (e) { saltati.push(nome + ': ' + e.message.split('\n')[0]); } };
  const applica = (r) => { db = r.db; for (const x of r.registro || []) registro.push(x); return r; };
  const tariffa = (i) => { const t = (db.tariffario || [])[i % Math.max(1, (db.tariffario || []).length)] || {}; return t.chiave || ((t.pacchetto || 'Corso Base e Avanzato') + ' · ' + (t.frequenza || '2 giorni/settimana')); };
  const tipi = (L.TIPI || []).map((t) => t.nome);

  for (const p of PERSONE) passo('allieva ' + p.name, () => { const r = applica(L.salvaAllieva(db, null, Object.assign({}, p), ADESSO)); ids[p.name] = r.id; });
  for (const x of ISCRIZIONI) passo('iscrizione ' + x.a, () => {
    if (x.soloSeEsiste && tipi.length && !tipi.includes(x.soloSeEsiste)) return; // il tipo non esiste in questa versione
    const f = { allievaId: ids[x.a], corso: x.corso, giorni: x.giorni, fascia: (db.liste.fasce || [])[0] || '17:00-18:30', pacchetto: tariffa(x.pac), tipo: x.tipo, inizio: x.inizio, quota: '', annullata: false };
    const r = applica(L.salvaIscrizione(db, null, f, ADESSO)); isc[x.a] = r.id;
    if (x.annullata) applica(L.salvaIscrizione(db, r.id, Object.assign({}, f, { annullata: true }), ADESSO));
  });
  const pag = (a, importo, metodo, data, note) => passo('pagamento ' + a + ' ' + importo, () => applica(L.salvaPagamento(db, { iscrizioneId: isc[a], importo, metodo, data, note: note || '' }, ADESSO)));
  pag('Rossi Maria', 100, 'Contanti', '2026-09-14', 'acconto');
  pag('Rossi Maria', 70, 'Bonifico', '2026-10-02');
  pag('Rossi Lia', 60, 'POS', '2026-10-20');
  pag('Del Bosco Giulia', 500, 'Bonifico', '2026-09-02', 'saldo annuale');
  pag('Bianchi Sara', 105, 'Contanti', '2026-08-01');
  pag('D\'Angelo Chiara', 35, 'Contanti', '2026-11-03');
  passo('archivia Verdi Anna', () => { if (typeof L.archiviaAllieva === 'function') applica(L.archiviaAllieva(db, ids['Verdi Anna'], true, ADESSO)); else applica(L.salvaAllieva(db, ids['Verdi Anna'], Object.assign({}, PERSONE[6], { archiviata: true }), ADESSO)); });
  passo('rinnovo Bianchi Sara', () => applica(L.rinnova(db, isc['Bianchi Sara'], ADESSO, OGGI)));
  passo('verifica di un bonifico', () => { if (typeof L.verificaPagamento !== 'function') return; const b = db.pagamenti.find((p) => p.metodo === 'Bonifico'); if (b) applica(L.verificaPagamento(db, b.id, true, ADESSO)); });
  passo('promemoria', () => { if (typeof L.segnaPromemoria !== 'function') return; applica(L.segnaPromemoria(db, { tipo: 'abbonamento', rif: isc['Bianchi Sara'], scadenza: '2026-11-01', on: true }, ADESSO, OGGI)); });
  passo('certificato di una persona senza (1.16+)', () => { if (typeof L.salvaCertificato !== 'function') return; applica(L.salvaCertificato(db, { allievaId: ids['Verdi Anna'], certTipo: 'Non Agonistico', rilascio: '2026-02-01', scadenza: '2027-02-01' }, ADESSO, OGGI)); });
  passo('documento scansionato (1.15+)', () => {
    if (typeof L.salvaDocumento !== 'function') return;
    applica(L.salvaDocumento(db, { allievaId: ids['Rossi Maria'], file: FILE_DOC, nome: 'certificato.pdf', certTipo: 'Non Agonistico', rilascio: '2026-03-10', scadenza: '2027-03-10', aggiornaCertificato: true }, ADESSO, OGGI));
    documento = true;
  });
  passo('note (1.18+)', () => {
    if (typeof L.salvaNota !== 'function') return;
    applica(L.salvaNota(db, null, { testo: 'Chiamare il comune per la palestra', data: OGGI }, ADESSO, OGGI));
    applica(L.salvaNota(db, null, { testo: 'La famiglia preferisce essere chiamata la sera', allievaId: ids['Rossi Maria'] }, ADESSO, OGGI));
    applica(L.salvaNota(db, null, { testo: 'Palestra chiusa per le feste', data: '2026-12-24', dataFine: '2026-12-27' }, ADESSO, OGGI));
  });
  passo('impostazioni dell\'associazione', () => { for (const [k, v] of [['legale', 'Verdi Giuseppe'], ['ente', 'CSEN'], ['codice', 'AQ-123'], ['cfAssociazione', '90012345678']]) if (k in db.impostazioni) db.impostazioni[k] = v; });
  passo('copia scaricata', () => { if (typeof L.segnaCopia === 'function') applica(L.segnaCopia(db, OGGI)); });
  return { db, saltati, registro, documento };
}

function registroJsonl(registro) {
  return registro.map((e, i) => JSON.stringify({ quando: '2026-11-10T' + String(9 + Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + ':00+01:00', allieva: e.allieva || '', operazione: e.operazione || '', campo: e.campo || undefined, prima: e.prima || undefined, dopo: e.dopo || undefined, nota: e.nota || undefined })).join('\n') + '\n';
}

(function main() {
  fs.rmSync(USCITA, { recursive: true, force: true });
  fs.mkdirSync(USCITA, { recursive: true });
  const indice = [], perCodice = new Map();
  for (const v of versioni()) {
    const cod = carica(v);
    if (perCodice.has(cod.hash)) { const g = perCodice.get(cod.hash); if (!g.usataDa.includes(v.ver)) g.usataDa.push(v.ver); continue; } // stesso codice dei dati di un momento già fatto
    const { db, saltati, registro, documento } = scenario(v.ver, cod);
    const nomeDir = v.ver + '@' + v.sha;
    const dir = path.join(USCITA, nomeDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'archivio.json'), JSON.stringify({ rev: 20 + registro.length, salvato: ADESSO + '+01:00', db }, null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'registro.jsonl'), registroJsonl(registro));
    if (documento) { fs.mkdirSync(path.join(dir, 'documenti'), { recursive: true }); fs.writeFileSync(path.join(dir, 'documenti', FILE_DOC), PDF_MINIMO); }
    const voce = { versione: v.ver, dir: nomeDir, commit: v.sha, usataDa: [v.ver], allieve: db.allieve.length, iscrizioni: db.iscrizioni.length, pagamenti: (db.pagamenti || []).length, note: (db.note || []).length, registro: registro.length, passiSaltati: saltati };
    perCodice.set(cod.hash, voce); indice.push(voce);
    console.log(nomeDir.padEnd(16), String(db.allieve.length).padStart(2), 'allieve', String(db.iscrizioni.length).padStart(2), 'iscrizioni', String((db.pagamenti || []).length).padStart(2), 'pagamenti', String((db.note || []).length).padStart(2), 'note', saltati.length ? ' SALTATI: ' + saltati.join(' | ') : '');
  }
  fs.writeFileSync(path.join(USCITA, 'INDICE.json'), JSON.stringify({ data: OGGI, nota: 'Archivi inventati fatti dal codice vero di ogni versione (git). Non modificare a mano: node test/make_archivi_vecchi.js', versioni: indice }, null, 1) + '\n');
  console.log('\n' + indice.length + ' archivi in ' + path.relative(ROOT, USCITA));
})();
