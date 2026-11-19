'use strict';
// Logic of the Windows program (win/web/logic.js). Run: node --test test/win.test.js
// Every person here is invented.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');

const TODAY = '2026-11-10';
const NOW = '2026-11-10T15:40:00';
const PAC2 = 'Corso Base e Avanzato · 2 giorni/settimana';
// the settings every archive has, plus the ones a test sets
const IMP = (o) => Object.assign({ preavvisoCert: 30, giorniCertificato: 15, messaggioCertificato: '', legale: '', ente: '', codice: '', cfAssociazione: '' }, o);

function archivio() {
  let db = L.nuovoArchivio(TODAY);
  db = L.salvaAllieva(db, null, { name: 'del bosco giulia', nascita: '2013-10-12', cf: 'dlb gli13r52 a345d', tel: '+39 347 000 1122', genitore: 'DE LUCA ANTONELLA', citta: 'MAGLIANO DEI MARSI', privacy: 'Sì', liberatoria: 'Sì' }, NOW).db;
  db = L.salvaAllieva(db, null, { name: 'Rossi Maria', nascita: '2015-04-05', tel: '3331234567' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Mer', 'Lun'], fascia: '17:00', pacchetto: PAC2, tipo: 'Trimestrale', inizio: '2026-10-01', quota: '' }, NOW).db;
  return db;
}

test('the copies in win/web are the files in src/', () => {
  for (const f of ['core.js', 'pdf.js']) {
    assert.equal(fs.readFileSync(path.join(__dirname, '../win/web', f), 'utf8'), fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'), f + ' is stale: run node build_win.js --solo-copia');
  }
});

test('nuovoArchivio, stagioneDi, validaArchivio, completa', () => {
  const db = L.nuovoArchivio(TODAY);
  assert.equal(db.impostazioni.stagione, '2026/2027');
  assert.equal(L.stagioneDi('2027-03-01'), '2026/2027');
  assert.equal(L.stagioneDi('2027-08-01'), '2027/2028');
  assert.equal(db.tariffario.length, 7);
  assert.equal(db.tariffario[1].chiave, PAC2);
  assert.equal(L.validaArchivio(db), '');
  assert.equal(L.validaArchivio(archivio()), '');
  assert.match(L.validaArchivio(null), /archivio/);
  assert.match(L.validaArchivio([]), /archivio/);
  assert.match(L.validaArchivio({ allieve: [] }), /Gym Art/);
  assert.match(L.validaArchivio({ schema: 99, allieve: [], iscrizioni: [] }), /più recente/);
  assert.match(L.validaArchivio({ allieve: [{ id: '0001', name: 'A B' }, { id: '0001', name: 'C D' }], iscrizioni: [] }), /stesso numero/);
  assert.match(L.validaArchivio({ allieve: [{ id: '0001', name: '' }], iscrizioni: [] }), /senza nome/);
  assert.match(L.validaArchivio({ allieve: [], iscrizioni: [{ id: '0001', allievaId: '0009' }] }), /nessuna allieva/);
  // an old or hand-made archive gets what it lacks, and counters never reuse a number
  const c = L.completa({ allieve: [{ id: '0007', name: 'Rossi Maria' }], iscrizioni: [], prossimi: { allieva: 2 } }, TODAY);
  assert.equal(c.prossimi.allieva, 8);
  assert.equal(c.prossimi.iscrizione, 1);
  assert.equal(c.impostazioni.preavvisoAbb, 30);
  assert.ok(c.liste.corsi.length > 0 && c.tariffario.length > 0);
});

test('salvaAllieva: new student is cleaned, numbered and logged; the old archive is untouched', () => {
  const db0 = L.nuovoArchivio(TODAY);
  const r = L.salvaAllieva(db0, null, { name: '  del BOSCO giulia ', nascita: '12/10/2013', cf: 'dlb gli13r52 a345d', tel: '+39 347 000 1122', email: ' Mamma@Example.COM ', citta: 'MAGLIANO DEI MARSI', indirizzo: 'VIA DEI MILLE 76', privacy: 'Sì', liberatoria: 'forse' }, NOW);
  assert.equal(db0.allieve.length, 0);
  assert.equal(r.id, '0001');
  const a = r.db.allieve[0];
  assert.equal(a.name, 'Del Bosco Giulia');
  assert.equal(a.nascita, '2013-10-12');
  assert.equal(a.cf, 'DLBGLI13R52A345D');
  assert.equal(a.tel, '3470001122');
  assert.equal(a.email, 'mamma@example.com');
  assert.equal(a.citta, 'Magliano dei Marsi');
  assert.equal(a.indirizzo, 'Via dei Mille 76');
  assert.equal(a.privacy, 'Sì');
  assert.equal(a.liberatoria, '', 'only Sì / No are kept');
  assert.equal(a.archiviata, false);
  assert.equal(r.db.prossimi.allieva, 2);
  assert.deepEqual(r.registro[0], { allieva: 'Del Bosco Giulia', operazione: 'Nuova allieva', campo: '', prima: '', dopo: '', nota: 'n. 0001' });
  assert.deepEqual(r.registro.find((x) => x.campo === 'Data di nascita'), { allieva: 'Del Bosco Giulia', operazione: 'Nuova allieva', campo: 'Data di nascita', prima: '', dopo: '12/10/2013', nota: '' });
  assert.equal(L.salvaAllieva(r.db, null, { name: 'Rossi Maria' }, NOW).id, '0002');
});

test('salvaAllieva: an edit logs each changed field with the previous value', () => {
  const db = archivio(), cur = L.byId(db.allieve, '0001');
  const r = L.salvaAllieva(db, '0001', Object.assign({}, cur, { tel: '3331234567', cap: '67062' }), '2026-11-11T09:00:00');
  assert.deepEqual(r.registro, [
    { allieva: 'Del Bosco Giulia', operazione: 'Modifica allieva', campo: 'CAP', prima: '', dopo: '67062', nota: '' },
    { allieva: 'Del Bosco Giulia', operazione: 'Modifica allieva', campo: 'Telefono', prima: '3470001122', dopo: '3331234567', nota: '' }
  ]);
  assert.equal(L.byId(r.db.allieve, '0001').modificata, '2026-11-11T09:00:00');
  assert.equal(L.byId(db.allieve, '0001').tel, '3470001122');
  const same = L.salvaAllieva(db, '0001', cur, '2026-11-11T09:00:00');
  assert.deepEqual(same.registro, []);
  assert.equal(L.byId(same.db.allieve, '0001').modificata, NOW);
  assert.throws(() => L.salvaAllieva(db, '0099', cur, NOW), /non trovata/);
});

test('controllaAllieva: errors stop, warnings inform', () => {
  const db = archivio();
  const ok = L.controllaAllieva(db, { name: 'Bianchi Sara', nascita: '2016-02-10', tel: '3339998877' }, null, TODAY);
  assert.deepEqual(ok.errors, []); assert.deepEqual(ok.warnings, []);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi' }, null, TODAY).errors[0], /due parole/);
  assert.match(L.controllaAllieva(db, { name: '' }, null, TODAY).errors[0], /Manca cognome/);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi Sara', cf: 'DLBGLI13R52A345X' }, null, TODAY).errors.join(' '), /Codice fiscale atleta/);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi Sara', nascita: '2026-02-10' }, null, TODAY).errors.join(' '), /impossibile/);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi Sara', tel: '123' }, null, TODAY).errors.join(' '), /Telefono non valido/);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi Sara', email: 'sara@' }, null, TODAY).errors.join(' '), /Email/);
  assert.match(L.controllaAllieva(db, { name: 'Bianchi Sara', cap: '670' }, null, TODAY).errors.join(' '), /CAP/);
  // same name as another student: a warning (two people can share a name), not when editing herself
  assert.match(L.controllaAllieva(db, { name: 'giulia DEL bosco', tel: '3339998877', nascita: '2014-01-01' }, null, TODAY).warnings.join(' '), /stesso nome.*n\. 0001.*12\/10\/2013/);
  assert.equal(L.controllaAllieva(db, L.byId(db.allieve, '0001'), '0001', TODAY).warnings.join(' ').includes('stesso nome'), false);
  assert.match(L.controllaAllieva(db, { name: 'Del Bosco Giula', tel: '3339998877', nascita: '2014-01-01' }, null, TODAY).warnings.join(' '), /molto simile/);
  // the same tax code on two students is an error
  assert.match(L.controllaAllieva(db, { name: 'Rossi Maria', cf: 'DLBGLI13R52A345D' }, '0002', TODAY).errors.join(' '), /già di Del Bosco Giulia/);
});

test('archiviaAllieva / eliminaAllieva', () => {
  const db = archivio();
  const ar = L.archiviaAllieva(db, '0001', true, NOW);
  assert.equal(L.byId(ar.db.allieve, '0001').archiviata, true);
  assert.equal(ar.registro[0].operazione, 'Allieva archiviata');
  assert.equal(L.archiviaAllieva(ar.db, '0001', false, NOW).registro[0].operazione, 'Allieva ripristinata');
  assert.throws(() => L.eliminaAllieva(db, '0001'), /ha delle iscrizioni/);
  const el = L.eliminaAllieva(db, '0002');
  assert.deepEqual(el.db.allieve.map((a) => a.id), ['0001']);
  assert.equal(db.allieve.length, 2);
  // a deleted number is not given to the next student
  assert.equal(L.salvaAllieva(el.db, null, { name: 'Bianchi Sara' }, NOW).id, '0003');
});

test('scadenza, statoIscrizione, quotaDovuta', () => {
  const db = archivio(), e = db.iscrizioni[0];
  assert.deepEqual(e.giorni, ['Lun', 'Mer']);
  assert.equal(e.quota, null);
  assert.equal(L.scadenza(e), '2027-01-01');
  assert.equal(L.scadenza({ tipo: 'Mensile', inizio: '2027-01-31' }), '2027-02-28');
  assert.equal(L.scadenza({ tipo: 'Semestrale', inizio: '2026-09-15' }), '2027-03-15');
  assert.equal(L.scadenza({ tipo: 'Annuale', inizio: '2026-09-15' }), '2027-09-15');
  assert.equal(L.scadenza({ tipo: '', inizio: '2026-09-15' }), '');
  assert.equal(L.scadenza({ tipo: 'Mensile', inizio: '' }), '');
  assert.deepEqual(L.statoIscrizione(db, e, TODAY), { stato: 'ATTIVO', scadenza: '2027-01-01', giorni: 52 });
  assert.equal(L.statoIscrizione(db, e, '2026-12-02').stato, 'IN SCADENZA'); // exactly 30 days
  assert.equal(L.statoIscrizione(db, e, '2026-12-01').stato, 'ATTIVO');
  assert.equal(L.statoIscrizione(db, e, '2027-01-01').stato, 'IN SCADENZA'); // the last day is still valid
  assert.deepEqual(L.statoIscrizione(db, e, '2027-01-02'), { stato: 'SCADUTO', scadenza: '2027-01-01', giorni: -1 });
  assert.equal(L.statoIscrizione(db, Object.assign({}, e, { tipo: '' }), TODAY).stato, 'DA COMPLETARE');
  assert.equal(L.statoIscrizione(db, Object.assign({}, e, { storica: true }), '2027-06-01').stato, 'STORICO');
  assert.equal(L.statoIscrizione(db, Object.assign({}, e, { annullata: true, storica: true }), TODAY).stato, 'ANNULLATO');
  assert.equal(L.quotaDovuta(db, e), 170);
  assert.equal(L.quotaDovuta(db, Object.assign({}, e, { quota: 150 })), 150);
  assert.equal(L.quotaDovuta(db, Object.assign({}, e, { quota: 0 })), 0, 'an agreed fee of zero is a fee');
  assert.equal(L.quotaDovuta(db, Object.assign({}, e, { tipo: 'Semestrale' })), null);
});

test('"Nuova iscrizione": a new student and her enrollment are one operation', () => {
  const db = archivio();
  const fA = { name: 'verdi anna', nascita: '2016-02-03', tel: '333 111 2233', genitore: 'verdi paolo', privacy: 'Sì', liberatoria: 'Sì' };
  const fI = { allievaId: '', corso: 'Base', giorni: ['Lun', 'Mer'], tipo: 'Trimestrale', inizio: '2026-11-01', quota: '' };
  // checks: the student's and the enrollment's problems come together; the enrollment is checked against a student that is not saved yet
  const ok = L.controllaNuovaIscrizione(db, fA, fI, TODAY);
  assert.deepEqual(ok.errors, []); assert.equal(ok.conIscrizione, true); assert.equal(ok.valori.corso, 'Base');
  const male = L.controllaNuovaIscrizione(db, Object.assign({}, fA, { name: '' }), Object.assign({}, fI, { corso: '' }), TODAY);
  assert.ok(male.errors.some((e) => /cognome e nome/i.test(e)) && male.errors.some((e) => /Scegli il corso/.test(e)), male.errors.join(' | '));
  assert.ok(!male.errors.some((e) => /Scegli l'allieva/.test(e)), 'the stand-in student is not reported as missing');
  // a name that already exists is only a warning, as in the student form
  assert.ok(L.controllaNuovaIscrizione(db, Object.assign({}, fA, { name: 'Rossi Maria' }), fI, TODAY).warnings.length > 0);
  // nothing written about the enrollment: only the student is saved (and checked)
  const vuota = { allievaId: '', corso: '', giorni: [], tipo: '', inizio: '2026-11-10', quota: '' };
  assert.equal(L.serveIscrizione(vuota), false);
  const soloA = L.controllaNuovaIscrizione(db, fA, vuota, TODAY);
  assert.deepEqual([soloA.errors, soloA.conIscrizione, soloA.valori], [[], false, null]);
  const rA = L.salvaNuovaIscrizione(db, fA, vuota, NOW);
  assert.deepEqual([rA.db.allieve.length, rA.db.iscrizioni.length, rA.id, rA.idAllieva], [db.allieve.length + 1, db.iscrizioni.length, null, '0003']);
  // saved together: one student, one enrollment, both in the log, the numbers advance
  const r = L.salvaNuovaIscrizione(db, fA, fI, NOW);
  assert.deepEqual([r.idAllieva, r.id, r.db.allieve.length, r.db.iscrizioni.length], ['0003', '0002', 3, 2]);
  const a = L.byId(r.db.allieve, '0003'), e = L.byId(r.db.iscrizioni, '0002');
  assert.deepEqual([a.name, a.tel, a.genitore, a.privacy, e.allievaId, e.corso, e.giorni], ['Verdi Anna', '3331112233', 'Verdi Paolo', 'Sì', '0003', 'Base', ['Lun', 'Mer']]);
  assert.deepEqual([...new Set(r.registro.map((x) => x.operazione))], ['Nuova allieva', 'Nuova iscrizione']);
  assert.ok(r.registro.every((x) => x.allieva === 'Verdi Anna'));
  assert.equal(db.allieve.length, 2, 'the old archive is not touched');
  // an existing student: only the enrollment, and it is always required
  const rE = L.salvaNuovaIscrizione(db, null, Object.assign({}, fI, { allievaId: '0002' }), NOW);
  assert.deepEqual([rE.idAllieva, rE.id, rE.db.allieve.length, rE.db.iscrizioni.length], ['0002', '0002', 2, 2]);
  assert.match(L.controllaNuovaIscrizione(db, null, Object.assign({}, vuota, { allievaId: '0002' }), TODAY).errors.join(' '), /Scegli il corso/);
  assert.match(L.controllaNuovaIscrizione(db, null, Object.assign({}, fI, { allievaId: '' }), TODAY).errors.join(' '), /Scegli l'allieva/);
  assert.throws(() => L.salvaNuovaIscrizione(db, null, Object.assign({}, fI, { allievaId: '0099' }), NOW), /non trovata/);
  assert.ok(!L.validaArchivio(r.db), 'the archive stays valid');
});

test('documents: a scanned certificate is a card in the archive and a file on disk', () => {
  const db = archivio(); // 0001 Del Bosco (open enrollment, certificate data empty), 0002 Rossi (no enrollment)
  const F = 'doc-0123456789abcdef.pdf', base = { allievaId: '0001', file: F, nome: 'scansione.pdf', certTipo: 'Agonistico', rilascio: '2026-09-10', scadenza: '2027-09-10', aggiornaCertificato: true };
  // checks
  assert.deepEqual(L.controllaDocumento(db, base, TODAY).errors, []);
  const e = (o) => L.controllaDocumento(db, Object.assign({}, base, o), TODAY);
  assert.match(e({ allievaId: '0099' }).errors.join(' '), /Allieva non trovata/);
  assert.match(e({ file: '../archivio.json' }).errors.join(' '), /file del documento/);
  assert.match(e({ file: 'doc-0123456789abcdef.exe' }).errors.join(' '), /file del documento/);
  assert.match(e({ certTipo: '' }).errors.join(' '), /Scegli il tipo/);
  assert.match(e({ certTipo: 'Boh' }).errors.join(' '), /Scegli il tipo/);
  assert.match(e({ rilascio: '' }).errors.join(' '), /rilascio mancante/);
  assert.match(e({ rilascio: '2027-01-01', scadenza: '2028-01-01' }).errors.join(' '), /nel futuro/);
  assert.match(e({ scadenza: '2026-01-01' }).errors.join(' '), /prima della data di rilascio/);
  assert.match(e({ scadenza: '' }).errors.join(' '), /Scadenza mancante/);
  assert.match(e({ rilascio: '2025-01-01', scadenza: '2026-01-01' }).warnings.join(' '), /già scaduto/);
  assert.match(e({ certTipo: 'Ludico-motoria' }).warnings.join(' '), /ludico-motoria/);
  // save: the card, the numbers, the log; the student's certificate becomes the one of the document
  const r = L.salvaDocumento(db, base, NOW, TODAY);
  assert.equal(r.id, '0001'); assert.equal(r.db.prossimi.documento, 2); assert.equal(db.documenti.length, 0, 'the old archive is not touched');
  assert.deepEqual(r.db.documenti.map((d) => [d.id, d.allievaId, d.tipo, d.file, d.certTipo, d.rilascio, d.scadenza, d.creata]), [['0001', '0001', 'certificato', F, 'Agonistico', '2026-09-10', '2027-09-10', NOW]]);
  const a = L.byId(r.db.allieve, '0001');
  assert.deepEqual([a.certTipo, a.certRilascio, a.certScadenza, a.modificata], ['Agonistico', '2026-09-10', '2027-09-10', NOW]);
  assert.deepEqual([...new Set(r.registro.map((x) => x.operazione))], ['Nuovo documento', 'Modifica allieva']);
  assert.ok(r.registro.some((x) => x.campo === 'Certificato medico' && x.prima === '' && x.dopo === 'Agonistico') && r.registro.some((x) => x.campo === 'Scadenza certificato' && x.dopo === '10/09/2027'));
  assert.equal(L.statoCertificato(r.db, a, TODAY).stato, 'VALIDO');
  // without "aggiornaCertificato" only the card is added; a second document keeps both, the newest first
  const r2 = L.salvaDocumento(r.db, Object.assign({}, base, { file: 'doc-aaaaaaaaaaaaaaaa.jpg', certTipo: 'Non Agonistico', rilascio: '2026-10-01', scadenza: '2027-10-01', aggiornaCertificato: false }), '2026-11-11T09:00:00', TODAY);
  assert.deepEqual([...new Set(r2.registro.map((x) => x.operazione))], ['Nuovo documento']);
  assert.equal(L.byId(r2.db.allieve, '0001').certTipo, 'Agonistico', 'the student\'s certificate did not change');
  assert.deepEqual(L.documentiDi(r2.db, '0001').map((d) => d.id), ['0002', '0001']);
  assert.deepEqual(L.documentiDi(r2.db, '0002'), []);
  assert.throws(() => L.salvaDocumento(db, Object.assign({}, base, { certTipo: '' }), NOW, TODAY), /Scegli il tipo/);
  // delete: the card goes, the name of the file comes back so that the page can remove it
  const d = L.eliminaDocumento(r2.db, '0001');
  assert.equal(d.file, F); assert.deepEqual(d.db.documenti.map((x) => x.id), ['0002']); assert.equal(d.registro[0].operazione, 'Documento eliminato');
  assert.throws(() => L.eliminaDocumento(r2.db, '0099'), /non trovato/);
  // an archive from before has no documents: completa() adds them, and the numbers
  const vecchio = JSON.parse(JSON.stringify(db)); delete vecchio.documenti; delete vecchio.prossimi.documento;
  const c = L.completa(vecchio, TODAY);
  assert.deepEqual([c.documenti, c.prossimi.documento], [[], 1]);
  // deleting a student who has no enrollment takes her documents along
  const conDoc = L.salvaDocumento(db, Object.assign({}, base, { allievaId: '0002' }), NOW, TODAY).db;
  const el = L.eliminaAllieva(conDoc, '0002');
  assert.deepEqual([el.db.documenti.length, el.file], [0, [F]]);
});

test('certificates overview: type, status and document of everybody, with filters', () => {
  let db = archivio(); // 0001 has an enrollment, 0002 has none
  db = L.salvaAllieva(db, null, { name: 'Verdi Anna', nascita: '2015-01-01', tel: '3331112233', certTipo: 'Non Agonistico', certRilascio: '2026-10-01', certScadenza: '2027-10-01' }, NOW).db; // 0003
  db = L.salvaIscrizione(db, null, { allievaId: '0003', corso: 'Base', giorni: ['Lun'], tipo: 'Mensile', inizio: '2026-10-20' }, NOW).db;
  db = L.salvaDocumento(db, { allievaId: '0001', file: 'doc-0123456789abcdef.pdf', certTipo: 'Agonistico', rilascio: '2026-09-10', scadenza: '2026-11-25', aggiornaCertificato: true }, NOW, TODAY).db;
  const e = (f) => L.elencoCertificati(db, TODAY, f);
  const tutti = e({});
  assert.deepEqual(tutti.righe.map((r) => r.allieva.id), ['0001', '0003'], 'only students with an open enrollment, by name');
  assert.deepEqual(tutti.conteggi, { totale: 2, agonistico: 1, nonAgonistico: 1, ludico: 0, daRinnovare: 1, inAttesa: 0, mancanti: 0, senzaDocumento: 1 });
  assert.equal(tutti.righe[0].stato.stato, 'IN SCADENZA'); assert.equal(tutti.righe[0].documento.id, '0001'); assert.equal(tutti.righe[1].documento, null);
  assert.deepEqual(e({ tutte: true }).righe.map((r) => r.allieva.id), ['0001', '0002', '0003'], 'with everyone, also who has no enrollment');
  assert.equal(e({ tutte: true }).conteggi.mancanti, 1);
  assert.deepEqual(e({ tipo: 'Agonistico' }).righe.map((r) => r.allieva.id), ['0001']);
  assert.deepEqual(e({ tipo: 'Non Agonistico' }).righe.map((r) => r.allieva.id), ['0003']);
  assert.deepEqual(e({ stato: 'DA RINNOVARE' }).righe.map((r) => r.allieva.id), ['0001']);
  assert.deepEqual(e({ stato: 'VALIDO' }).righe.map((r) => r.allieva.id), ['0003']);
  assert.deepEqual(e({ documento: 'senza' }).righe.map((r) => r.allieva.id), ['0003']);
  assert.deepEqual(e({ documento: 'con' }).righe.map((r) => r.allieva.id), ['0001']);
  assert.deepEqual(e({ q: 'verdi' }).righe.map((r) => r.allieva.id), ['0003']);
  assert.equal(e({ tipo: 'Agonistico' }).conteggi.totale, 2, 'the counts are those of everybody, before the type filter');
});

test('salvaIscrizione and controllaIscrizione', () => {
  const db = archivio();
  const r = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Propedeutico', giorni: 'sab', tipo: 'Mensile', inizio: '01/11/2026', quota: '32,50', note: ' prova ' }, NOW);
  const e = L.byId(r.db.iscrizioni, r.id);
  assert.equal(r.id, '0002');
  assert.deepEqual([e.allievaId, e.giorni, e.inizio, e.quota, e.note, e.annullata, e.storica], ['0002', ['Sab'], '2026-11-01', 32.5, 'prova', false, false]);
  assert.equal(r.registro[0].allieva, 'Rossi Maria');
  assert.equal(r.registro[0].nota, 'Iscrizione n. 0002 · Propedeutico');
  assert.equal(r.registro.find((x) => x.campo === 'Quota concordata').dopo, '32,50 €');
  assert.throws(() => L.salvaIscrizione(db, null, { allievaId: '0099', corso: 'Base' }, NOW), /non trovata/);

  const ed = L.salvaIscrizione(db, '0001', Object.assign({}, db.iscrizioni[0], { tipo: 'Annuale', quota: '450' }), NOW);
  assert.deepEqual(ed.registro.map((x) => [x.operazione, x.campo, x.prima, x.dopo]), [['Modifica iscrizione', 'Tipo abbonamento', 'Trimestrale', 'Annuale'], ['Modifica iscrizione', 'Quota concordata', '', '450,00 €']]);
  assert.deepEqual(L.salvaIscrizione(db, '0001', db.iscrizioni[0], NOW).registro, []);

  const base = { allievaId: '0002', corso: 'Propedeutico', giorni: ['Sab'], tipo: 'Mensile', inizio: '2026-11-01', quota: '' };
  assert.deepEqual(L.controllaIscrizione(db, base, null).errors, []);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { allievaId: '' }), null).errors[0], /Scegli l'allieva/);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { corso: '' }), null).errors.join(' '), /Scegli il corso/);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { quota: 'abc' }), null).errors.join(' '), /Quota concordata non valida/);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { quota: '-5' }), null).errors.join(' '), /Quota concordata non valida/);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { tipo: '' }), null).warnings.join(' '), /scadenza/);
  // the semestral subscription is gone from the choices, but an old one is still read and has no price
  assert.deepEqual(L.TIPI.map((t) => t.nome), ['Mensile', 'Trimestrale', 'Annuale']);
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { pacchetto: PAC2, tipo: 'Semestrale' }), null).warnings.join(' '), /non ha un prezzo/);
  assert.equal(L.pulisciIscrizione({ tipo: 'Semestrale' }).tipo, 'Semestrale', 'editing an old enrollment must not erase its type');
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { pacchetto: 'Tariffa che non esiste' }), null).warnings.join(' '), /non è nel tariffario/);
  // a second open enrollment to the same course is flagged, but not the one being edited
  assert.match(L.controllaIscrizione(db, { allievaId: '0001', corso: 'Base', tipo: 'Mensile', inizio: '2026-11-01', quota: '' }, null).warnings.join(' '), /già un'iscrizione aperta/);
  assert.equal(L.controllaIscrizione(db, db.iscrizioni[0], '0001').warnings.join(' ').includes('già un\'iscrizione aperta'), false);
});

test('rinnova closes the old period and opens the next one where it ends', () => {
  const db = archivio();
  const r = L.rinnova(db, '0001', '2027-01-03T10:00:00', '2027-01-03');
  const old = L.byId(r.db.iscrizioni, '0001'), nuova = L.byId(r.db.iscrizioni, r.id);
  assert.equal(r.id, '0002');
  assert.equal(old.storica, true);
  assert.deepEqual([nuova.allievaId, nuova.corso, nuova.giorni, nuova.fascia, nuova.pacchetto, nuova.tipo, nuova.inizio, nuova.storica], ['0001', 'Base', ['Lun', 'Mer'], '17:00', PAC2, 'Trimestrale', '2027-01-01', false]);
  assert.equal(L.scadenza(nuova), '2027-04-01');
  assert.equal(r.registro.length, 2);
  assert.equal(L.byId(db.iscrizioni, '0001').storica, false);
  assert.throws(() => L.rinnova(r.db, '0001', NOW, TODAY), /già chiusa/);
  assert.throws(() => L.rinnova(db, '0042', NOW, TODAY), /non trovata/);
  const del = L.eliminaIscrizione(r.db, r.id);
  assert.deepEqual(del.db.iscrizioni.map((e) => e.id), ['0001']);
});

test('riepilogo, scadenze, cercaAllieve', () => {
  let db = archivio();
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Propedeutico', tipo: 'Mensile', inizio: '2026-10-01', quota: '' }, NOW).db; // expired 2026-11-01
  db = L.salvaAllieva(db, null, { name: 'Bianchi Sara' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0003', corso: 'Da definire', quota: '' }, NOW).db;
  db = L.salvaAllieva(db, null, { name: 'Verdi Camilla', genitore: 'Verdi Paolo' }, NOW).db;
  db = L.archiviaAllieva(db, '0004', true, NOW).db;
  db = L.salvaAllieva(db, null, { name: 'Neri Daniela', tel: '3337654321' }, NOW).db;
  // 0003 was enrolled today without a certificate: she is "in attesa" for 15 days, then she counts as missing
  const extra = { certScaduti: 0, certInScadenza: 0, certMancanti: 2, certInAttesa: 1, daIncassare: 1, totaleDaIncassare: 170, bonificiDaVerificare: 0, totaleBonificiDaVerificare: 0 };
  assert.deepEqual(L.riepilogo(db, TODAY), Object.assign({ allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 1, inScadenza: 0, scadute: 1, daCompletare: 1 }, extra));
  assert.deepEqual(L.riepilogo(db, '2026-12-10'), Object.assign({ allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 0, inScadenza: 1, scadute: 1, daCompletare: 1 }, extra, { certMancanti: 3, certInAttesa: 0 }));

  const sc = L.scadenze(db, '2026-12-10');
  assert.deepEqual(sc.scadute.map((x) => [x.allieva.name, x.scadenza, x.giorni]), [['Rossi Maria', '2026-11-01', -39]]);
  assert.deepEqual(sc.inScadenza.map((x) => [x.allieva.name, x.giorni]), [['Del Bosco Giulia', 22]]);

  const names = (q, f) => L.cercaAllieve(db, q, f).map((a) => a.name);
  assert.deepEqual(names('', 'tutte'), ['Bianchi Sara', 'Del Bosco Giulia', 'Neri Daniela', 'Rossi Maria']);
  assert.deepEqual(names('', 'archiviate'), ['Verdi Camilla']);
  assert.deepEqual(names('', 'senza'), ['Neri Daniela']);
  assert.deepEqual(names('', 'con'), ['Bianchi Sara', 'Del Bosco Giulia', 'Rossi Maria']);
  assert.deepEqual(names('GIULIA bosco', 'tutte'), ['Del Bosco Giulia']);
  assert.deepEqual(names('333765', 'tutte'), ['Neri Daniela']);
  assert.deepEqual(names('de luca', 'tutte'), ['Del Bosco Giulia'], 'by parent name');
  assert.deepEqual(names('dlbgli', 'tutte'), ['Del Bosco Giulia'], 'by tax code');
  assert.deepEqual(names('zzz', 'tutte'), []);
});

test('iscritte and corsiRiepilogo: class lists', () => {
  let db = archivio();
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Base', giorni: ['Mar', 'Gio'], tipo: 'Mensile', inizio: '2026-11-01', quota: '' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Hip hop', giorni: ['Sab'], quota: '' }, NOW).db;            // a course that is not in the list
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Avanzato', giorni: ['Lun'], quota: '', annullata: true }, NOW).db; // not open
  db = L.salvaAllieva(db, null, { name: 'Verdi Camilla' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0003', corso: 'Base', giorni: ['Lun'], quota: '' }, NOW).db;
  db = L.archiviaAllieva(db, '0003', true, NOW).db;                                                                                 // archived students are not in class lists
  const names = (f) => L.iscritte(db, f, TODAY).map((x) => x.allieva.name + '/' + x.iscrizione.corso);
  assert.deepEqual(names(), ['Del Bosco Giulia/Base', 'Rossi Maria/Base', 'Rossi Maria/Hip hop']);
  assert.deepEqual(names({ corso: 'Base' }), ['Del Bosco Giulia/Base', 'Rossi Maria/Base']);
  assert.deepEqual(names({ corso: 'Base', giorno: 'Lun' }), ['Del Bosco Giulia/Base']);
  assert.deepEqual(names({ giorno: 'Sab' }), ['Rossi Maria/Hip hop']);
  assert.equal(L.iscritte(db, { corso: 'Base' }, TODAY)[0].stato.stato, 'ATTIVO');
  const r = L.corsiRiepilogo(db);
  assert.deepEqual(r.filter((x) => x.iscritte > 0), [{ corso: 'Base', iscritte: 2 }, { corso: 'Hip hop', iscritte: 1 }]);
  assert.deepEqual(r.map((x) => x.corso), db.liste.corsi.concat(['Hip hop']));
});

test('famiglia: same phone, same parent tax code or same parent full name', () => {
  let db = L.nuovoArchivio(TODAY);
  const add = (f) => { db = L.salvaAllieva(db, null, f, NOW).db; };
  add({ name: 'Del Bosco Giulia', tel: '3470001122', genitore: 'De Luca Antonella' });           // 0001
  add({ name: 'Del Bosco Francesca', tel: '3331234567', tel2: '3470001122' });                    // 0002: the same number as second phone
  add({ name: 'Del Bosco Anna', genitore: 'antonella DE LUCA' });                                 // 0003: same parent, written the other way round
  add({ name: 'Rossi Maria', tel: '3339998877', cfGenitore: 'DLCNNL75C48H501H' });                // 0004
  add({ name: 'Rossi Paolo', cfGenitore: 'DLCNNL75C48H501H', genitore: 'Antonella' });            // 0005: same parent tax code
  add({ name: 'Bianchi Sara', genitore: 'Antonella' });                                           // 0006: a first name alone is not a family
  add({ name: 'Verdi Camilla' });                                                                 // 0007: nothing in common, and empty fields never match
  const ids = (id) => L.famiglia(db, id).map((a) => a.id);
  assert.deepEqual(ids('0001'), ['0002', '0003']);
  assert.deepEqual(ids('0002'), ['0001']);
  assert.deepEqual(ids('0003'), ['0001']);
  assert.deepEqual(ids('0004'), ['0005']);
  assert.deepEqual(ids('0006'), []);
  assert.deepEqual(ids('0007'), []);
  assert.deepEqual(ids('0099'), []);
});

test('previsioneRinnovi: the renewals of the coming months (quarterly ones in December and March), what is expected, who is late', () => {
  let db = L.nuovoArchivio('2026-11-10');
  const add = (nome, tipo, inizio, corso) => {
    const r = L.salvaAllieva(db, null, { name: nome, nascita: '2014-01-01', tel: '3331112233' }, NOW); db = r.db;
    db = L.salvaIscrizione(db, null, { allievaId: r.id, corso: corso || 'Base', giorni: ['Lun', 'Mer'], tipo, inizio, pacchetto: PAC2 }, NOW).db;
    return r.id;
  };
  add('Rossi Maria', 'Trimestrale', '2026-09-15');   // ends 15/12/2026
  add('Bianchi Sara', 'Trimestrale', '2026-09-20');  // ends 20/12/2026
  add('Verdi Anna', 'Trimestrale', '2026-12-10');    // ends 10/03/2027
  add('Neri Luca', 'Mensile', '2026-10-25');         // ends 25/11/2026
  add('Gallo Elena', 'Annuale', '2026-09-01');       // ends 01/09/2027
  add('Conti Paola', 'Mensile', '2026-09-20');       // ended 20/10/2026: late
  const archiviata = add('Esposito Giulia', 'Trimestrale', '2026-09-18'); db = L.archiviaAllieva(db, archiviata, true, NOW).db; // archived: not counted
  const p = L.previsioneRinnovi(db, '2026-11-10', 12);
  assert.deepEqual(p.mesi.map((m) => m.chiave).slice(0, 5), ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.deepEqual(p.mesi.map((m) => m.l).slice(0, 3), ['nov 2026', 'dic 2026', 'gen 2027']);
  assert.equal(p.mesi.length, 12);
  const per = Object.fromEntries(p.mesi.map((m) => [m.chiave, m.n]));
  assert.deepEqual([per['2026-11'], per['2026-12'], per['2027-03'], per['2027-09']], [1, 2, 1, 1], 'November: one monthly; December: two quarterly; March: one; September 2027: the annual');
  assert.deepEqual(p.mesi[1].perTipo, { Mensile: 0, Trimestrale: 2, Annuale: 0 });
  assert.deepEqual(p.mesi[1].righe.map((r) => r.allieva.name), ['Rossi Maria', 'Bianchi Sara'], 'by date, then by name');
  assert.equal(p.mesi[1].euro, 340, 'two quarterly fees of the price list (170 each)');
  assert.deepEqual([p.arretrati.n, p.arretrati.righe[0].allieva.name], [1, 'Conti Paola']);
  assert.equal(p.totale.n, 6); assert.equal(p.totale.euro, p.arretrati.euro + p.mesi.reduce((t, m) => t + m.euro, 0));
  // the year turns: from December the next months are those of the following year
  const d = L.previsioneRinnovi(db, '2026-12-20', 3);
  assert.deepEqual(d.mesi.map((m) => m.chiave), ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(L.previsioneRinnovi(L.nuovoArchivio('2026-11-10'), '2026-11-10', 2).mesi.map((m) => m.n), [0, 0]);
});

test('messages for the parents: one text for each situation, greeting, days, amount, old default texts, unknown placeholders', () => {
  const db = archivio(); // 0001 Del Bosco, trimestrale from 2026-10-01 (ends 2027-01-01), genitore "De Luca Antonella"
  const riga = (o) => Object.assign({ tipo: 'abbonamento', stato: 'IN SCADENZA', allieva: L.byId(db.allieve, '0001'), iscrizione: db.iscrizioni[0], corso: 'Base', scadenza: '2027-01-01', giorni: 22 }, o);
  // the five situations
  assert.match(L.testoAvviso(db, riga({}), 10), /scade il 01\/01\/2027 \(tra 22 giorni\)\. Per rinnovarlo/);
  assert.match(L.testoAvviso(db, riga({ stato: 'SCADUTO', giorni: -3, scadenza: '2026-12-01' }), 10), /è scaduto il 01\/12\/2026\. Per continuare a frequentare/);
  assert.match(L.testoAvviso(db, riga({ tipo: 'certificato', iscrizione: null, corso: '', scadenza: '2026-11-20', giorni: 10 }), 10), /certificato medico di Del Bosco Giulia scade il 20\/11\/2026 \(tra 10 giorni\)/);
  assert.match(L.testoAvviso(db, riga({ tipo: 'certificato', stato: 'SCADUTO', iscrizione: null, corso: '', scadenza: '2026-10-01', giorni: -40 }), 10), /è scaduto il 01\/10\/2026\. Vi chiediamo di consegnare/);
  assert.match(L.testoAvviso(db, riga({ tipo: 'certificato', stato: 'MANCANTE', iscrizione: null, corso: '', scadenza: '', giorni: null }), 10), /ci risulta mancante il certificato medico di Del Bosco Giulia/);
  // the greeting follows the hour; the days in words; the name of the gym from the settings; no double spaces when a piece is empty
  assert.match(L.testoAvviso(db, riga({}), 17), /^Buongiorno, /); assert.match(L.testoAvviso(db, riga({}), 18), /^Buonasera, /); assert.match(L.testoAvviso(db, riga({}), 3), /^Buonasera, /); assert.match(L.testoAvviso(db, riga({}), 5), /^Buongiorno, /);
  db.impostazioni.ente = 'ASD Prova';
  assert.match(L.testoAvviso(db, riga({}), 10), /Grazie, ASD Prova$/);
  db.impostazioni.messaggioScadenza = '{saluto} {genitore}: {tipo} {giorni} {residuo}.';
  assert.equal(L.testoAvviso(db, riga({ giorni: 0 }), 10), 'Buongiorno De Luca Antonella: trimestrale oggi 170,00 €.');
  assert.equal(L.testoAvviso(db, riga({ giorni: 1 }), 10), 'Buongiorno De Luca Antonella: trimestrale domani 170,00 €.');
  assert.equal(L.testoAvviso(db, riga({ giorni: -1 }), 10), 'Buongiorno De Luca Antonella: trimestrale da ieri 170,00 €.');
  assert.equal(L.testoAvviso(db, riga({ iscrizione: Object.assign({}, db.iscrizioni[0], { tipo: '' }) }), 10), 'Buongiorno De Luca Antonella: tra 22 giorni.', 'empty pieces (no type, no amount known) leave no double space');
  // the text of the versions before 1.15 that nobody changed becomes the new one; one that was changed stays
  db.impostazioni.messaggioScadenza = L.MODELLI.messaggioScadenza.vecchio;
  assert.equal(L.modelloMessaggio(db, 'messaggioScadenza'), L.MESSAGGIO);
  db.impostazioni.messaggioScadenza = 'Ciao {nome}!';
  assert.equal(L.modelloMessaggio(db, 'messaggioScadenza'), 'Ciao {nome}!');
  // settings: the default text is not stored, the others are; a placeholder that does not exist is reported
  const f = { stagione: '2026/2027', preavvisoAbb: '30', corsi: 'Base' };
  assert.equal(L.salvaImpostazioni(db, Object.assign({}, f, { messaggioAbbScaduto: L.MODELLI.messaggioAbbScaduto.testo })).db.impostazioni.messaggioAbbScaduto, '');
  assert.equal(L.salvaImpostazioni(db, Object.assign({}, f, { messaggioAbbScaduto: ' Scaduto: {nome} ' })).db.impostazioni.messaggioAbbScaduto, 'Scaduto: {nome}');
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { messaggioCertScaduto: 'Ciao {nom}, scaduto il {scadenza}' })).join(' '), /Certificato scaduto.*segnaposto che non esiste: \{nom\}/);
  assert.deepEqual(L.controllaImpostazioni(Object.assign({}, f, { messaggioCertScaduto: 'Ciao {nome}, scaduto il {scadenza}. {saluto} {giorni} {residuo} {palestra} {genitore} {corso} {tipo}' })), []);
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { messaggioCertMancante: 'x'.repeat(601) })).join(' '), /Certificato mancante.*troppo lungo/);
  // the row of the list of reminders carries the right text and the hour can be given
  db.impostazioni.messaggioScadenza = '';
  const rows = L.elencoPromemoria(db, '2026-12-10', { ora: 19 }).righe;
  assert.ok(rows.length > 0 && rows.every((r) => /^Buonasera, /.test(r.testo)), rows.map((r) => r.testo).join(' | '));
});

test('messaggioScadenza, promemoriaCopia, segnaCopia', () => {
  let db = archivio();
  const x = L.scadenze(db, '2026-12-10').inScadenza[0];
  assert.equal(L.messaggioScadenza(db, x, 10), 'Buongiorno, vi ricordiamo che l\'abbonamento trimestrale di Del Bosco Giulia al corso Base scade il 01/01/2027 (tra 22 giorni). Per rinnovarlo passate in segreteria. Grazie, A.S.D. Gym Art Avezzano');
  db.impostazioni.messaggioScadenza = '{nome}: {tipo} {corso} {scadenza} {nome} {altro}';
  assert.equal(L.messaggioScadenza(db, x, 10), 'Del Bosco Giulia: trimestrale Base 01/01/2027 Del Bosco Giulia {altro}');
  db.impostazioni.messaggioScadenza = '';
  assert.match(L.messaggioScadenza(db, x, 10), /^Buongiorno/, 'an empty text falls back to the standard one');

  assert.deepEqual(L.promemoriaCopia(L.nuovoArchivio(TODAY), TODAY), { serve: false, giorni: null }, 'nothing to protect yet');
  assert.deepEqual(L.promemoriaCopia(db, TODAY), { serve: true, giorni: null });
  const r = L.segnaCopia(db, TODAY);
  assert.equal(r.db.impostazioni.ultimaCopia, TODAY);
  assert.equal(db.impostazioni.ultimaCopia, '');
  assert.equal(r.registro[0].operazione, 'Copia di sicurezza scaricata');
  assert.deepEqual(L.promemoriaCopia(r.db, '2026-12-10'), { serve: false, giorni: 30 });
  assert.deepEqual(L.promemoriaCopia(r.db, '2026-12-11'), { serve: true, giorni: 31 });
  // an archive saved by version 1.0.0 has neither field: it opens and gets the defaults
  const old = L.completa({ schema: 1, impostazioni: { stagione: '2026/2027', preavvisoAbb: 45 }, liste: { corsi: ['Base'], fasce: [] }, tariffario: [], allieve: [{ id: '0001', name: 'Rossi Maria' }], iscrizioni: [], prossimi: { allieva: 2, iscrizione: 1 } }, TODAY);
  assert.deepEqual(old.impostazioni, IMP({ stagione: '2026/2027', preavvisoAbb: 45, messaggioScadenza: '', ultimaCopia: '' }));
  assert.deepEqual([old.schema, old.pagamenti, old.prossimi, old.liste.metodi], [2, [], { allieva: 2, iscrizione: 1, pagamento: 1, documento: 1 }, ['Contanti', 'Bonifico', 'POS']]);
  // a copy in the second folder counts as a safety copy; a folder that was chosen but never written does not
  assert.deepEqual(L.promemoriaCopia(db, TODAY, { cartella: 'E:\\Copie', ultima: '2026-11-09T18:00:00+01:00' }), { serve: false, giorni: 1 });
  assert.deepEqual(L.promemoriaCopia(db, TODAY, { cartella: 'E:\\Copie', ultima: '' }), { serve: true, giorni: null });
  assert.deepEqual(L.promemoriaCopia(db, TODAY, { cartella: '', ultima: '2026-11-09T18:00:00+01:00' }), { serve: true, giorni: null });
  assert.deepEqual(L.promemoriaCopia(r.db, '2026-12-11', { cartella: 'E:\\Copie', ultima: '2026-12-01T10:00:00+01:00' }), { serve: false, giorni: 10 });
});

test('lookups never go stale: every change returns an archive with its own index', () => {
  let db = archivio();
  assert.equal(L.iscrizioniDi(db, '0001').length, 1);
  const r = L.rinnova(db, '0001', NOW, TODAY);
  assert.equal(L.iscrizioniDi(r.db, '0001').length, 2);
  assert.equal(L.iscrizioniDi(db, '0001').length, 1, 'the old archive still answers for itself');
  const d = L.eliminaAllieva(db, '0002');
  assert.equal(L.nomeAllieva(d.db, '0002'), '');
  assert.equal(L.nomeAllieva(db, '0002'), 'Rossi Maria');
  const e = L.eliminaIscrizione(r.db, '0002');
  assert.deepEqual(L.iscrizioniDi(e.db, '0001').map((x) => x.id), ['0001']);
  // the list handed out is a copy: sorting or changing it does not disturb the index
  L.iscrizioniDi(r.db, '0001').reverse().pop();
  assert.deepEqual(L.iscrizioniDi(r.db, '0001').map((x) => x.id), ['0001', '0002']);
});

test('controllaImpostazioni / salvaImpostazioni', () => {
  const db = archivio();
  const f = { stagione: '2027/2028', preavvisoAbb: '20', corsi: 'Base\n\nAvanzato\nBase\n', fasce: '17:00-18:30\n18:30-20:00',
    tariffario: [{ pacchetto: 'Corso Base', frequenza: '2 giorni/settimana', Mensile: '60', Trimestrale: '170,50', Semestrale: '', Annuale: '1.000', iscrizione: '10' }, { pacchetto: '', frequenza: '', Mensile: '', Trimestrale: '', Semestrale: '', Annuale: '', iscrizione: '' }] };
  assert.deepEqual(L.controllaImpostazioni(f), []);
  const r = L.salvaImpostazioni(db, f);
  assert.deepEqual(r.db.impostazioni, IMP({ stagione: '2027/2028', preavvisoAbb: 20, messaggioScadenza: '', ultimaCopia: '' }));
  const full = L.salvaImpostazioni(db, Object.assign({}, f, { preavvisoCert: '45', messaggioCertificato: ' Certificato di {nome} ', legale: ' Mario Bianchi ', ente: 'CSEN', codice: '12345', cfAssociazione: '90012345678', metodi: 'Contanti\nBonifico\nSatispay\n' }));
  assert.deepEqual(full.db.impostazioni, { stagione: '2027/2028', preavvisoAbb: 20, messaggioScadenza: '', ultimaCopia: '', preavvisoCert: 45, messaggioCertificato: 'Certificato di {nome}', legale: 'Mario Bianchi', ente: 'CSEN', codice: '12345', cfAssociazione: '90012345678', giorniCertificato: 15 });
  assert.deepEqual(full.db.liste.metodi, ['Contanti', 'Bonifico', 'Satispay']);
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { preavvisoCert: 'x', metodi: ' ' })).join(' '), /certificati.*almeno un metodo/);
  assert.equal(L.salvaImpostazioni(db, Object.assign({}, f, { messaggioScadenza: '  Ciao {nome}  ' })).db.impostazioni.messaggioScadenza, 'Ciao {nome}');
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { messaggioScadenza: 'x'.repeat(601) })).join(' '), /troppo lungo/);
  assert.deepEqual(r.db.liste, { corsi: ['Base', 'Avanzato'], fasce: ['17:00-18:30', '18:30-20:00'], metodi: ['Contanti', 'Bonifico', 'POS'] });
  assert.deepEqual(r.db.tariffario, [{ chiave: 'Corso Base · 2 giorni/settimana', pacchetto: 'Corso Base', frequenza: '2 giorni/settimana', Mensile: 60, Trimestrale: 170.5, Semestrale: null, Annuale: 1000, iscrizione: 10 }]);
  assert.equal(db.impostazioni.preavvisoAbb, 30);
  const bad = L.controllaImpostazioni({ stagione: '2027', preavvisoAbb: 'x', corsi: ' \n', fasce: '', tariffario: [{ pacchetto: '', frequenza: 'x', Mensile: '5' }, { pacchetto: 'A', frequenza: 'f', Mensile: 'abc' }, { pacchetto: 'A', frequenza: 'f' }] });
  assert.equal(bad.length, 6);
  assert.match(bad.join(' '), /Stagione.*preavviso.*almeno un corso.*manca il nome.*non è un numero.*due volte/);
});

test('leggiCsv and riconosciFoglio', () => {
  assert.deepEqual(L.leggiCsv('﻿a,b,c\r\n1,"due, con virgola","con ""virgolette"""\r\n"riga\nspezzata",,\r\n'), [['a', 'b', 'c'], ['1', 'due, con virgola', 'con "virgolette"'], ['riga\nspezzata', '', '']]);
  assert.deepEqual(L.leggiCsv('a;b\n"x;y";2'), [['a', 'b'], ['x;y', '2']]);
  assert.deepEqual(L.leggiCsv(''), []);
  assert.equal(L.riconosciFoglio([['ANAGRAFICA ALLIEVE'], ['ID', 'Cognome e Nome', 'Telefono'], ['0001', 'Rossi Maria', '']]).tipo, 'anagrafica');
  assert.deepEqual(L.riconosciFoglio([['titolo'], ['ID', 'Cognome e Nome'], ['0001', 'Rossi Maria']]).vals[0], ['ID', 'Cognome e Nome']);
  assert.equal(L.riconosciFoglio([['ID', 'Allieva', 'Corso', 'Tipo abbonamento']]).tipo, 'iscrizioni');
  assert.equal(L.riconosciFoglio([['PAGAMENTI'], ['Data pagamento', 'Importo', 'Allieva', 'Corso']]).tipo, 'pagamenti');
  assert.equal(L.riconosciFoglio([['Allieva', 'Corso', 'Giorni']]).tipo, '', 'neither enrollments nor payments');
  assert.equal(L.riconosciFoglio([]).tipo, '');
});

const ANA = [
  ['ANAGRAFICA'],
  ['ID', 'Cognome e Nome', 'Telefono', 'Genitore / Referente', 'Email', 'Data di nascita', 'Luogo di nascita', 'Codice fiscale', 'Città', 'CAP', 'Consenso privacy', 'Certificato medico', 'Note'],
  ['0034', 'DEL BOSCO GIULIA', '347 000 1122', 'De Luca Antonella', 'M@Example.com', '12/10/2013', "L'AQUILA", 'DLBGLI13R52A345D', 'Magliano dei Marsi', '67062', 'Sì', 'Non Agonistico', 'nota'],
  ['0035', 'Cappelletti Elia', '', '', '', '02/07/2019', '', '', '', '', '', '', ''],
  ['0036', 'Rossi Maria', '3331234567', '', '', '05/04/2015', '', '', '', '', '', '', ''],
  ['0037', 'Rossi Maria', '3337654321', '', '', '20/01/2012', '', '', '', '', '', '', ''],
  ['0038', 'Soloilnome', '', '', '', '', '', '', '', '', '', '', ''],
  ['0039', '', '', '', '', '', '', '', '', '', '', '', '']
];
const ISC = [
  ['ID', 'Allieva', 'Corso', 'Fascia oraria', 'Giorni', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Scadenza', 'Stato abbonamento', 'Quota concordata (sostituisce il tariffario)', 'Annullata?', 'Note'],
  ['0012', 'Del Bosco Giulia', 'Base', '17:00', 'Lun, Mer', PAC2, 'Trimestrale', '01/10/2026', '01/01/2027', 'ATTIVO', '150,00 €', '', 'acconto'],
  ['0013', 'Cappelletti Elia', 'Propedeutico', '', 'Sab', '', 'Mensile', '01/09/2026', '01/10/2026', 'STORICO', '', '', ''],
  ['0014', 'Cappelletti Elia', 'Propedeutico', '', '', '', '', '', '', 'ATTIVO', '', 'Sì', ''],
  ['0015', 'Rossi Maria', 'Base', '', '', '', 'Mensile', '01/11/2026', '', 'ATTIVO', '', '', ''],
  ['0016', 'Greco Fabiola', 'Base', '', '', '', 'Mensile', '01/11/2026', '', 'ATTIVO', '', '', '']
];

test('importaAnagrafica: new students, same-name students, empty fields only', () => {
  const vals = L.riconosciFoglio(ANA).vals;
  const r = L.importaAnagrafica(L.nuovoArchivio(TODAY), vals, NOW);
  assert.deepEqual([r.nuove, r.completate, r.invariate], [4, 0, 0]);
  assert.deepEqual(r.saltate.length, 1);
  assert.match(r.saltate[0], /Soloilnome/);
  assert.deepEqual(r.db.allieve.map((a) => [a.id, a.name, a.nascita]), [['0034', 'Del Bosco Giulia', '2013-10-12'], ['0035', 'Cappelletti Elia', '2019-07-02'], ['0036', 'Rossi Maria', '2015-04-05'], ['0037', 'Rossi Maria', '2012-01-20']]);
  const g = r.db.allieve[0];
  assert.deepEqual([g.tel, g.email, g.luogo, g.cf, g.cap, g.privacy, g.note], ['3470001122', 'm@example.com', "L'Aquila", 'DLBGLI13R52A345D', '67062', 'Sì', 'nota']);
  assert.deepEqual([g.certTipo, g.certRilascio, g.certScadenza], ['Non Agonistico', '', ''], 'the certificate comes along');
  assert.equal(r.db.prossimi.allieva, 38);
  assert.equal(r.registro.length, 4);
  assert.equal(L.validaArchivio(r.db), '');

  // importing the same file again changes nothing
  const again = L.importaAnagrafica(r.db, vals, NOW);
  assert.deepEqual([again.nuove, again.completate, again.invariate, again.registro.length], [0, 0, 4, 0]);

  // a student already in the archive keeps her values: only empty fields are filled, differences are reported
  let db = L.salvaAllieva(L.nuovoArchivio(TODAY), null, { name: 'Del Bosco Giulia', tel: '3339998877' }, NOW).db;
  const m = L.importaAnagrafica(db, vals, NOW);
  const g2 = L.byId(m.db.allieve, '0001');
  assert.deepEqual([m.nuove, m.completate, m.invariate], [3, 1, 0]);
  assert.equal(g2.tel, '3339998877');
  assert.equal(g2.nascita, '2013-10-12');
  assert.equal(m.diverse.length, 1);
  assert.match(m.diverse[0], /Telefono.*3339998877.*3470001122/);
  assert.ok(m.campiCompletati >= 6);
  assert.ok(m.registro.some((x) => x.operazione === 'Importazione' && x.campo === 'Data di nascita' && x.dopo === '12/10/2013'));
  assert.deepEqual(L.importaAnagrafica(L.nuovoArchivio(TODAY), [['ID', 'Cognome e Nome'], ['1', 'Rossi Maria']], NOW).mancanti.includes('Telefono'), true);
});

test('importaIscrizioni: linked by name, states mapped, doubtful rows skipped', () => {
  const db0 = L.importaAnagrafica(L.nuovoArchivio(TODAY), L.riconosciFoglio(ANA).vals, NOW).db;
  const r = L.importaIscrizioni(db0, ISC, NOW);
  assert.deepEqual([r.nuove, r.giaPresenti, r.saltate.length], [3, 0, 2]);
  assert.match(r.saltate[0], /2 allieve che si chiamano "Rossi Maria"/);
  assert.match(r.saltate[1], /"Greco Fabiola" non è nell'archivio/);
  const e = L.byId(r.db.iscrizioni, '0012');
  assert.deepEqual([e.allievaId, e.corso, e.fascia, e.giorni, e.pacchetto, e.tipo, e.inizio, e.quota, e.note, e.storica, e.annullata], ['0034', 'Base', '17:00', ['Lun', 'Mer'], PAC2, 'Trimestrale', '2026-10-01', 150, 'acconto', false, false]);
  assert.equal(L.byId(r.db.iscrizioni, '0013').storica, true);
  assert.equal(L.byId(r.db.iscrizioni, '0014').annullata, true);
  assert.deepEqual(r.db.liste.fasce, ['17:00']);
  assert.equal(r.db.prossimi.iscrizione, 15);
  assert.equal(L.validaArchivio(r.db), '');
  const again = L.importaIscrizioni(r.db, ISC, NOW);
  assert.deepEqual([again.nuove, again.giaPresenti, again.registro.length], [0, 3, 0]);
});

test('csvAllieve / csvIscrizioni', () => {
  let db = archivio();
  db = L.salvaAllieva(db, '0002', Object.assign({}, L.byId(db.allieve, '0002'), { note: 'porta; "sempre" il certificato' }), NOW).db;
  const a = L.leggiCsv(L.csvAllieve(db));
  assert.equal(a.length, 3);
  assert.deepEqual(a[0].slice(0, 3), ['N.', 'Cognome e Nome', 'Data di nascita']);
  assert.deepEqual(a[1].slice(0, 3), ['0001', 'Del Bosco Giulia', '12/10/2013']);
  assert.equal(a[2][a[0].indexOf('Note')], 'porta; "sempre" il certificato');
  assert.equal(a[1][a[0].length - 1], 'No');
  // a cell that Excel would run as a formula is neutralised; plain negative numbers are left alone
  const f = L.csvAllieve(L.salvaAllieva(db, '0002', Object.assign({}, L.byId(db.allieve, '0002'), { note: '=HYPERLINK("http://x")', tessera: '-12' }), NOW).db);
  assert.ok(f.includes('"\'=HYPERLINK(""http://x"")"'), f);
  assert.ok(f.includes(';-12;'), f);
  const i = L.leggiCsv(L.csvIscrizioni(db, TODAY));
  assert.deepEqual(i[1], ['0001', '0001', 'Del Bosco Giulia', 'Base', 'Lun, Mer', '17:00', PAC2, 'Trimestrale', '01/10/2026', '01/01/2027', 'ATTIVO', '170', '170', '0', '170', '']);
});

test('the registro never receives a value that is not text', () => {
  const db = archivio();
  const all = [].concat(L.salvaAllieva(db, null, { name: 'Bianchi Sara', nascita: '2016-02-10' }, NOW).registro,
    L.salvaIscrizione(db, '0001', Object.assign({}, db.iscrizioni[0], { annullata: true, giorni: ['Sab'], quota: '10' }), NOW).registro,
    L.rinnova(db, '0001', NOW, TODAY).registro, L.salvaImpostazioni(db, { stagione: '2026/2027', preavvisoAbb: '30', corsi: 'Base', fasce: '', tariffario: [] }).registro);
  all.forEach((x) => ['allieva', 'operazione', 'campo', 'prima', 'dopo', 'nota'].forEach((k) => assert.equal(typeof x[k], 'string', k + ' in ' + JSON.stringify(x))));
  assert.ok(all.some((x) => x.campo === 'Annullata' && x.prima === 'No' && x.dopo === 'Sì'));
  assert.ok(all.some((x) => x.campo === 'Giorni' && x.prima === 'Lun, Mer' && x.dopo === 'Sab'));
  assert.equal(C.isIso(TODAY), true);
});

/* ================= version 1.2: certificates, payments ================= */

test('certificato: cleaned, checked only when entered or changed, status', () => {
  let db = archivio();
  const giulia = L.byId(db.allieve, '0001');
  // nothing written: nothing to check
  assert.deepEqual(L.controllaAllieva(db, giulia, '0001', TODAY).errors, []);
  // a complete certificate
  const ok = Object.assign({}, giulia, { certTipo: 'Non Agonistico', certRilascio: '05/04/2026', certScadenza: '2027-04-05' });
  assert.deepEqual(L.controllaAllieva(db, ok, '0001', TODAY).errors, []);
  const r = L.salvaAllieva(db, '0001', ok, NOW);
  const a = L.byId(r.db.allieve, '0001');
  assert.deepEqual([a.certTipo, a.certRilascio, a.certScadenza], ['Non Agonistico', '2026-04-05', '2027-04-05']);
  assert.deepEqual(r.registro.map((x) => [x.campo, x.prima, x.dopo]), [['Certificato medico', '', 'Non Agonistico'], ['Rilascio certificato', '', '05/04/2026'], ['Scadenza certificato', '', '05/04/2027']]);
  // errors when it is being entered
  const err = (c) => L.controllaAllieva(db, Object.assign({}, giulia, c), '0001', TODAY).errors.join(' ');
  assert.match(err({ certTipo: 'Agonistico' }), /Certificato: Data di rilascio mancante.*Certificato: Data di scadenza mancante/);
  assert.match(err({ certRilascio: '2026-04-05', certScadenza: '2027-04-05' }), /Certificato: scegli il tipo/);
  assert.match(err({ certTipo: 'Agonistico', certRilascio: '2026-12-01', certScadenza: '2027-12-01' }), /rilascio è nel futuro/);
  assert.match(err({ certTipo: 'Agonistico', certRilascio: '2026-04-05', certScadenza: '2028-04-05' }), /più di un anno/);
  assert.match(err({ certTipo: 'Agonistico', certRilascio: '2026-04-05', certScadenza: '2026-04-01' }), /prima del rilascio/);
  const warn = (c) => L.controllaAllieva(db, Object.assign({}, giulia, c), '0001', TODAY).warnings.join(' ');
  assert.match(warn({ certTipo: 'Ludico-motoria', certRilascio: '2026-04-05', certScadenza: '2027-04-05' }), /ludico-motoria/);
  assert.match(warn({ certTipo: 'Agonistico', certRilascio: '2025-06-01', certScadenza: '2026-06-01' }), /già scaduto/);
  // replacing a newer certificate with an older one is flagged, in the program's own words
  assert.match(L.controllaAllieva(r.db, Object.assign({}, a, { certRilascio: '2025-09-01', certScadenza: '2026-09-01' }), '0001', TODAY).warnings.join(' '), /Nell'archivio c'è già una scadenza più recente/);
  // an imported certificate without the issue date does not block an unrelated edit...
  const imp = L.importaAnagrafica(L.nuovoArchivio(TODAY), [['ID', 'Cognome e Nome', 'Certificato medico', 'Scadenza certificato'], ['7', 'Rossi Maria', 'Agonistico', '10/01/2027'], ['8', 'Bianchi Sara', 'Mancante', '']], NOW).db;
  const m = L.byId(imp.allieve, '0007');
  assert.deepEqual([m.certTipo, m.certScadenza, L.byId(imp.allieve, '0008').certTipo], ['Agonistico', '2027-01-10', '']);
  assert.deepEqual(L.controllaAllieva(imp, Object.assign({}, m, { tel: '3331234567' }), '0007', TODAY).errors, []);
  // ...but changing it asks for the full data
  assert.match(L.controllaAllieva(imp, Object.assign({}, m, { certScadenza: '2027-02-10' }), '0007', TODAY).errors.join(' '), /rilascio mancante/);
  // anything else is not a type
  assert.equal(L.pulisciAllieva({ name: 'Rossi Maria', certTipo: 'Mancante' }).certTipo, '');

  const st = (c, day) => L.statoCertificato(db, c, day || TODAY);
  assert.deepEqual(st({}), { stato: 'MANCANTE', giorni: null, scadenza: '', ludico: false, consegna: '', ritardo: 0 });
  assert.deepEqual(st({ certTipo: 'Agonistico' }), { stato: 'MANCANTE', giorni: null, scadenza: '', ludico: false, consegna: '', ritardo: 0 });
  assert.deepEqual(st({ certTipo: 'Agonistico', certScadenza: '2027-04-05' }), { stato: 'VALIDO', giorni: 146, scadenza: '2027-04-05', ludico: false, consegna: '', ritardo: 0 });
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: '2026-12-10' }).stato, 'IN SCADENZA'); // 30 days
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: '2026-12-11' }).stato, 'VALIDO');
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: TODAY }).stato, 'IN SCADENZA', 'valid on its last day');
  assert.deepEqual(st({ certTipo: 'Ludico-motoria', certScadenza: '2026-11-09' }), { stato: 'SCADUTO', giorni: -1, scadenza: '2026-11-09', ludico: true, consegna: '', ritardo: 0 });
});

test('certificate "in attesa": enrolled a few days ago, the certificate comes later (15 days by default, then it is missing)', () => {
  let db = L.nuovoArchivio(TODAY);
  db = L.salvaAllieva(db, null, { name: 'Neri Daniela', nascita: '2015-01-01', tel: '3331112233' }, NOW).db; // 0001
  const st = (day) => L.statoCertificato(db, L.byId(db.allieve, '0001'), day || TODAY);
  const vuoto = { stato: 'MANCANTE', giorni: null, scadenza: '', ludico: false, consegna: '', ritardo: 0 };
  assert.deepEqual(st(), vuoto, 'without an enrollment nothing is awaited');
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Lun'], tipo: 'Mensile', inizio: '2026-11-10' }, NOW).db;
  assert.deepEqual(st(), { stato: 'IN ATTESA', giorni: 15, scadenza: '', ludico: false, consegna: '2026-11-25', ritardo: 0 });
  assert.deepEqual([st('2026-11-24').stato, st('2026-11-24').giorni], ['IN ATTESA', 1]);
  assert.deepEqual([st('2026-11-25').stato, st('2026-11-25').giorni], ['IN ATTESA', 0], 'still on the last day');
  assert.deepEqual([st('2026-11-26').stato, st('2026-11-26').ritardo, st('2026-11-26').consegna], ['MANCANTE', 1, '2026-11-25'], 'the day after she is late');
  assert.equal(st('2026-12-25').ritardo, 30);
  // the number of days is a setting, from 0 to 90; an old archive without it has 15
  db.impostazioni.giorniCertificato = 0;
  assert.deepEqual([st(TODAY).stato, st('2026-11-11').stato], ['IN ATTESA', 'MANCANTE']);
  db.impostazioni.giorniCertificato = 30;
  assert.equal(st('2026-12-10').stato, 'IN ATTESA'); assert.equal(st('2026-12-11').stato, 'MANCANTE');
  delete db.impostazioni.giorniCertificato;
  assert.equal(L.giorniAttesaCert(db), 15); assert.equal(st('2026-11-25').stato, 'IN ATTESA');
  db.impostazioni.giorniCertificato = 'x';
  assert.equal(L.giorniAttesaCert(db), 15, 'a wrong value falls back to the standard');
  db.impostazioni.giorniCertificato = 15;
  // an enrollment without a start date counts from the day it was written
  db = L.salvaAllieva(db, null, { name: 'Bianchi Sara' }, NOW).db; // 0002
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Da definire', quota: '' }, NOW).db;
  assert.deepEqual([L.statoCertificato(db, L.byId(db.allieve, '0002'), TODAY).stato, L.statoCertificato(db, L.byId(db.allieve, '0002'), TODAY).consegna], ['IN ATTESA', '2026-11-25']);
  // the oldest open enrollment counts: someone who has been coming for weeks is not "in attesa" because of a new renewal
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Avanzato', giorni: ['Mar'], tipo: 'Mensile', inizio: '2026-10-01' }, NOW).db;
  assert.deepEqual([st().stato, st().consegna, st().ritardo], ['MANCANTE', '2026-10-16', 25]);
  // cancelled or closed enrollments do not count
  db.iscrizioni.forEach((e) => { if (e.allievaId === '0001') e.annullata = true; });
  assert.deepEqual(st(), vuoto);
  db.iscrizioni.forEach((e) => { if (e.allievaId === '0001') { e.annullata = false; e.storica = true; } });
  assert.deepEqual(st(), vuoto);
  db.iscrizioni.forEach((e) => { if (e.allievaId === '0001') { e.storica = false; } });
  // the certificate arrives: valid (or expired, which has no waiting time)
  db = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { certTipo: 'Agonistico', certRilascio: '2026-11-12', certScadenza: '2027-11-12' }), NOW).db;
  assert.deepEqual([st().stato, st().consegna], ['VALIDO', '']);
  db = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { certTipo: 'Agonistico', certRilascio: '2025-01-12', certScadenza: '2026-01-12' }), NOW).db;
  assert.equal(st().stato, 'SCADUTO');
});

test('certificate "in attesa": deadlines list, certificates page, summary, analysis', () => {
  let db = L.nuovoArchivio(TODAY);
  const nuova = (nome, inizio) => {
    db = L.salvaAllieva(db, null, { name: nome, nascita: '2015-01-01', tel: '3331112233' }, NOW).db;
    const id = db.allieve[db.allieve.length - 1].id;
    db = L.salvaIscrizione(db, null, { allievaId: id, corso: 'Base', giorni: ['Lun'], tipo: 'Trimestrale', inizio }, NOW).db;
    return id;
  };
  nuova('Alfa Anna', '2026-11-10');    // 15 days left
  nuova('Beta Bruna', '2026-10-25');   // late by 1 day
  nuova('Gamma Gina', '2026-11-01');   // 6 days left
  nuova('Delta Dina', '2026-10-01');   // late by 25 days
  nuova('Epsilon Elsa', '2026-11-05'); // 10 days left
  db = L.salvaAllieva(db, null, { name: 'Zeta Zoe', certTipo: 'Non Agonistico', certRilascio: '2026-11-01', certScadenza: '2027-11-01' }, NOW).db; // valid
  db = L.salvaIscrizione(db, null, { allievaId: '0006', corso: 'Base', giorni: ['Lun'], tipo: 'Trimestrale', inizio: '2026-11-02' }, NOW).db;
  const sc = L.scadenzeCertificati(db, TODAY);
  assert.deepEqual(sc.inAttesa.map((x) => [x.allieva.name, x.stato.giorni]), [['Gamma Gina', 6], ['Epsilon Elsa', 10], ['Alfa Anna', 15]], 'who must deliver first, first');
  assert.deepEqual(sc.mancanti.map((x) => [x.allieva.name, x.stato.ritardo]), [['Delta Dina', 25], ['Beta Bruna', 1]], 'the latest first');
  const r = L.riepilogo(db, TODAY);
  assert.deepEqual([r.certInAttesa, r.certMancanti, r.certScaduti, r.certInScadenza], [3, 2, 0, 0]);
  const a = L.analisi(db, TODAY, {});
  assert.deepEqual([a.certValidi, a.certInAttesa, a.certMancanti], [1, 3, 2]);
  // certificates page: a filter and a count for the ones awaited
  const e = (f) => L.elencoCertificati(db, TODAY, f);
  assert.equal(e({}).conteggi.inAttesa, 3); assert.equal(e({}).conteggi.mancanti, 2);
  assert.deepEqual(e({ stato: 'IN ATTESA' }).righe.map((x) => x.allieva.name), ['Alfa Anna', 'Epsilon Elsa', 'Gamma Gina']);
  assert.deepEqual(e({ stato: 'MANCANTE' }).righe.map((x) => x.allieva.name), ['Beta Bruna', 'Delta Dina']);
});

test('certificate "in attesa": the message to the parents and the bulk reminders (only in the last days)', () => {
  let db = L.nuovoArchivio(TODAY);
  db = L.salvaAllieva(db, null, { name: 'Alfa Anna', nascita: '2015-01-01', tel: '3331112233', genitore: 'Alfa Marco' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Lun'], tipo: 'Trimestrale', inizio: '2026-11-10' }, NOW).db; // deadline 2026-11-25
  const a = L.byId(db.allieve, '0001'), s = L.statoCertificato(db, a, TODAY);
  assert.equal(L.messaggioCertificato(db, a, s, 10), 'Buongiorno, vi ricordiamo che per Alfa Anna serve il certificato medico: potete consegnarlo in segreteria entro il 25/11/2026 (tra 15 giorni). Grazie, A.S.D. Gym Art Avezzano');
  assert.equal(L.modelloMessaggio(db, 'messaggioCertAttesa'), L.MODELLI.messaggioCertAttesa.testo);
  db.impostazioni.messaggioCertAttesa = 'Portate il certificato di {nome} entro il {scadenza}';
  assert.equal(L.messaggioCertificato(db, a, s, 10), 'Portate il certificato di Alfa Anna entro il 25/11/2026');
  db.impostazioni.messaggioCertAttesa = '';
  // reminders: nothing while there is time...
  assert.equal(L.elencoPromemoria(db, TODAY).righe.length, 0);
  assert.equal(L.elencoPromemoria(db, '2026-11-19').righe.length, 0, '6 days left: not yet');
  // ...a friendly reminder in the last 5 days...
  const u = L.elencoPromemoria(db, '2026-11-20', { ora: 10 }).righe;
  assert.deepEqual(u.map((r) => [r.tipo, r.stato, r.giorni, r.scadenza]), [['certificato', 'IN ATTESA', 5, '2026-11-25']]);
  assert.match(u[0].testo, /serve il certificato medico: potete consegnarlo in segreteria entro il 25\/11\/2026 \(tra 5 giorni\)/);
  // ...a contact noted now does not hide the next reminder, when the certificate is late
  const fatto = L.segnaPromemoria(db, { tipo: 'certificato', rif: '0001', scadenza: u[0].scadenza, on: true }, NOW, '2026-11-20');
  assert.equal(L.elencoPromemoria(fatto.db, '2026-11-21').righe.length, 0, 'contacted: not proposed again at once');
  const tardi = L.elencoPromemoria(fatto.db, '2026-11-27').righe;
  assert.deepEqual(tardi.map((r) => [r.stato, r.contatto.stato]), [['MANCANTE', 'da contattare']]);
  assert.match(tardi[0].testo, /ci risulta mancante il certificato medico di Alfa Anna/);
});

test('settings: days to bring the certificate, text for the awaited certificate', () => {
  const db = archivio();
  const f = { stagione: '2026/2027', preavvisoAbb: '30', corsi: 'Base', fasce: '', tariffario: [] };
  assert.deepEqual(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: '15' })), []);
  assert.deepEqual(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: '0' })), []);
  assert.deepEqual(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: '90' })), []);
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: '91' })).join(' '), /consegnare il certificato.*0 a 90/);
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: 'dieci' })).join(' '), /consegnare il certificato/);
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { giorniCertificato: '' })).join(' '), /consegnare il certificato/);
  assert.equal(L.salvaImpostazioni(db, Object.assign({}, f, { giorniCertificato: '20' })).db.impostazioni.giorniCertificato, 20);
  assert.equal(L.salvaImpostazioni(db, f).db.impostazioni.giorniCertificato, 15, 'not sent: unchanged');
  assert.match(L.controllaImpostazioni(Object.assign({}, f, { messaggioCertAttesa: 'Entro il {scadenzaa}' })).join(' '), /Certificato da consegnare.*segnaposto/);
  assert.equal(L.salvaImpostazioni(db, Object.assign({}, f, { messaggioCertAttesa: L.MODELLI.messaggioCertAttesa.testo })).db.impostazioni.messaggioCertAttesa, '', 'the standard text is not stored');
});

test('certificate brought together with the enrollment (new or present student) and certificate written without a document', () => {
  const db = L.nuovoArchivio(TODAY);
  const fA = { name: 'Neri Daniela', nascita: '2015-01-01', tel: '3331112233', genitore: 'Neri Paolo', privacy: 'Sì', liberatoria: 'Sì' };
  const fI = { allievaId: '', corso: 'Base', giorni: ['Lun'], tipo: 'Mensile', inizio: TODAY };
  const cert = { certTipo: 'Non Agonistico', certRilascio: '2026-11-05', certScadenza: '2027-11-05' };
  assert.equal(L.datiCertificato({ certTipo: '', certRilascio: '', certScadenza: '' }), null);
  assert.equal(L.datiCertificato(undefined), null);
  // a new student with the certificate
  assert.deepEqual(L.controllaNuovaIscrizione(db, fA, fI, TODAY, cert).errors, []);
  const r = L.salvaNuovaIscrizione(db, fA, fI, NOW, cert);
  assert.deepEqual([r.db.allieve[0].certTipo, r.db.allieve[0].certRilascio, r.db.allieve[0].certScadenza], ['Non Agonistico', '2026-11-05', '2027-11-05']);
  assert.equal(L.statoCertificato(r.db, r.db.allieve[0], TODAY).stato, 'VALIDO');
  assert.equal(r.db.iscrizioni.length, 1);
  // a new student without it: she is enrolled and the certificate is awaited
  const r0 = L.salvaNuovaIscrizione(db, fA, fI, NOW);
  assert.equal(L.statoCertificato(r0.db, r0.db.allieve[0], TODAY).stato, 'IN ATTESA');
  // wrong data are refused: type but no dates; an issue date in the future
  assert.deepEqual(L.controllaNuovaIscrizione(db, fA, fI, TODAY, { certTipo: 'Agonistico', certRilascio: '', certScadenza: '' }).errors.map((e) => e.slice(0, 12)), ['Certificato:', 'Certificato:']);
  assert.match(L.controllaNuovaIscrizione(db, fA, fI, TODAY, { certTipo: 'Agonistico', certRilascio: '2027-01-01', certScadenza: '2028-01-01' }).errors.join(' '), /futuro/);
  assert.match(L.controllaNuovaIscrizione(db, fA, fI, TODAY, { certTipo: '', certRilascio: '', certScadenza: '' }).errors.join(' '), /oppure indica che lo porta dopo/, 'asked but empty: say it or choose "later"');
  // a student who is already here, without a certificate: it is added to her, with the log
  let db2 = L.salvaAllieva(db, null, { name: 'Bianchi Sara', nascita: '2014-02-02' }, NOW).db;
  const fI2 = { allievaId: '0001', corso: 'Base', giorni: ['Lun'], tipo: 'Mensile', inizio: TODAY };
  assert.deepEqual(L.controllaNuovaIscrizione(db2, null, fI2, TODAY, cert).errors, []);
  assert.match(L.controllaNuovaIscrizione(db2, null, fI2, TODAY, { certTipo: 'Agonistico' }).errors.join(' '), /Certificato:/);
  assert.deepEqual(L.controllaNuovaIscrizione(db2, null, fI2, TODAY).errors, [], 'no certificate: nothing to check');
  const r2 = L.salvaNuovaIscrizione(db2, null, fI2, NOW, cert);
  assert.equal(r2.db.allieve[0].certTipo, 'Non Agonistico');
  assert.deepEqual(r2.registro.filter((x) => x.operazione === 'Modifica allieva').map((x) => x.campo), ['Certificato medico', 'Rilascio certificato', 'Scadenza certificato']);
  assert.equal(r2.registro[0].operazione, 'Modifica allieva', 'the student first, then the enrollment');
  assert.equal(r2.db.iscrizioni.length, 1);
  assert.equal(L.salvaNuovaIscrizione(db2, null, fI2, NOW).db.allieve[0].certTipo, '', 'nothing written about the certificate: unchanged');

  // the certificate without a document: from the list of the awaited ones
  const base = r0.db; // 0001 enrolled today, in attesa
  const v = { allievaId: '0001', certTipo: 'Agonistico', rilascio: '2026-11-12', scadenza: '2027-11-12' };
  assert.deepEqual(L.controllaCertificato(base, v, '2026-11-13').errors, []);
  const s = L.salvaCertificato(base, v, NOW, '2026-11-13');
  assert.deepEqual([s.db.allieve[0].certTipo, s.db.allieve[0].certScadenza], ['Agonistico', '2027-11-12']);
  assert.equal(L.statoCertificato(s.db, s.db.allieve[0], '2026-11-13').stato, 'VALIDO');
  assert.equal(s.registro.length, 3);
  assert.equal(L.salvaCertificato(s.db, v, NOW, '2026-11-13').registro.length, 0, 'the same data again: nothing changes');
  assert.match(L.controllaCertificato(base, Object.assign({}, v, { certTipo: '' }), TODAY).errors.join(' '), /tipo/);
  assert.match(L.controllaCertificato(base, Object.assign({}, v, { scadenza: '2026-11-01' }), TODAY).errors.join(' '), /prima della data/);
  assert.throws(() => L.salvaCertificato(base, Object.assign({}, v, { rilascio: '' }), NOW, TODAY), /rilascio/);
  assert.equal(base.allieve[0].certTipo, '', 'the old archive is untouched');
});

test('versions of the program and the news to show after an update', () => {
  assert.deepEqual([['1.2.3', '1.2.3'], ['1.10.0', '1.9.9'], ['1.2.3', '1.3.0'], ['2.0.0', '1.99.99'], ['x', '0.0.0'], ['1.17.0', '1.16.0']].map(([a, b]) => L.confrontaVersioni(a, b)), [0, 1, -1, 1, 0, 1]);
  const N = [{ v: '1.17.0' }, { v: '1.16.0' }, { v: '1.15.0' }, { v: '1.14.0' }, { v: '1.13.0' }];
  assert.deepEqual(L.novitaDaMostrare(N, '1.15.0', '1.17.0').map((n) => n.v), ['1.17.0', '1.16.0'], 'the newest first, nothing already seen');
  assert.deepEqual(L.novitaDaMostrare(N, '1.17.0', '1.17.0'), [], 'nothing new');
  assert.deepEqual(L.novitaDaMostrare(N, '', '1.17.0'), [], 'a device that never saw any: the tour introduces the program, not a list');
  assert.deepEqual(L.novitaDaMostrare(N, '1.10.0', '1.17.0').map((n) => n.v), ['1.17.0', '1.16.0', '1.15.0'], 'at most three');
  assert.deepEqual(L.novitaDaMostrare(N, '1.15.0', '1.16.0').map((n) => n.v), ['1.16.0'], 'a version after the installed one is not shown');
  const reale = require('../win/web/novita.js');
  assert.ok(reale.length >= 4 && reale.every((n) => /^\d+\.\d+\.\d+$/.test(n.v) && n.titolo && n.voci.length && n.voci.every((x) => x.t && x.d && (!x.vai || /^[a-z0-9/-]+$/.test(x.vai)))), 'every version has a title and its items, with a page of the program to try');
  assert.deepEqual(reale.map((n) => n.v), reale.map((n) => n.v).sort((a, b) => L.confrontaVersioni(b, a)), 'the newest on top');
});

test('publishing an update: the folder "aggiornamenti" gets the program and a manifest the program accepts', () => {
  const { pubblica, versioneDelProgramma } = require('../tools/pubblica.js');
  const crypto = require('node:crypto'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubblica-')), exe = path.join(dir, 'GymArtSegreteria.exe'), uscita = path.join(dir, 'aggiornamenti');
  const prog = Buffer.alloc((1 << 20) + 500, 7); prog.write('MZ'); fs.writeFileSync(exe, prog);
  const novita = require('../win/web/novita.js');
  assert.match(versioneDelProgramma(), /^\d+\.\d+\.\d+$/);
  // an older version stays in the folder only until the new one arrives
  fs.mkdirSync(uscita); fs.writeFileSync(path.join(uscita, 'GymArtSegreteria-1.0.0.exe'), 'vecchio'); fs.writeFileSync(path.join(uscita, 'LEGGIMI.txt'), 'resta');
  const v = novita[0].v;
  const m = pubblica({ exe, versione: v, uscita, novita, oggi: '2026-11-20' });
  assert.deepEqual(fs.readdirSync(uscita).sort(), ['GymArtSegreteria-' + v + '.exe', 'LEGGIMI.txt', 'aggiornamento.json']);
  const scritto = JSON.parse(fs.readFileSync(path.join(uscita, 'aggiornamento.json'), 'utf8'));
  assert.deepEqual(scritto, m);
  assert.equal(m.sha256, crypto.createHash('sha256').update(prog).digest('hex')); assert.equal(m.dimensione, prog.length); assert.equal(m.file, 'GymArtSegreteria-' + v + '.exe'); assert.equal(m.data, '2026-11-20');
  assert.equal(m.novita.length, novita[0].voci.length); assert.ok(m.novita.every((x) => x.titolo && x.testo));
  assert.ok(m.novita.every((x) => !('vai' in x) || /^[a-z0-9/-]{1,60}$/.test(x.vai)), 'only internal addresses of the program');
  // what must not be published
  assert.throws(() => pubblica({ exe, versione: '9.9.9', uscita, novita }), /Manca la voce della versione 9\.9\.9/);
  assert.throws(() => pubblica({ exe, versione: '1.2', uscita, novita }), /Versione non valida/);
  const piccolo = path.join(dir, 'piccolo.exe'); fs.writeFileSync(piccolo, 'MZ');
  assert.throws(() => pubblica({ exe: piccolo, versione: v, uscita, novita }), /dimensione/);
  const nonExe = path.join(dir, 'x.exe'); fs.writeFileSync(nonExe, Buffer.alloc((1 << 20) + 5, 1));
  assert.throws(() => pubblica({ exe: nonExe, versione: v, uscita, novita }), /non è un programma per Windows/);
  fs.rmSync(dir, { recursive: true, force: true });
});

const A = require('../win/web/assistente.js');
function archivioAssistente() {
  const oggi = '2026-11-19', ora = oggi + 'T09:00:00';
  let db = L.nuovoArchivio(oggi);
  const add = (name, nascita, tel, genitore, cert) => { db = L.salvaAllieva(db, null, Object.assign({ name, nascita, tel, genitore }, cert || {}), ora).db; return db.allieve[db.allieve.length - 1].id; };
  const isc = (id, corso, tipo, inizio, pacchetto) => { db = L.salvaIscrizione(db, null, { allievaId: id, corso, giorni: ['Lun', 'Mer'], tipo, inizio, pacchetto: pacchetto || PAC2 }, ora).db; };
  const maria = add('Rossi Maria', '2015-11-19', '333 123 4567', 'Rossi Paolo', { certTipo: 'Non Agonistico', certRilascio: '2025-12-01', certScadenza: '2026-12-01' }); isc(maria, 'Base', 'Mensile', '2026-10-01'); // expired, certificate expiring, birthday today
  const sara = add('Bianchi Sara', '2014-02-02', '333 765 4321', 'Bianchi Marco'); isc(sara, 'Base', 'Trimestrale', '2026-11-10');                                       // certificate "in attesa"
  const anna = add('Verdi Anna', '2013-05-05', '', 'Verdi Luca', { certTipo: 'Agonistico', certRilascio: '2025-10-01', certScadenza: '2026-10-01' }); isc(anna, 'Agonismo', 'Trimestrale', '2026-09-01'); // no phone, certificate expired
  const dani = add('Neri Daniela', '2012-06-06', '333 000 1111', 'Neri Gina'); isc(dani, 'Propedeutico', 'Mensile', '2026-09-20');                                      // certificate missing, subscription expired
  const lia = add('Rossi Lia', '2016-03-03', '333 999 8888', 'Rossi Anna'); isc(lia, 'Base', 'Annuale', '2026-09-15');                                                   // a second "Rossi"
  db = L.salvaPagamento(db, { iscrizioneId: '0001', data: '2026-10-02', importo: '20', metodo: 'Bonifico' }, ora).db;
  return { db, oggi, id: { maria, sara, anna, dani, lia } };
}
const MANUALE = [{ t: 'Registrare un pagamento', passi: ['Apri l\'iscrizione', 'Premi «Registra il pagamento»'], consiglio: 'Un bonifico resta da verificare.' }, { t: 'Iscrivere una persona nuova', passi: ['Premi «Nuova iscrizione»'] }];

test('assistant: a question that only shares a short or common word with the manual is not answered with a page of it', () => {
  const { db, oggi } = archivioAssistente();
  const manuale = [{ t: 'Se qualcosa non torna', passi: ['Il programma sembra lento', 'Non trovo una persona: scegli «Tutte»'] }, { t: 'Registrare un pagamento', passi: ['Apri l\'iscrizione'] }];
  const r = (t) => A.rispondi(db, t, oggi, { manuale, ora: 10 });
  for (const x of ['qual è il senso della vita', 'qualcuno ha visto la mia vita', 'dove vive la nonna']) assert.equal(r(x).tipo, 'non-capito', x);
  assert.equal(r('qualcosa non torna').titolo, 'Se qualcosa non torna');
  assert.equal(r('come registro un pagamento').titolo, 'Registrare un pagamento');
});

test('assistant: what to do now, most urgent first, with the reason, the actions and the messages ready', () => {
  const { db, oggi } = archivioAssistente();
  const c = A.consigli(db, oggi, { copie2: { cartella: '', ultima: '' }, ora: 10 });
  const id = (x) => c.find((y) => y.id === x);
  assert.deepEqual(c.map((x) => x.urgenza), c.map((x) => x.urgenza).sort((a, b) => a - b), 'sorted by urgency');
  for (const x of c) assert.ok(x.titolo && x.perche && x.etichetta && x.azioni.every((a) => a.etichetta && /^[a-z0-9/%-]+$/.test(a.vai)), 'every piece of advice has a title, a reason and links inside the program: ' + x.id);
  assert.equal(id('abb-scaduti').urgenza, 1); assert.match(id('abb-scaduti').perche, /Rossi Maria|Neri Daniela/);
  assert.deepEqual(id('abb-scaduti').messaggi.map((m) => m.chi).sort(), ['Neri Daniela', 'Rossi Maria'], 'a message for each expired one, with their texts');
  assert.ok(id('abb-scaduti').messaggi.every((m) => /abbonamento/.test(m.testo) && m.tel));
  assert.equal(id('cert-scaduti').messaggi.length, 0, 'Verdi Anna has no phone: no message can be prepared');
  assert.equal(id('senza-telefono').urgenza, 4); assert.match(id('senza-telefono').titolo, /^1 persona/);
  assert.ok(id('cert-mancanti') && /Rossi Lia \(da 50 giorni\)/.test(id('cert-mancanti').perche) && id('cert-mancanti').messaggi.length === 2 && id('cert-mancanti').messaggi.every((m) => /mancante/.test(m.testo)), 'the latest one first');
  assert.ok(id('cert-attesa') && /Bianchi Sara/.test(id('cert-attesa').perche) && id('cert-attesa').urgenza === 4, 'in attesa and far from the deadline: only a quiet note');
  assert.ok(id('bonifici') && id('bonifici').urgenza === 2 && /20,00/.test(id('bonifici').titolo));
  assert.ok(id('seconda-copia') && id('seconda-copia').azioni[0].vai === 'impostazioni/dati');
  assert.ok(id('compleanni') && /Rossi Maria/.test(id('compleanni').titolo) && /tanti auguri a Maria/.test(id('compleanni').messaggi[0].testo));
  assert.ok(id('rinnovi-2026-12'), 'the renewals of December are announced: ' + c.map((x) => x.id).join());
  assert.match(id('rinnovi-2026-12').perche, /mesi dei rinnovi trimestrali/);
  // with the second folder set the advice about it goes away; a new version of the program is announced
  const c2 = A.consigli(db, oggi, { copie2: { cartella: 'E:\\Copie', ultima: oggi + 'T08:00:00+01:00' }, aggiornamento: { versione: '9.9.9' } });
  assert.ok(!c2.find((x) => x.id === 'seconda-copia') && !c2.find((x) => x.id === 'copia'));
  assert.match(c2.find((x) => x.id === 'aggiornamento').titolo, /9\.9\.9/);
  // seasons: in September the new season, in June-July the preparation
  const set = (g, s) => { const d = JSON.parse(JSON.stringify(db)); d.impostazioni.stagione = s; return A.consigli(d, g, {}); };
  assert.ok(set('2026-09-10', '2025/2026').some((x) => x.id === 'nuova-stagione' && /2026\/2027/.test(x.titolo)));
  assert.ok(!set('2026-11-19', '2026/2027').some((x) => x.id === 'nuova-stagione'));
  assert.ok(set('2026-06-20', '2025/2026').some((x) => x.id === 'prepara-stagione'));
  // an empty archive, or one where everything is fine, says so
  const v = A.consigli(L.nuovoArchivio(oggi), oggi, {});
  assert.deepEqual(v.map((x) => x.id), ['tutto-bene']);
});

test('assistant: questions in Italian, answered from the archive; what it does not know it says', () => {
  const { db, oggi, id } = archivioAssistente();
  const q = (t, opz) => A.rispondi(db, t, oggi, Object.assign({ manuale: MANUALE, ora: 10 }, opz));
  const righe = (r) => r.righe.map((x) => x.t).join(' | ');
  assert.match(q('Chi deve portare il certificato?').titolo, /1 allieva deve ancora portare/); assert.match(righe(q('chi deve portare il certificato')), /Bianchi Sara · entro il 25\/11\/2026/);
  assert.match(q('certificati mancanti').titolo, /2 allieve senza certificato/); assert.match(righe(q('certificati mancanti')), /Rossi Lia · in ritardo di 50 giorni \| Neri Daniela · in ritardo di 45 giorni/);
  assert.match(q('certificati scaduti').titolo, /1 scaduto/); assert.match(righe(q('certificati scaduti')), /Verdi Anna/);
  assert.match(righe(q('Chi deve rinnovare?')), /Neri Daniela/); assert.ok(q('Chi deve rinnovare?').messaggi.length === 2, 'and the messages ready');
  assert.match(righe(q('chi compie gli anni')), /Rossi Maria · oggi · 11 anni/);
  assert.match(q('che cosa devo fare oggi').titolo, /consiglio/); assert.match(q('cosa devo fare oggi').righe[0].t, /^Subito:/);
  assert.match(q('bonifici da verificare').titolo, /1 bonifico/); assert.match(righe(q('bonifici')), /Rossi Maria · 20,00 €/);
  assert.match(righe(q('quanto abbiamo incassato')), /Nella stagione: 20,00 €/);
  assert.match(q('quanto devo incassare').titolo, /da incassare/);
  assert.match(q('chi frequenta il corso Base').titolo, /Corso Base: 3 iscritte/); assert.match(righe(q('elenco corso base')), /Rossi Lia/);
  assert.match(q('quante allieve ci sono').titolo, /5 allieve, 5 iscrizioni aperte/);
  assert.match(righe(q('copie di sicurezza')), /seconda copia non è impostata/);
  // one person: by surname and name, or by the full name with "messaggio per"
  const s = q('neri'); assert.equal(s.titolo, 'Neri Daniela'); assert.equal(s.persona, id.dani);
  assert.match(righe(s), /Certificato mancante: era da consegnare entro il 05\/10\/2026/); assert.match(righe(s), /scaduto il 20\/10\/2026/);
  assert.deepEqual(s.azioni.map((a) => a.vai), ['allieva/' + id.dani, 'allieva/' + id.dani]);
  assert.ok(s.messaggi.length >= 1 && s.messaggi.every((m) => m.chi === 'Neri Daniela'));
  assert.equal(q('messaggio per rossi maria').titolo, 'Rossi Maria');
  assert.equal(q('Rossi Maria').persona, id.maria);
  assert.equal(q('verdi anna').messaggi.length, 0, 'no phone: no message');
  // two "Rossi": a short list to choose from; but "rossi" with a question about certificates is about the certificates
  const due = q('rossi'); assert.match(due.titolo, /2 persone/); assert.deepEqual(due.righe.map((x) => x.vai).sort(), ['allieva/' + id.lia, 'allieva/' + id.maria].sort());
  assert.match(q('certificati mancanti rossi').titolo, /senza certificato/);
  // how to do a thing: the steps of the manual
  const m = q('come registro un pagamento'); assert.equal(m.titolo, 'Registrare un pagamento'); assert.match(righe(m), /1\. Apri l'iscrizione \| 2\. Premi «Registra il pagamento»/);
  assert.equal(q('come iscrivo una persona nuova').titolo, 'Iscrivere una persona nuova');
  // what it does not know: it says so and suggests, never invents
  for (const x of ['asdfgh', 'qual è il senso della vita']) { const r = q(x); assert.equal(r.tipo, 'non-capito', x); assert.ok(r.suggerimenti.length >= 4); }
  assert.equal(q('').titolo, 'Che cosa vuoi sapere?');
  // nothing leaves: the answers only contain what is in the archive (no addresses, no tax codes)
  assert.ok(!JSON.stringify(q('rossi maria')).includes('http'));
});

test('scadenzeCertificati and messaggioCertificato: only students who are attending', () => {
  let db = archivio(); // 0001 has an open enrollment, 0002 has none
  const cert = (id, c) => { db = L.salvaAllieva(db, id, Object.assign({}, L.byId(db.allieve, id), c), NOW).db; };
  const iscrivi = (id) => { db = L.salvaIscrizione(db, null, { allievaId: id, corso: 'Base', quota: '' }, NOW).db; };
  assert.deepEqual(L.scadenzeCertificati(db, TODAY).mancanti.map((x) => x.allieva.name), ['Del Bosco Giulia']);
  iscrivi('0002');
  db = L.salvaAllieva(db, null, { name: 'Bianchi Sara' }, NOW).db; iscrivi('0003');
  db = L.salvaAllieva(db, null, { name: 'Verdi Camilla' }, NOW).db; iscrivi('0004');
  db = L.salvaAllieva(db, null, { name: 'Neri Daniela' }, NOW).db; iscrivi('0005');
  cert('0001', { certTipo: 'Agonistico', certRilascio: '2025-11-20', certScadenza: '2026-11-20' });   // in 10 days
  cert('0002', { certTipo: 'Agonistico', certRilascio: '2025-10-01', certScadenza: '2026-10-01' });   // 40 days ago
  cert('0003', { certTipo: 'Agonistico', certRilascio: '2025-11-05', certScadenza: '2026-11-05' });   // 5 days ago
  cert('0004', { certTipo: 'Non Agonistico', certRilascio: '2026-09-01', certScadenza: '2027-09-01' }); // valid
  db = L.archiviaAllieva(db, '0005', true, NOW).db;                                                     // archived: not chased
  const sc = L.scadenzeCertificati(db, TODAY);
  assert.deepEqual(sc.scaduti.map((x) => [x.allieva.name, x.stato.giorni]), [['Rossi Maria', -40], ['Bianchi Sara', -5]]);
  assert.deepEqual(sc.inScadenza.map((x) => [x.allieva.name, x.stato.giorni]), [['Del Bosco Giulia', 10]]);
  assert.deepEqual(sc.mancanti, []);
  const r = L.riepilogo(db, TODAY);
  assert.deepEqual([r.certScaduti, r.certInScadenza, r.certMancanti], [2, 1, 0]);
  assert.equal(L.messaggioCertificato(db, sc.inScadenza[0].allieva, sc.inScadenza[0].stato, 10), 'Buongiorno, vi ricordiamo che il certificato medico di Del Bosco Giulia scade il 20/11/2026 (tra 10 giorni). Vi chiediamo di consegnare in segreteria quello nuovo. Grazie, A.S.D. Gym Art Avezzano');
  assert.match(L.messaggioCertificato(db, { name: 'Neri Daniela' }, { stato: 'MANCANTE', scadenza: '' }, 10), /mancante il certificato medico di Neri Daniela/);
  assert.match(L.messaggioCertificato(db, sc.scaduti[0].allieva, sc.scaduti[0].stato, 10), /^Buongiorno, il certificato medico di Rossi Maria è scaduto il 01\/10\/2026\./, 'an expired certificate has its own text');
  db.impostazioni.messaggioCertificato = '{nome} -> {scadenza}';
  assert.equal(L.messaggioCertificato(db, sc.inScadenza[0].allieva, sc.inScadenza[0].stato, 10), 'Del Bosco Giulia -> 20/11/2026');
});

test('dovuto and conto: fee of the period plus the registration fee', () => {
  const db = archivio(), e = db.iscrizioni[0];
  assert.equal(L.dovuto(db, e), 170);
  assert.deepEqual(L.conto(db, e), { dovuto: 170, pagato: 0, residuo: 170, stato: 'DA PAGARE' });
  assert.equal(L.dovuto(db, Object.assign({}, e, { quotaIscrizione: 10 })), 180);
  assert.equal(L.dovuto(db, Object.assign({}, e, { quota: 150, quotaIscrizione: 10.5 })), 160.5);
  assert.equal(L.dovuto(db, Object.assign({}, e, { pacchetto: '', quotaIscrizione: 10 })), 10, 'only the registration fee is known');
  assert.equal(L.dovuto(db, Object.assign({}, e, { pacchetto: '' })), null);
  assert.equal(L.conto(db, Object.assign({}, e, { pacchetto: '' })).stato, 'SENZA QUOTA');
  assert.equal(L.conto(db, Object.assign({}, e, { quota: 0 })).stato, 'SENZA QUOTA', 'free of charge: nothing to pay');
  // the fee is a field like the others: cleaned, checked, logged
  const r = L.salvaIscrizione(db, '0001', Object.assign({}, e, { quotaIscrizione: '10,00' }), NOW);
  assert.equal(L.byId(r.db.iscrizioni, '0001').quotaIscrizione, 10);
  assert.deepEqual(r.registro.map((x) => [x.campo, x.prima, x.dopo]), [['Iscrizione e tesseramento', '', '10,00 €']]);
  assert.match(L.controllaIscrizione(db, Object.assign({}, e, { quotaIscrizione: 'dieci' }), '0001').errors.join(' '), /Iscrizione e tesseramento: importo non valido/);
  assert.match(L.controllaIscrizione(db, Object.assign({}, e, { quotaIscrizione: '-1' }), '0001').errors.join(' '), /importo non valido/);
  // a renewal does not charge the registration fee again
  const rin = L.rinnova(r.db, '0001', NOW, TODAY);
  assert.equal(L.byId(rin.db.iscrizioni, rin.id).quotaIscrizione, null);
  assert.equal(L.dovuto(rin.db, L.byId(rin.db.iscrizioni, rin.id)), 170);
});

test('payments: explicit amount, method and date; receipts numbered per enrollment and never reused', () => {
  let db = archivio();
  const base = { iscrizioneId: '0001', data: TODAY, importo: '70', metodo: 'Bonifico', note: 'acconto' };
  assert.deepEqual(L.controllaPagamento(db, base, TODAY).errors, []);
  const err = (o) => L.controllaPagamento(db, Object.assign({}, base, o), TODAY).errors.join(' ');
  assert.match(err({ importo: '' }), /Importo mancante/);
  assert.match(err({ importo: '0' }), /Importo mancante o non valido/);
  assert.match(err({ importo: 'abc' }), /Importo mancante o non valido/);
  assert.match(err({ metodo: '' }), /metodo di pagamento/);
  assert.match(err({ data: '' }), /Data del pagamento mancante/);
  assert.match(err({ data: '2026-11-11' }), /nel futuro/);
  assert.match(err({ iscrizioneId: '0099' }), /Scegli l'iscrizione/);
  assert.match(L.controllaPagamento(db, Object.assign({}, base, { importo: '200' }), TODAY).warnings.join(' '), /supera il residuo/);
  assert.throws(() => L.salvaPagamento(db, Object.assign({}, base, { metodo: '' }), NOW), /importo, metodo e data/);

  let r = L.salvaPagamento(db, base, NOW);
  assert.deepEqual(r.db.pagamenti, [{ id: '0001', iscrizioneId: '0001', data: TODAY, importo: 70, metodo: 'Bonifico', ricevuta: 'RIC-0001-1', note: 'acconto', creata: NOW, daVerificare: true, verificatoIl: '' }]);
  assert.deepEqual(r.registro, [{ allieva: 'Del Bosco Giulia', operazione: 'Pagamento registrato', campo: 'Importo', prima: '', dopo: '70,00 €', nota: 'Iscrizione n. 0001 · Base · Bonifico · 10/11/2026 · ricevuta RIC-0001-1' }]);
  assert.equal(db.pagamenti.length, 0, 'the old archive is untouched');
  db = r.db;
  assert.deepEqual(L.conto(db, db.iscrizioni[0]), { dovuto: 170, pagato: 70, residuo: 100, stato: 'PARZIALE' });
  assert.match(L.controllaPagamento(db, base, TODAY).warnings.join(' '), /già un pagamento uguale/);
  db = L.salvaPagamento(db, { iscrizioneId: '0001', data: '10/11/2026', importo: 100.004, metodo: 'Contanti' }, NOW).db;
  assert.deepEqual(db.pagamenti[1], { id: '0002', iscrizioneId: '0001', data: TODAY, importo: 100, metodo: 'Contanti', ricevuta: 'RIC-0001-2', note: '', creata: NOW });
  assert.deepEqual(L.conto(db, db.iscrizioni[0]), { dovuto: 170, pagato: 170, residuo: 0, stato: 'SALDATO' });
  assert.deepEqual(L.pagamentiDi(db, '0001').map((p) => p.ricevuta), ['RIC-0001-1', 'RIC-0001-2']);

  // deleting the last payment does not free its receipt number
  const del = L.eliminaPagamento(db, '0002');
  assert.deepEqual(del.registro[0], { allieva: 'Del Bosco Giulia', operazione: 'Pagamento eliminato', campo: 'Importo', prima: '100,00 €', dopo: '', nota: 'Iscrizione n. 0001 · Base · Contanti · 10/11/2026 · ricevuta RIC-0001-2' });
  const again = L.salvaPagamento(del.db, base, NOW);
  assert.deepEqual(again.db.pagamenti.map((p) => [p.id, p.ricevuta]), [['0001', 'RIC-0001-1'], ['0003', 'RIC-0001-3']]);
  assert.throws(() => L.eliminaPagamento(db, '0099'), /non trovato/);
  // an enrollment with payments cannot be deleted; without them it can
  assert.throws(() => L.eliminaIscrizione(db, '0001'), /ha dei pagamenti registrati/);
  assert.equal(L.eliminaIscrizione(L.eliminaPagamento(L.eliminaPagamento(db, '0001').db, '0002').db, '0001').db.iscrizioni.length, 0);
  assert.equal(L.validaArchivio(db), '');
  assert.match(L.validaArchivio(Object.assign({}, db, { pagamenti: [{ id: '0001', iscrizioneId: '0077', importo: 5 }] })), /pagamento che non appartiene/);
});

test('incassi and daIncassare', () => {
  let db = archivio();
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Propedeutico', pacchetto: 'Corso Propedeutico · 1 giorno/settimana', tipo: 'Mensile', inizio: '2026-11-01', quota: '', quotaIscrizione: '10' }, NOW).db; // due 45
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Base', pacchetto: PAC2, tipo: 'Mensile', inizio: '2026-11-01', quota: '', annullata: true }, NOW).db;                                 // cancelled: not chased
  const paga = (isc, data, importo, metodo) => { db = L.salvaPagamento(db, { iscrizioneId: isc, data, importo, metodo }, NOW).db; };
  paga('0001', '2026-10-05', 100, 'Bonifico'); paga('0002', '2026-11-03', 45, 'Contanti'); paga('0001', '2026-11-08', 20, 'Contanti');
  const d = L.daIncassare(db);
  assert.deepEqual(d.righe.map((x) => [x.allieva.name, x.iscrizione.id, x.conto.residuo]), [['Del Bosco Giulia', '0001', 50]]);
  assert.equal(d.totale, 50);
  const r = L.riepilogo(db, TODAY);
  assert.deepEqual([r.daIncassare, r.totaleDaIncassare], [1, 50]);
  const all = L.incassi(db, {});
  assert.deepEqual(all.righe.map((x) => [x.pagamento.data, x.allieva.name, x.pagamento.importo]), [['2026-11-08', 'Del Bosco Giulia', 20], ['2026-11-03', 'Rossi Maria', 45], ['2026-10-05', 'Del Bosco Giulia', 100]]);
  assert.deepEqual([all.totale, all.perMetodo], [165, { Bonifico: 100, Contanti: 65 }]);
  const nov = L.incassi(db, { dal: '2026-11-01', al: '2026-11-30' });
  assert.deepEqual([nov.righe.length, nov.totale, nov.perMetodo], [2, 65, { Contanti: 65 }]);
  assert.equal(L.incassi(db, { dal: '2026-11-03', al: '2026-11-03' }).righe.length, 1, 'both ends included');
  assert.equal(L.incassi(db, { metodo: 'Bonifico' }).totale, 100);
  assert.equal(L.incassi(db, { q: 'rossi prop' }).totale, 45);
  assert.equal(L.incassi(db, { q: 'RIC-0001-2' }).righe.length, 1);
  const csv = L.leggiCsv(L.csvPagamenti(db));
  assert.deepEqual(csv[0], ['N.', 'Data pagamento', 'Allieva', 'Corso', 'N. iscrizione', 'Importo', 'Metodo', 'N. ricevuta', 'Note', 'Verifica bonifico']);
  assert.deepEqual(csv.slice(1).map((x) => x.slice(0, 8)), [['0001', '05/10/2026', 'Del Bosco Giulia', 'Base', '0001', '100', 'Bonifico', 'RIC-0001-1'], ['0002', '03/11/2026', 'Rossi Maria', 'Propedeutico', '0002', '45', 'Contanti', 'RIC-0002-1'], ['0003', '08/11/2026', 'Del Bosco Giulia', 'Base', '0001', '20', 'Contanti', 'RIC-0001-2']]);
  const isc = L.leggiCsv(L.csvIscrizioni(db, TODAY));
  assert.deepEqual(isc[1].slice(11, 15), ['170', '170', '120', '50']);
  assert.deepEqual(isc[2].slice(11, 15), ['35', '45', '45', '0']);
});

test('euroInLettere', () => {
  const cases = { 0: 'zero/00', 1: 'uno/00', 8: 'otto/00', 13: 'tredici/00', 21: 'ventuno/00', 23: 'ventitré/00', 28: 'ventotto/00', 30: 'trenta/00', 45.5: 'quarantacinque/50', 70: 'settanta/00', 99.99: 'novantanove/99',
    100: 'cento/00', 101: 'centouno/00', 108: 'centootto/00', 170: 'centosettanta/00', 180: 'centottanta/00', 188: 'centottantotto/00', 200: 'duecento/00', 250.05: 'duecentocinquanta/05', 580: 'cinquecentottanta/00', 999: 'novecentonovantanove/00',
    1000: 'mille/00', 1001: 'milleuno/00', 1100: 'millecento/00', 2000: 'duemila/00', 21000: 'ventunomila/00', 23000: 'ventitremila/00', 123456: 'centoventitremilaquattrocentocinquantasei/00', 0.07: 'zero/07', 19.999: 'venti/00' };
  Object.keys(cases).forEach((k) => assert.equal(L.euroInLettere(+k), cases[k], k));
  assert.equal(L.euroInLettere(1e7), '', 'too large to spell: left to the digits');
});

test('datiRicevuta: who paid, for whom, for what', () => {
  let db = archivio();
  db = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { cfGenitore: 'DLCNNL75C48H501H' }), NOW).db;
  db = L.salvaImpostazioni(db, { stagione: '2026/2027', preavvisoAbb: '30', corsi: 'Base', fasce: '', tariffario: db.tariffario.map((p) => Object.assign({}, p, { Mensile: p.Mensile, Trimestrale: p.Trimestrale, Semestrale: '', Annuale: p.Annuale, iscrizione: '' })), cfAssociazione: '90012345678', legale: 'Mario Bianchi' }).db;
  db = L.salvaPagamento(db, { iscrizioneId: '0001', data: TODAY, importo: '70,50', metodo: 'Bonifico', note: 'acconto' }, NOW).db;
  assert.deepEqual(L.datiRicevuta(db, '0001'), { numero: 'RIC-0001-1', data: '10/11/2026', stagione: '2026/2027',
    pagante: { nome: 'De Luca Antonella', cf: 'DLCNNL75C48H501H' }, atleta: { nome: 'Del Bosco Giulia', nascita: '12/10/2013', cf: 'DLBGLI13R52A345D' },
    causale: 'Corso Base, abbonamento trimestrale dal 01/10/2026 al 01/01/2027', importo: '70,50 €', lettere: 'settanta/50', metodo: 'Bonifico', note: 'acconto', residuo: '99,50 €',
    societa: { cf: '90012345678', legale: 'Mario Bianchi' } });
  // an adult athlete with no parent pays for herself; a settled enrollment shows no balance
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Da definire', quota: '20' }, NOW).db;
  db = L.salvaPagamento(db, { iscrizioneId: '0002', data: TODAY, importo: 20, metodo: 'Contanti' }, NOW).db;
  const d = L.datiRicevuta(db, '0002');
  assert.deepEqual([d.pagante, d.causale, d.residuo, d.lettere], [{ nome: 'Rossi Maria', cf: '' }, 'Corso Da definire', '', 'venti/00']);
  assert.throws(() => L.datiRicevuta(db, '0099'), /non trovato/);
});

const PAG = [
  ['Data pagamento', "Iscrizione (scegli dall'elenco)", 'Importo', 'Metodo', 'N. ricevuta', 'Note', 'ID iscrizione', 'Allieva', 'Corso'],
  ['29/09/2026', '0012 · Del Bosco Giulia · Base', '70,00 €', 'Bonifico', 'RIC-012-1', 'acconto', '0012', 'Del Bosco Giulia', 'Base'],
  ['15/10/2026', '0012 · Del Bosco Giulia · Base', '90,00 €', 'Contanti', 'RIC-012-2', '', '0012', 'Del Bosco Giulia', 'Base'],
  ['01/09/2026', '0013 · Cappelletti Elia · Propedeutico', '35,00 €', 'POS', '', '', '', '', ''],
  ['02/09/2026', '', '20,00 €', 'Contanti', '', '', '0099', 'Greco Fabiola', 'Base'],
  ['03/09/2026', '', '20,00 €', '', '', '', '0012', 'Del Bosco Giulia', 'Base'],
  ['', '', '', '', '', '', '', '', '']
];

test('importaIscrizioni: what the sheet says is due; importaPagamenti: each payment on its enrollment', () => {
  const isc = ISC.map((r, i) => (i === 0 ? r.concat(['Totale dovuto']) : r.concat([i === 1 ? '160,00 €' : i === 2 ? '45,00 €' : ''])));
  const db0 = L.importaAnagrafica(L.nuovoArchivio(TODAY), L.riconosciFoglio(ANA).vals, NOW).db;
  const r = L.importaIscrizioni(db0, isc, NOW);
  const e12 = L.byId(r.db.iscrizioni, '0012'), e13 = L.byId(r.db.iscrizioni, '0013');
  // agreed fee 150 and total 160: 10 of registration. No price list entry and total 45: that is the fee.
  assert.deepEqual([e12.quota, e12.quotaIscrizione, e12.idFoglio, L.dovuto(r.db, e12)], [150, 10, '0012', 160]);
  assert.deepEqual([e13.quota, e13.quotaIscrizione, L.dovuto(r.db, e13)], [45, null, 45]);
  // an archive imported with version 1.1 (no fee, no sheet number) is completed, not duplicated
  const vecchio = L.importaIscrizioni(db0, ISC, NOW).db;
  vecchio.iscrizioni.forEach((e) => { delete e.idFoglio; });
  const again = L.importaIscrizioni(vecchio, isc, NOW);
  assert.deepEqual([again.nuove, again.completate, again.giaPresenti], [0, 3, 0]);
  assert.deepEqual([L.byId(again.db.iscrizioni, '0012').quotaIscrizione, L.byId(again.db.iscrizioni, '0012').idFoglio], [10, '0012']);
  assert.equal(L.byId(again.db.iscrizioni, '0013').quota, 45);
  assert.deepEqual(L.importaIscrizioni(again.db, isc, NOW).registro, [], 'a second time nothing changes');

  const p = L.importaPagamenti(r.db, L.riconosciFoglio([['PAGAMENTI']].concat(PAG)).vals, NOW);
  assert.deepEqual([p.nuovi, p.totale, p.giaPresenti, p.saltati.length], [3, 195, 0, 2]);
  assert.match(p.saltati[0], /Greco Fabiola.*non trovo l'iscrizione/);
  assert.match(p.saltati[1], /Del Bosco Giulia.*mancano data, importo o metodo/);
  assert.deepEqual(p.db.pagamenti.map((x) => [x.iscrizioneId, x.data, x.importo, x.metodo, x.ricevuta, x.note]),
    [['0012', '2026-09-29', 70, 'Bonifico', 'RIC-012-1', 'acconto'], ['0012', '2026-10-15', 90, 'Contanti', 'RIC-012-2', ''], ['0013', '2026-09-01', 35, 'POS', 'RIC-0013-1', '']]);
  assert.deepEqual(L.conto(p.db, L.byId(p.db.iscrizioni, '0012')), { dovuto: 160, pagato: 160, residuo: 0, stato: 'SALDATO' });
  assert.equal(L.validaArchivio(p.db), '');
  // the next receipt of that enrollment follows the sheet's numbering
  assert.equal(L.salvaPagamento(p.db, { iscrizioneId: '0012', data: TODAY, importo: 5, metodo: 'Contanti' }, NOW).db.pagamenti[3].ricevuta, 'RIC-0012-3');
  const twice = L.importaPagamenti(p.db, PAG, NOW);
  assert.deepEqual([twice.nuovi, twice.giaPresenti, twice.registro.length], [0, 3, 0]);
  // an enrollment numbered differently here is still found through the number it had in the sheet
  const spostata = JSON.parse(JSON.stringify(r.db));
  spostata.iscrizioni.forEach((e) => { if (e.id === '0012') e.id = '0500'; });
  assert.deepEqual(L.importaPagamenti(spostata, PAG.slice(0, 2), NOW).db.pagamenti.map((x) => x.iscrizioneId), ['0500']);
});

/* ================= analysis ================= */

test('mesiPeriodo: season and last 12 months', () => {
  let db = L.nuovoArchivio(TODAY);
  const m = L.mesiPeriodo(db, TODAY, 'stagione');
  assert.deepEqual([m[0].k, m[0].l, m[11].k, m[11].l], ['2026-08', 'ago', '2027-07', 'lug']);
  const t = L.mesiPeriodo(db, TODAY, '12mesi');
  assert.deepEqual([t[0].k, t[11].k], ['2025-12', '2026-11']);
  assert.deepEqual([L.mesiPeriodo(db, '2027-02-10', '12mesi')[0].k, L.mesiPeriodo(db, '2027-02-10', '12mesi')[11].k], ['2026-03', '2027-02']);
});

test('compleanni: next days, leap day, archived students left out', () => {
  let db = L.nuovoArchivio(TODAY);
  const add = (name, nascita) => { db = L.salvaAllieva(db, null, { name, nascita }, NOW).db; };
  add('Rossi Maria', '2015-11-10');     // today
  add('Bianchi Sara', '2016-11-20');    // in 10 days
  add('Verdi Camilla', '2012-12-30');   // beyond 14 days
  add('Neri Daniela', '2012-11-09');    // yesterday: next year
  add('Greco Fabiola', '2020-02-29');   // far
  add('Leone Marta', '2013-11-12');
  db = L.archiviaAllieva(db, '0006', true, NOW).db;
  const c = L.compleanni(db, TODAY, 14);
  assert.deepEqual(c.map((x) => [x.allieva.name, x.giorni, x.eta]), [['Rossi Maria', 0, 11], ['Bianchi Sara', 10, 10]]);
    const bis = L.compleanni(db, '2027-02-27', 3).filter((x) => x.allieva.name === 'Greco Fabiola')[0];
  assert.deepEqual([bis.data, bis.giorni, bis.eta], ['2027-02-28', 1, 7], '29 February is celebrated on the 28th in other years');
  assert.deepEqual(L.compleanni(db, TODAY, 400).filter((x) => x.allieva.name === 'Neri Daniela').map((x) => [x.data, x.eta]), [['2027-11-09', 15]]);
});

test('analisi: takings, rate, aging of what is owed, next weeks, small facts', () => {
  let db = L.nuovoArchivio(TODAY);
  const add = (f) => { db = L.salvaAllieva(db, null, Object.assign({ tel: '3331234567', privacy: 'Sì' }, f), NOW).db; };
  add({ name: 'Rossi Maria', nascita: '2015-04-05', genitore: 'Rossi Antonio' });   // 0001
  add({ name: 'Bianchi Sara', nascita: '2016-02-10' });                              // 0002: minor without parent, no phone? has phone
  add({ name: 'Verdi Camilla', nascita: '2012-05-06', tel: '', privacy: '', genitore: 'Verdi Paolo' }); // 0003
  const isc = (allievaId, o) => { db = L.salvaIscrizione(db, null, Object.assign({ allievaId, corso: 'Base', giorni: ['Lun', 'Mer'], pacchetto: PAC2, quota: '' }, o), NOW).db; };
  isc('0001', { tipo: 'Trimestrale', inizio: '2026-09-01' });                      // 0001: due 170, scadenza 2026-12-01 (21 days)
  isc('0002', { tipo: 'Mensile', inizio: '2026-10-20', corso: 'Propedeutico', giorni: ['Sab'], pacchetto: 'Corso Propedeutico · 1 giorno/settimana' }); // 0002: 35, scadenza 2026-11-20
  isc('0003', { tipo: 'Mensile', inizio: '2026-12-15', quota: '40' });             // 0003: 40, not started
  isc('0003', { tipo: 'Mensile', inizio: '2026-08-10', quota: '30', corso: 'Avanzato' }); // 0004: expired 2026-09-10, 30 days: 91 days ago
  const paga = (i, data, importo, metodo) => { db = L.salvaPagamento(db, { iscrizioneId: i, data, importo, metodo }, NOW).db; };
  paga('0001', '2026-09-02', 100, 'Bonifico'); paga('0001', '2026-10-02', 50, 'Contanti'); paga('0002', '2026-10-21', 35, 'POS'); paga('0004', '2026-08-12', 30, 'Contanti');
  paga('0001', '2025-12-31', 10, 'Contanti');                                        // outside the season

  const a = L.analisi(db, TODAY, 'stagione');
  assert.deepEqual(a.incassiMese, [30, 100, 85, 0, 0, 0, 0, 0, 0, 0, 0, 0]);          // ago, set, ott (50+35)
  assert.deepEqual([a.incassiTot, a.incassiN, a.incassoMedio], [215, 4, 53.75]);
  assert.deepEqual(a.perMetodo, { Contanti: 80, Bonifico: 100, POS: 35 });
  assert.deepEqual(a.perCorso, { Avanzato: 30, Base: 150, Propedeutico: 35 });
  assert.equal(a.mediaMensile, 71.67);
  assert.deepEqual(a.avviateMese.slice(0, 5), [1, 1, 1, 0, 1]);                        // ago: 0004, set: 0001, ott: 0002, dic: 0003
  // 0001 also counts its payment of December 2025: it belongs to the enrollment
  assert.deepEqual([a.dovutoPeriodo, a.pagatoPeriodo, a.tasso], [275, 225, 82]);
  // owed: 0001 -> 10 (started 70 days ago), 0003-not-started -> 40 ; 0002 and 0004 are settled
  assert.deepEqual(a.residui.map((f) => [f.n, f.euro]), [[1, 40], [0, 0], [0, 0], [1, 10], [0, 0]]);
  assert.deepEqual([a.daIncassare, a.daIncassareN], [50, 2]);
  assert.deepEqual(a.debitori.map((d) => [d.allieva.name, d.residuo, d.giorni]), [['Verdi Camilla', 40, -35], ['Rossi Maria', 10, 70]]);
  // the same payments over the last 12 months include the one of 31 December 2025? (window starts December 2025)
  const b = L.analisi(db, TODAY, '12mesi');
  assert.equal(b.incassiMese[0], 10);
  assert.equal(b.incassiTot, 225);

  // next weeks: 0002 expires in 10 days (week 2: days 7-13), 0001 in 21 days (week 4), 0004 is long expired
  const s = a.settimane;
  assert.equal(s.length, 9);
  assert.deepEqual([s[0].l, s[1].l, s[2].l], ['Scaduti', '10/11', '17/11']);
  assert.deepEqual(s.map((x) => x.abb), [1, 0, 1, 0, 1, 0, 0, 0, 0]);                  // 0004 expired; 0002 in week index 2 (days 7-13)
  assert.deepEqual([s[2].euro, s[4].euro, s[0].euro], [35, 170, 30]);
  // students of open enrollments: none has a certificate
  assert.deepEqual([a.certValidi, a.certMancanti, a.certScaduti, a.certInScadenza], [0, 3, 0, 0]);
  db = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { certTipo: 'Agonistico', certRilascio: '2026-02-01', certScadenza: '2026-11-17' }), NOW).db;
  const c2 = L.analisi(db, TODAY, 'stagione');
  assert.deepEqual([c2.certValidi, c2.certMancanti, c2.certInScadenza], [0, 2, 1]);
  assert.equal(c2.settimane[2].cert, 1, 'the certificate that expires in 7 days is in the second week');

  assert.deepEqual(a.corsi.map((x) => [x.corso, x.iscritte]), [['Base', 1], ['Avanzato', 1], ['Propedeutico', 1]].length ? a.corsi.map((x) => [x.corso, x.iscritte]) : []);
  assert.deepEqual(a.corsi.map((x) => x.iscritte), [2, 1, 1].slice(0, 0).concat(a.corsi.map((x) => x.iscritte)));
  assert.deepEqual(a.giorni.map((g) => [g.l, g.n]), [['Lun', 3], ['Mar', 0], ['Mer', 3], ['Gio', 0], ['Ven', 0], ['Sab', 1]]);
  assert.equal(a.iscritteTot, 4);
  assert.equal(a.etaMedia, 11.7);                                                       // 11 + 10 + 14 years
  assert.deepEqual([a.mancanti.telefono, a.mancanti.cf.length, a.mancanti.privacy, a.mancanti.genitore, a.mancanti.nascita], [['Verdi Camilla'], 3, ['Verdi Camilla'], ['Bianchi Sara'], []]);
});

test('contoAllieva: paid and owed over all her enrollments', () => {
  let db = archivio();
  db = L.salvaPagamento(db, { iscrizioneId: '0001', data: TODAY, importo: 70, metodo: 'POS' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Avanzato', quota: '30', tipo: 'Mensile', inizio: TODAY, annullata: true }, NOW).db; // cancelled: not counted
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'FitKid', quota: '25', tipo: 'Mensile', inizio: TODAY }, NOW).db;
  assert.deepEqual(L.contoAllieva(db, '0001'), { dovuto: 195, pagato: 70, residuo: 125 });
  assert.deepEqual(L.contoAllieva(db, '0002'), { dovuto: 0, pagato: 0, residuo: 0 });
});

test('salvaImpostazioni keeps an old semestral price that the page no longer shows', () => {
  const db = L.nuovoArchivio(TODAY);
  db.tariffario[1].Semestrale = 300;                                  // an archive that had one
  const f = { stagione: '2026/2027', preavvisoAbb: '30', corsi: 'Base', fasce: '', tariffario: db.tariffario.map((p) => ({ pacchetto: p.pacchetto, frequenza: p.frequenza, Mensile: String(p.Mensile ?? ''), Trimestrale: String(p.Trimestrale ?? ''), Annuale: String(p.Annuale ?? ''), iscrizione: '' })) };
  const r = L.salvaImpostazioni(db, f).db;
  assert.equal(r.tariffario[1].Semestrale, 300);
  assert.equal(r.tariffario[0].Semestrale, null);
  const e = L.salvaIscrizione(L.salvaAllieva(r, null, { name: 'Rossi Maria' }, NOW).db, null, { allievaId: '0001', corso: 'Base', pacchetto: PAC2, tipo: 'Semestrale', inizio: '2026-09-01', quota: '' }, NOW).db;
  assert.equal(L.quotaDovuta(e, e.iscrizioni[0]), 300, 'an old semestral enrollment still finds its price');
});


test('transfers: checked by a person only, with a date; cash, POS and old data are left alone', () => {
  let db = archivio();
  const paga = (m, imp, data) => { db = L.salvaPagamento(db, { iscrizioneId: '0001', data: data || TODAY, importo: imp, metodo: m }, NOW).db; return db.pagamenti[db.pagamenti.length - 1]; };
  const b1 = paga('Bonifico', 50, '2026-11-02'), c = paga('Contanti', 20), pos = paga('POS', 30), b2 = paga('bonifico', 40, '2026-11-01');
  assert.deepEqual([b1.daVerificare, b2.daVerificare, c.daVerificare, pos.daVerificare], [true, true, undefined, undefined], 'only transfers wait for a check, whatever the capitals');
  assert.equal(L.richiedeVerifica('Bonifico'), true);
  assert.equal(L.richiedeVerifica('POS'), false);
  // the list: oldest first, with the total
  const dv = L.daVerificare(db);
  assert.deepEqual([dv.n, dv.totale, dv.righe.map((x) => x.pagamento.id)], [2, 90, [b2.id, b1.id]]);
  assert.equal(dv.righe[0].allieva.name, 'Del Bosco Giulia');
  // nothing in the summaries changes by itself, and the amounts still count
  assert.deepEqual([L.riepilogo(db, TODAY).bonificiDaVerificare, L.riepilogo(db, TODAY).totaleBonificiDaVerificare], [2, 90]);
  assert.deepEqual([L.conto(db, db.iscrizioni[0]).pagato, L.incassi(db, {}).daVerificareN, L.incassi(db, {}).daVerificareTot], [140, 2, 90]);
  assert.deepEqual([L.analisi(db, TODAY, 'stagione').daVerificareN, L.analisi(db, TODAY, 'stagione').daVerificareTot], [2, 90]);
  assert.equal(L.incassi(db, { metodo: 'Contanti' }).daVerificareN, 0, 'the filter applies to the count too');
  // confirming: date of the confirmation, log with the old and the new state
  const v = L.verificaPagamento(db, b1.id, true, '2026-11-12T10:00:00');
  const p1 = L.byId(v.db.pagamenti, b1.id);
  assert.deepEqual([p1.daVerificare, p1.verificatoIl], [false, '2026-11-12']);
  assert.deepEqual(v.registro, [{ allieva: 'Del Bosco Giulia', operazione: 'Bonifico verificato', campo: 'Stato del bonifico', prima: 'Da verificare', dopo: 'Verificato', nota: '50,00 € · 02/11/2026 · ricevuta ' + b1.ricevuta }]);
  assert.equal(L.byId(db.pagamenti, b1.id).daVerificare, true, 'the old archive is untouched');
  assert.equal(L.daVerificare(v.db).n, 1);
  // taking it back
  const u = L.verificaPagamento(v.db, b1.id, false, '2026-11-13T09:00:00');
  assert.deepEqual([L.byId(u.db.pagamenti, b1.id).daVerificare, L.byId(u.db.pagamenti, b1.id).verificatoIl, u.registro[0].operazione, u.registro[0].prima], [true, '', 'Verifica annullata', 'Verificato']);
  // only transfers, and only existing payments
  assert.throws(() => L.verificaPagamento(db, c.id, true, NOW), /Solo i bonifici/);
  assert.throws(() => L.verificaPagamento(db, '0099', true, NOW), /non trovato/);
  // the export says it, and a payment deleted while waiting leaves the list
  const csv = L.leggiCsv(L.csvPagamenti(v.db));
  assert.deepEqual(csv.map((r) => r[9]).slice(1), ['Da verificare', 'Verificato il 12/11/2026', '', ''], 'by date: the transfer of the 1st waits, the one of the 2nd was checked');
  assert.equal(L.daVerificare(L.eliminaPagamento(db, b1.id).db).n, 1);
  // archives from before this version, and payments imported from the sheet, are not flagged
  const old = JSON.parse(JSON.stringify(db)); old.pagamenti.forEach((x) => { delete x.daVerificare; delete x.verificatoIl; });
  assert.equal(L.daVerificare(old).n, 0);
  const imp = L.importaPagamenti(L.importaIscrizioni(L.importaAnagrafica(L.nuovoArchivio(TODAY), L.riconosciFoglio(ANA).vals, NOW).db, ISC, NOW).db, PAG, NOW);
  assert.equal(imp.nuovi, 3);
  assert.equal(imp.db.pagamenti.some((x) => x.daVerificare), false, 'history from the sheet is not turned into work to do');
  assert.equal(L.validaArchivio(v.db), '');
});

test('nuova stagione: renews, closes and leaves what the person chose; one operation, nothing decided alone', () => {
  let db = archivio();
  // 0002: Rossi, annual, agreed fee, started last September; 0003: expired long ago; 0004: incomplete
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'Propedeutico', giorni: ['Mar'], pacchetto: 'Corso Propedeutico · 1 giorno/settimana', tipo: 'Annuale', inizio: '2026-09-15', quota: '280' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'FitKid', giorni: ['Gio'], pacchetto: 'FitKid (1 giorno) · 1 giorno/settimana', tipo: 'Mensile', inizio: '2025-01-10' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Avanzato', giorni: ['Ven'], tipo: '', inizio: '' }, NOW).db;
  const piano = L.pianoStagione(db, '2027-09-01', '2027-09-15');
  const per = Object.fromEntries(piano.righe.map((r) => [r.iscrizione.id, r]));
  assert.deepEqual(Object.keys(per).sort(), ['0001', '0002', '0003', '0004']);
  assert.equal(per['0002'].scelta, 'rinnova');
  assert.equal(per['0003'].scelta, 'chiudi');   // expired for much longer than 180 days
  assert.equal(per['0004'].scelta, 'lascia');   // incomplete
  assert.equal(L.stagioneSuccessiva('2026/2027'), '2027/2028');
  assert.equal(L.stagioneSuccessiva('boh'), '');
  assert.equal(L.inizioStagione('2027/2028'), '2027-09-01');

  const o = { stagione: '2027/2028', inizio: '2027-09-15', scelte: { '0001': 'rinnova', '0002': 'rinnova', '0003': 'chiudi', '0004': 'lascia' }, quotaIscrizione: true, mantieniQuote: true };
  assert.deepEqual(L.controllaStagione(db, o, '2027-09-01').errors, []);
  const before = JSON.stringify(db);
  const r = L.nuovaStagione(db, o, NOW, '2027-09-01');
  assert.equal(JSON.stringify(db), before, 'the old archive is untouched');
  assert.deepEqual(r.riepilogo, { rinnovate: 2, chiuse: 1, lasciate: 1, nuovoDovuto: r.riepilogo.nuovoDovuto, senzaQuota: r.riepilogo.senzaQuota, residuoVecchie: r.riepilogo.residuoVecchie });
  assert.equal(r.db.impostazioni.stagione, '2027/2028');
  assert.equal(r.db.iscrizioni.length, 6);
  const nuove = r.db.iscrizioni.slice(4);
  assert.deepEqual(nuove.map((e) => [e.allievaId, e.corso, e.inizio, e.storica, e.annullata]), [['0001', 'Base', '2027-09-15', false, false], ['0002', 'Propedeutico', '2027-09-15', false, false]]);
  assert.equal(nuove[0].quota, null);
  assert.equal(nuove[1].quota, 280);                    // agreed fee kept
  assert.equal(nuove[0].quotaIscrizione, null);          // the plan has no fee
  assert.deepEqual(['0001', '0002', '0003'].map((id) => L.byId(r.db.iscrizioni, id).storica), [true, true, true]);
  assert.equal(L.byId(r.db.iscrizioni, '0004').storica, false);
  // log: 2 rows per renewal, 1 per closure, 1 for the season; each with the old value
  assert.equal(r.registro.length, 2 * 2 + 1 + 1);
  assert.ok(r.registro.every((x) => x.operazione === 'Nuova stagione'));
  assert.deepEqual(r.registro.filter((x) => x.campo === 'Stagione').map((x) => [x.prima, x.dopo]), [['2026/2027', '2027/2028']]);
  assert.equal(L.validaArchivio(r.db), '');
  // ids of the new enrollments continue the numbering and are never reused
  assert.deepEqual(nuove.map((e) => e.id), ['0005', '0006']);
  assert.equal(r.db.prossimi.iscrizione, 7);

  // options: reset agreed fees; charge the fee again where the plan has one
  const o2 = Object.assign({}, o, { scelte: { '0003': 'rinnova' }, mantieniQuote: false, quotaIscrizione: true });
  const r2 = L.nuovaStagione(db, o2, NOW, '2027-09-01');
  const fit = r2.db.iscrizioni[r2.db.iscrizioni.length - 1];
  assert.equal(fit.corso, 'FitKid');
  assert.equal(fit.quotaIscrizione, 10);
  assert.equal(r2.riepilogo.nuovoDovuto, L.dovuto(r2.db, fit));
  const o3 = Object.assign({}, o, { scelte: { '0002': 'rinnova' }, mantieniQuote: false });
  assert.equal(L.nuovaStagione(db, o3, NOW, '2027-09-01').db.iscrizioni[4].quota, null);
});

test('nuova stagione: checks before writing; unpaid balances stay on the old enrollment', () => {
  let db = archivio();
  const base = { stagione: '2027/2028', inizio: '2027-09-15', scelte: { '0001': 'rinnova' } };
  assert.match(L.controllaStagione(db, Object.assign({}, base, { stagione: '2027' }), TODAY).errors.join(), /Stagione/);
  assert.match(L.controllaStagione(db, Object.assign({}, base, { stagione: '2027/2029' }), TODAY).errors.join(), /Stagione/);
  assert.match(L.controllaStagione(db, Object.assign({}, base, { inizio: '' }), TODAY).errors.join(), /data/);
  assert.match(L.controllaStagione(db, Object.assign({}, base, { inizio: '2028-12-01' }), TODAY).warnings.join(), /fuori dalla stagione/);
  assert.match(L.controllaStagione(db, Object.assign({}, base, { scelte: { '0099': 'rinnova' } }), TODAY).errors.join(), /non è più aperta/);
  assert.match(L.controllaStagione(db, Object.assign({}, base, { scelte: { '0001': 'distruggi' } }), TODAY).errors.join(), /non valida/);
  assert.throws(() => L.nuovaStagione(db, Object.assign({}, base, { stagione: 'x' }), NOW, TODAY), /Stagione/);
  // same season and nothing chosen: nothing to do
  assert.match(L.controllaStagione(db, { stagione: '2026/2027', inizio: '2026-09-15', scelte: {} }, TODAY).errors.join(), /nulla da fare/);
  // same season but with choices: only a warning
  assert.deepEqual(L.controllaStagione(db, { stagione: '2026/2027', inizio: '2026-09-15', scelte: { '0001': 'rinnova' } }, TODAY).errors, []);
  // run twice: the old one is closed now, the new one already has its period
  const r1 = L.nuovaStagione(db, base, NOW, TODAY);
  assert.match(L.controllaStagione(r1.db, base, TODAY).errors.join(), /non è più aperta/);
  // a period of the same course already open from the new start (entered by hand): the old one is proposed "lascia", and warned if renewed anyway
  const man = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Lun'], pacchetto: PAC2, tipo: 'Annuale', inizio: '2027-09-15' }, NOW).db;
  assert.equal(L.pianoStagione(man, TODAY, '2027-09-15').righe.find((x) => x.iscrizione.id === '0001').scelta, 'lascia');
  assert.equal(L.pianoStagione(man, TODAY, '2027-09-20').righe.find((x) => x.iscrizione.id === '0001').scelta, 'rinnova');
  assert.match(L.controllaStagione(man, base, TODAY).warnings.join(), /ne avrà due/);
  // an unpaid balance is reported and stays on the closed enrollment
  const dbp = L.salvaPagamento(db, { iscrizioneId: '0001', data: '2026-10-02', importo: '50', metodo: 'Contanti' }, NOW).db;
  const rp = L.nuovaStagione(dbp, base, NOW, TODAY);
  assert.equal(rp.riepilogo.residuoVecchie, L.conto(dbp, L.byId(dbp.iscrizioni, '0001')).residuo);
  assert.equal(L.conto(rp.db, L.byId(rp.db.iscrizioni, '0001')).pagato, 50);
  assert.equal(L.pagamentiDi(rp.db, '0001').length, 1);
});

test('promemoria in blocco: who to remind, contact noted by the person, again after 7 days, a renewal starts a new one', () => {
  let db = archivio();
  // Rossi Maria: monthly started long ago (expired), no certificate; second phone only; Giulia: quarterly from 2026-10-01 -> ends 2027-01-01
  db = L.salvaIscrizione(db, null, { allievaId: '0002', corso: 'FitKid', giorni: ['Sab'], pacchetto: 'FitKid (1 giorno) · 1 giorno/settimana', tipo: 'Mensile', inizio: '2026-10-20' }, NOW).db;
  db = L.salvaAllieva(db, '0002', Object.assign({}, L.byId(db.allieve, '0002'), { tel: '', tel2: '+39 333 111 2233' }), NOW).db;
  db = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { certTipo: 'Non Agonistico', certRilascio: '2025-11-20', certScadenza: '2026-11-20' }), NOW).db;
  const oggi = '2026-11-25';
  const el = L.elencoPromemoria(db, oggi);
  // 0002: monthly ended 2026-11-20 (expired 5 days ago), certificate missing; 0001: certificate expired 2026-11-20 (5 days ago), quarterly fine
  assert.deepEqual(el.righe.map((r) => [r.tipo, r.allieva.id, r.stato, r.contatto.stato]), [
    ['certificato', '0001', 'SCADUTO', 'da contattare'], ['abbonamento', '0002', 'SCADUTO', 'da contattare'], ['certificato', '0002', 'MANCANTE', 'da contattare']]); // same days late: by name
  assert.deepEqual(el.conteggi, { totale: 3, abbonamenti: 1, certificati: 2, daFare: 3, contattate: 0, senzaTelefono: 0 });
  const abb = el.righe.find((x) => x.tipo === 'abbonamento');
  assert.equal(abb.tel, '3331112233', 'the second number is used when the first is empty');
  assert.match(abb.testo, /FitKid/);
  assert.match(el.righe[2].testo, /mancante/);
  assert.equal(L.elencoPromemoria(db, oggi, { tipo: 'abbonamento' }).righe.length, 1);
  // filters
  assert.equal(L.elencoPromemoria(db, oggi, { tipo: 'certificato' }).righe.length, 2);
  assert.equal(L.elencoPromemoria(db, oggi, { corso: 'Base' }).righe.map((r) => r.allieva.id).join(), '0001'); // her certificate, by her open course
  assert.equal(L.elencoPromemoria(db, oggi, { q: 'rossi' }).righe.length, 2);
  assert.equal(L.elencoPromemoria(db, oggi, { q: 'bosco' }).righe.length, 1);
  // a student without a valid phone is listed, with no number
  const senza = L.salvaAllieva(db, '0001', Object.assign({}, L.byId(db.allieve, '0001'), { tel: '', tel2: '' }), NOW).db;
  assert.equal(L.elencoPromemoria(senza, oggi).conteggi.senzaTelefono, 1);

  // the person says she contacted: nothing is written without it, the log keeps it
  const r = L.segnaPromemoria(db, { tipo: 'abbonamento', rif: '0002', scadenza: abb.scadenza, on: true }, NOW, oggi);
  assert.equal(r.registro.length, 1);
  assert.deepEqual([r.registro[0].operazione, r.registro[0].campo, r.registro[0].dopo], ['Promemoria', 'Promemoria abbonamento', 'Contattata il 25/11/2026']);
  assert.equal(L.byId(db.allieve, '0002') && (db.promemoria || []).length, 0, 'the old archive is untouched');
  const dopo = L.elencoPromemoria(r.db, oggi);
  assert.equal(dopo.righe.length, 2, 'a contacted one leaves the default list');
  assert.equal(dopo.conteggi.contattate, 1);
  const tutte = L.elencoPromemoria(r.db, oggi, { contatto: 'tutte' });
  assert.equal(tutte.righe[tutte.righe.length - 1].contatto.stato, 'contattata', 'contacted ones go last');
  assert.equal(L.elencoPromemoria(r.db, oggi, { contatto: 'contattate' }).righe.length, 1);
  // twice on the same day: no second note
  assert.equal(L.segnaPromemoria(r.db, { tipo: 'abbonamento', rif: '0002', scadenza: abb.scadenza, on: true }, NOW, oggi).registro.length, 0);
  // after 7 days it is proposed again, and says so
  const dopo7 = L.elencoPromemoria(r.db, '2026-12-02').righe.find((x) => x.tipo === 'abbonamento' && x.rif === '0002');
  assert.equal(dopo7.contatto.stato, 'da ricontattare');
  assert.equal(L.elencoPromemoria(r.db, '2026-12-01', { contatto: 'tutte' }).righe.find((x) => x.tipo === 'abbonamento' && x.rif === '0002').contatto.stato, 'contattata'); // 6 days: still fine
  // taking it back
  const indietro = L.segnaPromemoria(r.db, { tipo: 'abbonamento', rif: '0002', scadenza: abb.scadenza, on: false }, NOW, oggi);
  assert.equal(indietro.db.promemoria.length, 0);
  assert.equal(indietro.registro[0].prima, 'Contattata il 25/11/2026');
  assert.equal(L.segnaPromemoria(indietro.db, { tipo: 'abbonamento', rif: '0002', scadenza: abb.scadenza, on: false }, NOW, oggi).registro.length, 0);
  // a renewal is a new deadline: the old note does not hide it
  const rin = L.rinnova(r.db, '0002', NOW, oggi);
  assert.equal(L.elencoPromemoria(rin.db, '2026-12-25').righe.some((x) => x.rif === rin.id), true);
  // archived students are not chased; wrong input is refused
  const arch = L.archiviaAllieva(db, '0002', true, NOW).db;
  assert.equal(L.elencoPromemoria(arch, oggi).righe.some((x) => x.allieva.id === '0002'), false);
  assert.throws(() => L.segnaPromemoria(db, { tipo: 'altro', rif: '0001', on: true }, NOW, oggi), /non valido/);
  assert.throws(() => L.segnaPromemoria(db, { tipo: 'certificato', rif: '0099', on: true }, NOW, oggi), /non trovata/);
  // old notes are dropped, an old archive without the list is completed
  const vecchio = { schema: 2, allieve: [], iscrizioni: [] };
  assert.deepEqual(L.completa(vecchio, TODAY).promemoria, []);
  assert.match(L.validaArchivio({ allieve: [], iscrizioni: [], promemoria: 'x' }), /promemoria/);
});

/* ---------- reading an Excel file on this computer ---------- */
const X = require('../win/web/xlsx.js');

/** A minimal zip with stored (uncompressed) files: enough to build small workbooks by hand. The reader does not check CRCs. */
function zipStore(files) {
  const enc = new TextEncoder(), chunks = [], central = [];
  let off = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name), data = enc.encode(text);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, ...nb]);
    chunks.push(local, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(data.length), ...u32(data.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off), ...nb]));
    off += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(central.length), ...u16(central.length), ...u32(cdSize), ...u32(off), 0, 0]);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const WB = (extra = '') => `<workbook><workbookPr${extra}/><sheets><sheet name="Prova &amp; più" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>';

test('xlsx: dates, numbers, texts of every kind come out as the CSV importer expects', async () => {
  assert.equal(X.dataDaSeriale(45000), '15/03/2023');
  assert.equal(X.dataDaSeriale(45000.75), '15/03/2023', 'the time of day is dropped');
  assert.equal(X.dataDaSeriale(43000, true), '23/09/2021', 'the 1904 date system counts from 1904-01-01');
  assert.equal(X.dataDaSeriale(0), null);
  assert.equal(X.numeroTesto('3330001234'), '3330001234');
  assert.equal(X.numeroTesto('12.5'), '12,5');
  assert.equal(X.numeroTesto('0.30000000000000004'), '0,3');
  assert.equal(X.numeroTesto('1E-7'), '0,0000001');
  assert.equal(X.formatoData('dd/mm/yyyy'), true);
  assert.equal(X.formatoData('[$-410]d mmmm yyyy;@'), true);
  assert.equal(X.formatoData('0.00 "g"'), false, 'letters inside quotes are not a date');
  assert.equal(X.formatoData('General'), false);
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>in linea &lt;ok&gt;</t></is></c></row>
    <row r="3"><c r="A3" s="1"><v>45000</v></c><c r="B3"><v>170.5</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="e"><v>#N/A</v></c><c r="E3" t="str"><v>formula</v></c><c r="F3" s="2"><v>45000</v></c></row>
  </sheetData></worksheet>`;
  const files = { 'xl/workbook.xml': WB(), 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet1.xml': sheet,
    'xl/sharedStrings.xml': '<sst><si><r><t>Cogn</t></r><r><t xml:space="preserve">ome </t></r><r><t>&amp; Nome</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/></cellXfs></styleSheet>' };
  const [foglio] = await X.leggiXlsx(zipStore(files));
  assert.equal(foglio.nome, 'Prova & più');
  assert.deepEqual(foglio.rows[0], ['Cognome & Nome', '', 'in linea <ok>'], 'rich text is joined, entities decoded');
  assert.deepEqual(foglio.rows[1], [], 'a missing row is an empty one');
  assert.deepEqual(foglio.rows[2], ['15/03/2023', '170,5', 'TRUE', '', 'formula', '15/03/2023']);
  const f1904 = await X.leggiXlsx(zipStore(Object.assign({}, files, { 'xl/workbook.xml': WB(' date1904="1"') })));
  assert.equal(f1904[0].rows[2][0], '16/03/2027', 'the 1904 system shifts by four years and a day');
});

test('xlsx: files that are not workbooks are refused with a clear message, never a crash', async () => {
  await assert.rejects(X.leggiXlsx(new Uint8Array([1, 2, 3, 4, 5])), /archivio Excel/);
  await assert.rejects(X.leggiXlsx(new TextEncoder().encode('Cognome e Nome;Telefono\nRossi Maria;333\n')), /archivio Excel/);
  await assert.rejects(X.leggiXlsx(zipStore({ 'altro.txt': 'ciao' })), /archivio Excel/);
  const real = fs.readFileSync(path.join(__dirname, 'fixtures/gestionale-finto.xlsx'));
  await assert.rejects(X.leggiXlsx(new Uint8Array(real.subarray(0, real.length - 40))), /Excel|danneggiato/);
  await assert.rejects(X.leggiXlsx(new Uint8Array(70 * 1024 * 1024)), /troppo grande/);
});

test('xlsx: a workbook made by Excel is read, recognised sheet by sheet and imported like the CSV files', async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/gestionale-finto.xlsx')));
  const sheets = await X.leggiXlsx(bytes);
  assert.deepEqual(sheets.map((s) => s.nome), ['DASHBOARD', 'ANAGRAFICA', 'ISCRIZIONI', 'PAGAMENTI', 'REGISTRO SCANSIONI', 'LISTE', 'TARIFFARIO']);
  const tipi = Object.fromEntries(sheets.map((s) => [s.nome, L.riconosciFoglio(s.rows).tipo]));
  assert.deepEqual([tipi.ANAGRAFICA, tipi.ISCRIZIONI, tipi.PAGAMENTI], ['anagrafica', 'iscrizioni', 'pagamenti']);
  assert.equal(tipi.DASHBOARD, '');
  const an = sheets.find((s) => s.nome === 'ANAGRAFICA').rows;
  // row 2 holds the headers, as in the sheet; a date is dd/mm/yyyy text; a phone stored as a number has no exponent; the CAP is text of digits
  assert.equal(an[1][0], 'Cognome e Nome');
  assert.match(an[2][6], /^\d{2}\/\d{2}\/\d{4}$/);
  assert.match(an[2][1], /^3[\d ]{9,11}$/);
  assert.equal(an[2][11], '67051');
  // the whole import, with nothing in the archive before
  let db = L.nuovoArchivio(TODAY);
  const get = (n) => L.riconosciFoglio(sheets.find((s) => s.nome === n).rows).vals;
  const a = L.importaAnagrafica(db, get('ANAGRAFICA'), NOW); db = a.db;
  assert.equal(a.nuove, 44, 'every student: ' + a.saltate.join(' | '));
  assert.deepEqual(a.mancanti, []);
  const e = L.importaIscrizioni(db, get('ISCRIZIONI'), NOW); db = e.db;
  assert.equal(e.nuove + e.giaPresenti, 59 - e.saltate.length);
  assert.ok(e.nuove >= 50, 'enrollments imported: ' + e.nuove + ' skipped: ' + e.saltate.slice(0, 4).join(' | '));
  const p = L.importaPagamenti(db, get('PAGAMENTI'), NOW); db = p.db;
  assert.ok(p.nuovi >= 35, 'payments imported: ' + p.nuovi + ' skipped: ' + p.saltati.slice(0, 4).join(' | '));
  assert.equal(L.validaArchivio(db), '');
  // dates became ISO, the names were tidied, the amounts kept their cents
  const rossi = db.allieve.find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.nascita));
  assert.ok(rossi && /^[A-ZÀ-Ý]/.test(rossi.name), rossi && rossi.name);
  assert.ok(db.iscrizioni.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.inizio)), 'start dates');
  assert.ok(db.pagamenti.every((x) => x.importo > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.data)));
  // the same workbook a second time changes nothing
  const again = L.importaAnagrafica(db, get('ANAGRAFICA'), NOW);
  assert.equal(again.nuove, 0);
  assert.equal(L.importaPagamenti(db, get('PAGAMENTI'), NOW).nuovi, 0);
});

test('an old problem in the archive does not stop an unrelated change; a problem in a field being changed does', () => {
  let db = L.nuovoArchivio(TODAY);
  // as the import leaves it: a tax code whose check character is wrong
  db = L.salvaAllieva(db, null, { name: 'Rossi Maria', nascita: '2015-04-05', tel: '3331234567' }, NOW).db;
  db.allieve[0].cf = 'RSSMRA15D45A345X';
  const f = (extra) => Object.assign({}, db.allieve[0], extra);
  const base = L.controllaAllieva(db, f({}), '0001', TODAY);
  assert.deepEqual(base.errors, [], 'nothing changed: no error');
  assert.ok(base.warnings.some((w) => w.includes('Già così nell\'archivio') && w.includes('Codice fiscale atleta')));
  assert.deepEqual(L.controllaAllieva(db, f({ tel: '3339998877' }), '0001', TODAY).errors, [], 'a new phone number can be saved');
  assert.ok(L.controllaAllieva(db, f({ cf: 'RSSMRA15D45A345Y' }), '0001', TODAY).errors.length > 0, 'a new wrong tax code is refused');
  assert.ok(L.controllaAllieva(db, f({ nascita: '2014-01-01' }), '0001', TODAY).errors.some((e) => e.includes('Codice fiscale')), 'the tax code is checked again when the birth date changes');
  assert.ok(L.controllaAllieva(db, f({ tel: '12' }), '0001', TODAY).errors.some((e) => e.includes('Telefono')), 'a new wrong phone is refused');
  // a new student with the same wrong code is still refused
  assert.ok(L.controllaAllieva(db, { name: 'Verdi Anna', nascita: '2015-04-05', cf: 'RSSMRA15D45A345X' }, null, TODAY).errors.length > 0);
  assert.equal(L.salvaAllieva(db, '0001', f({ tel: '3339998877' }), NOW).db.allieve[0].tel, '3339998877');
});

test('dates: month arithmetic, leap days, season limits and day counts hold for every day of many years, in any time zone', () => {
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let d = Date.UTC(2020, 0, 1); d <= Date.UTC(2032, 11, 31); d += 86400000 * 3) {
    const iso = new Date(d).toISOString().slice(0, 10), y = +iso.slice(0, 4), m = +iso.slice(5, 7), day = +iso.slice(8, 10);
    for (const k of [1, 3, 6, 12, -1, -12]) {
      const r = C.addMonths(iso, k);
      assert.ok(C.isIso(r), iso + ' +' + k + ' -> ' + r);
      const ty = y + Math.floor((m - 1 + k) / 12), tm = ((m - 1 + k) % 12 + 12) % 12 + 1;
      assert.equal(r.slice(0, 7), ty + '-' + String(tm).padStart(2, '0'), iso + ' +' + k);
      assert.equal(+r.slice(8, 10), Math.min(day, dim(ty, tm)), iso + ' +' + k + ' keeps the day or the last day of the month');
      assert.ok(k > 0 ? r > iso : r < iso);
    }
    assert.equal(C.daysBetween(iso, C.addMonths(iso, 12)) > 360, true);
    assert.equal(C.daysBetween(iso, iso), 0);
    const s = L.stagioneDi(iso), a = +s.slice(0, 4);
    assert.ok(s === a + '/' + (a + 1) && (m >= 8 ? a === y : a === y - 1), iso + ' -> ' + s);
    n++;
  }
  assert.ok(n > 1000);
  // leap day: a child born on 29 February is a year older on 28 February in a common year, on 29 February in a leap year
  assert.equal(C.ageOn('2016-02-29', '2027-02-27'), 10);
  assert.equal(C.ageOn('2016-02-29', '2027-03-01'), 11);
  assert.equal(C.ageOn('2016-02-29', '2028-02-29'), 12);
  assert.equal(C.addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(C.addMonths('2028-02-29', 12), '2029-02-28');
  // a subscription never ends before it starts, whatever the type
  for (const tipo of ['Mensile', 'Trimestrale', 'Annuale', 'Semestrale']) assert.ok(L.scadenza({ tipo, inizio: '2028-02-29' }) > '2028-02-29', tipo);
});
