/* Gym Art Segreteria - builds the database view and the write plans (pure: no DOM, no network). */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Core;

  /** raw = { ana, isc, pag, lis, tar, reg }: arrays of display rows as returned by get_values. */
  function buildDb(raw) {
    var S = C.parseStudents(raw.ana), E = C.parseEnrollments(raw.isc), P = C.parsePayments(raw.pag), L = C.parseListe(raw.lis), T = C.parseTariffario(raw.tar), R = C.parseRegistro(raw.reg);
    var problems = [];
    if (S.missing.length) problems.push('ANAGRAFICA: mancano le colonne ' + S.missing.join(', '));
    if (E.missing.length) problems.push('ISCRIZIONI: mancano le colonne ' + E.missing.join(', '));
    if (P.missing.length) problems.push('PAGAMENTI: mancano le colonne ' + P.missing.join(', '));
    if (L.missing.length) problems.push('LISTE: mancano le colonne ' + L.missing.join(', '));
    if (T.missing.length) problems.push('TARIFFARIO: mancano le colonne ' + T.missing.join(', '));
    if (!R.headerOk) problems.push('REGISTRO SCANSIONI: intestazioni non riconosciute');
    if (!S.rows.length) problems.push('ANAGRAFICA: nessuna allieva trovata');
    return { students: S.rows, sMap: S.map, sFirstEmpty: S.firstEmpty, enrollments: E.rows, eMap: E.map, eFirstEmpty: E.firstEmpty, payments: P.rows, pMap: P.map, pFirstEmpty: P.firstEmpty,
      lists: L, settings: L.settings, tariff: T.rows, registro: R.rows, problems: problems };
  }
  function byRow(list, row) { for (var i = 0; i < list.length; i++) if (list[i].row === row) return list[i]; return null; }
  function enrollmentsOf(db, name) { var k = C.tokenKey(name); return db.enrollments.filter(function (e) { return C.tokenKey(e.allieva) === k; }); }
  function has(v) { return v !== '' && v !== null && v !== undefined; }
  function line(sheet, op) { var a = C.expectedDisplay(op.prev === undefined ? '' : op.prev, op.kind), b = C.expectedDisplay(op.value, op.kind); return { sheet: sheet, campo: op.header, prima: a, dopo: b }; }

  function studentPart(db, it, fields, force, notes, out) {
    var isNew = it.studentChoice === 'new', cur = isNew ? null : byRow(db.students, it.studentChoice);
    var name = C.titleCase(it.f.name);
    if (!isNew && !cur) { out.errors.push('L\'allieva scelta non è più nella stessa riga del foglio: ricarica i dati e riprova.'); }
    if (isNew) {
      var m = C.matchStudent(db.students, name);
      if (m.exact) out.errors.push('Nel foglio c\'è già "' + m.exact.name + '" (riga ' + m.exact.row + '): scegli quella allieva invece di crearne una nuova.');
      if (db.sFirstEmpty === null) out.errors.push('L\'anagrafica è piena: non ci sono righe libere.');
      fields = Object.assign({ name: name }, fields);
    }
    var d = C.diffStudent(cur, fields, force, notes), ops = d.ops.slice(), open = [];
    d.conflicts.forEach(function (c) { if (it.replace && it.replace[c.key]) ops.push(C.conflictToOp(c)); else open.push(c); });
    out.student = { mode: isNew ? 'new' : 'update', row: isNew ? db.sFirstEmpty : (cur ? cur.row : null), name: isNew ? name : (cur ? cur.name : name), current: cur, ops: ops, conflicts: d.conflicts, open: open };
    ops.forEach(function (o) { out.lines.push(line('ANAGRAFICA', o)); });
    return cur;
  }

  /** it = { f:{...form}, studentChoice:'new'|row, enrollChoice:'none'|'new'|row, replace:{key:true}, replaceE:{key:true}, ai } */
  function planModulo(db, it, today) {
    today = today || C.todayIso();
    var f = it.f, out = { kind: 'modulo', errors: [], warnings: [], lines: [], student: null, enrollment: null, payment: null, addFascia: null };
    var chk = C.checkModulo(f, today); out.errors = out.errors.concat(chk.errors); out.warnings = out.warnings.concat(chk.warnings);
    var fields = { tel: C.cleanPhone(f.tel), tel2: C.cleanPhone(f.tel2), genitore: C.titleCase(f.genitore), cfGenitore: C.cfNormalize(f.cfGenitore), email: C.str(f.email), nascita: f.nascita, luogo: C.str(f.luogo), cf: C.cfNormalize(f.cf),
      indirizzo: C.str(f.indirizzo), citta: C.str(f.citta), cap: C.str(f.cap), privacy: f.privacy, liberatoria: f.liberatoria, dataModulo: f.dataModulo, certTipo: f.certTipo, certScadenza: f.certScadenza };
    if (it.studentChoice === 'new' && !fields.certTipo) fields.certTipo = 'Mancante';
    var notes = {};
    if (f.privacyBarrata === null) notes.privacy = 'Casella non barrata sul modulo: Sì inserito per regola della palestra.';
    if (f.liberatoriaBarrata === null) notes.liberatoria = 'Casella non barrata sul modulo: Sì inserito per regola della palestra.';
    if (f.nascitaScritta && C.parseDate(f.nascitaScritta) !== f.nascita) notes.nascita = 'Sul modulo era scritto ' + f.nascitaScritta + ': corretta in preverifica.';
    var cur = studentPart(db, it, fields, null, notes, out);
    var name = out.student.name;

    if (it.enrollChoice !== 'none') {
      var qIn = has(f.quota) && C.str(f.quota) !== '' ? C.parseMoney(f.quota) : '';
      if (qIn === null) out.errors.push('Quota concordata non valida: scrivi solo la cifra, per esempio 170 oppure 170,50.');
      var ec = C.checkIscrizione({ corso: f.corso, tipo: f.tipo, inizio: f.inizio, quota: qIn === null ? '' : qIn });
      out.errors = out.errors.concat(ec.errors); out.warnings = out.warnings.concat(ec.warnings);
      var eNew = it.enrollChoice === 'new', eCur = eNew ? null : byRow(db.enrollments, it.enrollChoice);
      if (!eNew && (!eCur || C.tokenKey(eCur.allieva) !== C.tokenKey(name))) { out.errors.push('L\'iscrizione scelta non corrisponde più a questa allieva: ricarica i dati.'); eCur = null; }
      if (eNew && db.eFirstEmpty === null) out.errors.push('Il foglio ISCRIZIONI è pieno: non ci sono righe libere.');
      if (f.corso && db.lists.corsi.indexOf(f.corso) < 0) out.errors.push('Il corso "' + f.corso + '" non è nell\'elenco dei corsi del foglio.');
      if (f.pacchetto && !db.tariff.some(function (p) { return p.chiave === f.pacchetto; })) out.errors.push('Il pacchetto scelto non è nel tariffario.');
      if (f.tipo && !db.lists.tipi.some(function (t) { return t.nome === f.tipo; })) out.errors.push('Tipo di abbonamento non valido.');
      if (eNew && cur) {
        var same = enrollmentsOf(db, name).filter(function (e) { return e.active && e.corso === f.corso; });
        if (same.length) out.warnings.push('Ha già un\'iscrizione attiva al corso ' + f.corso + ' (riga ' + same[0].row + '). Se è la stessa, scegli "Completa l\'iscrizione esistente" per non contarla due volte.');
      }
      var quota = qIn === '' || qIn === null ? null : qIn;
      var eFields = { corso: f.corso, fascia: C.str(f.fascia), giorni: (f.giorni || []).join(', '), pacchetto: f.pacchetto, tipo: f.tipo, inizio: f.inizio };
      if (quota !== null) eFields.quota = quota;
      if (eNew) eFields = Object.assign({ allieva: name }, eFields);
      var de = C.diffEnrollment(eCur, eFields, null), eOps = de.ops.slice(), eOpen = [];
      de.conflicts.forEach(function (c) { if (it.replaceE && it.replaceE[c.key]) eOps.push(C.conflictToOp(c)); else eOpen.push(c); });
      var nota = C.notaModulo(f, { nGiorni: (f.giorni || []).length ? null : (f.nGiorni || null), giorni: f.giorni || [], orarioScritto: f.orarioScritto || '', quotaIscrizione: has(f.quotaIscrizione) ? f.quotaIscrizione : null, quotaMensile: has(f.quotaMensile) ? f.quotaMensile : null, scontoFratelli: f.scontoFratelli, modalita: f.modalita || '', annotazioni: f.annotazioni || '' }, { pagato: !!f.pagatoSulModulo });
      var merged = eCur ? C.mergeNote(eCur.note, nota) : nota;
      if (merged) eOps.push({ key: 'note', header: C.E_COLS.note, kind: 'text', value: merged, prev: eCur ? eCur.note : '', note: '' });
      var tariffa = C.quotaTariffario(db.tariff, f.pacchetto || (eCur ? eCur.pacchetto : ''), f.tipo || (eCur ? eCur.tipo : ''));
      var atteso = quota !== null ? quota : (eCur && eCur.dovutoN ? eCur.dovutoN : tariffa);
      out.enrollment = { mode: eNew ? 'new' : 'update', row: eNew ? db.eFirstEmpty : (eCur ? eCur.row : null), current: eCur, ops: eOps, conflicts: de.conflicts, open: eOpen, quotaTariffario: tariffa, dovutoAtteso: atteso };
      eOps.forEach(function (o) { out.lines.push(line('ISCRIZIONI', o)); });
      if (f.fascia && db.lists.fasce.indexOf(f.fascia) < 0) {
        var free = 4 + db.lists.fasce.length;
        if (db.lists.fasceCol !== undefined && free <= 10) { out.addFascia = { row: free, col: db.lists.fasceCol, value: f.fascia }; out.lines.push({ sheet: 'LISTE', campo: 'Fascia oraria', prima: '', dopo: f.fascia }); }
        else out.warnings.push('L\'orario "' + f.fascia + '" non è nell\'elenco degli orari del foglio e l\'elenco è pieno: verrà scritto lo stesso, ma il foglio lo segnalerà.');
      }
      if (f.payOn) {
        var pseudo = eCur ? eCur : { id: '', residuoN: atteso, dovutoN: atteso };
        var pc = C.checkPagamento({ data: f.payData, importo: f.payImporto, metodo: f.payMetodo }, pseudo, eCur ? db.payments : [], today);
        out.errors = out.errors.concat(pc.errors); out.warnings = out.warnings.concat(pc.warnings);
        if (f.payMetodo && db.lists.metodi.indexOf(f.payMetodo) < 0) out.errors.push('Metodo di pagamento non valido.');
        if (db.pFirstEmpty === null) out.errors.push('Il foglio PAGAMENTI è pieno: non ci sono righe libere.');
        out.payment = { row: db.pFirstEmpty, importo: pc.importo, data: f.payData, metodo: f.payMetodo, note: 'Da modulo di iscrizione' + (f.dataModulo ? ' del ' + C.isoToIt(f.dataModulo) : '') };
        out.lines.push({ sheet: 'PAGAMENTI', campo: 'Nuovo versamento', prima: '', dopo: C.fmtMoney(pc.importo || 0) + ' · ' + (f.payMetodo || '?') + ' · ' + C.isoToIt(f.payData || '') });
      } else if (f.pagatoSulModulo) out.warnings.push('Sul modulo c\'è la P (pagato) ma il pagamento non verrà registrato: attiva "Registra il pagamento" e indica importo e metodo, oppure registralo dopo dalla sezione Pagamenti.');
    } else if (f.payOn) out.errors.push('Per registrare un pagamento serve un\'iscrizione a cui collegarlo.');
    if (!out.lines.length && !out.errors.length) out.errors.push('Non c\'è niente di nuovo da scrivere: i dati sono già nel foglio.');
    return out;
  }

  function planCertificato(db, it, today) {
    today = today || C.todayIso();
    var f = it.f, out = { kind: 'certificato', errors: [], warnings: [], lines: [], student: null };
    var isNew = it.studentChoice === 'new', cur = isNew ? null : byRow(db.students, it.studentChoice);
    var pseudo = cur || { name: f.name, certScadenza: '', nascita: '' };
    if (isNew && C.norm(f.name).split(' ').length < 2) out.errors.push('Per una nuova allieva servono cognome e nome.');
    var chk = C.checkCertificato({ certTipo: f.certTipo, certRilascio: f.certRilascio, certScadenza: f.certScadenza, originale: f.originale, rilascioAPenna: f.rilascioAPenna, cf: f.cf, nascita: f.nascita, name: isNew ? f.name : '' }, pseudo, today);
    out.errors = out.errors.concat(chk.errors); out.warnings = out.warnings.concat(chk.warnings);
    if (f.nascita && C.isIso(f.nascita)) { var age = C.ageOn(f.nascita, today); if (age < 2 || age > 90) out.errors.push('Data di nascita impossibile (' + C.isoToIt(f.nascita) + ').'); }
    if (f.cap && !/^\d{5}$/.test(C.str(f.cap))) out.errors.push('CAP non valido: servono 5 cifre.');
    if (cur && cur.certTipo === f.certTipo && cur.certRilascio === f.certRilascio && cur.certScadenza === f.certScadenza) out.warnings.push('Questo certificato risulta già registrato con le stesse date.');
    var fields = { certTipo: f.certTipo, certRilascio: f.certRilascio, certScadenza: f.certScadenza, nascita: f.nascita, luogo: C.str(f.luogo), cf: C.cfNormalize(f.cf), indirizzo: C.str(f.indirizzo), citta: C.str(f.citta), cap: C.str(f.cap) };
    var notes = { certScadenza: f.scadenzaStampata ? 'Scadenza stampata sul certificato.' : 'Scadenza calcolata: un anno dal rilascio.' };
    if (cur && cur.certScadenza && cur.certScadenza !== f.certScadenza) notes.certScadenza += ' Sostituisce la scadenza precedente.';
    if (f.rilascioAPenna) notes.certRilascio = 'Data scritta a penna sul certificato.';
    if (isNew) { fields.privacy = ''; }
    studentPart(db, it, fields, { certTipo: true, certRilascio: true, certScadenza: true }, notes, out);
    var extra = [];
    if (f.originale === 'ludico_motoria') extra.push('Certificato per attività ludico-motoria.');
    if (f.rilascioAPenna) extra.push('Data di rilascio del certificato scritta a penna.');
    if (extra.length && out.student) {
      var merged = C.mergeNote(cur ? cur.note : '', extra.join(' '));
      if (merged) { var op = { key: 'note', header: C.S_COLS.note, kind: 'text', value: merged, prev: cur ? cur.note : '', note: '' }; out.student.ops.push(op); out.lines.push(line('ANAGRAFICA', op)); }
    }
    if (!out.lines.length && !out.errors.length) out.errors.push('Non c\'è niente di nuovo da scrivere: i dati sono già nel foglio.');
    return out;
  }

  /** p = { enrollRow, data, importo, metodo, note } */
  function planPagamento(db, p, today) {
    today = today || C.todayIso();
    var out = { kind: 'pagamento', errors: [], warnings: [], lines: [], enrollment: null, payment: null };
    var e = byRow(db.enrollments, p.enrollRow);
    var chk = C.checkPagamento(p, e, db.payments, today);
    out.errors = chk.errors.slice(); out.warnings = chk.warnings.slice();
    if (e && !e.active) out.warnings.push('Questa iscrizione è annullata o già rinnovata: controlla di aver scelto quella giusta.');
    if (e && !e.chiave) out.errors.push('Non riesco a leggere la chiave dell\'iscrizione nel foglio (colonna "Chiave elenco").');
    if (p.metodo && db.lists.metodi.indexOf(p.metodo) < 0) out.errors.push('Metodo di pagamento non valido.');
    if (db.pFirstEmpty === null) out.errors.push('Il foglio PAGAMENTI è pieno: non ci sono righe libere.');
    out.enrollment = e;
    out.payment = { row: db.pFirstEmpty, importo: chk.importo, data: p.data, metodo: p.metodo, note: C.str(p.note) };
    if (!out.errors.length) out.lines.push({ sheet: 'PAGAMENTI', campo: 'Nuovo versamento', prima: '', dopo: C.fmtMoney(chk.importo) + ' · ' + p.metodo + ' · ' + C.isoToIt(p.data) });
    return out;
  }
  /** Operations for one PAGAMENTI row. chiave = text of the enrollment as shown in ISCRIZIONI "Chiave elenco". */
  function paymentOps(pay, chiave) {
    var ops = [
      { header: C.P_COLS.data, kind: 'date', value: pay.data },
      { header: C.P_COLS.iscrizione, kind: 'text', value: chiave },
      { header: C.P_COLS.importo, kind: 'number', value: pay.importo },
      { header: C.P_COLS.metodo, kind: 'list', value: pay.metodo }
    ];
    if (pay.note) ops.push({ header: C.P_COLS.note, kind: 'text', value: pay.note });
    return ops;
  }

  var Plan = { buildDb: buildDb, byRow: byRow, enrollmentsOf: enrollmentsOf, planModulo: planModulo, planCertificato: planCertificato, planPagamento: planPagamento, paymentOps: paymentOps };
  if (typeof module !== 'undefined' && module.exports) module.exports = Plan; else root.Plan = Plan;
})(typeof self !== 'undefined' ? self : this);
