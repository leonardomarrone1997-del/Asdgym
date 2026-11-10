'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const C = require('../src/core.js');

const TODAY = '2026-11-10';

/* ---------- independent reference for the CF control character ---------- */
const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21 };
'BAKPLCQDREVOSFTGUHMINJWZYX'.split('').forEach((ch, v) => { ODD[ch] = v; });
'ABCDEFGHIJ'.split('').forEach((ch, d) => { assert.equal(ODD[ch], ODD[d]); });
function refControl(cf15) {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = cf15[i];
    if (i % 2 === 0) sum += ODD[ch];
    else sum += /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26));
}

// Invented people: each code is computed from the invented name, date and place.
const SAMPLE = [
  ['DLCNNL75C48H501H', 'De Luca Antonella', '1975-03-08', 'F'],
  ['DLBGLI13R52A345D', 'Del Bosco Giulia', '2013-10-12', 'F'],
  ['DLBFNC17P54A515S', 'Del Bosco Francesca', '2017-09-14', 'F'],
  ['GRCFBL20H49A515X', 'Greco Fabiola', '2020-06-09', 'F'],
  ['LNEMRT13T43A515Q', 'Leone Marta', '2013-12-03', 'F'],
  ['DLVNMO19D62A515X', 'Del Vecchio Noemi', '2019-04-22', 'F'],
  ['CPPLEI19L02A515S', 'Cappelletti Elia', '2019-07-02', 'M']
];

/* ---------- fixtures ---------- */
const ANA_HEAD = ['ID', 'Cognome e Nome', 'Stato iscrizione', 'N. corsi', 'Totale dovuto', 'Totale pagato', 'Residuo', 'Telefono', 'WhatsApp', 'Secondo telefono', 'Genitore / Referente', 'CF genitore', 'Email', 'Data di nascita', 'Età', 'Luogo di nascita', 'Codice fiscale', 'Indirizzo', 'Città', 'CAP', 'N° tessera EPS/FGI', 'Consenso privacy', 'Liberatoria foto/video', 'Data modulo iscrizione', 'Certificato medico', 'Rilascio certificato', 'Scadenza certificato', 'Stato certificato', 'Giorni a scadenza', 'Note', 'Controllo dati', 'Chiave certificato', 'Chiave residuo'];
const ISC_HEAD = ['ID', 'Allieva', 'Corso', 'Fascia oraria', 'Giorni', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Durata (mesi)', 'Scadenza', 'Durata (giorni)', 'Giorni alla scadenza', 'Stato abbonamento', 'Quota da tariffario', 'Iscrizione', 'Quota concordata (sostituisce il tariffario)', 'Totale dovuto', 'Totale pagato', 'Residuo', 'Stato pagamento', 'N. versamenti', 'Modalità', 'Ultimo versamento', 'Annullata?', 'Note', 'Controllo dati', 'Conta', 'Chiave elenco', 'Chiave scadenza', 'Chiave allieva'];
const PAG_HEAD = ['Data pagamento', "Iscrizione (scegli dall'elenco)", 'Importo', 'Metodo', 'N. ricevuta', 'Link ricevuta (PDF/foto)', 'Note', 'ID iscrizione', 'Allieva', 'Corso', 'N. versamento', 'Ricevuta', 'Controllo dati', 'Chiave allieva'];

/** Builds a display row for a header from {header: value}; trailing empty cells are dropped like get_values does. */
function mk(head, obj) {
  const r = head.map((h) => (h in obj ? obj[h] : ''));
  while (r.length && r[r.length - 1] === '') r.pop();
  return r;
}
function shuffled(head) { // deterministic permutation + one unknown column
  const h = head.slice().reverse();
  h.splice(3, 0, 'Colonna sconosciuta');
  return h;
}
const GIULIA = { ID: '0034', 'Cognome e Nome': 'Del Bosco Giulia', 'Totale dovuto': '195,00 €', 'Totale pagato': '1.234,56 €', Residuo: '-', Telefono: '3470001122', 'Data di nascita': '12/10/2013', 'Codice fiscale': 'DLBGLI13R52A345D', CAP: '67051', 'Certificato medico': 'Non Agonistico', 'Scadenza certificato': '05/04/2027', Note: 'nota', 'Colonna sconosciuta': 'zzz' };
const ELIA = { ID: '0035', 'Cognome e Nome': 'Cappelletti Elia', 'Data di nascita': '02/07/2019' };

const TAR_HEAD = ['', 'Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale', 'Iscrizione (€)', 'Chiave pacchetto (menu a tendina)'];
const TAR_VALS = [TAR_HEAD].concat([
  ['Corso Propedeutico', '1 giorno/settimana', '35 €', '105 €', 'da confermare', '300 €', ''],
  ['Corso Base e Avanzato', '2 giorni/settimana', '60 €', '170 €', 'da confermare', '500 €', ''],
  ['Corso Base e Avanzato', '3 giorni/settimana', '70 €', '200 €', 'da confermare', '580 €', ''],
  ['Corso Preagonistico', '2 giorni/settimana', '70 €', '200 €', 'da confermare', '580 €', ''],
  ['Corso Agonistico', '3 giorni/settimana', '85 €', '250 €', 'da confermare', '1.000 €', ''],
  ['FitKid (1 giorno)', '1 giorno/settimana', '25 €', '70 €', 'da confermare', '-', '10 €'],
  ['FitKid (2 giorni)', '2 giorni/settimana', '40 €', '110 €', 'da confermare', '-', '10 €']
].map((r) => [''].concat(r, [r[0] + ' · ' + r[1]])), [['', '', '', '', '', '', '', '', '']]);
const TARIFF = C.parseTariffario(TAR_VALS).rows;

/* =================================================================== */
test('utilities: colLetter, titleCase, titleCasePlace', () => {
  assert.equal(C.colLetter(0), 'A');
  assert.equal(C.colLetter(25), 'Z');
  assert.equal(C.colLetter(26), 'AA');
  assert.equal(C.colLetter(32), 'AG');
  assert.equal(C.colLetter(701), 'ZZ');
  assert.equal(C.colLetter(702), 'AAA');
  assert.equal(C.titleCase("D'ALESSANDRO"), "D'Alessandro");
  assert.equal(C.titleCase("L'AQUILA"), "L'Aquila");
  assert.equal(C.titleCase('d’alessandro   maria-pia'), "D'Alessandro Maria-Pia");
  assert.equal(C.titleCase('  DEL BOSCO giulia '), 'Del Bosco Giulia');
  assert.equal(C.titleCase('NICOLÒ'), 'Nicolò');
  assert.equal(C.titleCase(null), '');
  assert.equal(C.titleCasePlace('MAGLIANO DEI MARSI'), 'Magliano dei Marsi');
  assert.equal(C.titleCasePlace("L'AQUILA"), "L'Aquila");
  assert.equal(C.titleCasePlace('VIA DEI MILLE 76'), 'Via dei Mille 76');
  assert.equal(C.titleCasePlace('LA SPEZIA'), 'La Spezia');
  assert.equal(C.titleCasePlace(''), '');
});

test('parseDate: accepted formats', () => {
  assert.equal(C.parseDate('05/04/2010'), '2010-04-05');
  assert.equal(C.parseDate('5.4.10'), '2010-04-05');
  assert.equal(C.parseDate('05-04-2010'), '2010-04-05');
  assert.equal(C.parseDate('2010-04-05'), '2010-04-05');
  assert.equal(C.parseDate(' 5 / 4 / 2010 '), '2010-04-05');
  assert.equal(C.parseDate('10/11/2026'), '2026-11-10', 'Italian order, not US');
  assert.equal(C.parseDate('29/02/2024'), '2024-02-29');
  assert.equal(C.parseDate('26/09/00'), '2000-09-26');
  assert.equal(C.parseDate('26/09/40'), '2040-09-26');
  assert.equal(C.parseDate('26/09/41'), '1941-09-26');
  assert.equal(C.parseDate('26/09/99'), '1999-09-26');
  assert.equal(C.parseDate('08/03/75'), '1975-03-08');
});

test('parseDate: rejected values', () => {
  ['31/02/2020', '29/02/2023', '29/02/1900', '01/13/2026', '00/01/2026', '32/01/2026', '31/04/2026', '2023-02-29', '2026-13-01',
    '5/4/201', '2026/11/10', '', '-', 'da definire', '05/04', '05/04/2010 10:00', null, undefined].forEach((s) => {
    assert.equal(C.parseDate(s), null, String(s));
  });
});

test('isIso, isoToIt, todayIso', () => {
  assert.equal(C.isIso('2024-02-29'), true);
  assert.equal(C.isIso('2023-02-29'), false);
  assert.equal(C.isIso('05/04/2010'), false);
  assert.equal(C.isoToIt('2010-04-05'), '05/04/2010');
  assert.equal(C.isoToIt('nope'), '');
  assert.equal(C.todayIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(C.todayIso(new Date(2026, 10, 10, 0, 0, 1)), '2026-11-10');
});

test('addYears / addMonths', () => {
  assert.equal(C.addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(C.addYears('2024-02-29', 4), '2028-02-29');
  assert.equal(C.addYears('2026-09-01', 1), '2027-09-01');
  assert.equal(C.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(C.addMonths('2026-01-31', -1), '2025-12-31');
  assert.equal(C.addMonths('2026-03-31', -13), '2025-02-28');
  assert.equal(C.addMonths('2026-05-10', 0), '2026-05-10');
  assert.equal(C.addMonths('2026-10-01', 12), '2027-10-01');
});

test('daysBetween is immune to DST', () => {
  assert.equal(C.daysBetween('2026-03-28', '2026-03-30'), 2); // last Sunday of March 2026 = 29
  assert.equal(C.daysBetween('2026-10-24', '2026-10-26'), 2); // last Sunday of October 2026 = 25
  assert.equal(C.daysBetween('2026-03-01', '2026-11-01'), 245);
  assert.equal(C.daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(C.daysBetween('2024-01-01', '2025-01-01'), 366);
  assert.equal(C.daysBetween('2026-11-10', '2026-11-10'), 0);
  assert.equal(C.daysBetween('2026-11-10', '2026-11-09'), -1);
});

test('dates behave the same in Europe/Rome and other time zones', () => {
  const code = 'const C=require(process.argv[1]);console.log([C.daysBetween("2026-03-28","2026-03-30"),C.daysBetween("2026-10-24","2026-10-26"),C.toSerial(new Date(2026,10,10,15,40,0)),C.toSerial(new Date(2026,2,29,3,30,0)),C.todayIso(new Date(2026,9,25,0,30))].join("|"))';
  ['Europe/Rome', 'America/Los_Angeles', 'Pacific/Auckland', 'UTC'].forEach((tz) => {
    const r = spawnSync(process.execPath, ['-e', code, path.join(__dirname, '../src/core.js')], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '2|2|46336.652778|46110.145833|2026-10-25', tz);
  });
});

test('toSerial and ageOn', () => {
  assert.equal(C.toSerial(new Date(2026, 10, 10, 15, 40, 0)), 46336.652778);
  assert.equal(C.toSerial(new Date(2026, 10, 10, 0, 0, 0)), 46336);
  assert.equal(C.toSerial(new Date(1899, 11, 31, 12, 0, 0)), 1.5);
  assert.equal(C.toSerial(new Date(2020, 0, 1)), 43831);
  assert.equal(C.ageOn('2013-10-12', '2026-10-11'), 12);
  assert.equal(C.ageOn('2013-10-12', '2026-10-12'), 13);
  assert.equal(C.ageOn('2013-10-12', '2026-11-10'), 13);
  assert.equal(C.ageOn('2024-02-29', '2025-02-28'), 0);
  assert.equal(C.ageOn('2024-02-29', '2025-03-01'), 1);
  assert.equal(C.ageOn('2026-05-01', '2026-11-10'), 0);
});

test('parseMoney', () => {
  assert.equal(C.parseMoney('195,00 €'), 195);
  assert.equal(C.parseMoney('1.234,56 €'), 1234.56);
  assert.equal(C.parseMoney('1.000 €'), 1000);
  assert.equal(C.parseMoney('35 €'), 35);
  assert.equal(C.parseMoney('-'), null);
  assert.equal(C.parseMoney('da confermare'), null);
  assert.equal(C.parseMoney(''), null);
  assert.equal(C.parseMoney(null), null);
  assert.equal(C.parseMoney(undefined), null);
  assert.equal(C.parseMoney('170'), 170);
  assert.equal(C.parseMoney('170,5'), 170.5);
  assert.equal(C.parseMoney('170.50'), 170.5);
  assert.equal(C.parseMoney(170), 170);
  assert.equal(C.parseMoney(0), 0);
  assert.equal(C.parseMoney('0,00 €'), 0);
  assert.equal(C.parseMoney('195,00 €'), 195, 'non-breaking space');
  assert.equal(C.parseMoney('€ 1.234.567,89'), 1234567.89);
  assert.equal(C.parseMoney('-20,00 €'), -20);
  assert.equal(C.parseMoney(NaN), null);
  assert.equal(C.parseMoney(Infinity), null);
  assert.equal(C.parseMoney('12abc'), null);
  assert.equal(C.parseMoney('1,2,3'), null);
});

test('fmtMoney', () => {
  assert.equal(C.fmtMoney(1234.5), '1.234,50 €');
  assert.equal(C.fmtMoney(195), '195,00 €');
  assert.equal(C.fmtMoney(0), '0,00 €');
  assert.equal(C.fmtMoney(-35), '-35,00 €');
  assert.equal(C.fmtMoney(1000000), '1.000.000,00 €');
  assert.equal(C.fmtMoney(null), '');
  assert.equal(C.fmtMoney(NaN), '');
  [0, 35, 195, 1000, 1234.56, 99999.99].forEach((n) => assert.equal(C.parseMoney(C.fmtMoney(n)), n));
});

test('phone, email, waLink', () => {
  assert.equal(C.cleanPhone('+39 347 000 1122'), '3470001122');
  assert.equal(C.cleanPhone('0039 347-0001122'), '3470001122');
  assert.equal(C.cleanPhone('347.000.1122'), '3470001122');
  assert.equal(C.validPhone('3470001122'), true);
  assert.equal(C.validPhone('0863 123456'), true);
  assert.equal(C.validPhone('34700'), false);
  assert.equal(C.validPhone('347000112299'), false);
  assert.equal(C.validPhone(''), false);
  assert.equal(C.validEmail('mamma.rossi@example.com'), true);
  assert.equal(C.validEmail('mamma@example'), false);
  assert.equal(C.validEmail('mamma rossi@example.com'), false);
  assert.equal(C.waLink('+39 347 000 1122', 'Ciao Giulia, è ora!'), 'https://wa.me/393470001122?text=' + encodeURIComponent('Ciao Giulia, è ora!'));
  assert.equal(C.waLink('3470001122'), 'https://wa.me/393470001122');
  assert.equal(C.waLink(''), '');
  assert.equal(C.waLink(null, 'x'), '');
});

/* ---------- codice fiscale ---------- */
test('cfControlChar agrees with an independent implementation', () => {
  SAMPLE.forEach(([cf]) => {
    assert.equal(refControl(cf.slice(0, 15)), cf[15], 'reference is right for ' + cf);
    assert.equal(C.cfControlChar(cf.slice(0, 15)), cf[15]);
  });
});

test('cfCheck: valid codes pass with matching name and birth date', () => {
  SAMPLE.forEach(([cf, name, birth, sex]) => {
    const r = C.cfCheck(cf, { fullName: name, birthIso: birth });
    assert.equal(r.valid, true, cf);
    assert.deepEqual(r.errors, [], cf);
    assert.deepEqual(r.warnings, [], cf);
    assert.equal(r.cf, cf);
    assert.equal(r.decoded.sex, sex);
    assert.equal(r.decoded.day, Number(birth.slice(8)));
    assert.equal(r.decoded.month, Number(birth.slice(5, 7)));
    assert.equal(r.decoded.yy, Number(birth.slice(2, 4)));
    // name order must not matter
    const rev = name.split(' ').slice(-1).concat(name.split(' ').slice(0, -1)).join(' ');
    assert.deepEqual(C.cfCheck(cf, { fullName: rev, birthIso: birth }).warnings, [], rev);
    // lowercase and spaces
    const messy = ' ' + cf.toLowerCase().replace(/(.{3})/g, '$1 ') + ' ';
    const m = C.cfCheck(messy, { fullName: name.toUpperCase(), birthIso: birth });
    assert.equal(m.valid, true);
    assert.equal(m.cf, cf);
    assert.equal(m.errors.length + m.warnings.length, 0);
  });
  assert.equal(C.cfCheck('DLCNNL75C48H501H').decoded.place, 'H501');
  assert.deepEqual(C.cfCheck('DLBGLI13R52A345D', { fullName: 'Giulia Del Bosco' }).warnings, []);
});

test('cfCheck: every single-character substitution is caught', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let n = 0;
  SAMPLE.forEach(([cf, name, birth]) => {
    for (let i = 0; i < 16; i++) {
      for (const ch of alphabet) {
        if (ch === cf[i]) continue;
        const bad = cf.slice(0, i) + ch + cf.slice(i + 1);
        const r = C.cfCheck(bad, { fullName: name, birthIso: birth });
        assert.ok(r.errors.length + r.warnings.length > 0, bad + ' accepted');
        n++;
      }
    }
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((ch) => {
      if (ch === cf[15]) return;
      const r = C.cfCheck(cf.slice(0, 15) + ch);
      assert.equal(r.valid, false);
      assert.equal(r.errors.length, 1);
    });
  });
  assert.equal(n, 7 * 16 * 35);
});

test('cfCheck: adjacent transpositions are caught (error or warning)', () => {
  SAMPLE.forEach(([cf, name, birth]) => {
    for (let i = 0; i < 15; i++) {
      if (cf[i] === cf[i + 1]) continue;
      const bad = cf.slice(0, i) + cf[i + 1] + cf[i] + cf.slice(i + 2);
      const r = C.cfCheck(bad, { fullName: name, birthIso: birth });
      assert.ok(r.errors.length + r.warnings.length > 0, bad + ' accepted');
    }
  });
});

test('cfCheck: wrong date / unrelated name are warnings, valid stays true', () => {
  let r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Del Bosco Giulia', birthIso: '2013-10-13' });
  assert.equal(r.valid, true); assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1);
  r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Del Bosco Giulia', birthIso: '2013-11-12' });
  assert.equal(r.valid, true); assert.equal(r.warnings.length, 1);
  r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Del Bosco Giulia', birthIso: '2014-10-12' });
  assert.equal(r.valid, true); assert.equal(r.warnings.length, 1);
  r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Greco Fabiola', birthIso: '2013-10-12' });
  assert.equal(r.valid, true); assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1);
  r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Del Bosco Francesca' }); // the sister
  assert.equal(r.valid, true); assert.equal(r.warnings.length, 1);
  r = C.cfCheck('DLBGLI13R52A345D', { fullName: 'Greco Fabiola', birthIso: '2020-06-09' });
  assert.equal(r.warnings.length, 2);
});

test('cfCheck: format errors', () => {
  [['', /vuoto/], [null, /vuoto/], ['DLBGLI13R52A345', /16/], ['DLBGLI13R52A345DD', /16/], ['DLBGLI13R52A3455', /Formato/], ['1LBGLI13R52A345D', /Formato/], ['DLBGLI13F52A345D', /Formato/]].forEach(([cf, re]) => {
    const r = C.cfCheck(cf);
    assert.equal(r.valid, false, String(cf));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], re);
    assert.equal(r.decoded, null);
  });
});

test('cfCheck: omocodia', () => {
  const OMO = 'LMNPQRSTUV';
  const base = 'DLBGLI13R52A345';
  const sets = [[14], [13, 14], [6], [9, 10], [6, 7, 9, 10, 12, 13, 14]];
  sets.forEach((idx) => {
    const a = base.split('');
    idx.forEach((i) => { a[i] = OMO[Number(a[i])]; });
    const body = a.join('');
    const cf = body + refControl(body);
    const r = C.cfCheck(cf, { fullName: 'Del Bosco Giulia', birthIso: '2013-10-12' });
    assert.equal(r.valid, true, cf);
    assert.deepEqual(r.warnings, [], cf);
    assert.deepEqual(r.decoded, { yy: 13, month: 10, day: 12, sex: 'F', place: 'A345' });
    // the control character of the plain code is NOT valid for the omocodic one
    assert.equal(C.cfCheck(body + 'D').valid, refControl(body) === 'D');
  });
  assert.equal(C.cfCheck('DLBGLI13R52A34RY').valid, refControl('DLBGLI13R52A34R') === 'Y');
});

test('cfSurnameCode / cfNameCode', () => {
  assert.equal(C.cfSurnameCode('De Luca'), 'DLC');
  assert.equal(C.cfSurnameCode('Fo'), 'FOX');
  assert.equal(C.cfSurnameCode('Aiello'), 'LLA');
  assert.equal(C.cfSurnameCode("D'Alò"), 'DLA');
  assert.equal(C.cfNameCode('Antonella'), 'NNL');
  assert.equal(C.cfNameCode('Francesca'), 'FNC');
  assert.equal(C.cfNameCode('Giulia'), 'GLI');
  assert.equal(C.cfNameCode('Elia'), 'LEI');
  assert.equal(C.cfNameCode('Marta'), 'MRT');
  assert.equal(C.cfNameCode('Maria Chiara'), 'MCH');
  assert.equal(C.cfNameCode('Ada'), 'DAA');
  assert.equal(C.cfNameCode('Io'), 'IOX');
});

/* ---------- matching ---------- */
test('matchStudent', () => {
  const st = [{ name: 'Del Bosco Giulia', row: 36 }, { name: 'Del Bosco Francesca', row: 37 }, { name: 'Cappelletti Elia', row: 40 }, { name: 'Di Stefano Giulia', row: 41 }, { name: '', row: 50 }];
  assert.equal(C.matchStudent(st, 'giulia DEL bosco').exact.row, 36);
  assert.equal(C.matchStudent(st, 'Del Bosco Giulia').exact.row, 36);
  assert.equal(C.matchStudent(st, 'Dí Stefano Giulia').exact.row, 41);
  assert.equal(C.matchStudent(st, 'DI STEFANO GIULIÀ').exact.row, 41);
  let m = C.matchStudent(st, 'Capelletti Elia');
  assert.equal(m.exact, null);
  assert.equal(m.candidates[0].student.row, 40);
  assert.ok(m.candidates[0].score >= 0.9 && m.candidates[0].score < 1);
  m = C.matchStudent(st, 'Elia Capelletti');
  assert.equal(m.exact, null);
  assert.equal(m.candidates[0].student.row, 40);
  m = C.matchStudent(st, 'Del Bosco Francesca');
  assert.equal(m.exact.row, 37);
  assert.ok(m.candidates.every((c) => c.student.row !== 37));
  m = C.matchStudent([st[0]], 'Del Bosco Francesca');
  assert.equal(m.exact, null, 'sisters are not the same person');
  m = C.matchStudent(st, 'Del Bosco');
  assert.equal(m.exact, null);
  m = C.matchStudent(st, 'Rossi Maria');
  assert.equal(m.exact, null); assert.deepEqual(m.candidates, []);
  assert.deepEqual(C.matchStudent(st, ''), { exact: null, candidates: [] });
  assert.deepEqual(C.matchStudent(st, null), { exact: null, candidates: [] });
  assert.deepEqual(C.matchStudent([], 'Del Bosco Giulia'), { exact: null, candidates: [] });
});

test('surnameFirst', () => {
  assert.deepEqual(C.surnameFirst('DANIELA NERI', 'Daniel Neri'), { name: 'Neri Daniela', changed: true });
  assert.deepEqual(C.surnameFirst('ROSSI MARIA', 'De Luca Antonella'), { name: 'Rossi Maria', changed: false });
  assert.deepEqual(C.surnameFirst('giulia del bosco', 'DEL BOSCO MARIO'), { name: 'Del Bosco Giulia', changed: true });
  assert.deepEqual(C.surnameFirst('Del Bosco Giulia', 'Del Bosco Mario'), { name: 'Del Bosco Giulia', changed: false });
  assert.deepEqual(C.surnameFirst('Neri Daniela', ''), { name: 'Neri Daniela', changed: false });
  assert.deepEqual(C.surnameFirst('Neri', 'Daniel Neri'), { name: 'Neri', changed: false });
  assert.deepEqual(C.surnameFirst('', 'Daniel Neri'), { name: '', changed: false });
  assert.deepEqual(C.surnameFirst('Daniel Neri', 'Daniel Neri'), { name: 'Daniel Neri', changed: false });
  // a stray punctuation token must not be treated as "shared" with an empty parent name
  assert.deepEqual(C.surnameFirst('Rossi - Maria', ''), { name: 'Rossi - Maria', changed: false });
  assert.deepEqual(C.surnameFirst('Rossi - Maria', null), { name: 'Rossi - Maria', changed: false });
});

/* ---------- sheet parsing ---------- */
test('parseStudents: by header, real layout', () => {
  const vals = [ANA_HEAD, mk(ANA_HEAD, GIULIA), [], mk(ANA_HEAD, ELIA), ['0166', '', '', '', '', '', '', '', '-'], ['0167', '', '', '', '', '', '', '', '-']];
  const t = C.parseStudents(vals);
  assert.deepEqual(t.missing, []);
  assert.equal(t.rows.length, 2);
  const g = t.rows[0];
  assert.equal(g.row, 3);
  assert.equal(g.name, 'Del Bosco Giulia');
  assert.equal(g.id, '0034');
  assert.equal(g.nascita, '2013-10-12');
  assert.equal(g.certScadenza, '2027-04-05');
  assert.equal(g.certTipo, 'Non Agonistico');
  assert.equal(g.tel, '3470001122');
  assert.equal(g.cap, '67051');
  assert.equal(g.dovutoN, 195);
  assert.equal(g.pagatoN, 1234.56);
  assert.equal(g.residuoN, null);
  assert.equal(g.note, 'nota');
  assert.equal(g.certRilascio, '');
  assert.equal(t.rows[1].row, 5);
  assert.equal(t.firstEmpty, 4, 'the [] row in the middle is the first empty one');
  assert.equal(t.map['Cognome e Nome'], 1);
});

test('parseStudents: shuffled columns + unknown column give the same records', () => {
  const H = shuffled(ANA_HEAD);
  const a = C.parseStudents([ANA_HEAD, mk(ANA_HEAD, GIULIA), mk(ANA_HEAD, ELIA)]);
  const b = C.parseStudents([H, mk(H, GIULIA), mk(H, ELIA)]);
  assert.deepEqual(b.rows, a.rows);
  assert.deepEqual(b.missing, []);
  assert.equal(b.firstEmpty, 5);
  assert.equal(b.map['Cognome e Nome'], H.indexOf('Cognome e Nome'));
  assert.notEqual(b.map['Cognome e Nome'], a.map['Cognome e Nome']);
});

test('parseStudents: firstEmpty, pre-filled IDs, limits, missing headers', () => {
  assert.equal(C.parseStudents([ANA_HEAD, mk(ANA_HEAD, GIULIA), ['0166', '', '', '', '', '', '', '', '-']]).firstEmpty, 4);
  assert.equal(C.parseStudents([ANA_HEAD, ['0001', '', '', '', '', '', '', '', '-'], mk(ANA_HEAD, GIULIA)]).firstEmpty, 3);
  assert.equal(C.parseStudents([ANA_HEAD, mk(ANA_HEAD, GIULIA), mk(ANA_HEAD, ELIA)]).firstEmpty, 5);
  assert.equal(C.parseStudents([ANA_HEAD]).firstEmpty, 3);
  assert.equal(C.parseStudents([]).firstEmpty, 3);
  assert.deepEqual(C.parseStudents([ANA_HEAD]).rows, []);
  assert.equal(C.parseStudents(null).rows.length, 0);
  const full = (n) => [ANA_HEAD].concat(Array.from({ length: n }, (_, i) => ['' + i, 'Rossi Maria' + i]));
  assert.equal(C.parseStudents(full(399)).firstEmpty, 402);
  assert.equal(C.parseStudents(full(400)).firstEmpty, null);
  assert.equal(C.parseStudents(full(400)).rows[399].row, 402);
  const lastIdOnly = full(399).concat([['0400', '', '', '', '', '', '', '', '-']]);
  assert.equal(C.parseStudents(lastIdOnly).firstEmpty, 402);
  const noRil = ANA_HEAD.filter((h) => h !== 'Rilascio certificato' && h !== 'Telefono');
  const t = C.parseStudents([noRil, mk(noRil, GIULIA)]);
  assert.deepEqual(t.missing.slice().sort(), ['Rilascio certificato', 'Telefono']);
  assert.equal(t.rows[0].tel, '');
  assert.equal(t.rows[0].name, 'Del Bosco Giulia');
  assert.ok(C.parseStudents([['ID', 'Nome']]).missing.includes('Cognome e Nome'));
});

test('parseEnrollments', () => {
  const e1 = { ID: '0012', Allieva: 'Del Bosco Giulia', Corso: 'Base', 'Fascia oraria': '17:00', Giorni: 'Lun, Mer', 'Tariffa / Pacchetto': 'Corso Base e Avanzato · 2 giorni/settimana', 'Tipo abbonamento': 'Trimestrale', 'Data inizio': '01/10/2026', Scadenza: '01/01/2027', 'Stato abbonamento': 'ATTIVO', 'Quota concordata (sostituisce il tariffario)': '150,00 €', 'Totale dovuto': '170,00 €', 'Totale pagato': '70,00 €', Residuo: '100,00 €', 'Chiave elenco': '0012 · Del Bosco Giulia · Base' };
  const e2 = { ID: '0013', Allieva: 'Cappelletti Elia', Corso: 'Propedeutico', 'Annullata?': 'Sì', 'Totale dovuto': '-' };
  const e3 = { ID: '0014', Allieva: 'Greco Fabiola', Corso: 'Base', 'Stato abbonamento': 'STORICO' };
  const idOnly = ['0015', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '0'];
  [ISC_HEAD, shuffled(ISC_HEAD)].forEach((H) => {
    const t = C.parseEnrollments([H, mk(H, e1), mk(H, e2), mk(H, e3), H === ISC_HEAD ? idOnly : mk(H, { ID: '0015', Conta: '0' })]);
    assert.deepEqual(t.missing, []);
    assert.equal(t.rows.length, 3);
    assert.equal(t.firstEmpty, 6);
    const r = t.rows[0];
    assert.equal(r.row, 3); assert.equal(r.id, '0012'); assert.equal(r.allieva, 'Del Bosco Giulia');
    assert.equal(r.inizio, '2026-10-01'); assert.equal(r.scadenza, '2027-01-01');
    assert.equal(r.quotaN, 150); assert.equal(r.dovutoN, 170); assert.equal(r.pagatoN, 70); assert.equal(r.residuoN, 100);
    assert.equal(r.active, true); assert.equal(r.fascia, '17:00'); assert.equal(r.chiave, '0012 · Del Bosco Giulia · Base');
    assert.equal(t.rows[1].active, false); assert.equal(t.rows[1].dovutoN, null);
    assert.equal(t.rows[2].active, false);
  });
  const full = (n) => [ISC_HEAD].concat(Array.from({ length: n }, (_, i) => ['' + i, 'Rossi Maria']));
  assert.equal(C.parseEnrollments(full(499)).firstEmpty, 502);
  assert.equal(C.parseEnrollments(full(500)).firstEmpty, null);
  assert.ok(C.parseEnrollments([ISC_HEAD.filter((h) => h !== 'Allieva')]).missing.includes('Allieva'));
});

test('parsePayments', () => {
  const p1 = { 'Data pagamento': '29/09/2026', "Iscrizione (scegli dall'elenco)": '0012 · Del Bosco Giulia · Base', Importo: '70,00 €', Metodo: 'Bonifico', 'N. ricevuta': 'RIC-012-1', 'ID iscrizione': '0012', Allieva: 'Del Bosco Giulia', Corso: 'Base', Note: 'acconto' };
  const p2 = { "Iscrizione (scegli dall'elenco)": '0013 · Cappelletti Elia · Propedeutico', Importo: '1.250,00 €', Metodo: 'Contanti', 'ID iscrizione': '0013' };
  const onlyFormula = { 'Controllo dati': 'OK', 'N. ricevuta': '' };
  [PAG_HEAD, shuffled(PAG_HEAD)].forEach((H) => {
    const t = C.parsePayments([H, mk(H, p1), mk(H, onlyFormula), mk(H, p2)]);
    assert.deepEqual(t.missing, []);
    assert.equal(t.rows.length, 2);
    assert.equal(t.firstEmpty, 4);
    assert.deepEqual([t.rows[0].row, t.rows[1].row], [3, 5]);
    assert.equal(t.rows[0].data, '2026-09-29'); assert.equal(t.rows[0].importoN, 70); assert.equal(t.rows[0].metodo, 'Bonifico');
    assert.equal(t.rows[0].idIscr, '0012'); assert.equal(t.rows[0].ricevuta, 'RIC-012-1'); assert.equal(t.rows[0].note, 'acconto');
    assert.equal(t.rows[1].data, ''); assert.equal(t.rows[1].importoN, 1250);
  });
  assert.equal(C.parsePayments([PAG_HEAD, mk(PAG_HEAD, p1), mk(PAG_HEAD, p2)]).firstEmpty, 5);
  assert.equal(C.parsePayments([PAG_HEAD]).firstEmpty, 3);
  // each single key keeps the row "used"
  ['Data pagamento', "Iscrizione (scegli dall'elenco)", 'Importo', 'Metodo'].forEach((h) => {
    const o = {}; o[h] = h === 'Data pagamento' ? '01/10/2026' : h === 'Importo' ? '10,00 €' : 'x';
    assert.equal(C.parsePayments([PAG_HEAD, mk(PAG_HEAD, o)]).firstEmpty, 4, h);
  });
  const full = (n) => [PAG_HEAD].concat(Array.from({ length: n }, () => ['01/10/2026', 'x', '10,00 €', 'Contanti']));
  assert.equal(C.parsePayments(full(1499)).firstEmpty, 1502);
  assert.equal(C.parsePayments(full(1500)).firstEmpty, null);
  assert.ok(C.parsePayments([PAG_HEAD.filter((h) => h !== 'Importo')]).missing.includes('Importo'));
});

test('parseListe', () => {
  const vals = [
    ['Corsi', '', 'Fascia oraria', '', 'Tipo abbonamento', 'Mesi', '', 'Metodo di pagamento', '', 'Certificato medico', '', 'Sì / No', '', 'Parametro', 'Valore'],
    ['Propedeutico', '', '17:00', '', 'Mensile', '1', '', 'Contanti', '', 'Agonistico', '', 'Sì', '', 'Giorni di preavviso: abbonamento «in scadenza»', '20'],
    ['Base', '', '18:30', '', 'Trimestrale', '3', '', 'Bonifico', '', 'Non Agonistico', '', 'No', '', 'Giorni di preavviso: certificato «in scadenza»', '45'],
    ['Avanzato', '', '17:00/18:30', '', 'Semestrale', '6', '', 'POS', '', 'Mancante', '', '', '', 'Stagione sportiva', '2027/2028'],
    [],
    ['Agonismo', '', '', '', 'Annuale', '12', '', '', '', '', '', '', '', 'Le celle gialle sono i parametri che puoi cambiare.'],
    ['FitKid']
  ];
  const l = C.parseListe(vals);
  assert.deepEqual(l.corsi, ['Propedeutico', 'Base', 'Avanzato', 'Agonismo', 'FitKid']);
  assert.deepEqual(l.fasce, ['17:00', '18:30', '17:00/18:30']);
  assert.deepEqual(l.tipi, [{ nome: 'Mensile', mesi: 1 }, { nome: 'Trimestrale', mesi: 3 }, { nome: 'Semestrale', mesi: 6 }, { nome: 'Annuale', mesi: 12 }]);
  assert.deepEqual(l.metodi, ['Contanti', 'Bonifico', 'POS']);
  assert.deepEqual(l.certTipi, ['Agonistico', 'Non Agonistico', 'Mancante']);
  assert.deepEqual(l.missing, []);
  assert.equal(l.fasceCol, 2);
  assert.equal(l.settings.stagione, '2027/2028');
  assert.equal(l.settings.preavvisoCert, 45);
  assert.equal(l.settings.preavvisoAbb, 20);
  const e = C.parseListe([]);
  assert.deepEqual(e.corsi, []);
  assert.equal(e.settings.preavvisoCert, 30);
  assert.equal(e.settings.stagione, '2026/2027');
  assert.equal(e.missing.length, 7);
  assert.doesNotThrow(() => C.parseListe(null));
});

test('parseTariffario / quotaTariffario', () => {
  const t = C.parseTariffario(TAR_VALS);
  assert.deepEqual(t.missing, []);
  assert.equal(t.rows.length, 7);
  assert.deepEqual(t.rows[0], { chiave: 'Corso Propedeutico · 1 giorno/settimana', pacchetto: 'Corso Propedeutico', frequenza: '1 giorno/settimana', Mensile: 35, Trimestrale: 105, Semestrale: null, Annuale: 300, iscrizione: 0 });
  assert.equal(t.rows[4].Annuale, 1000);
  assert.equal(t.rows[5].Annuale, null);
  assert.equal(t.rows[5].iscrizione, 10);
  assert.equal(C.quotaTariffario(TARIFF, 'Corso Base e Avanzato · 2 giorni/settimana', 'Trimestrale'), 170);
  assert.equal(C.quotaTariffario(TARIFF, 'Corso Base e Avanzato · 2 giorni/settimana', 'Semestrale'), null);
  assert.equal(C.quotaTariffario(TARIFF, 'Nope', 'Mensile'), null);
  assert.equal(C.quotaTariffario(TARIFF, 'Corso Propedeutico · 1 giorno/settimana', ''), null);
  assert.ok(C.parseTariffario([['Frequenza']]).missing.includes('Chiave pacchetto (menu a tendina)'));
});

test('suggestPacchetto', () => {
  const s = (c, n) => C.suggestPacchetto(TARIFF, c, n);
  assert.equal(s('Base', 2), 'Corso Base e Avanzato · 2 giorni/settimana');
  assert.equal(s('Base', 3), 'Corso Base e Avanzato · 3 giorni/settimana');
  assert.equal(s('Avanzato', 3), 'Corso Base e Avanzato · 3 giorni/settimana');
  assert.equal(s('Base/Avanzato', 2), 'Corso Base e Avanzato · 2 giorni/settimana');
  assert.equal(s('Base', null), '', 'ambiguous');
  assert.equal(s('Base', 0), '');
  assert.equal(s('Base', undefined), '');
  assert.equal(s('Base', 1), '');
  assert.equal(s('Agonismo', 1), '');
  assert.equal(s('Agonismo', 3), 'Corso Agonistico · 3 giorni/settimana');
  assert.equal(s('Agonismo', null), 'Corso Agonistico · 3 giorni/settimana');
  assert.equal(s('Agonismo', 2), '', 'must not fall into Preagonistico');
  assert.equal(s('Preagonismo', 2), 'Corso Preagonistico · 2 giorni/settimana');
  assert.equal(s('Preagonismo', null), 'Corso Preagonistico · 2 giorni/settimana');
  assert.equal(s('Preagonismo', 3), '', 'must not fall into Agonistico');
  assert.equal(s('Pre-agonismo', 2), 'Corso Preagonistico · 2 giorni/settimana');
  assert.equal(s('Propedeutico', 1), 'Corso Propedeutico · 1 giorno/settimana');
  assert.equal(s('Propedeutico', null), 'Corso Propedeutico · 1 giorno/settimana');
  assert.equal(s('Propedeutico', 2), '');
  assert.equal(s('FitKid', 1), 'FitKid (1 giorno) · 1 giorno/settimana');
  assert.equal(s('FitKid', 2), 'FitKid (2 giorni) · 2 giorni/settimana');
  assert.equal(s('FitKid', null), '');
  assert.equal(s('Da definire', 2), '');
  assert.equal(s('', 2), '');
  assert.equal(s(null, 2), '');
  assert.equal(C.suggestPacchetto([], 'Base', 2), '');
});

/* ---------- writing ---------- */
test('encodeValue', () => {
  assert.equal(C.encodeValue('3470001122', 'text'), "'3470001122");
  assert.equal(C.encodeValue('67041'), "'67041");
  assert.equal(C.encodeValue(67041, 'text'), "'67041");
  assert.equal(C.encodeValue('17:00', 'text'), "'17:00");
  assert.equal(C.encodeValue('=x', 'text'), "'=x");
  assert.equal(C.encodeValue('+39 347', 'text'), "'+39 347");
  assert.equal(C.encodeValue('2010-04-05', 'date'), '2010-04-05');
  assert.strictEqual(C.encodeValue(170, 'number'), 170);
  assert.strictEqual(C.encodeValue(0, 'number'), 0);
  assert.strictEqual(C.encodeValue('170', 'number'), 170);
  assert.equal(C.encodeValue('Sì', 'list'), 'Sì');
  assert.equal(C.encodeValue('Non Agonistico', 'list'), 'Non Agonistico');
  ['text', 'date', 'number', 'list', undefined].forEach((k) => {
    assert.strictEqual(C.encodeValue('', k), '');
    assert.strictEqual(C.encodeValue(null, k), '');
    assert.strictEqual(C.encodeValue(undefined, k), '');
  });
});

test('encodeValue / sameDisplay: number typed the Italian way is read like parseMoney', () => {
  assert.strictEqual(C.encodeValue('170,5', 'number'), 170.5);
  assert.strictEqual(C.encodeValue('170.50', 'number'), 170.5);
  assert.strictEqual(C.encodeValue('1.200', 'number'), 1200, 'never 1.2');
  assert.strictEqual(C.encodeValue('1.234,56 €', 'number'), 1234.56);
  assert.ok(Number.isNaN(C.encodeValue('abc', 'number')), 'unreadable stays NaN (JSON null = cell untouched)');
  assert.equal(C.sameDisplay('1,20 €', '1.200', 'number'), false, 'a wrong write must not verify');
  assert.equal(C.sameDisplay('1.200,00 €', '1.200', 'number'), true);
  assert.equal(C.sameDisplay('170,50 €', '170,5', 'number'), true);
  assert.equal(C.sameDisplay('', 'abc', 'number'), false);
  assert.equal(C.expectedDisplay('170,5', 'number'), '170,50 €');
});

test('expectedDisplay / sameDisplay', () => {
  assert.equal(C.expectedDisplay('2010-04-05', 'date'), '05/04/2010');
  assert.equal(C.expectedDisplay(170, 'number'), '170,00 €');
  assert.equal(C.expectedDisplay(' abc ', 'text'), 'abc');
  assert.equal(C.expectedDisplay('', 'date'), '');
  assert.equal(C.sameDisplay('05/04/2010', '2010-04-05', 'date'), true);
  assert.equal(C.sameDisplay('04/05/2010', '2010-04-05', 'date'), false);
  assert.equal(C.sameDisplay('', '2010-04-05', 'date'), false);
  assert.equal(C.sameDisplay('170,00 €', 170, 'number'), true);
  assert.equal(C.sameDisplay('1.234,56 €', 1234.56, 'number'), true);
  assert.equal(C.sameDisplay('170,00 €', 171, 'number'), false);
  assert.equal(C.sameDisplay('17,00 €', 170, 'number'), false);
  assert.equal(C.sameDisplay('', 170, 'number'), false);
  assert.equal(C.sameDisplay('-', 170, 'number'), false);
  assert.equal(C.sameDisplay('', '', 'number'), true);
  assert.equal(C.sameDisplay('', null, 'number'), true);
  assert.equal(C.sameDisplay('', undefined, 'number'), true, 'undefined is written as empty, so empty must verify');
  assert.equal(C.sameDisplay('170,00 €', '', 'number'), false);
  assert.equal(C.sameDisplay(' 3470001122 ', '3470001122', 'text'), true);
  assert.equal(C.sameDisplay('347000112', '3470001122', 'text'), false);
  assert.equal(C.sameDisplay('del bosco giulia', 'Del Bosco Giulia', 'text'), false, 'text is exact');
  assert.equal(C.sameDisplay('Sì', 'Sì', 'list'), true);
  assert.equal(C.sameDisplay('Si', 'Sì', 'list'), false);
  assert.equal(C.sameDisplay('', '', 'text'), true);
});

test('buildRowUpdate', () => {
  const map = C.headerMap(ANA_HEAD);
  let u = C.buildRowUpdate('ANAGRAFICA', map, 161, [{ header: 'Telefono', value: '3470001122', kind: 'text' }, { header: 'Data di nascita', value: '2010-04-05', kind: 'date' }]);
  assert.deepEqual(u, { range: 'ANAGRAFICA!H161:N161', values: [["'3470001122", null, null, null, null, null, '2010-04-05']] });
  // order of ops does not matter
  u = C.buildRowUpdate('ANAGRAFICA', map, 161, [{ header: 'Data di nascita', value: '2010-04-05', kind: 'date' }, { header: 'Telefono', value: '3470001122', kind: 'text' }]);
  assert.equal(u.range, 'ANAGRAFICA!H161:N161');
  assert.equal(u.values[0][0], "'3470001122");
  u = C.buildRowUpdate('ANAGRAFICA', map, 3, [{ header: 'CAP', value: '67051', kind: 'text' }]);
  assert.deepEqual(u, { range: 'ANAGRAFICA!T3:T3', values: [["'67051"]] });
  // beyond Z
  u = C.buildRowUpdate('ANAGRAFICA', map, 40, [{ header: 'Scadenza certificato', value: '2027-04-05', kind: 'date' }, { header: 'Certificato medico', value: 'Agonistico', kind: 'list' }, { header: 'Note', value: 'x', kind: 'text' }]);
  assert.deepEqual(u, { range: 'ANAGRAFICA!Y40:AD40', values: [['Agonistico', null, '2027-04-05', null, null, "'x"]] });
  assert.equal(u.values.length, 1);
  const wide = {}; wide.Ultima = 32; wide.Prima = 26;
  assert.equal(C.buildRowUpdate('ISCRIZIONI', wide, 7, [{ header: 'Ultima', value: 1, kind: 'number' }, { header: 'Prima', value: 2, kind: 'number' }]).range, 'ISCRIZIONI!AA7:AG7');
  // shuffled map -> different letters, same cells by header
  const H = shuffled(ANA_HEAD), m2 = C.headerMap(H);
  u = C.buildRowUpdate('ANAGRAFICA', m2, 9, [{ header: 'Telefono', value: '1', kind: 'text' }]);
  assert.equal(u.range, 'ANAGRAFICA!' + C.colLetter(H.indexOf('Telefono')) + '9:' + C.colLetter(H.indexOf('Telefono')) + '9');
  // quoting
  const rm = C.headerMap(C.REG_HEAD);
  assert.equal(C.buildRowUpdate('REGISTRO SCANSIONI', rm, 5, [{ header: 'Allieva', value: 'x' }, { header: 'Note', value: 'y' }]).range, "'REGISTRO SCANSIONI'!B5:J5");
  assert.equal(C.buildRowUpdate("L'elenco", { A: 0 }, 5, [{ header: 'A', value: 'x' }]).range, "'L''elenco'!A5:A5");
  // unknown header
  assert.throws(() => C.buildRowUpdate('ANAGRAFICA', map, 3, [{ header: 'Telefono', value: '1' }, { header: 'Non esiste', value: '2' }]), /Non esiste/);
  // JSON keeps null placeholders
  assert.equal(JSON.stringify(C.buildRowUpdate('A', { x: 0, y: 2 }, 3, [{ header: 'x', value: 1, kind: 'number' }, { header: 'y', value: '', kind: 'text' }]).values), '[[1,null,""]]');
});

test('buildRowUpdate with no ops fails fast instead of hanging', () => {
  const code = 'const C=require(process.argv[1]);try{C.buildRowUpdate("ANAGRAFICA",{a:0},3,[]);console.log("returned")}catch(e){console.log("threw")}';
  const r = spawnSync(process.execPath, ['-e', code, path.join(__dirname, '../src/core.js')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.error, undefined, 'timed out: infinite loop');
  assert.equal(r.stdout.trim(), 'threw');
});

test('verifyRow', () => {
  const map = C.headerMap(ANA_HEAD);
  const ops = [{ header: 'Telefono', value: '3470001122', kind: 'text' }, { header: 'Data di nascita', value: '2010-04-05', kind: 'date' }, { header: 'Totale dovuto', value: 170, kind: 'number' }, { header: 'Consenso privacy', value: 'Sì', kind: 'list' }];
  const good = mk(ANA_HEAD, { Telefono: '3470001122', 'Data di nascita': '05/04/2010', 'Totale dovuto': '170,00 €', 'Consenso privacy': 'Sì' });
  assert.deepEqual(C.verifyRow(good, map, ops), []);
  const bad = mk(ANA_HEAD, { Telefono: '3,47E+09', 'Data di nascita': '04/05/2010', 'Totale dovuto': '17,00 €', 'Consenso privacy': 'Sì' });
  const b = C.verifyRow(bad, map, ops);
  assert.deepEqual(b.map((x) => x.header), ['Telefono', 'Data di nascita', 'Totale dovuto']);
  assert.deepEqual(b[0], { header: 'Telefono', atteso: '3470001122', trovato: '3,47E+09' });
  assert.equal(b[1].atteso, '05/04/2010');
  assert.equal(b[2].atteso, '170,00 €');
  assert.equal(C.verifyRow([], map, ops).length, 4);
  assert.equal(C.verifyRow(undefined, map, ops).length, 4);
});

test('registroRows', () => {
  const rows = C.registroRows(46336.652778, 'Del Bosco Giulia', 'Certificato medico', 'Aggiornamento', 'ANAGRAFICA', 36, [
    { header: 'Data di nascita', kind: 'date', value: '2013-10-12', prev: '' },
    { header: 'Telefono', kind: 'text', value: '3470001122', prev: '3470000000', note: 'forzato' },
    { header: 'Quota', kind: 'number', value: 170, prev: 150 },
    { header: 'Città', kind: 'text', value: "L'Aquila" }
  ]);
  assert.equal(rows.length, 4);
  rows.forEach((r) => assert.equal(r.length, C.REG_HEAD.length));
  assert.deepEqual(rows[0], [46336.652778, 'Del Bosco Giulia', 'Certificato medico', 'Aggiornamento', 'ANAGRAFICA', 36, 'Data di nascita', '', "'12/10/2013", '']);
  assert.deepEqual(rows[1].slice(6), ['Telefono', "'3470000000", "'3470001122", 'forzato']);
  assert.deepEqual(rows[2].slice(6), ['Quota', "'150,00 €", "'170,00 €", '']);
  assert.deepEqual(rows[3].slice(6), ['Città', '', "'L'Aquila", '']);
  assert.deepEqual(C.registroRows(1, 'a', 'b', 'c', 'd', 3, []), []);
  const reg = C.parseRegistro([C.REG_HEAD, ['10/11/2026 15:40', 'Del Bosco Giulia', 'Modulo', 'Nuova', 'ANAGRAFICA', '36', 'Telefono', '', '3470001122'], []]);
  assert.equal(reg.headerOk, true);
  assert.equal(reg.rows.length, 1);
  assert.equal(reg.rows[0].row, 3);
  assert.equal(reg.rows[0].dopo, '3470001122');
  assert.equal(C.parseRegistro([]).headerOk, false);
});

/* ---------- diff ---------- */
test('diffStudent: new student', () => {
  const d = C.diffStudent(null, { name: 'Del Bosco Giulia', nascita: '2013-10-12', tel: '3470001122', email: '', cap: null, privacy: 'Sì', certTipo: 'Mancante', nascitaScritta: '12/10/13', sconosciuto: 'x' });
  assert.deepEqual(d.conflicts, []);
  assert.deepEqual(d.ops.map((o) => o.key), ['name', 'nascita', 'tel', 'privacy', 'certTipo']);
  assert.deepEqual(d.ops[0], { key: 'name', header: 'Cognome e Nome', kind: 'text', value: 'Del Bosco Giulia', prev: '', note: '' });
  assert.equal(d.ops[1].kind, 'date');
  assert.equal(d.ops[1].header, 'Data di nascita');
  assert.equal(d.ops[3].kind, 'list');
  assert.deepEqual(C.diffStudent(null, {}).ops, []);
});

test('diffStudent: existing student', () => {
  const cur = C.parseStudents([ANA_HEAD, mk(ANA_HEAD, GIULIA)]).rows[0];
  let d = C.diffStudent(cur, { name: 'DEL BOSCO GIULIA', nascita: '2013-10-12', tel: '3470001122', cap: '67051', email: 'm@example.com', luogo: "L'Aquila" });
  assert.deepEqual(d.conflicts, []);
  assert.deepEqual(d.ops.map((o) => o.key), ['email', 'luogo'], 'only the empty cells');
  d = C.diffStudent(cur, { tel: '3331234567', nascita: '2013-10-13', cap: '67051' }, null, { tel: 'dal modulo' });
  assert.deepEqual(d.ops, []);
  assert.deepEqual(d.conflicts.map((c) => c.key), ['tel', 'nascita']);
  assert.deepEqual(d.conflicts[0], { key: 'tel', header: 'Telefono', kind: 'text', current: '3470001122', proposed: '3331234567', note: 'dal modulo' });
  assert.deepEqual(C.conflictToOp(d.conflicts[0]), { key: 'tel', header: 'Telefono', kind: 'text', value: '3331234567', prev: '3470001122', note: 'dal modulo Valore precedente sostituito.' });
  // force
  d = C.diffStudent(cur, { certTipo: 'Agonistico', certScadenza: '2027-09-01', certRilascio: '2026-09-01', tel: '3331234567' }, { certTipo: true, certScadenza: true, certRilascio: true });
  assert.deepEqual(d.ops.map((o) => o.key), ['certTipo', 'certScadenza', 'certRilascio']);
  assert.equal(d.ops[0].prev, 'Non Agonistico');
  assert.equal(d.ops[1].prev, '2027-04-05');
  assert.equal(d.ops[2].prev, '');
  assert.deepEqual(d.conflicts.map((c) => c.key), ['tel']);
  // forced but equal -> nothing
  d = C.diffStudent(cur, { certTipo: 'Non Agonistico', certScadenza: '2027-04-05' }, { certTipo: true, certScadenza: true });
  assert.deepEqual(d, { ops: [], conflicts: [] });
  // without force a different type is a conflict
  d = C.diffStudent(cur, { certTipo: 'Agonistico' });
  assert.deepEqual(d.ops, []); assert.equal(d.conflicts.length, 1);
});

test('diffStudent: Mancante', () => {
  const man = { name: 'X Y', certTipo: 'Mancante', certScadenza: '' };
  let d = C.diffStudent(man, { certTipo: 'Agonistico' });
  assert.deepEqual(d.conflicts, []);
  assert.equal(d.ops.length, 1);
  assert.equal(d.ops[0].value, 'Agonistico'); assert.equal(d.ops[0].prev, 'Mancante');
  ['Agonistico', 'Non Agonistico', ''].forEach((t) => {
    d = C.diffStudent({ name: 'X Y', certTipo: t }, { certTipo: 'Mancante' });
    assert.deepEqual(d, { ops: [], conflicts: [] }, t);
    d = C.diffStudent({ name: 'X Y', certTipo: t }, { certTipo: 'Mancante' }, { certTipo: true });
    assert.deepEqual(d, { ops: [], conflicts: [] }, 'forced ' + t);
  });
  d = C.diffStudent(man, { certTipo: 'Mancante' });
  assert.deepEqual(d, { ops: [], conflicts: [] });
  const fields = { certTipo: 'Mancante' }, force = {};
  C.diffStudent(man, fields, force);
  assert.deepEqual(fields, { certTipo: 'Mancante' }, 'inputs are not mutated');
  assert.deepEqual(force, {});
});

test('diffEnrollment: numbers', () => {
  const cur = { row: 3, allieva: 'Del Bosco Giulia', corso: 'Base', inizio: '2026-10-01', quota: '150,00 €', quotaN: 150, note: '' };
  assert.deepEqual(C.diffEnrollment(cur, { quota: 150, corso: 'base', inizio: '2026-10-01' }), { ops: [], conflicts: [] });
  assert.deepEqual(C.diffEnrollment(cur, { quota: '150,00' }), { ops: [], conflicts: [] }, 'same amount typed the Italian way is not a conflict');
  let d = C.diffEnrollment(cur, { quota: 170 });
  assert.equal(d.conflicts.length, 1); assert.equal(d.conflicts[0].current, 150); assert.equal(d.conflicts[0].kind, 'number');
  d = C.diffEnrollment(Object.assign({}, cur, { quota: '', quotaN: null }), { quota: 170, note: 'n' });
  assert.deepEqual(d.ops.map((o) => [o.key, o.value, o.prev]), [['quota', 170, ''], ['note', 'n', '']]);
  d = C.diffEnrollment(null, { allieva: 'Del Bosco Giulia', corso: 'Base', quota: 0, tipo: '' });
  assert.deepEqual(d.ops.map((o) => o.key), ['allieva', 'corso', 'quota']);
});

test('mergeNote', () => {
  assert.equal(C.mergeNote('', 'nuova'), 'nuova');
  assert.equal(C.mergeNote(null, ' nuova '), 'nuova');
  assert.equal(C.mergeNote('vecchia', 'nuova'), 'vecchia | nuova');
  assert.equal(C.mergeNote('vecchia | nuova', 'nuova'), '');
  assert.equal(C.mergeNote('vecchia', ''), '');
  assert.equal(C.mergeNote('vecchia', null), '');
});

/* ---------- checks ---------- */
const OK_MODULO = { name: 'Del Bosco Giulia', nascita: '2013-10-12', cf: 'DLBGLI13R52A345D', tel: '3470001122', cap: '67051', email: 'm@example.com', dataModulo: '2026-09-15', genitore: 'De Luca Antonella', cfGenitore: 'DLCNNL75C48H501H' };
test('checkModulo', () => {
  assert.deepEqual(C.checkModulo(OK_MODULO, TODAY), { errors: [], warnings: [] });
  const errs = (patch) => C.checkModulo(Object.assign({}, OK_MODULO, patch), TODAY).errors;
  const warns = (patch) => C.checkModulo(Object.assign({}, OK_MODULO, patch), TODAY).warnings;
  assert.equal(errs({ nascita: '2026-10-20', cf: '' }).length, 1, 'current year written as birth year');
  assert.match(errs({ nascita: '2026-10-20', cf: '' })[0], /Data di nascita impossibile/);
  assert.equal(errs({ nascita: '2024-11-11', cf: '' }).length, 1, 'age 1');
  assert.equal(errs({ nascita: '2024-11-10', cf: '' }).length, 0, 'age exactly 2');
  assert.equal(errs({ nascita: '2027-01-01', cf: '' }).length, 1, 'future');
  assert.equal(errs({ nascita: '1930-01-01', cf: '' }).length, 1);
  assert.equal(errs({ nascita: '12/10/2013', cf: '' }).length, 1, 'not ISO');
  assert.equal(errs({ tel: '34700' }).length, 1);
  assert.equal(errs({ tel: '347000112212' }).length, 1);
  assert.equal(errs({ tel2: '12' }).length, 1);
  assert.equal(errs({ cap: '6705' }).length, 1);
  assert.equal(errs({ cap: '670511' }).length, 1);
  assert.equal(errs({ cap: '6705A' }).length, 1);
  assert.equal(errs({ cf: 'DLBGLI13R52A345X' }).length, 1);
  assert.match(errs({ cf: 'DLBGLI13R52A345X' })[0], /Codice fiscale atleta/);
  assert.match(errs({ cfGenitore: 'DLCNNL75C48H501D' })[0], /Codice fiscale genitore/);
  assert.equal(errs({ email: 'm@example' }).length, 1);
  assert.equal(errs({ dataModulo: '2026-11-11' }).length, 1);
  assert.equal(errs({ name: 'Giulia' }).length, 1);
  assert.equal(errs({ name: '', cf: '' }).length, 1);
  assert.equal(errs({ certScadenza: '05/04/2027', certTipo: 'Agonistico' }).length, 1);
  assert.equal(errs({ nascita: '2013-10-13' }).length, 0);
  assert.equal(warns({ nascita: '2013-10-13' }).length, 1, 'CF/date mismatch is a warning');
  assert.equal(warns({ name: 'Greco Fabiola' }).length, 1);
  assert.equal(warns({ tel: '' }).length, 1);
  assert.equal(warns({ nascita: '', cf: '' }).length, 1);
  assert.equal(warns({ certScadenza: '2027-04-05' }).length, 1);
  assert.equal(warns({ certScadenza: '2027-04-05', certTipo: 'Mancante' }).length, 1);
  assert.equal(warns({ certScadenza: '2027-04-05', certTipo: 'Agonistico' }).length, 0);
});

test('checkIscrizione', () => {
  assert.deepEqual(C.checkIscrizione({ corso: 'Base', tipo: 'Mensile', inizio: '2026-10-01', quota: 60 }), { errors: [], warnings: [] });
  assert.equal(C.checkIscrizione({ corso: '', tipo: 'Mensile', inizio: '2026-10-01' }).errors.length, 1);
  assert.equal(C.checkIscrizione({ corso: 'Base', tipo: 'Mensile', inizio: '01/10/2026' }).errors.length, 1);
  assert.equal(C.checkIscrizione({ corso: 'Base', tipo: 'Mensile', inizio: '2026-10-01', quota: -5 }).errors.length, 1);
  assert.equal(C.checkIscrizione({ corso: 'Base', tipo: 'Mensile' }).warnings.length, 1);
  assert.equal(C.checkIscrizione({ corso: 'Base' }).warnings.length, 1);
});

test('checkPagamento', () => {
  const enr = { id: '0012', dovutoN: 170, pagatoN: 70, residuoN: 100 };
  const pays = [{ idIscr: '0012', data: '2026-11-09', importoN: 50, ricevuta: 'RIC-012-1' }, { idIscr: '0013', data: '2026-11-09', importoN: 60, ricevuta: '' }];
  const ok = { importo: 100, metodo: 'Contanti', data: '2026-11-10' };
  const run = (patch, e, p) => C.checkPagamento(Object.assign({}, ok, patch), e === undefined ? enr : e, p || pays, TODAY);
  assert.deepEqual(run({}), { errors: [], warnings: [], importo: 100 });
  assert.equal(run({ importo: '100,00 €' }).importo, 100);
  assert.equal(run({ importo: '1.000' }).importo, 1000);
  [undefined, null, '', 0, '0', '0,00', -5, 'abc', NaN].forEach((v) => {
    const r = run({ importo: v });
    assert.equal(r.errors.length, 1, 'importo ' + String(v));
    assert.match(r.errors[0], /Importo/);
  });
  assert.match(run({ metodo: '' }).errors[0], /metodo/);
  assert.equal(run({ metodo: '' }).errors.length, 1);
  assert.match(run({ data: '2026-11-11' }).errors[0], /futuro/);
  assert.equal(run({ data: '' }).errors.length, 1);
  assert.equal(run({ data: '10/11/2026' }).errors.length, 1);
  assert.equal(run({ data: '2024-12-31' }).errors.length, 1);
  assert.equal(run({}, null).errors.length, 1);
  // above the remaining balance
  let r = run({ importo: 100.01 });
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /supera il residuo/);
  assert.equal(run({ importo: 100 }).warnings.length, 0);
  assert.equal(run({ importo: 10 }, { id: '0012', dovutoN: 170, residuoN: 0 }).warnings.length, 1);
  // duplicate
  r = run({ importo: 50, data: '2026-11-09' });
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /RIC-012-1/);
  assert.equal(run({ importo: '50,00', data: '2026-11-09' }).warnings.length, 1);
  assert.equal(run({ importo: 50, data: '2026-11-08' }).warnings.length, 0, 'other date');
  assert.equal(run({ importo: 51, data: '2026-11-09' }).warnings.length, 0, 'other amount');
  assert.equal(run({ importo: 60, data: '2026-11-09' }).warnings.length, 0, 'other enrollment');
  assert.equal(run({ importo: 50, data: '2026-11-09' }, { id: '12', dovutoN: 170, residuoN: 100 }).warnings.length, 1, '0012 == 12');
  // no total due yet
  assert.match(run({}, { id: '0012', dovutoN: null, residuoN: null }).warnings[0], /totale dovuto/);
  assert.equal(run({}, { id: '0012', dovutoN: 0, residuoN: 0 }).warnings.length, 1);
});

test('checkCertificato', () => {
  const st = { name: 'Del Bosco Giulia', nascita: '2013-10-12', certScadenza: '' };
  const ok = { certTipo: 'Non Agonistico', certRilascio: '2026-09-01', certScadenza: '2027-09-01' };
  const run = (patch, s) => C.checkCertificato(Object.assign({}, ok, patch), s === undefined ? st : s, TODAY);
  assert.deepEqual(run({}), { errors: [], warnings: [] });
  assert.deepEqual(run({ certTipo: 'Agonistico', certRilascio: '2026-03-01', certScadenza: '2027-03-01' }), { errors: [], warnings: [] });
  assert.equal(run({ certRilascio: '2027-03-01', certScadenza: '2028-03-01' }, st).errors.length, 1, 'release in the future');
  assert.match(run({ certScadenza: '2026-08-31' }).errors[0], /prima del rilascio/);
  assert.equal(run({ certScadenza: '2026-09-01' }).errors.length, 1, 'same day');
  assert.match(run({ certScadenza: '2027-09-03' }).errors[0], /più di un anno/);
  assert.equal(run({ certScadenza: '2028-09-01' }).errors.length, 1);
  assert.deepEqual(C.checkCertificato({ certTipo: 'Agonistico', certRilascio: '2023-03-01', certScadenza: '2024-03-01' }, st, TODAY).errors, [], '366 days over a leap day is fine');
  assert.equal(run({ certTipo: 'Mancante' }).errors.length, 1);
  assert.equal(run({ certTipo: '' }).errors.length, 1);
  assert.equal(run({ certRilascio: '' }).errors.length, 1);
  assert.equal(run({ certScadenza: '' }).errors.length, 1);
  assert.equal(run({ certRilascio: '01/09/2026' }).errors.length, 1);
  assert.equal(run({}, null).errors.length, 1);
  // warnings
  let r = run({ certRilascio: '2025-10-01', certScadenza: '2026-10-01' });
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /già scaduto il 01\/10\/2026/);
  assert.equal(run({ certRilascio: '2025-11-10', certScadenza: '2026-11-10' }).warnings.length, 0, 'expires today: not yet expired');
  r = run({ originale: 'ludico_motoria' });
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /ludico-motoria/);
  r = run({}, { name: 'Del Bosco Giulia', certScadenza: '2027-10-15' });
  assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /15\/10\/2027/);
  assert.equal(run({}, { name: 'Del Bosco Giulia', certScadenza: '2027-09-01' }).warnings.length, 0);
  assert.equal(run({}, { name: 'Del Bosco Giulia', certScadenza: '2026-04-05' }).warnings.length, 0);
  assert.equal(run({ certScadenza: '2027-03-01' }).warnings.length, 1, 'short validity');
  assert.equal(run({ rilascioAPenna: true }).warnings.length, 1);
  assert.equal(run({ cf: 'DLBGLI13R52A345D' }).warnings.length, 0);
  assert.equal(run({ cf: 'DLBGLI13R52A345X' }).errors.length, 1);
  assert.equal(run({ cf: 'GRCFBL20H49A515X' }).warnings.length, 2);
  assert.equal(run({ nascita: '2013-10-13' }).warnings.length, 1);
});

test('certStatus / scadenze', () => {
  const cs = (scad, tipo) => C.certStatus({ certTipo: tipo === undefined ? 'Agonistico' : tipo, certScadenza: scad }, TODAY, 30);
  assert.deepEqual(cs('2026-11-09'), { stato: 'SCADUTO', giorni: -1 });
  assert.deepEqual(cs('2026-11-10'), { stato: 'IN SCADENZA', giorni: 0 });
  assert.deepEqual(cs('2026-12-10'), { stato: 'IN SCADENZA', giorni: 30 });
  assert.deepEqual(cs('2026-12-11'), { stato: 'VALIDO', giorni: 31 });
  assert.deepEqual(cs(''), { stato: 'MANCANTE', giorni: null });
  assert.deepEqual(cs('2027-01-01', 'Mancante'), { stato: 'MANCANTE', giorni: null });
  assert.deepEqual(cs('2027-01-01', ''), { stato: 'MANCANTE', giorni: null });
  const S = (name, scad, tipo) => ({ name, certTipo: tipo || 'Agonistico', certScadenza: scad });
  const db = {
    settings: { preavvisoCert: 30, preavvisoAbb: 15 },
    students: [S('A', '2027-06-01'), S('B', '2026-12-01'), S('C', '2026-11-12'), S('D', '2026-10-01'), S('E', '2026-11-01'), S('F', ''), S('G', '2027-06-01', 'Mancante'), S('H', '2027-03-01')],
    enrollments: [
      { allieva: 'A', active: true, scadenza: '2026-11-20' }, { allieva: 'B', active: true, scadenza: '2026-11-01' }, { allieva: 'C', active: false, scadenza: '2026-11-12' },
      { allieva: 'D', active: true, scadenza: '' }, { allieva: 'E', active: true, scadenza: '2026-11-26' }, { allieva: 'F', active: true, scadenza: '2026-11-25' }
    ]
  };
  const r = C.scadenze(db, TODAY);
  assert.equal(r.validi, 2);
  assert.deepEqual(r.inScadenza.map((x) => [x.student.name, x.giorni]), [['C', 2], ['B', 21]]);
  assert.deepEqual(r.scaduti.map((x) => [x.student.name, x.giorni]), [['E', -9], ['D', -40]]);
  assert.deepEqual(r.mancanti.map((x) => x.student.name), ['F', 'G']);
  assert.deepEqual(r.abbonamenti.map((x) => [x.enrollment.allieva, x.giorni]), [['B', -9], ['A', 10], ['F', 15]]);
  assert.equal(r.validi + r.inScadenza.length + r.scaduti.length + r.mancanti.length, db.students.length);
});

/* ---------- reading the photos ---------- */
test('fascia', () => {
  const F = ['17:00', '18:30', '17:00/18:30', '15:00-17:00'];
  assert.deepEqual(C.fascia('17:00', F), { value: '17:00', custom: false });
  assert.deepEqual(C.fascia('ore 18.30', F), { value: '18:30', custom: false });
  assert.deepEqual(C.fascia('18,30', F), { value: '18:30', custom: false });
  assert.deepEqual(C.fascia('17', F), { value: '17:00', custom: false });
  assert.deepEqual(C.fascia('15-17', F), { value: '15:00-17:00', custom: false });
  assert.deepEqual(C.fascia('16', F), { value: '16:00', custom: true });
  assert.deepEqual(C.fascia('16-17.30', F), { value: '16:00-17:30', custom: true });
  assert.deepEqual(C.fascia('pomeriggio', F), { value: 'pomeriggio', custom: true });
  assert.deepEqual(C.fascia('', F), { value: '', custom: false });
  assert.deepEqual(C.fascia(null, F), { value: '', custom: false });
  assert.deepEqual(C.fascia('17:00'), { value: '17:00', custom: true });
  assert.deepEqual(C.fascia({ a: 1 }, F), { value: '', custom: false });
});

const LISTS = { fasce: ['17:00', '18:30', '17:00/18:30'] };
const MODULO = {
  tipo_documento: 'modulo_iscrizione',
  atleta: { cognome_nome: 'GIULIA DEL BOSCO', data_nascita: '2013-10-12', data_nascita_come_scritta: '12/10/13', luogo_nascita: "L'AQUILA", codice_fiscale: 'dlb gli13r52 a345d', indirizzo: 'VIA DEI MILLE 76', citta: 'MAGLIANO DEI MARSI', cap: 67062 },
  genitore: { cognome_nome: 'DEL BOSCO MARIO', codice_fiscale: null, telefono: '+39 347 000 1122', email: ' Mario.Rossi@Example.com ', secondo_telefono: 3331234567 },
  iscrizione: { corso: 'BASE', giorni: ['Ven', 'lunedì', 'Dom', 'MER', 'Lun', 7, null], orario: '17', quota_iscrizione: '35', quota_mensile: '60,00 €', sconto_fratelli: true, modalita_pagamento: 'Carta', certificato_tipo: 'non_agonistico', certificato_scadenza: '05/04/2027', note_sanitarie_presenti: true },
  consensi: { privacy: null, liberatoria: false, data_modulo: '15/09/2026', firma_genitore: true, firma_societa: false },
  segreteria: { pagato: true, importo: '195', metodo: null, data_pagamento: null, tipo_abbonamento: 'Trimestrale', giorni_settimana: '2', data_inizio: '2026-10-01', annotazioni: 'P TRIM' },
  certificato: { tipo: null },
  dubbi: [{ campo: 'cap', motivo: 'cifra incerta' }, null, 'x', { campo: '', motivo: '' }, { campo: 5 }]
};

test('normalizeAi: enrollment form', () => {
  const r = C.normalizeAi(MODULO, LISTS, TARIFF);
  assert.equal(r.tipoDocumento, 'modulo_iscrizione');
  assert.equal(r.student.name, 'Del Bosco Giulia');
  assert.ok(r.dubbi.some((d) => d.campo === 'Cognome e nome'));
  assert.deepEqual(r.dubbi.slice(0, 2), [{ campo: 'cap', motivo: 'cifra incerta' }, { campo: '5', motivo: '' }]);
  assert.equal(r.dubbi.length, 3);
  assert.equal(r.student.nascita, '2013-10-12');
  assert.equal(r.student.luogo, "L'Aquila");
  assert.equal(r.student.cf, 'DLBGLI13R52A345D');
  assert.equal(r.student.indirizzo, 'Via dei Mille 76');
  assert.equal(r.student.citta, 'Magliano dei Marsi');
  assert.equal(r.student.cap, '67062');
  assert.equal(r.student.genitore, 'Del Bosco Mario');
  assert.equal(r.student.cfGenitore, '');
  assert.equal(r.student.tel, '3470001122');
  assert.equal(r.student.tel2, '3331234567');
  assert.equal(r.student.email, 'mario.rossi@example.com');
  assert.equal(r.student.privacy, 'Sì'); assert.equal(r.student.privacyBarrata, null);
  assert.equal(r.student.liberatoria, 'No'); assert.equal(r.student.liberatoriaBarrata, false);
  assert.equal(r.student.dataModulo, '2026-09-15');
  assert.equal(r.student.firmaGenitore, true); assert.equal(r.student.firmaSocieta, false);
  assert.equal(r.student.certTipo, 'Non Agonistico'); assert.equal(r.student.certScadenza, '2027-04-05');
  assert.equal(r.student.noteSanitarie, true);
  assert.equal(r.enrollment.corso, 'Base');
  assert.deepEqual(r.enrollment.giorni, ['Lun', 'Mer', 'Ven']);
  assert.equal(r.enrollment.nGiorni, 3);
  assert.equal(r.enrollment.pacchetto, 'Corso Base e Avanzato · 3 giorni/settimana');
  assert.equal(r.enrollment.fascia, '17:00'); assert.equal(r.enrollment.fasciaCustom, false);
  assert.equal(r.enrollment.tipo, 'Trimestrale');
  assert.equal(r.enrollment.inizio, '2026-10-01');
  assert.equal(r.enrollment.quotaIscrizione, 35); assert.equal(r.enrollment.quotaMensile, 60);
  assert.equal(r.enrollment.scontoFratelli, true);
  assert.deepEqual(r.payment, { pagato: true, importo: 195, metodo: 'POS', data: '' });
  assert.equal(r.cert.certTipo, ''); assert.equal(r.cert.certScadenza, ''); assert.equal(r.cert.scadenzaStampata, false);
  // the result is plain data
  assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.match(C.notaModulo(r.student, r.enrollment, r.payment), /^Modulo del 15\/09\/2026: orario 17; iscrizione e tesseramento 35,00 €; quota mensile 60,00 €; sconto fratelli; pagamento previsto: Carta; P sul modulo \(pagato\); annotazioni: P TRIM\.$/);
});

test('normalizeAi: courses, days, consents', () => {
  const en = (i, s) => C.normalizeAi({ tipo_documento: 'modulo_iscrizione', iscrizione: i, segreteria: s }, LISTS, TARIFF).enrollment;
  [['baby', 'Propedeutico'], ['base', 'Base'], ['avanzato', 'Avanzato'], ['preagonismo', 'Preagonismo'], ['agonismo', 'Agonismo'], ['Agonismo', 'Agonismo'], [' BABY ', 'Propedeutico'],
    ['null', ''], ['yoga', ''], [null, ''], [5, ''], ['constructor', ''], ['__proto__', ''], ['tostring', ''], ['hasownproperty', '']].forEach(([inp, out]) => {
    assert.strictEqual(en({ corso: inp }).corso, out, String(inp));
  });
  assert.deepEqual(en({ giorni: ['Sab', 'Gio', 'Mar', 'Lun', 'Ven', 'Mer', 'Dom', 'Sab'] }).giorni, ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']);
  assert.deepEqual(en({ giorni: ['sabato', 'GIOVEDÌ', 'xx', {}, []] }).giorni, ['Gio', 'Sab']);
  assert.deepEqual(en({ giorni: 'Lun' }).giorni, []);
  assert.deepEqual(en({ giorni: null }).giorni, []);
  assert.equal(en({ corso: 'base', giorni: [] }, { giorni_settimana: 2 }).pacchetto, 'Corso Base e Avanzato · 2 giorni/settimana');
  assert.equal(en({ corso: 'base', giorni: [] }, { giorni_settimana: '3' }).pacchetto, 'Corso Base e Avanzato · 3 giorni/settimana');
  assert.equal(en({ corso: 'base', giorni: [] }, {}).pacchetto, '');
  assert.equal(en({ corso: 'base', giorni: [] }, {}).nGiorni, null);
  assert.equal(en({ corso: 'agonismo', giorni: ['Lun'] }).pacchetto, '');
  assert.equal(en({ corso: 'baby', giorni: ['Lun'] }).pacchetto, 'Corso Propedeutico · 1 giorno/settimana');
  assert.equal(en({}, { tipo_abbonamento: 'Settimanale' }).tipo, '');
  const cons = (c) => C.normalizeAi({ consensi: c }).student;
  assert.equal(cons({ privacy: null, liberatoria: null }).privacy, 'Sì');
  assert.equal(cons({ privacy: null, liberatoria: null }).liberatoria, 'Sì');
  assert.equal(cons({}).privacy, 'Sì');
  assert.equal(cons({ privacy: true, liberatoria: true }).liberatoria, 'Sì');
  assert.equal(cons({ privacy: false, liberatoria: true }).privacy, 'No');
  assert.equal(cons({ privacy: false, liberatoria: false }).liberatoria, 'No');
  assert.equal(cons({ privacy: false }).privacyBarrata, false);
  assert.equal(cons({ privacy: true }).privacyBarrata, true);
  // a refusal sent as the string "false" must not silently become a consent
  assert.equal(cons({ liberatoria: 'false' }).liberatoria, 'No');
  assert.equal(cons({ privacy: ' False ' }).privacy, 'No');
  assert.equal(cons({ privacy: 'true' }).privacyBarrata, true);
  assert.equal(cons({ privacy: 'boh' }).privacy, 'Sì');
  const pay = (s, i) => C.normalizeAi({ segreteria: s, iscrizione: i }).payment;
  assert.equal(pay({ metodo: 'Bonifico' }, { modalita_pagamento: 'Contanti' }).metodo, 'Bonifico');
  assert.equal(pay({ metodo: 'Assegno' }, { modalita_pagamento: 'Contanti' }).metodo, 'Contanti');
  assert.equal(pay({ metodo: 'null' }, { modalita_pagamento: 'null' }).metodo, '');
  assert.equal(pay({ pagato: 'true' }).pagato, false);
  assert.equal(pay({ importo: '1.000 €', data_pagamento: '5.10.26' }).importo, 1000);
  assert.equal(pay({ importo: '1.000 €', data_pagamento: '5.10.26' }).data, '2026-10-05');
});

test('normalizeAi: medical certificate', () => {
  const cert = (ce, extra) => C.normalizeAi(Object.assign({ tipo_documento: 'certificato_medico', atleta: { cognome_nome: 'DEL BOSCO GIULIA', data_nascita: '12/10/2013', codice_fiscale: 'DLBGLI13R52A345D' }, genitore: { cognome_nome: 'Giulia Rossi' }, certificato: ce }, extra || {}));
  let r = cert({ tipo: 'non_agonistico', data_rilascio: '2026-09-01', data_scadenza: null, validita_testo: 'validità annuale', data_rilascio_a_penna: true });
  assert.equal(r.tipoDocumento, 'certificato_medico');
  assert.equal(r.cert.name, 'Del Bosco Giulia', 'no reordering on a certificate');
  assert.equal(r.cert.certTipo, 'Non Agonistico'); assert.equal(r.cert.originale, 'non_agonistico');
  assert.equal(r.cert.certRilascio, '2026-09-01'); assert.equal(r.cert.certScadenza, '2027-09-01'); assert.equal(r.cert.scadenzaStampata, false);
  assert.equal(r.cert.rilascioAPenna, true); assert.equal(r.cert.validita, 'validità annuale');
  assert.equal(r.cert.nascita, '2013-10-12'); assert.equal(r.cert.cf, 'DLBGLI13R52A345D');
  assert.deepEqual(C.checkCertificato(r.cert, { name: 'Del Bosco Giulia', nascita: '2013-10-12' }, TODAY).errors, []);
  r = cert({ tipo: 'agonistico', data_rilascio: '29/02/2024' });
  assert.equal(r.cert.certTipo, 'Agonistico'); assert.equal(r.cert.certScadenza, '2025-02-28');
  r = cert({ tipo: 'agonistico', data_rilascio: '01/09/2026', data_scadenza: '31/08/2027' });
  assert.equal(r.cert.certScadenza, '2027-08-31'); assert.equal(r.cert.scadenzaStampata, true);
  r = cert({ tipo: 'ludico_motoria', data_rilascio: '2026-09-01' });
  assert.equal(r.cert.certTipo, 'Non Agonistico'); assert.equal(r.cert.originale, 'ludico_motoria');
  assert.ok(C.checkCertificato(r.cert, { name: 'x y' }, TODAY).warnings.some((w) => /ludico/.test(w)));
  r = cert({ tipo: 'altro', data_rilascio: 'ieri' });
  assert.equal(r.cert.certTipo, ''); assert.equal(r.cert.originale, 'altro'); assert.equal(r.cert.certRilascio, ''); assert.equal(r.cert.certScadenza, ''); assert.equal(r.cert.scadenzaStampata, false);
  r = cert({ tipo: 'agonistico', data_rilascio: '2026-09-01', data_scadenza: '31/02/2027' });
  assert.equal(r.cert.certScadenza, '2027-09-01'); assert.equal(r.cert.scadenzaStampata, false);
});

test('normalizeAi never throws on malformed input', () => {
  const bad = [null, undefined, {}, [], 'x', 42, true, { atleta: 'x', genitore: 5, iscrizione: [], consensi: true, segreteria: 'P', certificato: 0, dubbi: 'no' },
    { atleta: { cognome_nome: {}, data_nascita: 20131020, cap: {}, codice_fiscale: [] }, genitore: { telefono: {}, email: 7 }, iscrizione: { giorni: 'Lun', corso: {}, orario: {}, quota_mensile: {} }, dubbi: [1, null, 'a', []] },
    { tipo_documento: 7, atleta: null, genitore: null, iscrizione: null, consensi: null, segreteria: null, certificato: null, dubbi: null },
    { iscrizione: { corso: 'constructor', orario: '99:99-xx', giorni: [[['Lun']]] }, segreteria: { giorni_settimana: 'due', importo: 'P' }, certificato: { tipo: {}, data_rilascio: {} } }];
  bad.forEach((j, n) => {
    [[undefined, undefined], [null, null], [{}, []], [LISTS, TARIFF]].forEach(([l, t]) => {
      let r;
      assert.doesNotThrow(() => { r = C.normalizeAi(j, l, t); }, 'case ' + n);
      assert.equal(typeof r.student.name, 'string');
      assert.equal(typeof r.enrollment.corso, 'string');
      assert.ok(Array.isArray(r.enrollment.giorni));
      assert.ok(Array.isArray(r.dubbi));
      assert.equal(r.student.privacy, 'Sì');
      assert.doesNotThrow(() => JSON.stringify(r));
    });
  });
  const e = C.normalizeAi(null);
  assert.equal(e.tipoDocumento, 'altro');
  assert.deepEqual(e.payment, { pagato: false, importo: null, metodo: '', data: '' });
  assert.equal(e.enrollment.pacchetto, '');
  assert.equal(e.cert.certScadenza, '');
  assert.equal(C.normalizeAi({ atleta: { data_nascita: null, data_nascita_come_scritta: '5/4/10' } }).student.nascita, '2010-04-05');
  assert.equal(C.normalizeAi({ atleta: { data_nascita: '2010-02-30', data_nascita_come_scritta: '30/02/2010' } }).student.nascita, '');
});

test('buildPrompt and exported constants', () => {
  assert.ok(C.buildPrompt().length > 1000);
  assert.deepEqual(C.DAY_ORDER, ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']);
  assert.equal(C.SHEETS.ANA.maxRow, 402); assert.equal(C.SHEETS.ISC.maxRow, 502); assert.equal(C.SHEETS.PAG.maxRow, 1502);
  assert.equal(C.REG_HEAD.length, 10);
  PAG_HEAD.slice(0, 4).forEach((h) => assert.ok(Object.values(C.P_COLS).includes(h)));
});
