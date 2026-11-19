/* Gym Art Segreteria per Windows - logica dell'archivio sul PC (no DOM, no network). Runs in the browser and in Node tests. */
(function (root) {
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;

  var SCHEMA = 2; // 2: certificates, payments, enrollment fee
  // Types that can be chosen, and types that can still be read: the semestral subscription no longer exists, but old data may hold one.
  var TIPI = [{ nome: 'Mensile', mesi: 1 }, { nome: 'Trimestrale', mesi: 3 }, { nome: 'Annuale', mesi: 12 }];
  var TIPI_NOTI = TIPI.concat([{ nome: 'Semestrale', mesi: 6 }]);
  var GIORNI = C.DAY_ORDER;
  /* Student and enrollment fields, with the labels used in the Google sheet (shown in forms, log and exports). */
  var A_CAMPI = { name: 'Cognome e Nome', nascita: 'Data di nascita', luogo: 'Luogo di nascita', cf: 'Codice fiscale', indirizzo: 'Indirizzo', citta: 'Città', cap: 'CAP',
    genitore: 'Genitore / Referente', cfGenitore: 'CF genitore', tel: 'Telefono', tel2: 'Secondo telefono', email: 'Email',
    privacy: 'Consenso privacy', liberatoria: 'Liberatoria foto/video', dataModulo: 'Data modulo iscrizione', tessera: 'N° tessera EPS/FGI',
    certTipo: 'Certificato medico', certRilascio: 'Rilascio certificato', certScadenza: 'Scadenza certificato', note: 'Note' };
  var A_DATE = { nascita: 1, dataModulo: 1, certRilascio: 1, certScadenza: 1 };
  var I_CAMPI = { corso: 'Corso', giorni: 'Giorni', fascia: 'Fascia oraria', pacchetto: 'Tariffa / Pacchetto', tipo: 'Tipo abbonamento', inizio: 'Data inizio',
    quota: 'Quota concordata', quotaIscrizione: 'Iscrizione e tesseramento', annullata: 'Annullata', storica: 'Chiusa (storico)', note: 'Note' };
  var CERT_TIPI = ['Agonistico', 'Non Agonistico', 'Ludico-motoria'];
  var METODI = ['Contanti', 'Bonifico', 'POS'];
  /* Messaggi per i genitori: un testo per ogni situazione. Segnaposto: {saluto} {nome} {genitore} {corso} {tipo} {scadenza} {giorni} {residuo} {palestra}.
     "vecchio" è il testo predefinito delle versioni prima della 1.15: chi non l'ha cambiato passa al nuovo, chi l'ha cambiato tiene il suo. */
  var PALESTRA = 'A.S.D. Gym Art Avezzano';
  var MODELLI = {
    messaggioScadenza: { nome: 'Abbonamento in scadenza', vecchio: 'Buongiorno, vi ricordiamo che l\'abbonamento di {nome} al corso {corso} ha scadenza il {scadenza}. Grazie, A.S.D. Gym Art Avezzano',
      testo: '{saluto}, vi ricordiamo che l\'abbonamento {tipo} di {nome} al corso {corso} scade il {scadenza} ({giorni}). Per rinnovarlo passate in segreteria. Grazie, {palestra}' },
    messaggioAbbScaduto: { nome: 'Abbonamento scaduto', vecchio: '',
      testo: '{saluto}, l\'abbonamento {tipo} di {nome} al corso {corso} è scaduto il {scadenza}. Per continuare a frequentare vi chiediamo di rinnovarlo in segreteria. Grazie, {palestra}' },
    messaggioCertificato: { nome: 'Certificato in scadenza', vecchio: 'Buongiorno, vi ricordiamo che il certificato medico di {nome} ha scadenza il {scadenza}. Grazie, A.S.D. Gym Art Avezzano',
      testo: '{saluto}, vi ricordiamo che il certificato medico di {nome} scade il {scadenza} ({giorni}). Vi chiediamo di consegnare in segreteria quello nuovo. Grazie, {palestra}' },
    messaggioCertScaduto: { nome: 'Certificato scaduto', vecchio: '',
      testo: '{saluto}, il certificato medico di {nome} è scaduto il {scadenza}. Vi chiediamo di consegnare in segreteria quello nuovo al più presto. Grazie, {palestra}' },
    messaggioCertMancante: { nome: 'Certificato mancante', vecchio: 'Buongiorno, ci risulta mancante il certificato medico di {nome}: vi chiediamo di consegnarlo in segreteria. Grazie, A.S.D. Gym Art Avezzano',
      testo: '{saluto}, ci risulta mancante il certificato medico di {nome}: vi chiediamo di consegnarlo in segreteria. Grazie, {palestra}' }
  };
  var SEGNAPOSTO = ['saluto', 'nome', 'genitore', 'corso', 'tipo', 'scadenza', 'giorni', 'residuo', 'palestra'];
  var MESSAGGIO_CERT = MODELLI.messaggioCertificato.testo;
  var MESSAGGIO = MODELLI.messaggioScadenza.testo;

  var GIORNI_COPIA = 30;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad4(n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  /* ---------- archive ---------- */
  function stagioneDi(today) { var y = +today.slice(0, 4); if (today.slice(5, 7) < '08') y -= 1; return y + '/' + (y + 1); }
  function tariffa(pacchetto, frequenza, m, t, s, a, iscr) {
    return { chiave: pacchetto + ' · ' + frequenza, pacchetto: pacchetto, frequenza: frequenza, Mensile: m, Trimestrale: t, Semestrale: s, Annuale: a, iscrizione: iscr || 0 };
  }
  function nuovoArchivio(today) {
    return {
      schema: SCHEMA,
      impostazioni: { stagione: stagioneDi(today || C.todayIso()), preavvisoAbb: 30, messaggioScadenza: '', ultimaCopia: '',
        preavvisoCert: 30, messaggioCertificato: '', legale: '', ente: '', codice: '', cfAssociazione: '' },
      liste: { corsi: ['Propedeutico', 'Base', 'Avanzato', 'Preagonismo', 'Agonismo', 'FitKid', 'Da definire'], fasce: [], metodi: METODI.slice() },
      tariffario: [
        tariffa('Corso Propedeutico', '1 giorno/settimana', 35, 105, null, 300),
        tariffa('Corso Base e Avanzato', '2 giorni/settimana', 60, 170, null, 500),
        tariffa('Corso Base e Avanzato', '3 giorni/settimana', 70, 200, null, 580),
        tariffa('Corso Preagonistico', '2 giorni/settimana', 70, 200, null, 580),
        tariffa('Corso Agonistico', '3 giorni/settimana', 85, 250, null, 1000),
        tariffa('FitKid (1 giorno)', '1 giorno/settimana', 25, 70, null, null, 10),
        tariffa('FitKid (2 giorni)', '2 giorni/settimana', 40, 110, null, null, 10)
      ],
      allieve: [], iscrizioni: [], pagamenti: [], promemoria: [], documenti: [],
      prossimi: { allieva: 1, iscrizione: 1, pagamento: 1, documento: 1 }
    };
  }
  /** Why an object cannot be used as an archive ('' if it can). Used before restoring a copy. */
  function validaArchivio(db) {
    if (!db || typeof db !== 'object' || Array.isArray(db)) return 'Il file non contiene un archivio.';
    if (!Array.isArray(db.allieve) || !Array.isArray(db.iscrizioni)) return 'Il file non contiene un archivio di Gym Art Segreteria.';
    if (typeof db.schema === 'number' && db.schema > SCHEMA) return 'Questa copia è stata creata con una versione più recente del programma.';
    var ids = {}, i;
    for (i = 0; i < db.allieve.length; i++) {
      var a = db.allieve[i];
      if (!a || typeof a.id !== 'string' || !C.str(a.name)) return 'Nel file c\'è un\'allieva senza nome o senza numero.';
      if (ids[a.id]) return 'Nel file ci sono due allieve con lo stesso numero (' + a.id + ').';
      ids[a.id] = 1;
    }
    for (i = 0; i < db.iscrizioni.length; i++) {
      var e = db.iscrizioni[i];
      if (!e || typeof e.id !== 'string' || !ids[e.allievaId]) return 'Nel file c\'è un\'iscrizione che non appartiene a nessuna allieva.';
    }
    if (db.promemoria !== undefined && !Array.isArray(db.promemoria)) return 'Nel file l\'elenco dei promemoria non è leggibile.';
    var isc = {};
    db.iscrizioni.forEach(function (e) { isc[e.id] = 1; });
    if (db.pagamenti !== undefined && !Array.isArray(db.pagamenti)) return 'Nel file l\'elenco dei pagamenti non è leggibile.';
    for (i = 0; i < (db.pagamenti || []).length; i++) {
      var p = db.pagamenti[i];
      if (!p || typeof p.id !== 'string' || !isc[p.iscrizioneId] || typeof p.importo !== 'number') return 'Nel file c\'è un pagamento che non appartiene a nessuna iscrizione.';
    }
    return '';
  }
  /** Fills in whatever an older or hand-edited archive lacks. Returns a new object. */
  function completa(db, today) {
    var base = nuovoArchivio(today), out = clone(db);
    out.schema = SCHEMA;
    out.impostazioni = Object.assign({}, base.impostazioni, out.impostazioni || {});
    out.liste = Object.assign({}, base.liste, out.liste || {});
    if (!Array.isArray(out.tariffario)) out.tariffario = base.tariffario;
    if (!Array.isArray(out.allieve)) out.allieve = [];
    if (!Array.isArray(out.iscrizioni)) out.iscrizioni = [];
    if (!Array.isArray(out.pagamenti)) out.pagamenti = [];
    if (!Array.isArray(out.promemoria)) out.promemoria = [];
    if (!Array.isArray(out.documenti)) out.documenti = [];
    var pr = out.prossimi || {};
    out.prossimi = { allieva: prossimoLibero(out.allieve, pr.allieva), iscrizione: prossimoLibero(out.iscrizioni, pr.iscrizione), pagamento: prossimoLibero(out.pagamenti, pr.pagamento), documento: prossimoLibero(out.documenti, pr.documento) };
    return out;
  }
  function prossimoLibero(list, from) {
    var n = from > 0 ? from : 1;
    list.forEach(function (x) { var k = parseInt(x.id, 10); if (k >= n) n = k + 1; });
    return n;
  }

  /* ---------- lookups ---------- */
  var indici = typeof WeakMap === 'function' ? new WeakMap() : null;
  /** { allieve: {id: student}, iscrizioni: {studentId: [enrollments]}, perId: {enrollmentId: enrollment}, pagamenti: {enrollmentId: [payments]} }, built once per archive object. */
  function indice(db) {
    var ix = indici && indici.get(db);
    var pag = db.pagamenti || [];
    if (ix && ix.na === db.allieve.length && ix.ni === db.iscrizioni.length && ix.np === pag.length) return ix;
    ix = { allieve: {}, iscrizioni: {}, perId: {}, pagamenti: {}, na: db.allieve.length, ni: db.iscrizioni.length, np: pag.length };
    db.allieve.forEach(function (a) { ix.allieve[a.id] = a; });
    db.iscrizioni.forEach(function (e) { ix.perId[e.id] = e; (ix.iscrizioni[e.allievaId] = ix.iscrizioni[e.allievaId] || []).push(e); });
    pag.forEach(function (x) { (ix.pagamenti[x.iscrizioneId] = ix.pagamenti[x.iscrizioneId] || []).push(x); });
    if (indici) indici.set(db, ix);
    return ix;
  }
  function perNome(a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : 0; }

  /* ---------- subscriptions ---------- */
  function mesiTipo(tipo) { for (var i = 0; i < TIPI_NOTI.length; i++) if (TIPI_NOTI[i].nome === tipo) return TIPI_NOTI[i].mesi; return null; }
  function scadenza(e) { var m = mesiTipo(e.tipo); return m && C.isIso(e.inizio) ? C.addMonths(e.inizio, m) : ''; }
  /** { stato, scadenza, giorni }: ANNULLATO, STORICO, DA COMPLETARE, SCADUTO, IN SCADENZA, ATTIVO. giorni = days left (negative if expired). */
  function statoIscrizione(db, e, today) {
    var sc = scadenza(e);
    if (e.annullata) return { stato: 'ANNULLATO', scadenza: sc, giorni: null };
    if (e.storica) return { stato: 'STORICO', scadenza: sc, giorni: null };
    if (!sc) return { stato: 'DA COMPLETARE', scadenza: '', giorni: null };
    var g = C.daysBetween(today, sc);
    return { stato: g < 0 ? 'SCADUTO' : g <= db.impostazioni.preavvisoAbb ? 'IN SCADENZA' : 'ATTIVO', scadenza: sc, giorni: g };
  }
  function corrente(e) { return !e.annullata && !e.storica; }
  /** Agreed fee if there is one, else the price list. null when neither is known. */
  function quotaDovuta(db, e) {
    if (typeof e.quota === 'number') return e.quota;
    return C.quotaTariffario(db.tariffario, e.pacchetto, e.tipo);
  }
  function iscrizioniDi(db, allievaId) { return (indice(db).iscrizioni[allievaId] || []).slice(); }
  function nomeAllieva(db, id) { var a = indice(db).allieve[id]; return a ? a.name : ''; }

  /* ---------- what is due and what was paid ---------- */
  function cent(n) { return Math.round(n * 100) / 100; }
  /** Fee of the period plus the one-off registration fee. null when neither is known. */
  function dovuto(db, e) {
    var q = quotaDovuta(db, e), f = typeof e.quotaIscrizione === 'number' ? e.quotaIscrizione : null;
    return q === null && f === null ? null : cent((q || 0) + (f || 0));
  }
  function pagamentiDi(db, iscrizioneId) { return (indice(db).pagamenti[iscrizioneId] || []).slice().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : a.id < b.id ? -1 : 1; }); }
  /** { dovuto, pagato, residuo, stato }: SALDATO, PARZIALE, DA PAGARE, or SENZA QUOTA when nothing is due yet. residuo is null without a fee. */
  function conto(db, e) {
    var d = dovuto(db, e), p = 0;
    (indice(db).pagamenti[e.id] || []).forEach(function (x) { p += x.importo; });
    p = cent(p);
    var r = d === null ? null : cent(d - p);
    return { dovuto: d, pagato: p, residuo: r, stato: d === null || d === 0 ? 'SENZA QUOTA' : r <= 0.005 ? 'SALDATO' : p > 0 ? 'PARZIALE' : 'DA PAGARE' };
  }
  /** Enrollments that are not cancelled and still have something to pay, by student name: { righe: [{ iscrizione, allieva, conto }], totale }. */
  function daIncassare(db) {
    var ix = indice(db), righe = [], tot = 0;
    db.iscrizioni.forEach(function (e) {
      if (e.annullata) return;
      var c = conto(db, e), a = ix.allieve[e.allievaId];
      if (c.residuo === null || c.residuo <= 0.005 || !a) return;
      righe.push({ k: C.norm(a.name), iscrizione: e, allieva: a, conto: c });
      tot += c.residuo;
    });
    return { righe: righe.sort(perNome), totale: cent(tot) };
  }
  /** Payments between two dates (inclusive, either may be empty), newest first: { righe: [{ pagamento, iscrizione, allieva }], totale, perMetodo }. */
  function incassi(db, f) {
    f = f || {};
    var ix = indice(db), words = C.norm(f.q).split(' ').filter(Boolean), righe = [], tot = 0, per = {}, nv = 0, tv = 0;
    (db.pagamenti || []).forEach(function (p) {
      if ((f.dal && p.data < f.dal) || (f.al && p.data > f.al) || (f.metodo && p.metodo !== f.metodo)) return;
      var e = ix.perId[p.iscrizioneId] || null, a = e ? ix.allieve[e.allievaId] || null : null;
      if (words.length) { var hay = C.norm([a ? a.name : '', e ? e.corso : '', p.ricevuta, p.note].join(' ')); if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return; }
      righe.push({ pagamento: p, iscrizione: e, allieva: a });
      tot += p.importo; per[p.metodo] = cent((per[p.metodo] || 0) + p.importo);
      if (p.daVerificare) { nv++; tv += p.importo; }
    });
    righe.sort(function (x, y) { return x.pagamento.data > y.pagamento.data ? -1 : x.pagamento.data < y.pagamento.data ? 1 : x.pagamento.id > y.pagamento.id ? -1 : 1; });
    return { righe: righe, totale: cent(tot), perMetodo: per, daVerificareN: nv, daVerificareTot: cent(tv) };
  }

  /* ---------- medical certificates ---------- */
  /** { stato: VALIDO | IN SCADENZA | SCADUTO | MANCANTE, giorni, scadenza, ludico }. ludico: the type does not cover sport and has to be checked. */
  function statoCertificato(db, a, today) {
    var s = C.certStatus({ certTipo: a.certTipo || '', certScadenza: a.certScadenza || '' }, today, db.impostazioni.preavvisoCert);
    return { stato: s.stato, giorni: s.giorni, scadenza: s.stato === 'MANCANTE' ? '' : a.certScadenza, ludico: a.certTipo === 'Ludico-motoria' };
  }
  /** Certificates to chase, for students who are not archived and have an open enrollment: { scaduti, inScadenza, mancanti }, each [{ allieva, stato }]. */
  function scadenzeCertificati(db, today) {
    var out = { scaduti: [], inScadenza: [], mancanti: [] }, aperta = {};
    db.iscrizioni.forEach(function (e) { if (corrente(e)) aperta[e.allievaId] = 1; });
    db.allieve.forEach(function (a) {
      if (a.archiviata || !aperta[a.id]) return;
      var s = statoCertificato(db, a, today), item = { k: C.norm(a.name), allieva: a, stato: s };
      if (s.stato === 'SCADUTO') out.scaduti.push(item); else if (s.stato === 'IN SCADENZA') out.inScadenza.push(item); else if (s.stato === 'MANCANTE') out.mancanti.push(item);
    });
    out.scaduti.sort(function (x, y) { return x.stato.giorni - y.stato.giorni; });
    out.inScadenza.sort(function (x, y) { return x.stato.giorni - y.stato.giorni; });
    out.mancanti.sort(perNome);
    return out;
  }
  /* ---------- documenti: i certificati medici scansionati o fotografati. Il file sta nella cartella dei dati, qui c'è solo la scheda che lo descrive. ---------- */
  var RE_DOC = /^doc-[0-9a-f]{16}\.(pdf|jpg|png)$/;
  /** I documenti di un'allieva, i più recenti per primi. */
  function documentiDi(db, allievaId) {
    return (db.documenti || []).filter(function (d) { return d.allievaId === allievaId; }).sort(function (a, b) { return a.creata < b.creata ? 1 : a.creata > b.creata ? -1 : a.id < b.id ? 1 : -1; });
  }
  function controllaDocumento(db, f, today) {
    var oggi = today || C.todayIso(), errors = [], warnings = [], a = byId(db.allieve, f.allievaId), ril = C.parseDate(f.rilascio) || '', scad = C.parseDate(f.scadenza) || '';
    if (!a) errors.push('Allieva non trovata.');
    if (!RE_DOC.test(C.str(f.file))) errors.push('Il file del documento non è valido: caricalo di nuovo.');
    if (CERT_TIPI.indexOf(f.certTipo) < 0) errors.push('Scegli il tipo di certificato: agonistico, non agonistico o ludico-motoria.');
    if (!ril) errors.push('Data di rilascio mancante o non valida.'); else if (ril > oggi) errors.push('La data di rilascio è nel futuro.');
    if (!scad) errors.push('Scadenza mancante o non valida.');
    else if (ril && scad < ril) errors.push('La scadenza è prima della data di rilascio.');
    else if (scad < oggi) warnings.push('Il certificato risulta già scaduto.');
    if (f.certTipo === 'Ludico-motoria') warnings.push('Un certificato per attività ludico-motoria non vale per l\'attività sportiva.');
    return { errors: errors, warnings: warnings, valori: { certTipo: f.certTipo, rilascio: ril, scadenza: scad } };
  }
  /** Aggiunge la scheda di un documento; con aggiornaCertificato anche tipo e date del certificato dell'allieva diventano quelle del documento. Restituisce { db, registro, id }. */
  function salvaDocumento(db, f, adesso, today) {
    var chk = controllaDocumento(db, f, today);
    if (chk.errors.length) throw new Error(chk.errors[0]);
    var out = clone(db), a = byId(out.allieve, f.allievaId), reg = [], v = chk.valori;
    if (!Array.isArray(out.documenti)) out.documenti = [];
    var id = pad4(prossimoLibero(out.documenti, out.prossimi.documento));
    out.prossimi.documento = parseInt(id, 10) + 1;
    out.documenti.push({ id: id, allievaId: a.id, tipo: 'certificato', file: f.file, nome: C.str(f.nome).slice(0, 120), certTipo: v.certTipo, rilascio: v.rilascio, scadenza: v.scadenza, creata: adesso });
    reg.push(riga(a.name, 'Nuovo documento', null, 'Certificato medico ' + v.certTipo + ' · scade il ' + C.isoToIt(v.scadenza) + ' · n. ' + id));
    if (f.aggiornaCertificato) {
      var campi = { certTipo: A_CAMPI.certTipo, certRilascio: A_CAMPI.certRilascio, certScadenza: A_CAMPI.certScadenza };
      var diff = differenze(a, { certTipo: v.certTipo, certRilascio: v.rilascio, certScadenza: v.scadenza }, campi, A_DATE);
      diff.forEach(function (d) { reg.push(riga(a.name, 'Modifica allieva', d)); });
      if (diff.length) { a.certTipo = v.certTipo; a.certRilascio = v.rilascio; a.certScadenza = v.scadenza; a.modificata = adesso; }
    }
    return { db: out, registro: reg, id: id };
  }
  /** Toglie la scheda di un documento. Restituisce anche il nome del file, che la pagina fa togliere dal disco dopo il salvataggio. */
  function eliminaDocumento(db, id) {
    var out = clone(db), d = byId(out.documenti || [], id);
    if (!d) throw new Error('Documento non trovato (n. ' + id + ').');
    out.documenti = out.documenti.filter(function (x) { return x.id !== id; });
    var a = byId(out.allieve, d.allievaId);
    return { db: out, registro: [riga(a ? a.name : '', 'Documento eliminato', null, 'Certificato medico · n. ' + id)], file: d.file };
  }
  /**
   * La pagina "Certificati": per ogni allieva non archiviata (di norma solo con un'iscrizione aperta, con f.tutte anche le altre) il tipo, le date, lo stato e l'ultimo documento.
   * f = { tipo: 'Agonistico' | 'Non Agonistico' | 'Ludico-motoria', stato: 'VALIDO' | 'IN SCADENZA' | 'SCADUTO' | 'MANCANTE' | 'DA RINNOVARE', documento: 'con' | 'senza', q, tutte }.
   * Restituisce { righe: [{ allieva, stato, tipo, documento, iscritta }], conteggi } (i conteggi sono prima dei filtri tipo/stato/documento).
   */
  function elencoCertificati(db, today, f) {
    f = f || {};
    var aperta = {}, ultimo = {}, words = C.norm(f.q).split(' ').filter(Boolean), tutte = [];
    var cn = { totale: 0, agonistico: 0, nonAgonistico: 0, ludico: 0, daRinnovare: 0, mancanti: 0, senzaDocumento: 0 };
    db.iscrizioni.forEach(function (e) { if (corrente(e)) aperta[e.allievaId] = 1; });
    (db.documenti || []).forEach(function (d) { var u = ultimo[d.allievaId]; if (!u || u.creata < d.creata || (u.creata === d.creata && u.id < d.id)) ultimo[d.allievaId] = d; });
    db.allieve.forEach(function (a) {
      if (a.archiviata || (!f.tutte && !aperta[a.id])) return;
      if (words.length) { var hay = C.norm(a.name + ' ' + C.str(a.genitore)); if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return; }
      var s = statoCertificato(db, a, today), r = { allieva: a, stato: s, tipo: a.certTipo || '', documento: ultimo[a.id] || null, iscritta: !!aperta[a.id] };
      cn.totale++;
      if (s.stato === 'MANCANTE') cn.mancanti++;
      else if (a.certTipo === 'Agonistico') cn.agonistico++; else if (a.certTipo === 'Non Agonistico') cn.nonAgonistico++; else if (a.certTipo === 'Ludico-motoria') cn.ludico++;
      if (s.stato === 'SCADUTO' || s.stato === 'IN SCADENZA') cn.daRinnovare++;
      if (!r.documento) cn.senzaDocumento++;
      tutte.push(r);
    });
    var righe = tutte.filter(function (r) {
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.stato === 'DA RINNOVARE' ? !(r.stato.stato === 'SCADUTO' || r.stato.stato === 'IN SCADENZA') : f.stato && r.stato.stato !== f.stato) return false;
      if (f.documento === 'con' && !r.documento) return false;
      if (f.documento === 'senza' && r.documento) return false;
      return true;
    });
    righe.sort(function (x, y) { return C.norm(x.allieva.name) < C.norm(y.allieva.name) ? -1 : 1; });
    return { righe: righe, conteggi: cn };
  }

  /** Il testo da usare per una chiave dei modelli: quello scritto in Impostazioni, o il predefinito (anche al posto del vecchio predefinito). */
  function modelloMessaggio(db, chiave) {
    var m = MODELLI[chiave], t = C.str(db.impostazioni && db.impostazioni[chiave]);
    return !t || t === m.vecchio ? m.testo : t;
  }
  function giorniParole(g) { return g === null || g === undefined ? '' : g === 0 ? 'oggi' : g === 1 ? 'domani' : g === -1 ? 'da ieri' : g < 0 ? 'da ' + (-g) + ' giorni' : 'tra ' + g + ' giorni'; }
  function riempiModello(t, v) {
    return t.replace(/\{(\w+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m; }).replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
  }
  /**
   * Il messaggio per il genitore di una riga di avviso: { tipo: 'abbonamento' | 'certificato', stato: 'SCADUTO' | 'IN SCADENZA' | 'MANCANTE', allieva, iscrizione, corso, scadenza, giorni }.
   * Sceglie il testo giusto per la situazione e riempie i segnaposto. ora = l'ora del giorno (0-23) per "Buongiorno" o "Buonasera" (di solito quella di adesso).
   */
  function testoAvviso(db, r, ora) {
    var a = r.allieva || {}, i = r.iscrizione || null, h = typeof ora === 'number' ? ora : new Date().getHours();
    var chiave = r.tipo === 'abbonamento' ? (r.stato === 'SCADUTO' ? 'messaggioAbbScaduto' : 'messaggioScadenza') : r.stato === 'MANCANTE' ? 'messaggioCertMancante' : r.stato === 'SCADUTO' ? 'messaggioCertScaduto' : 'messaggioCertificato';
    var cn = i ? conto(db, i) : null;
    return riempiModello(modelloMessaggio(db, chiave), {
      saluto: h >= 18 || h < 5 ? 'Buonasera' : 'Buongiorno', nome: C.str(a.name), genitore: C.str(a.genitore), corso: C.str(r.corso), tipo: i ? C.str(i.tipo).toLowerCase() : '',
      scadenza: r.scadenza ? C.isoToIt(r.scadenza) : '', giorni: giorniParole(r.giorni), residuo: cn && cn.residuo > 0.005 ? C.fmtMoney(cn.residuo) : '', palestra: C.str(db.impostazioni.ente) || PALESTRA
    });
  }
  function messaggioCertificato(db, a, stato, ora) {
    return testoAvviso(db, { tipo: 'certificato', stato: stato.stato, allieva: a, iscrizione: null, corso: '', scadenza: stato.scadenza, giorni: stato.giorni }, ora);
  }
  /** Il messaggio di un elemento di scadenze() (abbonamento scaduto o in scadenza). */
  function messaggioScadenza(db, x, ora) {
    return testoAvviso(db, { tipo: 'abbonamento', stato: x.giorni < 0 ? 'SCADUTO' : 'IN SCADENZA', allieva: x.allieva, iscrizione: x.iscrizione, corso: x.iscrizione.corso, scadenza: x.scadenza, giorni: x.giorni }, ora);
  }
  /** Segnaposto scritti in un testo che il programma non conosce (un errore di battitura: resterebbe scritto così nel messaggio). */
  function segnapostoSconosciuti(t) {
    var out = [];
    C.str(t).replace(/\{(\w*)\}/g, function (m, k) { if (SEGNAPOSTO.indexOf(k) < 0 && out.indexOf(m) < 0) out.push(m); return m; });
    return out;
  }

  function riepilogo(db, today) {
    var r = { allieve: 0, archiviate: 0, senzaIscrizione: 0, correnti: 0, attive: 0, inScadenza: 0, scadute: 0, daCompletare: 0 };
    var sc = scadenzeCertificati(db, today), inc = daIncassare(db);
    r.certScaduti = sc.scaduti.length; r.certInScadenza = sc.inScadenza.length; r.certMancanti = sc.mancanti.length;
    r.daIncassare = inc.righe.length; r.totaleDaIncassare = inc.totale;
    var dv = daVerificare(db); r.bonificiDaVerificare = dv.n; r.totaleBonificiDaVerificare = dv.totale;
    var conCorrente = {};
    db.iscrizioni.forEach(function (e) {
      if (!corrente(e)) return;
      r.correnti++; conCorrente[e.allievaId] = 1;
      var s = statoIscrizione(db, e, today).stato;
      if (s === 'ATTIVO') r.attive++; else if (s === 'IN SCADENZA') r.inScadenza++; else if (s === 'SCADUTO') r.scadute++; else r.daCompletare++;
    });
    db.allieve.forEach(function (a) {
      if (a.archiviata) { r.archiviate++; return; }
      r.allieve++;
      if (!conCorrente[a.id]) r.senzaIscrizione++;
    });
    return r;
  }
  /** Expired first (longest ago first), then expiring soon (soonest first). */
  function scadenze(db, today) {
    var out = { scadute: [], inScadenza: [] };
    db.iscrizioni.forEach(function (e) {
      var s = statoIscrizione(db, e, today), item = { iscrizione: e, allieva: indice(db).allieve[e.allievaId] || null, scadenza: s.scadenza, giorni: s.giorni };
      if (s.stato === 'SCADUTO') out.scadute.push(item); else if (s.stato === 'IN SCADENZA') out.inScadenza.push(item);
    });
    out.scadute.sort(function (a, b) { return a.giorni - b.giorni; });
    out.inScadenza.sort(function (a, b) { return a.giorni - b.giorni; });
    return out;
  }

  /* ---------- reminders in bulk ---------- */
  var GIORNI_RICONTATTO = 7; // a person contacted less than this many days ago is not proposed again
  function chiaveProm(tipo, rif, scadenza) { return tipo + '|' + rif + '|' + C.str(scadenza); }
  /** Most recent contact date for each reminder: { key: 'YYYY-MM-DD' }. A reminder is about one deadline, so a renewal starts a new one. */
  function ultimiContatti(db) {
    var m = {};
    (db.promemoria || []).forEach(function (p) { var k = chiaveProm(p.tipo, p.rif, p.scadenza); if (!m[k] || p.quando > m[k]) m[k] = p.quando; });
    return m;
  }
  /** First usable phone number of a student ('' if none): the program never guesses one. */
  function telefonoPromemoria(a) { return C.validPhone(a.tel) ? a.tel : C.validPhone(a.tel2) ? a.tel2 : ''; }
  /**
   * Everyone to remind: subscriptions expired or expiring, certificates expired, expiring or missing (students not archived).
   * f: { tipo: '' | 'abbonamento' | 'certificato', contatto: 'fare' (default) | 'contattate' | 'tutte', corso, q }.
   * { righe, conteggi }: conteggi counts the whole set, before the filters.
   * Each row: { chiave, tipo, rif, allieva, iscrizione, corso, stato, scadenza, giorni, testo, tel, contatto: { stato, quando } }.
   * contatto.stato: 'da contattare', 'contattata' (less than GIORNI_RICONTATTO days ago), 'da ricontattare' (older and still not solved).
   */
  function elencoPromemoria(db, today, f) {
    f = f || {};
    var ix = indice(db), sc = scadenze(db, today), ce = scadenzeCertificati(db, today), ult = ultimiContatti(db), all = [];
    var corsiDi = function (id) { var c = []; (ix.iscrizioni[id] || []).forEach(function (e) { if (corrente(e) && e.corso && c.indexOf(e.corso) < 0) c.push(e.corso); }); return c; };
    function contatto(chiave) {
      var q = ult[chiave];
      if (!q) return { stato: 'da contattare', quando: '' };
      return { stato: C.daysBetween(q, today) < GIORNI_RICONTATTO ? 'contattata' : 'da ricontattare', quando: q };
    }
    sc.scadute.concat(sc.inScadenza).forEach(function (x) {
      if (!x.allieva || x.allieva.archiviata) return;
      var ch = chiaveProm('abbonamento', x.iscrizione.id, x.scadenza);
      all.push({ chiave: ch, tipo: 'abbonamento', rif: x.iscrizione.id, allieva: x.allieva, iscrizione: x.iscrizione, corso: x.iscrizione.corso, corsi: [x.iscrizione.corso], stato: x.giorni < 0 ? 'SCADUTO' : 'IN SCADENZA',
        scadenza: x.scadenza, giorni: x.giorni, tel: telefonoPromemoria(x.allieva), contatto: contatto(ch) });
      all[all.length - 1].testo = testoAvviso(db, all[all.length - 1], f.ora);
    });
    [['SCADUTO', ce.scaduti], ['IN SCADENZA', ce.inScadenza], ['MANCANTE', ce.mancanti]].forEach(function (g) {
      g[1].forEach(function (x) {
        var ch = chiaveProm('certificato', x.allieva.id, x.stato.scadenza), corsi = corsiDi(x.allieva.id);
        all.push({ chiave: ch, tipo: 'certificato', rif: x.allieva.id, allieva: x.allieva, iscrizione: null, corso: corsi.join(', '), corsi: corsi, stato: g[0], scadenza: x.stato.scadenza || '', giorni: x.stato.giorni,
          tel: telefonoPromemoria(x.allieva), contatto: contatto(ch) });
        all[all.length - 1].testo = testoAvviso(db, all[all.length - 1], f.ora);
      });
    });
    var conteggi = { totale: all.length, abbonamenti: 0, certificati: 0, daFare: 0, contattate: 0, senzaTelefono: 0 };
    all.forEach(function (r) {
      if (r.tipo === 'abbonamento') conteggi.abbonamenti++; else conteggi.certificati++;
      if (r.contatto.stato === 'contattata') conteggi.contattate++; else conteggi.daFare++;
      if (!r.tel) conteggi.senzaTelefono++;
    });
    var words = C.norm(f.q).split(' ').filter(Boolean), modo = f.contatto || 'fare';
    var righe = all.filter(function (r) {
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.corso && r.corsi.indexOf(f.corso) < 0) return false;
      if (modo === 'fare' ? r.contatto.stato === 'contattata' : modo === 'contattate' ? r.contatto.stato !== 'contattata' : false) return false;
      if (words.length) { var hay = C.norm(r.allieva.name + ' ' + C.str(r.allieva.genitore) + ' ' + r.corso); if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return false; }
      return true;
    });
    var rc = { 'da contattare': 0, 'da ricontattare': 1, 'contattata': 2 }, rs = { 'SCADUTO': 0, 'MANCANTE': 1, 'IN SCADENZA': 2 };
    righe.sort(function (a, b) {
      return (rc[a.contatto.stato] - rc[b.contatto.stato]) || (rs[a.stato] - rs[b.stato]) || ((a.giorni === null ? 0 : a.giorni) - (b.giorni === null ? 0 : b.giorni)) || (C.norm(a.allieva.name) < C.norm(b.allieva.name) ? -1 : 1);
    });
    return { righe: righe, conteggi: conteggi };
  }
  /**
   * Notes that a person was contacted about one deadline (on: true) or takes the note back (on: false).
   * The program cannot know whether a message was sent: it records what the person says. o: { tipo, rif, scadenza, on }.
   */
  function segnaPromemoria(db, o, adesso, today) {
    if (o.tipo !== 'abbonamento' && o.tipo !== 'certificato') throw new Error('Tipo di promemoria non valido.');
    var out = clone(db), ix = indice(db), e = o.tipo === 'abbonamento' ? ix.perId[o.rif] : null, a = o.tipo === 'abbonamento' ? (e ? ix.allieve[e.allievaId] : null) : ix.allieve[o.rif];
    if (!a) throw new Error('Allieva non trovata.');
    var k = chiaveProm(o.tipo, o.rif, o.scadenza), campo = 'Promemoria ' + o.tipo, nota = e ? etichettaIscrizione(e) : '', reg = [];
    var taglio = C.addMonths(today, -14);
    out.promemoria = (out.promemoria || []).filter(function (p) { return p.quando >= taglio; }); // old notes are not kept for ever
    var gia = out.promemoria.filter(function (p) { return chiaveProm(p.tipo, p.rif, p.scadenza) === k; });
    if (o.on) {
      if (gia.some(function (p) { return p.quando === today; })) return { db: db, registro: [] }; // nothing to note
      out.promemoria.push({ tipo: o.tipo, rif: o.rif, scadenza: C.str(o.scadenza), quando: today, creato: adesso });
      reg.push(riga(a.name, 'Promemoria', { campo: campo, prima: gia.length ? 'Contattata il ' + C.isoToIt(gia[gia.length - 1].quando) : '', dopo: 'Contattata il ' + C.isoToIt(today) }, nota));
    } else if (gia.length) {
      var ultimo = gia.reduce(function (m, p) { return p.quando > m ? p.quando : m; }, '');
      out.promemoria = out.promemoria.filter(function (p) { return chiaveProm(p.tipo, p.rif, p.scadenza) !== k; });
      reg.push(riga(a.name, 'Promemoria', { campo: campo, prima: 'Contattata il ' + C.isoToIt(ultimo), dopo: '' }, nota));
    }
    if (!reg.length) return { db: db, registro: [] }; // nothing changed: the archive is not touched, not even to drop old notes
    return { db: out, registro: reg };
  }

  /* ---------- searching ---------- */
  function cercaAllieve(db, q, filtro) {
    var words = C.norm(q).split(' ').filter(Boolean), conCorrente = {};
    db.iscrizioni.forEach(function (e) { if (corrente(e)) conCorrente[e.allievaId] = 1; });
    var hits = [];
    db.allieve.forEach(function (a) {
      if (filtro === 'archiviate') { if (!a.archiviata) return; }
      else if (a.archiviata) return;
      if (filtro === 'con' && !conCorrente[a.id]) return;
      if (filtro === 'senza' && conCorrente[a.id]) return;
      if (words.length) {
        var hay = C.norm([a.name, a.genitore, a.tel, a.tel2, a.cf, a.email, a.citta, a.id].join(' '));
        if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return;
      }
      hits.push({ k: C.norm(a.name), a: a });
    });
    return hits.sort(perNome).map(function (x) { return x.a; });
  }

  /* ---------- class lists, families, reminders ---------- */
  /** Open enrollments of students who are not archived. filtro: { corso, giorno }. Sorted by name. */
  function iscritte(db, filtro, today) {
    filtro = filtro || {};
    var ix = indice(db), out = [];
    db.iscrizioni.forEach(function (e) {
      if (!corrente(e)) return;
      if (filtro.corso && e.corso !== filtro.corso) return;
      if (filtro.giorno && e.giorni.indexOf(filtro.giorno) < 0) return;
      var a = ix.allieve[e.allievaId];
      if (!a || a.archiviata) return;
      out.push({ k: C.norm(a.name), iscrizione: e, allieva: a, stato: statoIscrizione(db, e, today) });
    });
    return out.sort(perNome);
  }
  /** [{ corso, iscritte }] in the order of the course list; courses used but not listed come last. */
  function corsiRiepilogo(db) {
    var n = {}, ordine = db.liste.corsi.slice();
    iscritte(db, null, C.todayIso()).forEach(function (x) { var c = x.iscrizione.corso || ''; n[c] = (n[c] || 0) + 1; if (ordine.indexOf(c) < 0) ordine.push(c); });
    return ordine.map(function (c) { return { corso: c, iscritte: n[c] || 0 }; });
  }
  /** Other students of the same family: same phone number, same parent tax code, or same parent full name. */
  function famiglia(db, id) {
    var a = byId(db.allieve, id);
    if (!a) return [];
    var tels = [a.tel, a.tel2].filter(Boolean), gen = C.tokenKey(a.genitore);
    if (gen.split(' ').length < 2) gen = '';
    return db.allieve.filter(function (b) {
      if (b.id === id) return false;
      return tels.indexOf(b.tel) >= 0 || tels.indexOf(b.tel2) >= 0 || (a.cfGenitore && b.cfGenitore === a.cfGenitore) || (gen && C.tokenKey(b.genitore) === gen);
    });
  }
  /**
   * I rinnovi dei prossimi mesi (le rette trimestrali di norma a dicembre e a marzo): per ogni mese, a partire da quello di oggi, quanti abbonamenti scadono e quanto si prevede di incassare
   * (la quota del periodo, dalla quota concordata o dal tariffario). "arretrati" sono gli abbonamenti già scaduti e non rinnovati.
   * Restituisce { arretrati: { n, euro, righe }, mesi: [{ chiave: 'AAAA-MM', l: 'dic 2026', n, euro, perTipo: { Mensile, Trimestrale, Annuale }, righe: [{ allieva, iscrizione, scadenza, euro }] }], totale: { n, euro } }.
   */
  var MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function previsioneRinnovi(db, today, mesi) {
    var n = mesi > 0 ? mesi : 12, ix = indice(db), ty = +today.slice(0, 4), tm = +today.slice(5, 7) - 1, out = { arretrati: { n: 0, euro: 0, righe: [] }, mesi: [], totale: { n: 0, euro: 0 } }, i;
    for (i = 0; i < n; i++) {
      var y = ty + Math.floor((tm + i) / 12), m = (tm + i) % 12;
      out.mesi.push({ chiave: y + '-' + (m < 9 ? '0' : '') + (m + 1), l: MESI_BREVI[m] + ' ' + y, n: 0, euro: 0, perTipo: { Mensile: 0, Trimestrale: 0, Annuale: 0 }, righe: [] });
    }
    db.iscrizioni.forEach(function (e) {
      if (!corrente(e)) return;
      var a = ix.allieve[e.allievaId], sc = scadenza(e);
      if (!a || a.archiviata || !sc) return;
      var euro = quotaDovuta(db, e) || 0, riga = { allieva: a, iscrizione: e, scadenza: sc, euro: euro }, bucket;
      if (sc < today) bucket = out.arretrati;
      else { var d = (+sc.slice(0, 4)) * 12 + (+sc.slice(5, 7) - 1) - (ty * 12 + tm); if (d < 0 || d >= n) return; bucket = out.mesi[d]; if (bucket.perTipo[e.tipo] !== undefined) bucket.perTipo[e.tipo]++; }
      bucket.n++; bucket.euro = cent(bucket.euro + euro); bucket.righe.push(riga);
      out.totale.n++; out.totale.euro = cent(out.totale.euro + euro);
    });
    var perData = function (x, y) { return x.scadenza < y.scadenza ? -1 : x.scadenza > y.scadenza ? 1 : C.norm(x.allieva.name) < C.norm(y.allieva.name) ? -1 : 1; };
    out.arretrati.righe.sort(perData); out.mesi.forEach(function (x) { x.righe.sort(perData); });
    return out;
  }
  /** { serve, giorni }: there is data and no safety copy was downloaded in the last 30 days (giorni null = never). */
  function promemoriaCopia(db, today, seconda) {
    if (!db.allieve.length) return { serve: false, giorni: null };
    var u = db.impostazioni.ultimaCopia, s = seconda && seconda.cartella ? C.str(seconda.ultima).slice(0, 10) : '';
    if (C.isIso(s) && (!C.isIso(u) || s > u)) u = s; // a copy in the second folder is a safety copy too
    if (!C.isIso(u)) return { serve: true, giorni: null };
    var g = C.daysBetween(u, today);
    return { serve: g > GIORNI_COPIA, giorni: g };
  }
  function segnaCopia(db, today) {
    var out = clone(db);
    out.impostazioni.ultimaCopia = today;
    return { db: out, registro: [riga('', 'Copia di sicurezza scaricata')] };
  }

  /* ---------- students ---------- */
  function pulisciAllieva(f) {
    var o = {};
    Object.keys(A_CAMPI).forEach(function (k) { o[k] = C.str(f[k]); });
    o.name = C.titleCase(o.name);
    o.genitore = C.titleCase(o.genitore);
    o.luogo = C.titleCasePlace(o.luogo); o.indirizzo = C.titleCasePlace(o.indirizzo); o.citta = C.titleCasePlace(o.citta);
    o.cf = C.cfNormalize(o.cf); o.cfGenitore = C.cfNormalize(o.cfGenitore);
    if (o.tel) o.tel = C.cleanPhone(o.tel) || o.tel;
    if (o.tel2) o.tel2 = C.cleanPhone(o.tel2) || o.tel2;
    o.email = o.email.toLowerCase().replace(/\s+/g, '');
    o.nascita = C.parseDate(o.nascita) || o.nascita;
    o.dataModulo = C.parseDate(o.dataModulo) || o.dataModulo;
    if (o.privacy !== 'Sì' && o.privacy !== 'No') o.privacy = '';
    if (o.liberatoria !== 'Sì' && o.liberatoria !== 'No') o.liberatoria = '';
    if (CERT_TIPI.indexOf(o.certTipo) < 0) o.certTipo = ''; // the sheet writes "Mancante" for none
    o.certRilascio = C.parseDate(o.certRilascio) || o.certRilascio;
    o.certScadenza = C.parseDate(o.certScadenza) || o.certScadenza;
    return o;
  }
  function stessoCertificato(a, b) { return C.str(a.certTipo) === C.str(b.certTipo) && C.str(a.certRilascio) === C.str(b.certRilascio) && C.str(a.certScadenza) === C.str(b.certScadenza); }
  /** Errors stop the save, warnings do not. id = the student being edited (null for a new one). */
  /**
   * A problem in data that was already in the archive (typically a tax code with a wrong check character, brought in by the import) must not stop
   * an unrelated change such as a new phone number: it is shown as a warning. A problem in a field that is being changed stays an error.
   */
  var CAMPI_ERRORE = [[/^Manca cognome e nome|^Cognome e nome/, ['name']], [/^Data di nascita/, ['nascita']], [/^Codice fiscale atleta/, ['cf', 'name', 'nascita']], [/^Codice fiscale genitore/, ['cfGenitore', 'genitore']],
    [/^Telefono non valido/, ['tel']], [/^Secondo telefono/, ['tel2']], [/^Email non valida/, ['email']], [/^CAP non valido/, ['cap']], [/^Data del modulo/, ['dataModulo']], [/^Scadenza del certificato/, ['certScadenza']]];
  function declassaErroriPreesistenti(r, o, cur) {
    var restano = [];
    r.errors.forEach(function (e) {
      var campi = null;
      CAMPI_ERRORE.forEach(function (x) { if (!campi && x[0].test(e)) campi = x[1]; });
      var invariati = campi && campi.every(function (k) { return C.str(o[k]) === C.str(cur[k]); });
      if (invariati) r.warnings.push('Già così nell\'archivio, da correggere appena puoi: ' + e); else restano.push(e);
    });
    r.errors = restano;
  }
  function controllaAllieva(db, f, id, today) {
    var o = pulisciAllieva(f), r = C.checkModulo(o, today || C.todayIso());
    var altre = db.allieve.filter(function (a) { return a.id !== id; });
    var m = C.matchStudent(altre, o.name);
    if (m.exact) r.warnings.push('Esiste già un\'allieva con lo stesso nome: ' + m.exact.name + ' (n. ' + m.exact.id + (m.exact.nascita ? ', nata il ' + C.isoToIt(m.exact.nascita) : '') + '). Salva solo se è un\'altra persona.');
    else m.candidates.filter(function (c) { return c.score >= 0.9; }).forEach(function (c) { r.warnings.push('Nome molto simile a un\'allieva già presente: ' + c.student.name + ' (n. ' + c.student.id + ').'); });
    if (o.cf) altre.forEach(function (a) { if (a.cf && a.cf === o.cf) r.errors.push('Questo codice fiscale è già di ' + a.name + ' (n. ' + a.id + ').'); });
    // The certificate is checked when it is entered or changed, not at every other edit: imported ones may lack the issue date.
    var cur = id ? byId(db.allieve, id) : null;
    if (cur) declassaErroriPreesistenti(r, o, cur);
    if ((o.certTipo || o.certRilascio || o.certScadenza) && !(cur && stessoCertificato(cur, o))) {
      var ludico = o.certTipo === 'Ludico-motoria';
      var ck = C.checkCertificato({ certTipo: ludico ? 'Non Agonistico' : o.certTipo, originale: ludico ? 'ludico_motoria' : '', certRilascio: o.certRilascio, certScadenza: o.certScadenza },
        { name: o.name, nascita: o.nascita, certScadenza: cur ? cur.certScadenza : '' }, today || C.todayIso());
      ck.errors.forEach(function (e) { r.errors.push('Certificato: ' + e.replace('Scegli il tipo: Agonistico o Non Agonistico.', 'scegli il tipo.')); });
      ck.warnings.forEach(function (w) { r.warnings.push('Certificato: ' + w.replace('Nel foglio', 'Nell\'archivio')); });
    }
    return { errors: r.errors, warnings: r.warnings, valori: o };
  }
  function mostra(k, v, date) {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.join(', ');
    if (v === true) return 'Sì';
    if (v === false) return 'No';
    if (date && date[k]) return C.isoToIt(v) || String(v);
    if (k === 'quota' || k === 'quotaIscrizione' || k === 'importo') return C.fmtMoney(v);
    return String(v);
  }
  function differenze(prima, dopo, campi, date) {
    var out = [];
    Object.keys(campi).forEach(function (k) {
      var a = mostra(k, prima ? prima[k] : '', date), b = mostra(k, dopo[k], date);
      if (a !== b) out.push({ campo: campi[k], prima: a, dopo: b });
    });
    return out;
  }
  function riga(allieva, operazione, d, nota) { return { allieva: allieva, operazione: operazione, campo: d ? d.campo : '', prima: d ? d.prima : '', dopo: d ? d.dopo : '', nota: nota || '' }; }

  /** Adds (id null) or updates a student. Returns { db, registro, id }: a new archive, the old one is untouched. */
  function salvaAllieva(db, id, f, adesso) {
    var out = clone(db), o = pulisciAllieva(f), reg = [];
    if (id === null || id === undefined) {
      id = pad4(prossimoLibero(out.allieve, out.prossimi.allieva));
      out.prossimi.allieva = parseInt(id, 10) + 1;
      out.allieve.push(Object.assign({ id: id }, o, { archiviata: false, creata: adesso, modificata: adesso }));
      reg.push(riga(o.name, 'Nuova allieva', null, 'n. ' + id));
      differenze(null, o, A_CAMPI, A_DATE).forEach(function (d) { if (d.campo !== A_CAMPI.name) reg.push(riga(o.name, 'Nuova allieva', d)); });
    } else {
      var cur = byId(out.allieve, id);
      if (!cur) throw new Error('Allieva non trovata (n. ' + id + ').');
      var diff = differenze(cur, o, A_CAMPI, A_DATE);
      diff.forEach(function (d) { reg.push(riga(o.name, 'Modifica allieva', d)); });
      if (diff.length) { Object.assign(cur, o); cur.modificata = adesso; }
    }
    return { db: out, registro: reg, id: id };
  }
  function archiviaAllieva(db, id, archiviata, adesso) {
    var out = clone(db), cur = byId(out.allieve, id);
    if (!cur) throw new Error('Allieva non trovata (n. ' + id + ').');
    cur.archiviata = !!archiviata; cur.modificata = adesso;
    return { db: out, registro: [riga(cur.name, archiviata ? 'Allieva archiviata' : 'Allieva ripristinata')] };
  }
  /** A student with enrollments cannot be deleted: archive her instead. */
  function eliminaAllieva(db, id) {
    var out = clone(db), cur = byId(out.allieve, id);
    if (!cur) throw new Error('Allieva non trovata (n. ' + id + ').');
    if (iscrizioniDi(db, id).length) throw new Error('Questa allieva ha delle iscrizioni: non si può eliminare. Puoi archiviarla.');
    out.allieve = out.allieve.filter(function (a) { return a.id !== id; });
    var file = (out.documenti || []).filter(function (d) { return d.allievaId === id; }).map(function (d) { return d.file; });
    if (out.documenti) out.documenti = out.documenti.filter(function (d) { return d.allievaId !== id; });
    return { db: out, registro: [riga(cur.name, 'Allieva eliminata', null, 'n. ' + id)], file: file };
  }

  /* ---------- enrollments ---------- */
  function ordinaGiorni(list) {
    var g = (Array.isArray(list) ? list : C.str(list).split(/[,;\/\s]+/)).map(function (d) { return C.titleCase(C.str(d)).slice(0, 3); });
    return GIORNI.filter(function (d) { return g.indexOf(d) >= 0; });
  }
  function pulisciIscrizione(f) {
    function soldi(v) { return v === '' || v === null || v === undefined ? null : C.parseMoney(v); }
    return {
      corso: C.str(f.corso), giorni: ordinaGiorni(f.giorni), fascia: C.str(f.fascia), pacchetto: C.str(f.pacchetto), tipo: mesiTipo(C.str(f.tipo)) ? C.str(f.tipo) : '',
      inizio: C.parseDate(f.inizio) || C.str(f.inizio), quota: soldi(f.quota), quotaIscrizione: soldi(f.quotaIscrizione), annullata: f.annullata === true, storica: f.storica === true, note: C.str(f.note)
    };
  }
  function controllaIscrizione(db, f, id) {
    var o = pulisciIscrizione(f), r = C.checkIscrizione(Object.assign({}, o, { quota: f.quota === '' || f.quota === null || f.quota === undefined ? '' : (o.quota === null ? 'x' : o.quota) }));
    if (!byId(db.allieve, f.allievaId)) r.errors.unshift('Scegli l\'allieva.');
    var fee = C.str(f.quotaIscrizione);
    if (fee !== '' && (o.quotaIscrizione === null || o.quotaIscrizione < 0)) r.errors.push('Iscrizione e tesseramento: importo non valido.');
    if (o.pacchetto && !db.tariffario.some(function (p) { return p.chiave === o.pacchetto; })) r.warnings.push('La tariffa "' + o.pacchetto + '" non è nel tariffario: la quota va scritta a mano.');
    if (o.tipo && o.pacchetto && typeof o.quota !== 'number' && C.quotaTariffario(db.tariffario, o.pacchetto, o.tipo) === null && db.tariffario.some(function (p) { return p.chiave === o.pacchetto; })) {
      r.warnings.push('Il tariffario non ha un prezzo per l\'abbonamento ' + o.tipo + ' di questa tariffa: scrivi la quota concordata.');
    }
    if (corrente(o)) {
      db.iscrizioni.forEach(function (e) {
        if (e.id !== id && e.allievaId === f.allievaId && corrente(e) && C.norm(e.corso) === C.norm(o.corso) && o.corso) r.warnings.push('Questa allieva ha già un\'iscrizione aperta al corso ' + e.corso + ' (n. ' + e.id + '). Per proseguire un abbonamento usa "Rinnova".');
      });
    }
    return { errors: r.errors, warnings: r.warnings, valori: o };
  }
  function etichettaIscrizione(e) { return 'Iscrizione n. ' + e.id + (e.corso ? ' · ' + e.corso : ''); }
  function salvaIscrizione(db, id, f, adesso) {
    var out = clone(db), o = pulisciIscrizione(f), reg = [];
    if (id === null || id === undefined) {
      var al = byId(out.allieve, f.allievaId);
      if (!al) throw new Error('Allieva non trovata.');
      id = pad4(prossimoLibero(out.iscrizioni, out.prossimi.iscrizione));
      out.prossimi.iscrizione = parseInt(id, 10) + 1;
      var nuova = Object.assign({ id: id, allievaId: al.id }, o, { creata: adesso, modificata: adesso });
      out.iscrizioni.push(nuova);
      reg.push(riga(al.name, 'Nuova iscrizione', null, etichettaIscrizione(nuova)));
      differenze(null, o, I_CAMPI, { inizio: 1 }).forEach(function (d) { reg.push(riga(al.name, 'Nuova iscrizione', d, 'n. ' + id)); });
    } else {
      var cur = byId(out.iscrizioni, id);
      if (!cur) throw new Error('Iscrizione non trovata (n. ' + id + ').');
      var diff = differenze(cur, o, I_CAMPI, { inizio: 1 });
      diff.forEach(function (d) { reg.push(riga(nomeAllieva(out, cur.allievaId), 'Modifica iscrizione', d, etichettaIscrizione(cur))); });
      if (diff.length) { Object.assign(cur, o); cur.modificata = adesso; }
    }
    return { db: out, registro: reg, id: id };
  }
  /**
   * Una sola operazione per "Nuova iscrizione": la nuova allieva (fA, o null se fI.allievaId è già un'allieva presente) e la sua iscrizione (fI).
   * Se per una nuova allieva non è stato scritto niente dell'iscrizione (corso, giorni, abbonamento...) si salva solo l'allieva.
   */
  function serveIscrizione(fI) {
    return C.str(fI.corso) !== '' || (fI.giorni || []).length > 0 || C.str(fI.tipo) !== '' || C.str(fI.fascia) !== '' || C.str(fI.note) !== '' || C.str(fI.quota) !== '';
  }
  function controllaNuovaIscrizione(db, fA, fI, today) {
    var errors = [], warnings = [], conIscrizione = !fA || serveIscrizione(fI), valori = null;
    if (fA) { var ca = controllaAllieva(db, fA, null, today); errors = ca.errors.slice(); warnings = ca.warnings.slice(); }
    if (conIscrizione) {
      var db2 = db, f2 = fI;
      if (fA) { // the student does not exist yet: a stand-in lets the enrollment be checked
        db2 = Object.assign({}, db, { allieve: db.allieve.concat([{ id: '__nuova', name: C.str(fA.name) }]) });
        f2 = Object.assign({}, fI, { allievaId: '__nuova' });
      }
      var ci = controllaIscrizione(db2, f2, null);
      errors = errors.concat(ci.errors); warnings = warnings.concat(ci.warnings); valori = ci.valori;
    }
    return { errors: errors, warnings: warnings, conIscrizione: conIscrizione, valori: valori };
  }
  function salvaNuovaIscrizione(db, fA, fI, adesso) {
    var cur = db, registro = [], idAllieva = fI.allievaId, idIscrizione = null;
    if (fA) { var r1 = salvaAllieva(cur, null, fA, adesso); cur = r1.db; idAllieva = r1.id; registro = registro.concat(r1.registro); }
    if (!fA || serveIscrizione(fI)) {
      var r2 = salvaIscrizione(cur, null, Object.assign({}, fI, { allievaId: idAllieva }), adesso);
      cur = r2.db; idIscrizione = r2.id; registro = registro.concat(r2.registro);
    }
    return { db: cur, registro: registro, idAllieva: idAllieva, id: idIscrizione };
  }
  /** Closes an enrollment and opens the next period with the same data, starting where the old one ends. */
  function rinnova(db, id, adesso, today) {
    var out = clone(db), cur = byId(out.iscrizioni, id);
    if (!cur) throw new Error('Iscrizione non trovata (n. ' + id + ').');
    if (!corrente(cur)) throw new Error('Questa iscrizione è già chiusa o annullata.');
    var nid = pad4(prossimoLibero(out.iscrizioni, out.prossimi.iscrizione));
    out.prossimi.iscrizione = parseInt(nid, 10) + 1;
    var inizio = scadenza(cur) || today || C.todayIso();
    var nuova = { id: nid, allievaId: cur.allievaId, corso: cur.corso, giorni: cur.giorni.slice(), fascia: cur.fascia, pacchetto: cur.pacchetto, tipo: cur.tipo, inizio: inizio,
      quota: cur.quota, quotaIscrizione: null, annullata: false, storica: false, note: '', creata: adesso, modificata: adesso };
    cur.storica = true; cur.modificata = adesso;
    out.iscrizioni.push(nuova);
    var nome = nomeAllieva(out, cur.allievaId);
    return { db: out, id: nid, registro: [
      riga(nome, 'Rinnovo', { campo: I_CAMPI.storica, prima: 'No', dopo: 'Sì' }, etichettaIscrizione(cur)),
      riga(nome, 'Rinnovo', { campo: I_CAMPI.inizio, prima: '', dopo: C.isoToIt(inizio) }, etichettaIscrizione(nuova) + (nuova.tipo ? ' · ' + nuova.tipo : ''))
    ] };
  }
  function eliminaIscrizione(db, id) {
    var out = clone(db), cur = byId(out.iscrizioni, id);
    if (!cur) throw new Error('Iscrizione non trovata (n. ' + id + ').');
    if (pagamentiDi(db, id).length) throw new Error('Questa iscrizione ha dei pagamenti registrati: non si può eliminare. Segnala come annullata, oppure elimina prima i pagamenti.');
    out.iscrizioni = out.iscrizioni.filter(function (e) { return e.id !== id; });
    return { db: out, registro: [riga(nomeAllieva(out, cur.allievaId), 'Iscrizione eliminata', null, etichettaIscrizione(cur))] };
  }

  /* ---------- new season ---------- */
  /** '2026/2027' -> '2027/2028'; '' if the text is not a season. */
  function stagioneSuccessiva(s) { var m = /^(\d{4})\/(\d{4})$/.exec(C.str(s)); return m ? (+m[1] + 1) + '/' + (+m[2] + 1) : ''; }
  /** First of September of the season's first year. */
  function inizioStagione(s) { var m = /^(\d{4})\/\d{4}$/.exec(C.str(s)); return m ? m[1] + '-09-01' : ''; }
  var SCELTE_STAGIONE = { rinnova: 1, chiudi: 1, lascia: 1 };
  var GIORNI_ABBANDONO = 180; // an enrollment expired for longer than this is proposed for closing, not for renewal
  /** True when the student already has an open enrollment of the same course starting on or after the new start. */
  function giaPresente(db, e, inizio) {
    return (indice(db).iscrizioni[e.allievaId] || []).some(function (x) { return x.id !== e.id && corrente(x) && C.norm(x.corso) === C.norm(e.corso) && C.isIso(x.inizio) && x.inizio >= inizio; });
  }
  /** The open enrollments with what the program proposes for each: { righe: [{ iscrizione, allieva, stato, conto, scelta, motivo }], ... }. Nothing is decided: the person changes every choice. */
  function pianoStagione(db, today, inizio) {
    var ix = indice(db), righe = [];
    db.iscrizioni.forEach(function (e) {
      if (!corrente(e)) return;
      var a = ix.allieve[e.allievaId];
      if (!a) return;
      var st = statoIscrizione(db, e, today), scelta = 'rinnova', motivo = '';
      if (giaPresente(db, e, inizio)) { scelta = 'lascia'; motivo = 'Ha già un periodo aperto dello stesso corso dal ' + C.isoToIt(inizio) + ' o dopo.'; }
      else if (a.archiviata) { scelta = 'lascia'; motivo = 'L\'allieva è archiviata.'; }
      else if (st.stato === 'DA COMPLETARE') { scelta = 'lascia'; motivo = 'Manca il tipo di abbonamento o la data di inizio: completala prima.'; }
      else if (st.stato === 'SCADUTO' && st.giorni < -GIORNI_ABBANDONO) { scelta = 'chiudi'; motivo = 'Scaduta da più di ' + GIORNI_ABBANDONO + ' giorni: forse non frequenta più.'; }
      righe.push({ k: C.norm(a.name), iscrizione: e, allieva: a, stato: st, conto: conto(db, e), scelta: scelta, motivo: motivo });
    });
    return { righe: righe.sort(perNome) };
  }
  /**
   * o: { stagione, inizio, scelte: { enrollmentId: 'rinnova' | 'chiudi' | 'lascia' }, quotaIscrizione: bool, mantieniQuote: bool }.
   * { errors, warnings }: errors stop the operation.
   */
  function controllaStagione(db, o, today) {
    var err = [], warn = [], n = { rinnova: 0, chiudi: 0 }, dup = 0;
    var s = /^(\d{4})\/(\d{4})$/.exec(C.str(o.stagione));
    if (!s || +s[2] !== +s[1] + 1) err.push('Stagione: scrivila come 2027/2028 (due anni di seguito).');
    if (!C.isIso(o.inizio)) err.push('Scrivi la data da cui partono i nuovi periodi (gg/mm/aaaa).');
    else if (s && (o.inizio < s[1] + '-08-01' || o.inizio > s[2] + '-07-31')) warn.push('La data di inizio cade fuori dalla stagione ' + o.stagione + ' (da agosto a luglio).');
    if (s && C.str(o.stagione) === db.impostazioni.stagione) warn.push('La stagione ' + o.stagione + ' è già quella impostata: si rinnovano comunque le iscrizioni che hai scelto.');
    var ix = indice(db);
    Object.keys(o.scelte || {}).forEach(function (id) {
      var sc = o.scelte[id];
      if (!SCELTE_STAGIONE[sc]) { err.push('Scelta non valida per l\'iscrizione n. ' + id + '.'); return; }
      if (sc === 'lascia') return;
      var e = ix.perId[id];
      if (!e || !corrente(e)) { err.push('L\'iscrizione n. ' + id + ' non è più aperta: ricarica la pagina.'); return; }
      n[sc]++;
      if (sc === 'rinnova' && C.isIso(o.inizio) && giaPresente(db, e, o.inizio)) dup++;
    });
    if (dup) warn.push(dup === 1 ? 'Una iscrizione scelta per il rinnovo ha già un periodo aperto dello stesso corso: ne avrà due.' : dup + ' iscrizioni scelte per il rinnovo hanno già un periodo aperto dello stesso corso: ne avranno due.');
    if (!n.rinnova && !n.chiudi && !err.length && s && C.str(o.stagione) === db.impostazioni.stagione) err.push('Non hai scelto nessuna iscrizione da rinnovare o chiudere, e la stagione è la stessa: non c\'è nulla da fare.');
    return { errors: err, warnings: warn };
  }
  /**
   * The whole change in one go: renews the chosen enrollments from the new start, closes the ones that stop, sets the season.
   * Returns { db, registro, riepilogo: { rinnovate, chiuse, lasciate, nuovoDovuto, senzaQuota, residuoVecchie } } without touching `db`.
   */
  function nuovaStagione(db, o, adesso, today) {
    var chk = controllaStagione(db, o, today);
    if (chk.errors.length) throw new Error(chk.errors[0]);
    var out = clone(db), reg = [], ix = indice(db), rin = 0, chi = 0, las = 0, senza = 0, nuovoDov = 0, residuo = 0;
    var prima = db.impostazioni.stagione;
    out.iscrizioni.slice().forEach(function (cur) {
      if (!corrente(cur)) return;
      var sc = (o.scelte || {})[cur.id] || 'lascia', al = ix.allieve[cur.allievaId], nome = al ? al.name : '';
      if (sc === 'lascia') { las++; return; }
      var c = conto(db, cur);
      if (c.residuo !== null && c.residuo > 0.005) residuo = cent(residuo + c.residuo);
      cur.storica = true; cur.modificata = adesso;
      if (sc === 'chiudi') {
        chi++;
        reg.push(riga(nome, 'Nuova stagione', { campo: I_CAMPI.storica, prima: 'No', dopo: 'Sì' }, etichettaIscrizione(cur) + ' · chiusa, non rinnovata'));
        return;
      }
      var nid = pad4(prossimoLibero(out.iscrizioni, out.prossimi.iscrizione));
      out.prossimi.iscrizione = parseInt(nid, 10) + 1;
      var tar = out.tariffario.filter(function (p) { return p.chiave === cur.pacchetto; })[0];
      var nuova = { id: nid, allievaId: cur.allievaId, corso: cur.corso, giorni: cur.giorni.slice(), fascia: cur.fascia, pacchetto: cur.pacchetto, tipo: cur.tipo, inizio: o.inizio,
        quota: o.mantieniQuote !== false && typeof cur.quota === 'number' ? cur.quota : null,
        quotaIscrizione: o.quotaIscrizione === true && tar && tar.iscrizione ? tar.iscrizione : null,
        annullata: false, storica: false, note: '', creata: adesso, modificata: adesso };
      out.iscrizioni.push(nuova);
      rin++;
      var d = dovuto(out, nuova);
      if (d === null || d === 0) senza++; else nuovoDov = cent(nuovoDov + d);
      reg.push(riga(nome, 'Nuova stagione', { campo: I_CAMPI.storica, prima: 'No', dopo: 'Sì' }, etichettaIscrizione(cur)));
      reg.push(riga(nome, 'Nuova stagione', { campo: I_CAMPI.inizio, prima: '', dopo: C.isoToIt(o.inizio) }, etichettaIscrizione(nuova) + (nuova.tipo ? ' · ' + nuova.tipo : '')));
    });
    if (prima !== o.stagione) { out.impostazioni.stagione = o.stagione; reg.push(riga('', 'Nuova stagione', { campo: 'Stagione', prima: prima, dopo: o.stagione })); }
    return { db: out, registro: reg, riepilogo: { rinnovate: rin, chiuse: chi, lasciate: las, nuovoDovuto: nuovoDov, senzaQuota: senza, residuoVecchie: residuo } };
  }

  /* ---------- payments ---------- */
  function ultimaRicevuta(db, e) { var n = e.ricevute || 0; (indice(db).pagamenti[e.id] || []).forEach(function (p) { var m = /-(\d+)$/.exec(p.ricevuta || ''); if (m && +m[1] > n) n = +m[1]; }); return n; }
  /** A payment is recorded only with an explicit amount, method and date. f: { iscrizioneId, data, importo, metodo, note }. */
  function controllaPagamento(db, f, today) {
    var e = byId(db.iscrizioni, f.iscrizioneId), c = e ? conto(db, e) : null;
    var r = C.checkPagamento({ importo: f.importo, metodo: C.str(f.metodo), data: C.parseDate(f.data) || C.str(f.data) }, e ? { id: e.id, residuoN: c.residuo, dovutoN: c.dovuto } : null,
      e ? pagamentiDi(db, e.id).map(function (p) { return { idIscr: e.id, data: p.data, importoN: p.importo, ricevuta: p.ricevuta }; }) : [], today || C.todayIso());
    if (e && e.annullata) r.warnings.push('Questa iscrizione è annullata.');
    return { errors: r.errors, warnings: r.warnings, importo: r.importo };
  }
  /** Records a payment and gives it the next receipt number of its enrollment (never reused). Returns { db, registro, id }. */
  /** A bank transfer is only counted as seen on the account when someone says so. Cash and POS (the terminal confirms) need no check. */
  function richiedeVerifica(metodo) { return C.norm(metodo) === 'bonifico'; }
  function salvaPagamento(db, f, adesso) {
    var out = clone(db), e = byId(out.iscrizioni, f.iscrizioneId);
    if (!e) throw new Error('Iscrizione non trovata.');
    var importo = typeof f.importo === 'number' ? f.importo : C.parseMoney(f.importo), data = C.parseDate(f.data);
    if (importo === null || !(importo > 0) || !data || !C.str(f.metodo)) throw new Error('Per registrare un pagamento servono importo, metodo e data.');
    var id = pad4(prossimoLibero(out.pagamenti, out.prossimi.pagamento)), n = ultimaRicevuta(db, byId(db.iscrizioni, e.id)) + 1;
    out.prossimi.pagamento = parseInt(id, 10) + 1;
    e.ricevute = n;
    var p = { id: id, iscrizioneId: e.id, data: data, importo: cent(importo), metodo: C.str(f.metodo), ricevuta: 'RIC-' + e.id + '-' + n, note: C.str(f.note), creata: adesso };
    if (richiedeVerifica(p.metodo)) { p.daVerificare = true; p.verificatoIl = ''; } // never switched by the program: only by a person, with the bank statement in hand
    out.pagamenti.push(p);
    return { db: out, id: id, registro: [riga(nomeAllieva(out, e.allievaId), 'Pagamento registrato', { campo: 'Importo', prima: '', dopo: C.fmtMoney(p.importo) },
      etichettaIscrizione(e) + ' · ' + p.metodo + ' · ' + C.isoToIt(p.data) + ' · ricevuta ' + p.ricevuta)] };
  }
  /** Confirms (on = true) that a transfer is on the account, or takes the confirmation back. The date is the one of the confirmation. */
  function verificaPagamento(db, id, on, adesso) {
    var out = clone(db), p = byId(out.pagamenti, id);
    if (!p) throw new Error('Pagamento non trovato.');
    if (!richiedeVerifica(p.metodo)) throw new Error('Solo i bonifici si verificano.');
    var e = byId(out.iscrizioni, p.iscrizioneId), prima = p.daVerificare ? 'Da verificare' : 'Verificato';
    p.daVerificare = !on; p.verificatoIl = on ? C.str(adesso).slice(0, 10) : '';
    return { db: out, registro: [riga(e ? nomeAllieva(out, e.allievaId) : '', on ? 'Bonifico verificato' : 'Verifica annullata', { campo: 'Stato del bonifico', prima: prima, dopo: on ? 'Verificato' : 'Da verificare' },
      C.fmtMoney(p.importo) + ' · ' + C.isoToIt(p.data) + ' · ricevuta ' + p.ricevuta)] };
  }
  /** Transfers waiting for a check, oldest first: { righe: [{ pagamento, iscrizione, allieva }], totale, n }. */
  function daVerificare(db) {
    var ix = indice(db), righe = [], tot = 0;
    (db.pagamenti || []).forEach(function (p) {
      if (!p.daVerificare) return;
      var e = ix.perId[p.iscrizioneId] || null;
      righe.push({ pagamento: p, iscrizione: e, allieva: e ? ix.allieve[e.allievaId] || null : null });
      tot += p.importo;
    });
    righe.sort(function (a, b) { return a.pagamento.data < b.pagamento.data ? -1 : a.pagamento.data > b.pagamento.data ? 1 : a.pagamento.id < b.pagamento.id ? -1 : 1; });
    return { righe: righe, totale: cent(tot), n: righe.length };
  }
  function eliminaPagamento(db, id) {
    var out = clone(db), p = byId(out.pagamenti, id);
    if (!p) throw new Error('Pagamento non trovato.');
    var e = byId(out.iscrizioni, p.iscrizioneId);
    out.pagamenti = out.pagamenti.filter(function (x) { return x.id !== id; });
    return { db: out, registro: [riga(e ? nomeAllieva(out, e.allievaId) : '', 'Pagamento eliminato', { campo: 'Importo', prima: C.fmtMoney(p.importo), dopo: '' },
      (e ? etichettaIscrizione(e) + ' · ' : '') + p.metodo + ' · ' + C.isoToIt(p.data) + ' · ricevuta ' + p.ricevuta)] };
  }
  /* Amounts in words, as receipts want them: 170.5 -> "centosettanta/50". */
  var UNITA = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
  var DECINE = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
  function sotto100(n) { if (n < 20) return UNITA[n]; var d = DECINE[Math.floor(n / 10)], u = n % 10; if (!u) return d; if (u === 1 || u === 8) d = d.slice(0, -1); return d + (u === 3 ? 'tré' : UNITA[u]); }
  function sotto1000(n) { var c = Math.floor(n / 100), r = n % 100, s = c ? (c === 1 ? '' : UNITA[c]) + 'cento' : ''; if (c && Math.floor(r / 10) === 8) s = s.slice(0, -1); return s + (r ? sotto100(r) : ''); }
  function inLettere(n) {
    if (n === 0) return 'zero';
    var m = Math.floor(n / 1000), r = n % 1000;
    return (m === 1 ? 'mille' : m ? sotto1000(m).replace(/tré$/, 'tre') + 'mila' : '') + (r ? sotto1000(r) : '');
  }
  function euroInLettere(v) {
    var c = Math.round(Math.abs(v) * 100), e = Math.floor(c / 100);
    if (e > 999999) return '';
    return inLettere(e) + '/' + ('0' + (c % 100)).slice(-2);
  }
  /** What goes on the receipt of a payment, for GymPdf.ricevuta. */
  function datiRicevuta(db, id) {
    var p = byId(db.pagamenti, id), e = p ? byId(db.iscrizioni, p.iscrizioneId) : null, a = e ? byId(db.allieve, e.allievaId) : null;
    if (!p || !e || !a) throw new Error('Pagamento non trovato.');
    var sc = scadenza(e), c = conto(db, e);
    return { numero: p.ricevuta, data: C.isoToIt(p.data), stagione: db.impostazioni.stagione,
      pagante: { nome: a.genitore || a.name, cf: a.genitore ? a.cfGenitore : a.cf }, atleta: { nome: a.name, nascita: C.isoToIt(a.nascita), cf: a.cf },
      causale: 'Corso ' + (e.corso || 'da definire') + (e.tipo ? ', abbonamento ' + e.tipo.toLowerCase() : '') + (e.inizio ? ' dal ' + C.isoToIt(e.inizio) + (sc ? ' al ' + C.isoToIt(sc) : '') : ''),
      importo: C.fmtMoney(p.importo), lettere: euroInLettere(p.importo), metodo: p.metodo, note: p.note,
      residuo: c.residuo !== null && c.residuo > 0.005 ? C.fmtMoney(c.residuo) : '', societa: { cf: db.impostazioni.cfAssociazione, legale: db.impostazioni.legale } };
  }

  /* ---------- analysis: figures for the Analisi page ---------- */
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function ym(iso) { return iso.slice(0, 7); }
  /** The 12 months of a period: 'stagione' (August to July of the season in the settings) or '12mesi' (the last 12 months, this one included). */
  function mesiPeriodo(db, today, periodo) {
    var out = [], y, m, i;
    if (periodo === 'stagione') { y = parseInt(db.impostazioni.stagione, 10) || +today.slice(0, 4); m = 8; }
    else { y = +today.slice(0, 4); m = +today.slice(5, 7) - 11; while (m < 1) { m += 12; y -= 1; } }
    for (i = 0; i < 12; i++) { out.push({ k: y + '-' + (m < 10 ? '0' : '') + m, l: MESI[m - 1], anno: y }); if (++m > 12) { m = 1; y++; } }
    return out;
  }
  /** Birthdays in the next `giorni` days (today included) of students who are not archived: [{ allieva, giorni, eta, data }], soonest first. */
  function compleanni(db, today, giorni) {
    var out = [], y = +today.slice(0, 4);
    db.allieve.forEach(function (a) {
      if (a.archiviata || !C.isIso(a.nascita)) return;
      var m = a.nascita.slice(5, 7), d = a.nascita.slice(8, 10), yy, data, g;
      for (yy = y; yy <= y + 1; yy++) {
        data = yy + '-' + m + '-' + (m === '02' && d === '29' && !C.isIso(yy + '-02-29') ? '28' : d);
        g = C.daysBetween(today, data);
        if (g >= 0) break;
      }
      if (g <= giorni) out.push({ k: String(g), allieva: a, giorni: g, eta: +data.slice(0, 4) - +a.nascita.slice(0, 4), data: data });
    });
    return out.sort(function (a, b) { return a.giorni - b.giorni || (C.norm(a.allieva.name) < C.norm(b.allieva.name) ? -1 : 1); });
  }
  /**
   * Everything the Analisi page shows. periodo: 'stagione' | '12mesi'.
   * Payments are counted by their date; "da incassare" is what is still owed on enrollments that are not cancelled.
   */
  function analisi(db, today, periodo) {
    var ix = indice(db), mesi = mesiPeriodo(db, today, periodo), dal = mesi[0].k + '-01', al = mesi[11].k + '-31', pos = {}, r = { periodo: periodo, mesi: mesi, dal: dal };
    mesi.forEach(function (m, i) { pos[m.k] = i; });
    function zeri() { return mesi.map(function () { return 0; }); }

    // incassi
    r.incassiMese = zeri(); r.incassiN = 0; r.incassiTot = 0; r.perMetodo = {}; r.perCorso = {};
    (db.pagamenti || []).forEach(function (p) {
      if (p.data < dal || p.data > al || !(ym(p.data) in pos)) return;
      var e = ix.perId[p.iscrizioneId], corso = (e && e.corso) || 'Corso da definire';
      r.incassiMese[pos[ym(p.data)]] = cent(r.incassiMese[pos[ym(p.data)]] + p.importo);
      r.incassiTot = cent(r.incassiTot + p.importo); r.incassiN++;
      r.perMetodo[p.metodo] = cent((r.perMetodo[p.metodo] || 0) + p.importo);
      r.perCorso[corso] = cent((r.perCorso[corso] || 0) + p.importo);
    });
    r.incassoMedio = r.incassiN ? cent(r.incassiTot / r.incassiN) : 0;
    r.daVerificareN = 0; r.daVerificareTot = 0;
    (db.pagamenti || []).forEach(function (p) { if (p.daVerificare && p.data >= dal && p.data <= al) { r.daVerificareN++; r.daVerificareTot = cent(r.daVerificareTot + p.importo); } });
    var attivi = r.incassiMese.filter(function (v) { return v > 0; }).length;
    r.mediaMensile = attivi ? cent(r.incassiTot / attivi) : 0;

    // enrollments started in the period: how much was due and how much came in
    r.avviateMese = zeri(); r.dovutoPeriodo = 0; r.pagatoPeriodo = 0;
    db.iscrizioni.forEach(function (e) {
      if (e.annullata || !C.isIso(e.inizio) || !(ym(e.inizio) in pos)) return;
      var c = conto(db, e);
      r.avviateMese[pos[ym(e.inizio)]]++;
      if (c.dovuto !== null) { r.dovutoPeriodo = cent(r.dovutoPeriodo + c.dovuto); r.pagatoPeriodo = cent(r.pagatoPeriodo + Math.min(c.pagato, c.dovuto)); }
    });
    r.tasso = r.dovutoPeriodo > 0 ? Math.round(r.pagatoPeriodo / r.dovutoPeriodo * 100) : null;

    // what is still owed, by how long ago the enrollment started
    var fasce = [{ l: 'Non ancora iniziate', n: 0, euro: 0 }, { l: 'Iniziate da 0-30 giorni', n: 0, euro: 0 }, { l: 'Da 31-60 giorni', n: 0, euro: 0 }, { l: 'Da oltre 60 giorni', n: 0, euro: 0 }, { l: 'Senza data di inizio', n: 0, euro: 0 }];
    var deb = [];
    db.iscrizioni.forEach(function (e) {
      if (e.annullata) return;
      var c = conto(db, e), a = ix.allieve[e.allievaId];
      if (c.residuo === null || c.residuo <= 0.005 || !a) return;
      var g = C.isIso(e.inizio) ? C.daysBetween(e.inizio, today) : null, f = g === null ? 4 : g < 0 ? 0 : g <= 30 ? 1 : g <= 60 ? 2 : 3;
      fasce[f].n++; fasce[f].euro = cent(fasce[f].euro + c.residuo);
      deb.push({ k: String(1e9 - c.residuo), allieva: a, iscrizione: e, residuo: c.residuo, giorni: g });
    });
    r.residui = fasce; r.daIncassare = cent(fasce.reduce(function (t, f) { return t + f.euro; }, 0)); r.daIncassareN = deb.length;
    r.debitori = deb.sort(perNome).slice(0, 8);

    // next 8 weeks: subscriptions and certificates that expire, and the fees to renew
    var sett = [{ l: 'Scaduti', abb: 0, cert: 0, euro: 0 }], i;
    for (i = 0; i < 8; i++) { var d0 = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 7 * i)); sett.push({ l: C.isoToIt(d0.toISOString().slice(0, 10)).slice(0, 5), abb: 0, cert: 0, euro: 0 }); }
    function cassetto(g) { return g < 0 ? 0 : g >= 56 ? -1 : 1 + Math.floor(g / 7); }
    var aperta = {};
    db.iscrizioni.forEach(function (e) {
      if (!corrente(e)) return;
      aperta[e.allievaId] = 1;
      var sc = scadenza(e); if (!sc || !ix.allieve[e.allievaId] || ix.allieve[e.allievaId].archiviata) return;
      var k = cassetto(C.daysBetween(today, sc)); if (k < 0) return;
      sett[k].abb++; sett[k].euro = cent(sett[k].euro + (quotaDovuta(db, e) || 0));
    });
    r.certValidi = 0; r.certMancanti = 0; r.certScaduti = 0; r.certInScadenza = 0;
    db.allieve.forEach(function (a) {
      if (a.archiviata || !aperta[a.id]) return;
      var s = statoCertificato(db, a, today);
      if (s.stato === 'VALIDO') r.certValidi++; else if (s.stato === 'MANCANTE') r.certMancanti++; else if (s.stato === 'SCADUTO') r.certScaduti++; else r.certInScadenza++;
      if (s.scadenza) { var k = cassetto(C.daysBetween(today, s.scadenza)); if (k >= 0) sett[k].cert++; }
    });
    r.settimane = sett;

    // who attends what
    r.corsi = corsiRiepilogo(db).filter(function (x) { return x.iscritte > 0; }).sort(function (a, b) { return b.iscritte - a.iscritte; });
    r.giorni = GIORNI.map(function (g) { return { l: g, n: iscritte(db, { giorno: g }, today).length }; });
    r.iscritteTot = iscritte(db, null, today).length;

    // small things worth knowing
    var tot = 0, n = 0, m = { telefono: [], cf: [], nascita: [], privacy: [], genitore: [] };
    db.allieve.forEach(function (a) {
      if (a.archiviata) return;
      if (C.isIso(a.nascita)) { tot += C.ageOn(a.nascita, today); n++; }
      if (!a.tel) m.telefono.push(a.name);
      if (!a.cf) m.cf.push(a.name);
      if (!C.isIso(a.nascita)) m.nascita.push(a.name);
      if (!a.privacy) m.privacy.push(a.name);
      if (C.isIso(a.nascita) && C.ageOn(a.nascita, today) < 18 && !a.genitore) m.genitore.push(a.name);
    });
    r.etaMedia = n ? Math.round(tot / n * 10) / 10 : null;
    r.mancanti = m;
    r.compleanni = compleanni(db, today, 14);
    return r;
  }
  /** Paid and still owed over all the enrollments of one student. */
  function contoAllieva(db, id) {
    var t = { dovuto: 0, pagato: 0, residuo: 0 };
    iscrizioniDi(db, id).forEach(function (e) {
      if (e.annullata) return;
      var c = conto(db, e);
      t.pagato = cent(t.pagato + c.pagato);
      if (c.dovuto !== null) t.dovuto = cent(t.dovuto + c.dovuto);
      if (c.residuo !== null && c.residuo > 0.005) t.residuo = cent(t.residuo + c.residuo);
    });
    return t;
  }

  /* ---------- settings ---------- */
  function righe(testo) { var seen = {}, out = []; C.str(testo).split(/\r?\n/).forEach(function (l) { l = C.str(l); if (l && !seen[l]) { seen[l] = 1; out.push(l); } }); return out; }
  /** f: { stagione, preavvisoAbb, corsi (text, one per line), fasce (text), tariffario: [{pacchetto, frequenza, Mensile, ...}] }. */
  function controllaImpostazioni(f) {
    var err = [], n = parseInt(f.preavvisoAbb, 10);
    if (!/^\d{4}\/\d{4}$/.test(C.str(f.stagione))) err.push('Stagione: scrivila come 2026/2027.');
    if (!(n >= 0 && n <= 365) || String(n) !== C.str(f.preavvisoAbb)) err.push('Giorni di preavviso: un numero da 0 a 365.');
    if (f.preavvisoCert !== undefined) { var nc = parseInt(f.preavvisoCert, 10); if (!(nc >= 0 && nc <= 365) || String(nc) !== C.str(f.preavvisoCert)) err.push('Giorni di preavviso per i certificati: un numero da 0 a 365.'); }
    if (f.metodi !== undefined && !righe(f.metodi).length) err.push('Scrivi almeno un metodo di pagamento.');
    if (!righe(f.corsi).length) err.push('Scrivi almeno un corso.');
    Object.keys(MODELLI).forEach(function (k) {
      if (f[k] === undefined) return;
      if (C.str(f[k]).length > 600) err.push('Il messaggio "' + MODELLI[k].nome + '" è troppo lungo (massimo 600 caratteri).');
      var s = segnapostoSconosciuti(f[k]);
      if (s.length) err.push('Il messaggio "' + MODELLI[k].nome + '" ha un segnaposto che non esiste: ' + s.join(' ') + '. Quelli validi sono ' + SEGNAPOSTO.map(function (x) { return '{' + x + '}'; }).join(' ') + '.');
    });
    var chiavi = {};
    (f.tariffario || []).forEach(function (p, i) {
      var nome = C.str(p.pacchetto), fr = C.str(p.frequenza);
      if (!nome && !fr && TIPI.every(function (t) { return C.str(p[t.nome]) === ''; })) return;
      if (!nome) { err.push('Tariffario, riga ' + (i + 1) + ': manca il nome.'); return; }
      var k = nome + ' · ' + fr;
      if (chiavi[k]) err.push('Tariffario: "' + k + '" è scritta due volte.');
      chiavi[k] = 1;
      TIPI.map(function (t) { return t.nome; }).concat(['iscrizione']).forEach(function (c) {
        var v = C.str(p[c]), n = C.parseMoney(v);
        if (v !== '' && (n === null || n < 0)) err.push('Tariffario, "' + nome + '": il prezzo ' + c + ' non è un numero.');
      });
    });
    return err;
  }
  function salvaImpostazioni(db, f) {
    var out = clone(db);
    out.impostazioni.stagione = C.str(f.stagione);
    out.impostazioni.preavvisoAbb = parseInt(f.preavvisoAbb, 10);
    if (f.preavvisoCert !== undefined) out.impostazioni.preavvisoCert = parseInt(f.preavvisoCert, 10);
    Object.keys(MODELLI).forEach(function (k) { if (f[k] !== undefined) out.impostazioni[k] = C.str(f[k]) === MODELLI[k].testo ? '' : C.str(f[k]); }); // the default text is not stored: it follows the program
    ['legale', 'ente', 'codice', 'cfAssociazione'].forEach(function (k) { if (f[k] !== undefined) out.impostazioni[k] = C.str(f[k]); });
    if (f.metodi !== undefined) out.liste.metodi = righe(f.metodi);
    out.liste.corsi = righe(f.corsi);
    out.liste.fasce = righe(f.fasce);
    out.tariffario = (f.tariffario || []).filter(function (p) { return C.str(p.pacchetto); }).map(function (p) {
      function num(c) { var v = C.str(p[c]); return v === '' ? null : C.parseMoney(v); }
      var chiave = C.str(p.pacchetto) + ' · ' + C.str(p.frequenza), prima = db.tariffario.filter(function (x) { return x.chiave === chiave; })[0];
      return tariffa(C.str(p.pacchetto), C.str(p.frequenza), num('Mensile'), num('Trimestrale'), prima ? prima.Semestrale : null, num('Annuale'), num('iscrizione') || 0); // the old semestral price, if any, is kept
    });
    return { db: out, registro: [riga('', 'Impostazioni modificate')] };
  }

  /* ---------- import from the Google sheet (CSV download of one sheet) ---------- */
  /** RFC 4180 reader. The separator (comma or semicolon) is guessed from the first lines. */
  function leggiCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var sample = text.slice(0, 4000).replace(/"[^"]*"/g, ''), sep = (sample.split(';').length > sample.split(',').length) ? ';' : ',';
    var rows = [], row = [], cell = '', q = false, i = 0, n = text.length;
    while (i < n) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i += 2; continue; } q = false; i++; continue; }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === sep) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  /** Finds the header row in the first lines and says which sheet it is: { tipo: 'anagrafica'|'iscrizioni'|'pagamenti'|'', vals }. */
  function riconosciFoglio(rows) {
    for (var i = 0; i < rows.length && i < 12; i++) {
      var h = (rows[i] || []).map(C.str);
      if (h.indexOf(C.S_COLS.name) >= 0) return { tipo: 'anagrafica', vals: rows.slice(i) };
      if (h.indexOf(C.E_COLS.allieva) >= 0 && h.indexOf(C.E_COLS.corso) >= 0 && h.indexOf(C.E_COLS.tipo) >= 0) return { tipo: 'iscrizioni', vals: rows.slice(i) };
      if (h.indexOf(C.P_COLS.data) >= 0 && h.indexOf(C.P_COLS.importo) >= 0) return { tipo: 'pagamenti', vals: rows.slice(i) };
    }
    return { tipo: '', vals: [] };
  }
  /** The student already in the list who is the same person: same name, and no different birth date or tax code (two students can share a name). */
  function stessaPersona(list, o) {
    var key = C.tokenKey(o.name);
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (C.tokenKey(a.name) !== key) continue;
      if (a.nascita && o.nascita && a.nascita !== o.nascita) continue;
      if (a.cf && o.cf && a.cf !== o.cf) continue;
      return a;
    }
    return null;
  }
  function idLibero(usati, voluto) { return /^\d{1,6}$/.test(voluto) && !usati[pad4(parseInt(voluto, 10))] ? pad4(parseInt(voluto, 10)) : ''; }
  /**
   * Students from the ANAGRAFICA sheet. A student already in the archive (same name) only gets her empty fields filled.
   * Returns { db, registro, nuove, completate, campiCompletati, invariate, diverse: [text], saltate: [text], mancanti: [header] }.
   */
  function importaAnagrafica(db, vals, adesso) {
    var t = C.parseStudents(vals), out = clone(db), reg = [];
    var res = { nuove: 0, completate: 0, campiCompletati: 0, invariate: 0, diverse: [], saltate: [], mancanti: t.missing.filter(function (h) { return values(A_CAMPI).indexOf(h) >= 0; }) };
    var usati = {}; out.allieve.forEach(function (a) { usati[a.id] = 1; });
    t.rows.forEach(function (r) {
      var f = {}; Object.keys(A_CAMPI).forEach(function (k) { f[k] = r[k] === undefined ? '' : r[k]; });
      var o = pulisciAllieva(f);
      if (C.norm(o.name).split(' ').length < 2) { res.saltate.push('Riga ' + r.row + ': "' + r.name + '" non è un cognome e nome.'); return; }
      var cur = stessaPersona(out.allieve, o);
      if (cur) {
        var toccata = false;
        Object.keys(A_CAMPI).forEach(function (k) {
          if (k === 'name' || !o[k]) return;
          if (!cur[k]) { cur[k] = o[k]; toccata = true; res.campiCompletati++; reg.push(riga(cur.name, 'Importazione', { campo: A_CAMPI[k], prima: '', dopo: mostra(k, o[k], A_DATE) })); }
          else if (C.norm(mostra(k, cur[k], A_DATE)) !== C.norm(mostra(k, o[k], A_DATE))) res.diverse.push(cur.name + ' · ' + A_CAMPI[k] + ': nell\'archivio "' + mostra(k, cur[k], A_DATE) + '", nel foglio "' + mostra(k, o[k], A_DATE) + '" (lasciato com\'è).');
        });
        if (toccata) { cur.modificata = adesso; res.completate++; } else res.invariate++;
        return;
      }
      var id = idLibero(usati, r.id) || pad4(prossimoLibero(out.allieve, out.prossimi.allieva));
      usati[id] = 1;
      out.allieve.push(Object.assign({ id: id }, o, { archiviata: false, creata: adesso, modificata: adesso }));
      out.prossimi.allieva = prossimoLibero(out.allieve, out.prossimi.allieva);
      res.nuove++;
      reg.push(riga(o.name, 'Importazione', null, 'Nuova allieva n. ' + id + ' dal foglio Google'));
    });
    res.db = out; res.registro = reg;
    return res;
  }
  function values(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function stessaIscrizione(a, b) { return a.allievaId === b.allievaId && C.norm(a.corso) === C.norm(b.corso) && a.tipo === b.tipo && a.inizio === b.inizio; }
  /** Enrollments from the ISCRIZIONI sheet: the student must already be in the archive. Returns { db, registro, nuove, giaPresenti, saltate, mancanti }. */
  function importaIscrizioni(db, vals, adesso) {
    var t = C.parseEnrollments(vals), out = clone(db), reg = [];
    var res = { nuove: 0, giaPresenti: 0, completate: 0, saltate: [], mancanti: t.missing.filter(function (h) { return [C.E_COLS.allieva, C.E_COLS.corso, C.E_COLS.tipo, C.E_COLS.inizio].indexOf(h) >= 0; }) };
    var usati = {}; out.iscrizioni.forEach(function (e) { usati[e.id] = 1; });
    t.rows.forEach(function (r) {
      var key = C.tokenKey(r.allieva), trovate = out.allieve.filter(function (a) { return C.tokenKey(a.name) === key; });
      if (!trovate.length) { res.saltate.push('Riga ' + r.row + ': l\'allieva "' + r.allieva + '" non è nell\'archivio (importa prima il foglio ANAGRAFICA).'); return; }
      if (trovate.length > 1) { res.saltate.push('Riga ' + r.row + ': ci sono ' + trovate.length + ' allieve che si chiamano "' + r.allieva + '". Inserisci questa iscrizione a mano dalla scheda giusta.'); return; }
      var m = { exact: trovate[0] };
      var o = pulisciIscrizione({ corso: r.corso, giorni: r.giorni, fascia: r.fascia, pacchetto: r.pacchetto, tipo: r.tipo, inizio: r.inizio, quota: r.quotaN, annullata: r.annullata === 'Sì' || r.stato === 'ANNULLATO', storica: r.stato === 'STORICO', note: r.note });
      // What the sheet says is due: beyond the fee of the period it is the registration fee; with no price list entry it is the fee itself.
      var base = o.quota !== null ? o.quota : C.quotaTariffario(out.tariffario, o.pacchetto, o.tipo);
      if (typeof r.dovutoN === 'number' && r.dovutoN > 0) { if (base === null) o.quota = r.dovutoN; else if (r.dovutoN - base > 0.005) o.quotaIscrizione = cent(r.dovutoN - base); }
      var e = Object.assign({ allievaId: m.exact.id }, o), nFoglio = /^\d{1,6}$/.test(r.id) ? pad4(parseInt(r.id, 10)) : '';
      var gia = out.iscrizioni.filter(function (x) { return stessaIscrizione(x, e); })[0];
      if (gia) { // already here: only what is still empty is filled in
        var toccata = false;
        if (!gia.idFoglio && nFoglio) { gia.idFoglio = nFoglio; toccata = true; }
        if (typeof gia.quotaIscrizione !== 'number' && typeof o.quotaIscrizione === 'number') { gia.quotaIscrizione = o.quotaIscrizione; toccata = true; reg.push(riga(m.exact.name, 'Importazione', { campo: I_CAMPI.quotaIscrizione, prima: '', dopo: C.fmtMoney(o.quotaIscrizione) }, etichettaIscrizione(gia))); }
        if (typeof gia.quota !== 'number' && C.quotaTariffario(out.tariffario, gia.pacchetto, gia.tipo) === null && typeof o.quota === 'number') { gia.quota = o.quota; toccata = true; reg.push(riga(m.exact.name, 'Importazione', { campo: I_CAMPI.quota, prima: '', dopo: C.fmtMoney(o.quota) }, etichettaIscrizione(gia))); }
        if (toccata) { gia.modificata = adesso; res.completate++; } else res.giaPresenti++;
        return;
      }
      if (nFoglio) e.idFoglio = nFoglio;
      e.id = idLibero(usati, r.id) || pad4(prossimoLibero(out.iscrizioni, out.prossimi.iscrizione));
      usati[e.id] = 1; e.creata = adesso; e.modificata = adesso;
      out.iscrizioni.push(e);
      out.prossimi.iscrizione = prossimoLibero(out.iscrizioni, out.prossimi.iscrizione);
      if (e.fascia && out.liste.fasce.indexOf(e.fascia) < 0) out.liste.fasce.push(e.fascia);
      if (e.corso && out.liste.corsi.indexOf(e.corso) < 0) out.liste.corsi.push(e.corso);
      res.nuove++;
      reg.push(riga(m.exact.name, 'Importazione', null, 'Nuova ' + etichettaIscrizione(e).toLowerCase() + ' dal foglio Google'));
    });
    res.db = out; res.registro = reg;
    return res;
  }

  /**
   * Payments from the PAGAMENTI sheet. Each one must find exactly one enrollment (by the sheet's enrollment number, else by student and course)
   * and carry date, amount and method. Returns { db, registro, nuovi, totale, giaPresenti, saltati, mancanti }.
   */
  function importaPagamenti(db, vals, adesso) {
    var t = C.parsePayments(vals), out = clone(db), reg = [], nomi = {};
    var res = { nuovi: 0, totale: 0, giaPresenti: 0, saltati: [], mancanti: t.missing.filter(function (h) { return [C.P_COLS.data, C.P_COLS.importo, C.P_COLS.metodo].indexOf(h) >= 0; }) };
    out.allieve.forEach(function (a) { nomi[a.id] = a.name; });
    t.rows.forEach(function (r) {
      var k = /^\s*(\d+)\s*·\s*(.*?)\s*·\s*(.*?)\s*$/.exec(r.iscrizione) || [];
      var idF = /^\d+$/.test(r.idIscr) ? r.idIscr : k[1] || '', nome = r.allieva || k[2] || '', corso = r.corso || k[3] || '', chi = nome || r.iscrizione || 'senza nome';
      if (!C.isIso(r.data) || r.importoN === null || !(r.importoN > 0) || !r.metodo) { res.saltati.push('Riga ' + r.row + ' (' + chi + '): mancano data, importo o metodo.'); return; }
      idF = idF ? pad4(parseInt(idF, 10)) : '';
      var key = C.tokenKey(nome);
      var cand = !idF ? [] : out.iscrizioni.filter(function (e) { return (e.idFoglio ? e.idFoglio === idF : e.id === idF) && (!key || C.tokenKey(nomi[e.allievaId]) === key); });
      if (!cand.length && key) cand = out.iscrizioni.filter(function (e) { return !e.annullata && C.tokenKey(nomi[e.allievaId]) === key && (!corso || C.norm(e.corso) === C.norm(corso)); });
      if (cand.length !== 1) { res.saltati.push('Riga ' + r.row + ' (' + chi + '): ' + (cand.length ? 'ci sono ' + cand.length + ' iscrizioni possibili' : 'non trovo l\'iscrizione') + '. Registra questo pagamento a mano.'); return; }
      var e = cand[0];
      if (out.pagamenti.some(function (p) { return p.iscrizioneId === e.id && p.data === r.data && Math.abs(p.importo - r.importoN) < 0.005; })) { res.giaPresenti++; return; }
      var id = pad4(prossimoLibero(out.pagamenti, out.prossimi.pagamento)), m = /-(\d+)$/.exec(r.ricevuta), n = m ? +m[1] : (e.ricevute || 0) + 1;
      out.prossimi.pagamento = parseInt(id, 10) + 1;
      e.ricevute = Math.max(e.ricevute || 0, n);
      out.pagamenti.push({ id: id, iscrizioneId: e.id, data: r.data, importo: cent(r.importoN), metodo: r.metodo, ricevuta: r.ricevuta || 'RIC-' + e.id + '-' + n, note: r.note, creata: adesso });
      res.nuovi++; res.totale = cent(res.totale + r.importoN);
      reg.push(riga(nomi[e.allievaId], 'Importazione', { campo: 'Importo', prima: '', dopo: C.fmtMoney(r.importoN) }, 'Pagamento del ' + C.isoToIt(r.data) + ' dal foglio Google · ' + etichettaIscrizione(e)));
    });
    res.db = out; res.registro = reg;
    return res;
  }

  /* ---------- export ---------- */
  function csvCella(v) {
    v = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v; // Excel would run it as a formula
    return /[";\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCella).join(';'); }).join('\r\n') + '\r\n'; }
  /** Semicolon-separated, as Excel in Italian expects. */
  function csvAllieve(db) {
    var keys = Object.keys(A_CAMPI), rows = [['N.'].concat(keys.map(function (k) { return A_CAMPI[k]; }), ['Archiviata'])];
    db.allieve.forEach(function (a) { rows.push([a.id].concat(keys.map(function (k) { return mostra(k, a[k], A_DATE); }), [a.archiviata ? 'Sì' : 'No'])); });
    return csv(rows);
  }
  function csvIscrizioni(db, today) {
    var rows = [['N.', 'N. allieva', 'Allieva', 'Corso', 'Giorni', 'Fascia oraria', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Scadenza', 'Stato abbonamento', 'Quota', 'Totale dovuto', 'Totale pagato', 'Residuo', 'Note']];
    function n(v) { return v === null ? '' : String(v).replace('.', ','); }
    db.iscrizioni.forEach(function (e) {
      var s = statoIscrizione(db, e, today), c = conto(db, e);
      rows.push([e.id, e.allievaId, nomeAllieva(db, e.allievaId), e.corso, e.giorni.join(', '), e.fascia, e.pacchetto, e.tipo, C.isoToIt(e.inizio), C.isoToIt(s.scadenza), s.stato, n(quotaDovuta(db, e)), n(c.dovuto), n(c.pagato), n(c.residuo), e.note]);
    });
    return csv(rows);
  }
  function csvPagamenti(db) {
    var rows = [['N.', 'Data pagamento', 'Allieva', 'Corso', 'N. iscrizione', 'Importo', 'Metodo', 'N. ricevuta', 'Note', 'Verifica bonifico']];
    incassi(db, {}).righe.slice().reverse().forEach(function (x) {
      var p = x.pagamento;
      rows.push([p.id, C.isoToIt(p.data), x.allieva ? x.allieva.name : '', x.iscrizione ? x.iscrizione.corso : '', p.iscrizioneId, String(p.importo).replace('.', ','), p.metodo, p.ricevuta, p.note, p.daVerificare ? 'Da verificare' : richiedeVerifica(p.metodo) && p.verificatoIl ? 'Verificato il ' + C.isoToIt(p.verificatoIl) : '']);
    });
    return csv(rows);
  }

  var Logic = {
    SCHEMA: SCHEMA, TIPI: TIPI, GIORNI: GIORNI, A_CAMPI: A_CAMPI, I_CAMPI: I_CAMPI, CERT_TIPI: CERT_TIPI, MESSAGGIO_CERT: MESSAGGIO_CERT,
    dovuto: dovuto, conto: conto, pagamentiDi: pagamentiDi, daIncassare: daIncassare, incassi: incassi,
    statoCertificato: statoCertificato, scadenzeCertificati: scadenzeCertificati, messaggioCertificato: messaggioCertificato,
    documentiDi: documentiDi, controllaDocumento: controllaDocumento, salvaDocumento: salvaDocumento, eliminaDocumento: eliminaDocumento, elencoCertificati: elencoCertificati,
    controllaPagamento: controllaPagamento, salvaPagamento: salvaPagamento, eliminaPagamento: eliminaPagamento, euroInLettere: euroInLettere, datiRicevuta: datiRicevuta,
    importaPagamenti: importaPagamenti, csvPagamenti: csvPagamenti, verificaPagamento: verificaPagamento, daVerificare: daVerificare, richiedeVerifica: richiedeVerifica,
    analisi: analisi, compleanni: compleanni, contoAllieva: contoAllieva, mesiPeriodo: mesiPeriodo,
    nuovoArchivio: nuovoArchivio, validaArchivio: validaArchivio, completa: completa, stagioneDi: stagioneDi, byId: byId,
    scadenza: scadenza, statoIscrizione: statoIscrizione, corrente: corrente, quotaDovuta: quotaDovuta, iscrizioniDi: iscrizioniDi, nomeAllieva: nomeAllieva,
    riepilogo: riepilogo, scadenze: scadenze, elencoPromemoria: elencoPromemoria, segnaPromemoria: segnaPromemoria, GIORNI_RICONTATTO: GIORNI_RICONTATTO, cercaAllieve: cercaAllieve, indice: indice,
    iscritte: iscritte, corsiRiepilogo: corsiRiepilogo, famiglia: famiglia, previsioneRinnovi: previsioneRinnovi, messaggioScadenza: messaggioScadenza, testoAvviso: testoAvviso, modelloMessaggio: modelloMessaggio, MODELLI: MODELLI, SEGNAPOSTO: SEGNAPOSTO, promemoriaCopia: promemoriaCopia, segnaCopia: segnaCopia, MESSAGGIO: MESSAGGIO,
    pulisciAllieva: pulisciAllieva, controllaAllieva: controllaAllieva, salvaAllieva: salvaAllieva, archiviaAllieva: archiviaAllieva, eliminaAllieva: eliminaAllieva,
    pulisciIscrizione: pulisciIscrizione, controllaIscrizione: controllaIscrizione, salvaIscrizione: salvaIscrizione, serveIscrizione: serveIscrizione, controllaNuovaIscrizione: controllaNuovaIscrizione, salvaNuovaIscrizione: salvaNuovaIscrizione, rinnova: rinnova, eliminaIscrizione: eliminaIscrizione,
    stagioneSuccessiva: stagioneSuccessiva, inizioStagione: inizioStagione, pianoStagione: pianoStagione, controllaStagione: controllaStagione, nuovaStagione: nuovaStagione,
    controllaImpostazioni: controllaImpostazioni, salvaImpostazioni: salvaImpostazioni,
    leggiCsv: leggiCsv, riconosciFoglio: riconosciFoglio, importaAnagrafica: importaAnagrafica, importaIscrizioni: importaIscrizioni,
    csvAllieve: csvAllieve, csvIscrizioni: csvIscrizioni
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic; else root.Logic = Logic;
})(typeof self !== 'undefined' ? self : this);
