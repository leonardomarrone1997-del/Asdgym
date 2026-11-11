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

function archivio() {
  let db = L.nuovoArchivio(TODAY);
  db = L.salvaAllieva(db, null, { name: 'del bosco giulia', nascita: '2013-10-12', cf: 'dlb gli13r52 a345d', tel: '+39 347 000 1122', genitore: 'DE LUCA ANTONELLA', citta: 'MAGLIANO DEI MARSI', privacy: 'Sì', liberatoria: 'Sì' }, NOW).db;
  db = L.salvaAllieva(db, null, { name: 'Rossi Maria', nascita: '2015-04-05', tel: '3331234567' }, NOW).db;
  db = L.salvaIscrizione(db, null, { allievaId: '0001', corso: 'Base', giorni: ['Mer', 'Lun'], fascia: '17:00', pacchetto: PAC2, tipo: 'Trimestrale', inizio: '2026-10-01', quota: '' }, NOW).db;
  return db;
}

test('the copies in win/web are the files in src/', () => {
  for (const f of ['core.js', 'style.css']) {
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
  assert.deepEqual(L.riepilogo(db, TODAY), { allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 1, inScadenza: 0, scadute: 1, daCompletare: 1 });
  assert.deepEqual(L.riepilogo(db, '2026-12-10'), { allieve: 4, archiviate: 1, senzaIscrizione: 1, correnti: 3, attive: 0, inScadenza: 1, scadute: 1, daCompletare: 1 });

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

test('controllaImpostazioni / salvaImpostazioni', () => {
  const db = archivio();
  const f = { stagione: '2027/2028', preavvisoAbb: '20', corsi: 'Base\n\nAvanzato\nBase\n', fasce: '17:00-18:30\n18:30-20:00',
    tariffario: [{ pacchetto: 'Corso Base', frequenza: '2 giorni/settimana', Mensile: '60', Trimestrale: '170,50', Semestrale: '', Annuale: '1.000', iscrizione: '10' }, { pacchetto: '', frequenza: '', Mensile: '', Trimestrale: '', Semestrale: '', Annuale: '', iscrizione: '' }] };
  assert.deepEqual(L.controllaImpostazioni(f), []);
  const r = L.salvaImpostazioni(db, f);
  assert.deepEqual(r.db.impostazioni, { stagione: '2027/2028', preavvisoAbb: 20 });
  assert.deepEqual(r.db.liste, { corsi: ['Base', 'Avanzato'], fasce: ['17:00-18:30', '18:30-20:00'] });
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
  assert.equal(L.riconosciFoglio([['Data pagamento', 'Importo', 'Allieva', 'Corso']]).tipo, '', 'the payments sheet is not an enrollments sheet');
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
  assert.equal('certTipo' in g, false, 'certificates are not imported');
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
  assert.deepEqual(i[1], ['0001', '0001', 'Del Bosco Giulia', 'Base', 'Lun, Mer', '17:00', PAC2, 'Trimestrale', '01/10/2026', '01/01/2027', 'ATTIVO', '170', '']);
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
