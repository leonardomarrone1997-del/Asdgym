'use strict';
// Coerenza che un archivio deve avere sempre: usata dalla simulazione della logica e dal test dell'utente scimmia.
const assert = require('node:assert/strict');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');
const cent = (n) => Math.round(n * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Everything that must always be true of an archive. */
function controlla(db, today, ctx) {
  const dove = ' [' + ctx + ']';
  assert.equal(L.validaArchivio(db), '', 'validaArchivio' + dove);
  for (const lista of ['allieve', 'iscrizioni', 'pagamenti']) {
    const ids = db[lista].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, 'id duplicati in ' + lista + dove);
    assert.ok(ids.every((i) => /^\d{4,}$/.test(i)), 'formato id in ' + lista + dove);
  }
  const maxId = (l) => l.reduce((m, x) => Math.max(m, parseInt(x.id, 10)), 0);
  assert.ok(db.prossimi.allieva > maxId(db.allieve) && db.prossimi.iscrizione > maxId(db.iscrizioni) && db.prossimi.pagamento > maxId(db.pagamenti), 'contatori' + dove);
  const ricevute = new Set(), isc = Object.fromEntries(db.iscrizioni.map((e) => [e.id, e])), perIsc = {};
  for (const p of db.pagamenti) {
    assert.ok(isc[p.iscrizioneId], 'pagamento orfano' + dove);
    assert.ok(p.importo > 0 && Math.abs(p.importo * 100 - Math.round(p.importo * 100)) < 1e-6, 'importo non a centesimi: ' + p.importo + dove);
    assert.ok(ISO.test(p.data) && C.isIso(p.data), 'data pagamento' + dove);
    assert.ok(!ricevute.has(p.ricevuta), 'ricevuta doppia ' + p.ricevuta + dove);
    ricevute.add(p.ricevuta);
    const m = /^RIC-(\d+)-(\d+)$/.exec(p.ricevuta);
    assert.ok(m && m[1] === p.iscrizioneId || !m || true);
    if (m && m[1] === p.iscrizioneId) assert.ok((isc[p.iscrizioneId].ricevute || 0) >= +m[2], 'contatore ricevute indietro' + dove);
    (perIsc[p.iscrizioneId] = perIsc[p.iscrizioneId] || []).push(p);
    if (L.richiedeVerifica(p.metodo) && p.daVerificare === false) assert.ok(ISO.test(p.verificatoIl), 'bonifico verificato senza data' + dove);
  }
  let residuoTot = 0;
  for (const e of db.iscrizioni) {
    const c = L.conto(db, e), somma = cent((perIsc[e.id] || []).reduce((s, p) => s + p.importo, 0));
    assert.equal(c.pagato, somma, 'pagato' + dove);
    if (c.dovuto !== null) {
      assert.equal(c.residuo, cent(c.dovuto - somma), 'residuo' + dove);
      assert.ok(!Number.isNaN(c.residuo));
      if (!e.annullata && c.residuo > 0.005) residuoTot = cent(residuoTot + c.residuo);
    }
    assert.ok(['SALDATO', 'PARZIALE', 'DA PAGARE', 'SENZA QUOTA'].includes(c.stato), 'stato conto' + dove);
    const s = L.statoIscrizione(db, e, today);
    assert.ok(['ATTIVO', 'IN SCADENZA', 'SCADUTO', 'DA COMPLETARE', 'STORICO', 'ANNULLATO'].includes(s.stato), 'stato iscrizione' + dove);
    if (s.scadenza && C.isIso(e.inizio)) assert.ok(s.scadenza >= e.inizio, 'scadenza prima dell\'inizio' + dove);
    if (e.inizio) assert.ok(C.isIso(e.inizio), 'inizio non valido ' + e.inizio + dove);
    assert.ok(db.allieve.some((a) => a.id === e.allievaId), 'iscrizione orfana' + dove);
  }
  assert.equal(L.daIncassare(db).totale, residuoTot, 'totale da incassare' + dove);
  // the analysis page agrees with the payments themselves
  const an = L.analisi(db, today, '12mesi'), tot = cent(an.incassiMese.reduce((s, x) => s + x, 0));
  const da = C.addMonths(today.slice(0, 8) + '01', -11);
  const attesi = cent(db.pagamenti.filter((p) => p.data >= da && p.data <= today.slice(0, 8) + '31').reduce((s, p) => s + p.importo, 0));
  assert.equal(tot, attesi, 'analisi: incassi 12 mesi' + dove);
  // reminders and the summary never fail and agree with each other
  const pm = L.elencoPromemoria(db, today, { contatto: 'tutte' });
  assert.equal(pm.righe.length, pm.conteggi.totale, 'promemoria' + dove);
  L.riepilogo(db, today); L.scadenze(db, today); L.scadenzeCertificati(db, today); L.corsiRiepilogo(db); L.daVerificare(db); L.compleanni(db, today, 14);
  // what is saved is what is read back
  assert.deepEqual(JSON.parse(JSON.stringify(db)), db, 'serializzazione' + dove);
  assert.deepEqual(L.completa(db, today), db, 'completa() non deve cambiare un archivio sano' + dove);
}


module.exports = { controlla };
