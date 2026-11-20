'use strict';
// La versione di oggi apre gli archivi fatti dalle versioni passate, e ci può lavorare. Gli archivi (test/fixtures/archivi) li ha fatti
// test/make_archivi_vecchi.js con il codice vero di ogni versione (logic.js e core.js presi dalla storia di git), con persone inventate:
// 7 allieve, una famiglia, iscrizioni di ogni tipo (anche «Semestrale», tolto dalla 1.4.0), pagamenti, un bonifico verificato, certificati,
// note, un promemoria, un'allieva archiviata, un rinnovo. Run: node --test test/win.migrazione.test.js
// Questo è quello che succede a una segreteria quando il programma si aggiorna da solo: il file dei dati resta, il codice cambia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../win/web/logic.js');
const A = require('../win/web/assistente.js');

const DIR = path.join(__dirname, 'fixtures', 'archivi');
const OGGI = '2026-11-10', ADESSO = '2026-11-10T15:40:00';
const GIORNI = [OGGI, '2026-12-20', '2027-03-15', '2027-09-30']; // anche giorni più avanti: gli stati (scaduto, in scadenza) cambiano
const indice = JSON.parse(fs.readFileSync(path.join(DIR, 'INDICE.json'), 'utf8')).versioni;
const leggi = (dir) => JSON.parse(fs.readFileSync(path.join(DIR, dir, 'archivio.json'), 'utf8'));

/** Cerca dentro un risultato i segni di una pagina rotta: numeri che non sono numeri, «undefined», «NaN», «[object». */
function guasti(v, p, out, visti = new Set()) {
  if (typeof v === 'number' && !Number.isFinite(v)) out.push(p + ' = ' + v);
  else if (typeof v === 'string' && /undefined|NaN|\[object|Invalid Date/.test(v)) out.push(p + ' = ' + JSON.stringify(v).slice(0, 80));
  else if (v && typeof v === 'object' && !visti.has(v)) { visti.add(v); for (const k of Object.keys(v)) guasti(v[k], p + '.' + k, out, visti); }
  return out;
}
function senzaGuasti(nome, v) { const g = guasti(v, nome, []); assert.deepEqual(g, [], g.slice(0, 3).join(' | ')); return v; }
function idUnici(db) {
  for (const k of ['allieve', 'iscrizioni', 'pagamenti', 'note', 'documenti']) { const ids = (db[k] || []).map((x) => x.id); assert.equal(new Set(ids).size, ids.length, 'identificativi doppi in ' + k + ': ' + ids.join(',')); }
}

test('gli archivi di prova ci sono: da 1.0.0 fino a oggi, ognuno con il suo registro', () => {
  assert.ok(indice.length >= 14, 'archivi: ' + indice.length);
  assert.equal(indice[0].versione, '1.0.0');
  assert.ok(indice.some((v) => v.usataDa.includes('1.21.1')), 'manca la forma dei dati di oggi');
  for (const v of indice) {
    assert.ok(fs.existsSync(path.join(DIR, v.dir, 'archivio.json')) && fs.existsSync(path.join(DIR, v.dir, 'registro.jsonl')), v.dir);
    assert.equal(leggi(v.dir).db.allieve.length, v.allieve, v.dir);
  }
  // nessun dato vero: tutte le persone sono inventate (la stessa lista di test/make_archivi_vecchi.js)
  const nomi = new Set(['Rossi Maria', 'Rossi Lia', 'Del Bosco Giulia', 'Bianchi Sara', 'D\'Angelo Chiara', 'Neri Daniela', 'Verdi Anna']);
  for (const v of indice) for (const a of leggi(v.dir).db.allieve) assert.ok(nomi.has(a.name), v.dir + ': ' + a.name);
});

for (const v of indice) {
  const nome = v.dir + (v.usataDa.length > 1 ? ' (= ' + v.usataDa.join(', ') + ')' : '');

  test(nome + ': si apre come fa la pagina, e non si perde niente', () => {
    const env = leggi(v.dir);
    assert.ok(!L.validaArchivio(env.db), 'la pagina lo rifiuterebbe: ' + L.validaArchivio(env.db));
    const db = L.completa(env.db, OGGI);
    assert.ok(!L.validaArchivio(db));
    for (const k of ['allieve', 'iscrizioni', 'pagamenti']) {
      const prima = env.db[k] || [];
      assert.deepEqual(db[k].slice(0, prima.length), prima, k + ': i dati vecchi non vengono toccati');
    }
    assert.deepEqual(L.completa(db, OGGI), db, 'completare due volte non cambia niente');
    assert.equal(db.schema, L.completa(L.nuovoArchivio(OGGI), OGGI).schema);
    for (const k of ['impostazioni', 'liste', 'tariffario', 'promemoria', 'documenti', 'note', 'prossimi']) assert.ok(db[k] && typeof db[k] === 'object', 'dopo completa manca ' + k);
    // i numeri da dare ai prossimi non riusano quelli già dati
    for (const [lista, chiave] of [['allieve', 'allieva'], ['iscrizioni', 'iscrizione'], ['pagamenti', 'pagamento']]) {
      const max = Math.max(0, ...db[lista].map((x) => parseInt(x.id, 10)));
      assert.ok(db.prossimi[chiave] > max, 'prossimi.' + chiave + ' = ' + db.prossimi[chiave] + ' ma c\'è già il n. ' + max);
    }
    idUnici(db);
    // sopravvive al passaggio dal disco (JSON) com'è: è quello che fa il programma ad ogni salvataggio
    assert.deepEqual(JSON.parse(JSON.stringify(db)), db);
  });

  test(nome + ': tutte le pagine di lettura funzionano, in giorni diversi', () => {
    const db = L.completa(leggi(v.dir).db, OGGI);
    for (const g of GIORNI) {
      const t = (n, f) => senzaGuasti(g + ' ' + n, f());
      const r = t('riepilogo', () => L.riepilogo(db, g));
      assert.ok(Number.isInteger(r.allieve) && r.allieve >= 0 && r.allieve <= db.allieve.length, 'allieve nel riepilogo: ' + r.allieve);
      t('scadenze', () => L.scadenze(db, g)); t('elencoCertificati', () => L.elencoCertificati(db, g, {})); t('elencoPromemoria', () => L.elencoPromemoria(db, g, {}));
      t('elencoNote', () => L.elencoNote(db, g)); t('calendario', () => L.calendarioMese(db, g, +g.slice(0, 4), +g.slice(5, 7)));
      t('analisi 12 mesi', () => L.analisi(db, g, '12mesi')); t('analisi stagione', () => L.analisi(db, g, 'stagione')); t('previsione rinnovi', () => L.previsioneRinnovi(db, g, 6));
      t('da incassare', () => L.daIncassare(db)); t('da verificare', () => L.daVerificare(db)); t('corsi', () => L.corsiRiepilogo(db));
      t('iscritte', () => L.iscritte(db, { corso: 'Base', giorno: '' }, g)); t('ricerca', () => L.cercaAllieve(db, 'rossi', 'tutte')); t('compleanni', () => L.compleanni(db, g, 0));
      t('incassi', () => L.incassi(db, { dal: '', al: '', metodo: '', q: '' })); t('promemoria copia', () => L.promemoriaCopia(db, g, { cartella: '' })); t('scadenze certificati', () => L.scadenzeCertificati(db, g));
      for (const a of db.allieve) { t('certificato ' + a.id, () => L.statoCertificato(db, a, g)); t('conto allieva ' + a.id, () => L.contoAllieva(db, a.id)); t('famiglia ' + a.id, () => L.famiglia(db, a.id)); }
      for (const e of db.iscrizioni) { t('stato ' + e.id, () => L.statoIscrizione(db, e, g)); t('conto ' + e.id, () => L.conto(db, e)); t('scadenza ' + e.id, () => L.scadenza(e)); }
      t('assistente: consigli', () => A.consigli(db, g, {}));
      for (const d of ['chi deve rinnovare', 'certificati mancanti', 'quanto devo incassare', 'che note ho', 'rossi maria']) t('assistente: ' + d, () => A.rispondi(db, d, g, { manuale: [], ora: 10 }));
    }
    for (const f of ['csvAllieve', 'csvIscrizioni', 'csvPagamenti']) assert.ok(!/undefined|NaN/.test(L[f](db, OGGI)), f);
    senzaGuasti('excel', L.tabelleExcel(db, OGGI));
    // gli elenchi non perdono nessuno: ogni allieva è tra le «tutte» o tra le archiviate, ogni iscrizione è nel CSV
    assert.equal(L.cercaAllieve(db, '', 'tutte').length + L.cercaAllieve(db, '', 'archiviate').length, db.allieve.length);
    assert.equal(L.csvIscrizioni(db, OGGI).trim().split('\n').length, db.iscrizioni.length + 1);
  });

  test(nome + ': ci si lavora con la versione di oggi (nuova persona, pagamento, rinnovo, nota, stagione) e l\'archivio resta valido', () => {
    const db0 = L.completa(leggi(v.dir).db, OGGI);
    const copia = JSON.stringify(db0);
    const valido = (r, cosa) => { assert.ok(!L.validaArchivio(r.db), cosa + ': ' + L.validaArchivio(r.db)); idUnici(r.db); return r.db; };
    // una persona nuova con la sua iscrizione, e un pagamento
    const fA = { name: 'Gialli Elena', nascita: '2016-02-02', tel: '3335556677', genitore: 'Gialli Marco', privacy: 'Sì' };
    const fI = { allievaId: '', corso: 'Base', giorni: ['Lun', 'Mer'], fascia: '17:00-18:30', pacchetto: 'Corso Base e Avanzato · 2 giorni/settimana', tipo: 'Trimestrale', inizio: OGGI, quota: '' };
    const nuova = L.salvaNuovaIscrizione(db0, fA, fI, ADESSO);
    let db = valido(nuova, 'nuova iscrizione');
    assert.deepEqual([db.allieve.length, db.iscrizioni.length], [db0.allieve.length + 1, db0.iscrizioni.length + 1]);
    assert.ok(!db0.allieve.some((a) => a.id === nuova.idAllieva) && !db0.iscrizioni.some((e) => e.id === nuova.id), 'i numeri nuovi non sono già stati dati');
    assert.equal(JSON.stringify(db0), copia, 'l\'archivio di partenza non è stato toccato');
    if (typeof L.salvaPagamento === 'function' && db.pagamenti) {
      const p = L.salvaPagamento(db, { iscrizioneId: nuova.id, importo: 50, metodo: 'Contanti', data: OGGI }, ADESSO);
      db = valido(p, 'pagamento');
      assert.equal(L.byId(db.pagamenti, p.id).ricevuta, 'RIC-' + nuova.id + '-1');
      // un pagamento su un'iscrizione che ne ha già: la ricevuta non riusa un numero già dato
      const conPagamenti = db.iscrizioni.find((e) => db0.pagamenti.some((x) => x.iscrizioneId === e.id)); // le versioni prima della 1.2.0 non avevano i pagamenti
      if (conPagamenti) {
        const prima = new Set(db.pagamenti.map((x) => x.ricevuta));
        const p2 = L.salvaPagamento(db, { iscrizioneId: conPagamenti.id, importo: 10, metodo: 'POS', data: OGGI }, ADESSO);
        db = valido(p2, 'secondo pagamento');
        assert.ok(!prima.has(L.byId(db.pagamenti, p2.id).ricevuta), 'una ricevuta nuova: ' + L.byId(db.pagamenti, p2.id).ricevuta);
        senzaGuasti('conto', L.conto(db, conPagamenti)); assert.ok(L.datiRicevuta(db, p2.id), 'la ricevuta si può stampare');
      } else assert.ok(db0.pagamenti.length === 0, 'senza pagamenti vecchi: ' + v.dir);
    }
    // il rinnovo di un'iscrizione aperta, e la modifica di una persona
    const aperta = db.iscrizioni.find((e) => L.corrente(e) && e.id !== nuova.id);
    const rin = L.rinnova(db, aperta.id, ADESSO, OGGI); db = valido(rin, 'rinnovo');
    assert.equal(db.iscrizioni.length, db0.iscrizioni.length + 2);
    assert.equal(L.byId(db.iscrizioni, aperta.id).storica, true, 'quella vecchia passa nello storico');
    const mod = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { tel: '3330000000' }), ADESSO);
    db = valido(mod, 'modifica allieva'); assert.equal(L.byId(db.allieve, '0001').tel, '3330000000'); assert.ok(mod.registro.length === 1, 'una riga di registro: ' + mod.registro.length);
    // una nota (dalla 1.18) e un promemoria segnato (dalla 1.7)
    if (typeof L.salvaNota === 'function') { const n = L.salvaNota(db, null, { testo: 'Prova', data: OGGI }, ADESSO, OGGI); db = valido(n, 'nota'); assert.equal(db.note.length, db0.note.length + 1); }
    // la nuova stagione, su tutto quello che c'è (dalla 1.6)
    if (typeof L.pianoStagione === 'function') {
      const piano = L.pianoStagione(db, '2027-09-01', '2027-09-15');
      const scelte = Object.fromEntries(piano.righe.map((r) => [r.iscrizione.id, r.scelta]));
      const o = { stagione: '2027/2028', inizio: '2027-09-15', scelte, quotaIscrizione: false, mantieniQuote: true };
      assert.deepEqual(L.controllaStagione(db, o, '2027-09-01').errors, []);
      const ns = L.nuovaStagione(db, o, ADESSO, '2027-09-01'); db = valido(ns, 'nuova stagione');
      assert.equal(db.impostazioni.stagione, '2027/2028');
      senzaGuasti('riepilogo stagione', ns.riepilogo);
    }
    // e dopo tutto questo i dati si leggono ancora
    for (const g of ['2027-09-20', '2028-01-10']) { senzaGuasti('riepilogo ' + g, L.riepilogo(db, g)); senzaGuasti('scadenze ' + g, L.scadenze(db, g)); }
  });
}

test('le iscrizioni «Semestrale» (tipo tolto dalla 1.4.0) non rompono niente: si leggono, avvisano che manca la quota, si rinnovano', () => {
  const vecchie = indice.filter((v) => leggi(v.dir).db.iscrizioni.some((e) => e.tipo === 'Semestrale'));
  assert.ok(vecchie.length >= 2 && vecchie.every((v) => v.versione <= '1.3.0'), 'i momenti con il tipo Semestrale: ' + vecchie.map((v) => v.dir).join(', '));
  for (const v of vecchie) {
    const db = L.completa(leggi(v.dir).db, OGGI), e = db.iscrizioni.find((x) => x.tipo === 'Semestrale');
    assert.equal(L.scadenza(e), '2026-09-01', 'sei mesi dall\'inizio');
    assert.equal(L.statoIscrizione(db, e, OGGI).stato, 'SCADUTO');
    assert.equal(L.conto(db, e).stato, 'SENZA QUOTA');
    const chk = L.controllaIscrizione(db, Object.assign({}, e, { id: e.id }), e.id, OGGI);
    assert.deepEqual(chk.errors, []); assert.match(chk.warnings.join(' '), /Semestrale/);
    const r = L.rinnova(db, e.id, ADESSO, OGGI); assert.ok(!L.validaArchivio(r.db));
  }
});
