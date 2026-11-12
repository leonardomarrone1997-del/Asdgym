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
const IMP = (o) => Object.assign({ preavvisoCert: 30, messaggioCertificato: L.MESSAGGIO_CERT, legale: '', ente: '', codice: '', cfAssociazione: '' }, o);

function archivio() {
  let db = L.nuovoArchivio(TODAY);
  db = L.salvaAllieva(db, null, { name: 'del bosco giulia', nascita: '2013-10-12', cf: 'dlb gli13r52 a345d', tel: '+39 347 000 1122', genitore: 'DE LUCA ANTONELLA', citta: 'MAGLIANO DEI MARSI', privacy: 'Sì', liberatoria: 'Sì' }, NOW).db;
  db = L.salvaAllieva(db, null, { name: 'Rossi Maria', nascita: '2015-04-05', tel: '3331234567' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Mer', 'Lun'], fascia: '17:00', pacchetto: PAC2, tipo: 'Trimestrale', inizio: '2026-10-01', quota: '' }, NOW).db;
  return db;
}

test('the copies in win/web are the files in src/', () => {
  for (const f of ['core.js', 'pdf.js', 'style.css']) {
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
  assert.match(L.controllaIscrizione(db, Object.assign({}, base, { pacchetto: PAC2, tipo: 'Semestrale' }), null).warnings.join(' '), /non ha un prezzo/);
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
  const extra = { certScaduti: 0, certInScadenza: 0, certMancanti: 3, daIncassare: 1, totaleDaIncassare: 170 };
  assert.deepEqual(L.riepilogo(db, TODAY), Object.assign({ allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 1, inScadenza: 0, scadute: 1, daCompletare: 1 }, extra));
  assert.deepEqual(L.riepilogo(db, '2026-12-10'), Object.assign({ allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 0, inScadenza: 1, scadute: 1, daCompletare: 1 }, extra));

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

test('messaggioScadenza, promemoriaCopia, segnaCopia', () => {
  let db = archivio();
  const x = L.scadenze(db, '2026-12-10').inScadenza[0];
  assert.equal(L.messaggioScadenza(db, x), 'Buongiorno, vi ricordiamo che l\'abbonamento di Del Bosco Giulia al corso Base ha scadenza il 01/01/2027. Grazie, A.S.D. Gym Art Avezzano');
  db.impostazioni.messaggioScadenza = '{nome}: {tipo} {corso} {scadenza} {nome} {altro}';
  assert.equal(L.messaggioScadenza(db, x), 'Del Bosco Giulia: trimestrale Base 01/01/2027 Del Bosco Giulia {altro}');
  db.impostazioni.messaggioScadenza = '';
  assert.match(L.messaggioScadenza(db, x), /^Buongiorno/, 'an empty text falls back to the standard one');

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
  assert.deepEqual(old.impostazioni, IMP({ stagione: '2026/2027', preavvisoAbb: 45, messaggioScadenza: L.MESSAGGIO, ultimaCopia: '' }));
  assert.deepEqual([old.schema, old.pagamenti, old.prossimi, old.liste.metodi], [2, [], { allieva: 2, iscrizione: 1, pagamento: 1 }, ['Contanti', 'Bonifico', 'POS']]);
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
  assert.deepEqual(r.db.impostazioni, IMP({ stagione: '2027/2028', preavvisoAbb: 20, messaggioScadenza: L.MESSAGGIO, ultimaCopia: '' }));
  const full = L.salvaImpostazioni(db, Object.assign({}, f, { preavvisoCert: '45', messaggioCertificato: ' Certificato di {nome} ', legale: ' Mario Bianchi ', ente: 'CSEN', codice: '12345', cfAssociazione: '90012345678', metodi: 'Contanti\nBonifico\nSatispay\n' }));
  assert.deepEqual(full.db.impostazioni, { stagione: '2027/2028', preavvisoAbb: 20, messaggioScadenza: L.MESSAGGIO, ultimaCopia: '', preavvisoCert: 45, messaggioCertificato: 'Certificato di {nome}', legale: 'Mario Bianchi', ente: 'CSEN', codice: '12345', cfAssociazione: '90012345678' });
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
  assert.deepEqual(st({}), { stato: 'MANCANTE', giorni: null, scadenza: '', ludico: false });
  assert.deepEqual(st({ certTipo: 'Agonistico' }), { stato: 'MANCANTE', giorni: null, scadenza: '', ludico: false });
  assert.deepEqual(st({ certTipo: 'Agonistico', certScadenza: '2027-04-05' }), { stato: 'VALIDO', giorni: 146, scadenza: '2027-04-05', ludico: false });
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: '2026-12-10' }).stato, 'IN SCADENZA'); // 30 days
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: '2026-12-11' }).stato, 'VALIDO');
  assert.equal(st({ certTipo: 'Agonistico', certScadenza: TODAY }).stato, 'IN SCADENZA', 'valid on its last day');
  assert.deepEqual(st({ certTipo: 'Ludico-motoria', certScadenza: '2026-11-09' }), { stato: 'SCADUTO', giorni: -1, scadenza: '2026-11-09', ludico: true });
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
  assert.equal(L.messaggioCertificato(db, sc.inScadenza[0].allieva, sc.inScadenza[0].stato), 'Buongiorno, vi ricordiamo che il certificato medico di Del Bosco Giulia ha scadenza il 20/11/2026. Grazie, A.S.D. Gym Art Avezzano');
  assert.match(L.messaggioCertificato(db, { name: 'Neri Daniela' }, { stato: 'MANCANTE', scadenza: '' }), /mancante il certificato medico di Neri Daniela/);
  db.impostazioni.messaggioCertificato = '{nome} -> {scadenza}';
  assert.equal(L.messaggioCertificato(db, sc.scaduti[0].allieva, sc.scaduti[0].stato), 'Rossi Maria -> 01/10/2026');
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
  assert.deepEqual(r.db.pagamenti, [{ id: '0001', iscrizioneId: '0001', data: TODAY, importo: 70, metodo: 'Bonifico', ricevuta: 'RIC-0001-1', note: 'acconto', creata: NOW }]);
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
  assert.deepEqual(csv[0], ['N.', 'Data pagamento', 'Allieva', 'Corso', 'N. iscrizione', 'Importo', 'Metodo', 'N. ricevuta', 'Note']);
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
