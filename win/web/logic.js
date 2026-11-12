/* Gym Art Segreteria per Windows - logica dell'archivio sul PC (no DOM, no network). Runs in the browser and in Node tests. */
(function (root) {
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;

  var SCHEMA = 2; // 2: certificates, payments, enrollment fee
  var TIPI = [{ nome: 'Mensile', mesi: 1 }, { nome: 'Trimestrale', mesi: 3 }, { nome: 'Semestrale', mesi: 6 }, { nome: 'Annuale', mesi: 12 }];
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
  var MESSAGGIO_CERT = 'Buongiorno, vi ricordiamo che il certificato medico di {nome} ha scadenza il {scadenza}. Grazie, A.S.D. Gym Art Avezzano';
  var MESSAGGIO_CERT_MANCANTE = 'Buongiorno, ci risulta mancante il certificato medico di {nome}: vi chiediamo di consegnarlo in segreteria. Grazie, A.S.D. Gym Art Avezzano';

  var MESSAGGIO = 'Buongiorno, vi ricordiamo che l\'abbonamento di {nome} al corso {corso} ha scadenza il {scadenza}. Grazie, A.S.D. Gym Art Avezzano';
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
      impostazioni: { stagione: stagioneDi(today || C.todayIso()), preavvisoAbb: 30, messaggioScadenza: MESSAGGIO, ultimaCopia: '',
        preavvisoCert: 30, messaggioCertificato: MESSAGGIO_CERT, legale: '', ente: '', codice: '', cfAssociazione: '' },
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
      allieve: [], iscrizioni: [], pagamenti: [],
      prossimi: { allieva: 1, iscrizione: 1, pagamento: 1 }
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
    var pr = out.prossimi || {};
    out.prossimi = { allieva: prossimoLibero(out.allieve, pr.allieva), iscrizione: prossimoLibero(out.iscrizioni, pr.iscrizione), pagamento: prossimoLibero(out.pagamenti, pr.pagamento) };
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
  function mesiTipo(tipo) { for (var i = 0; i < TIPI.length; i++) if (TIPI[i].nome === tipo) return TIPI[i].mesi; return null; }
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
    var ix = indice(db), words = C.norm(f.q).split(' ').filter(Boolean), righe = [], tot = 0, per = {};
    (db.pagamenti || []).forEach(function (p) {
      if ((f.dal && p.data < f.dal) || (f.al && p.data > f.al) || (f.metodo && p.metodo !== f.metodo)) return;
      var e = ix.perId[p.iscrizioneId] || null, a = e ? ix.allieve[e.allievaId] || null : null;
      if (words.length) { var hay = C.norm([a ? a.name : '', e ? e.corso : '', p.ricevuta, p.note].join(' ')); if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return; }
      righe.push({ pagamento: p, iscrizione: e, allieva: a });
      tot += p.importo; per[p.metodo] = cent((per[p.metodo] || 0) + p.importo);
    });
    righe.sort(function (x, y) { return x.pagamento.data > y.pagamento.data ? -1 : x.pagamento.data < y.pagamento.data ? 1 : x.pagamento.id > y.pagamento.id ? -1 : 1; });
    return { righe: righe, totale: cent(tot), perMetodo: per };
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
  function messaggioCertificato(db, a, stato) {
    var t = stato.stato === 'MANCANTE' ? MESSAGGIO_CERT_MANCANTE : (C.str(db.impostazioni.messaggioCertificato) || MESSAGGIO_CERT), v = { nome: a.name, scadenza: C.isoToIt(stato.scadenza) };
    return t.replace(/\{(nome|scadenza)\}/g, function (m, k) { return v[k]; });
  }

  function riepilogo(db, today) {
    var r = { allieve: 0, archiviate: 0, senzaIscrizione: 0, correnti: 0, attive: 0, inScadenza: 0, scadute: 0, daCompletare: 0 };
    var sc = scadenzeCertificati(db, today), inc = daIncassare(db);
    r.certScaduti = sc.scaduti.length; r.certInScadenza = sc.inScadenza.length; r.certMancanti = sc.mancanti.length;
    r.daIncassare = inc.righe.length; r.totaleDaIncassare = inc.totale;
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
  /** Reminder text for one item of scadenze(): {nome}, {corso}, {tipo}, {scadenza} are filled in. */
  function messaggioScadenza(db, x) {
    var v = { nome: x.allieva ? x.allieva.name : '', corso: x.iscrizione.corso, tipo: C.str(x.iscrizione.tipo).toLowerCase(), scadenza: C.isoToIt(x.scadenza) };
    return (C.str(db.impostazioni.messaggioScadenza) || MESSAGGIO).replace(/\{(nome|corso|tipo|scadenza)\}/g, function (m, k) { return v[k]; });
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
  function controllaAllieva(db, f, id, today) {
    var o = pulisciAllieva(f), r = C.checkModulo(o, today || C.todayIso());
    var altre = db.allieve.filter(function (a) { return a.id !== id; });
    var m = C.matchStudent(altre, o.name);
    if (m.exact) r.warnings.push('Esiste già un\'allieva con lo stesso nome: ' + m.exact.name + ' (n. ' + m.exact.id + (m.exact.nascita ? ', nata il ' + C.isoToIt(m.exact.nascita) : '') + '). Salva solo se è un\'altra persona.');
    else m.candidates.filter(function (c) { return c.score >= 0.9; }).forEach(function (c) { r.warnings.push('Nome molto simile a un\'allieva già presente: ' + c.student.name + ' (n. ' + c.student.id + ').'); });
    if (o.cf) altre.forEach(function (a) { if (a.cf && a.cf === o.cf) r.errors.push('Questo codice fiscale è già di ' + a.name + ' (n. ' + a.id + ').'); });
    // The certificate is checked when it is entered or changed, not at every other edit: imported ones may lack the issue date.
    var cur = id ? byId(db.allieve, id) : null;
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
    return { db: out, registro: [riga(cur.name, 'Allieva eliminata', null, 'n. ' + id)] };
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
  function salvaPagamento(db, f, adesso) {
    var out = clone(db), e = byId(out.iscrizioni, f.iscrizioneId);
    if (!e) throw new Error('Iscrizione non trovata.');
    var importo = typeof f.importo === 'number' ? f.importo : C.parseMoney(f.importo), data = C.parseDate(f.data);
    if (importo === null || !(importo > 0) || !data || !C.str(f.metodo)) throw new Error('Per registrare un pagamento servono importo, metodo e data.');
    var id = pad4(prossimoLibero(out.pagamenti, out.prossimi.pagamento)), n = ultimaRicevuta(db, byId(db.iscrizioni, e.id)) + 1;
    out.prossimi.pagamento = parseInt(id, 10) + 1;
    e.ricevute = n;
    var p = { id: id, iscrizioneId: e.id, data: data, importo: cent(importo), metodo: C.str(f.metodo), ricevuta: 'RIC-' + e.id + '-' + n, note: C.str(f.note), creata: adesso };
    out.pagamenti.push(p);
    return { db: out, id: id, registro: [riga(nomeAllieva(out, e.allievaId), 'Pagamento registrato', { campo: 'Importo', prima: '', dopo: C.fmtMoney(p.importo) },
      etichettaIscrizione(e) + ' · ' + p.metodo + ' · ' + C.isoToIt(p.data) + ' · ricevuta ' + p.ricevuta)] };
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

  /* ---------- settings ---------- */
  function righe(testo) { var seen = {}, out = []; C.str(testo).split(/\r?\n/).forEach(function (l) { l = C.str(l); if (l && !seen[l]) { seen[l] = 1; out.push(l); } }); return out; }
  /** f: { stagione, preavvisoAbb, corsi (text, one per line), fasce (text), tariffario: [{pacchetto, frequenza, Mensile, ...}] }. */
  function controllaImpostazioni(f) {
    var err = [], n = parseInt(f.preavvisoAbb, 10);
    if (!/^\d{4}\/\d{4}$/.test(C.str(f.stagione))) err.push('Stagione: scrivila come 2026/2027.');
    if (!(n >= 0 && n <= 365) || String(n) !== C.str(f.preavvisoAbb)) err.push('Giorni di preavviso: un numero da 0 a 365.');
    if (f.preavvisoCert !== undefined) { var nc = parseInt(f.preavvisoCert, 10); if (!(nc >= 0 && nc <= 365) || String(nc) !== C.str(f.preavvisoCert)) err.push('Giorni di preavviso per i certificati: un numero da 0 a 365.'); }
    if (f.metodi !== undefined && !righe(f.metodi).length) err.push('Scrivi almeno un metodo di pagamento.');
    if (C.str(f.messaggioCertificato).length > 600) err.push('Il messaggio per i certificati è troppo lungo (massimo 600 caratteri).');
    if (!righe(f.corsi).length) err.push('Scrivi almeno un corso.');
    if (C.str(f.messaggioScadenza).length > 600) err.push('Il messaggio di promemoria è troppo lungo (massimo 600 caratteri).');
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
    if (f.messaggioScadenza !== undefined) out.impostazioni.messaggioScadenza = C.str(f.messaggioScadenza);
    if (f.preavvisoCert !== undefined) out.impostazioni.preavvisoCert = parseInt(f.preavvisoCert, 10);
    ['messaggioCertificato', 'legale', 'ente', 'codice', 'cfAssociazione'].forEach(function (k) { if (f[k] !== undefined) out.impostazioni[k] = C.str(f[k]); });
    if (f.metodi !== undefined) out.liste.metodi = righe(f.metodi);
    out.liste.corsi = righe(f.corsi);
    out.liste.fasce = righe(f.fasce);
    out.tariffario = (f.tariffario || []).filter(function (p) { return C.str(p.pacchetto); }).map(function (p) {
      function num(c) { var v = C.str(p[c]); return v === '' ? null : C.parseMoney(v); }
      return tariffa(C.str(p.pacchetto), C.str(p.frequenza), num('Mensile'), num('Trimestrale'), num('Semestrale'), num('Annuale'), num('iscrizione') || 0);
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
    var rows = [['N.', 'Data pagamento', 'Allieva', 'Corso', 'N. iscrizione', 'Importo', 'Metodo', 'N. ricevuta', 'Note']];
    incassi(db, {}).righe.slice().reverse().forEach(function (x) {
      var p = x.pagamento;
      rows.push([p.id, C.isoToIt(p.data), x.allieva ? x.allieva.name : '', x.iscrizione ? x.iscrizione.corso : '', p.iscrizioneId, String(p.importo).replace('.', ','), p.metodo, p.ricevuta, p.note]);
    });
    return csv(rows);
  }

  var Logic = {
    SCHEMA: SCHEMA, TIPI: TIPI, GIORNI: GIORNI, A_CAMPI: A_CAMPI, I_CAMPI: I_CAMPI, CERT_TIPI: CERT_TIPI, MESSAGGIO_CERT: MESSAGGIO_CERT,
    dovuto: dovuto, conto: conto, pagamentiDi: pagamentiDi, daIncassare: daIncassare, incassi: incassi,
    statoCertificato: statoCertificato, scadenzeCertificati: scadenzeCertificati, messaggioCertificato: messaggioCertificato,
    controllaPagamento: controllaPagamento, salvaPagamento: salvaPagamento, eliminaPagamento: eliminaPagamento, euroInLettere: euroInLettere, datiRicevuta: datiRicevuta,
    importaPagamenti: importaPagamenti, csvPagamenti: csvPagamenti,
    nuovoArchivio: nuovoArchivio, validaArchivio: validaArchivio, completa: completa, stagioneDi: stagioneDi, byId: byId,
    scadenza: scadenza, statoIscrizione: statoIscrizione, corrente: corrente, quotaDovuta: quotaDovuta, iscrizioniDi: iscrizioniDi, nomeAllieva: nomeAllieva,
    riepilogo: riepilogo, scadenze: scadenze, cercaAllieve: cercaAllieve, indice: indice,
    iscritte: iscritte, corsiRiepilogo: corsiRiepilogo, famiglia: famiglia, messaggioScadenza: messaggioScadenza, promemoriaCopia: promemoriaCopia, segnaCopia: segnaCopia, MESSAGGIO: MESSAGGIO,
    pulisciAllieva: pulisciAllieva, controllaAllieva: controllaAllieva, salvaAllieva: salvaAllieva, archiviaAllieva: archiviaAllieva, eliminaAllieva: eliminaAllieva,
    pulisciIscrizione: pulisciIscrizione, controllaIscrizione: controllaIscrizione, salvaIscrizione: salvaIscrizione, rinnova: rinnova, eliminaIscrizione: eliminaIscrizione,
    controllaImpostazioni: controllaImpostazioni, salvaImpostazioni: salvaImpostazioni,
    leggiCsv: leggiCsv, riconosciFoglio: riconosciFoglio, importaAnagrafica: importaAnagrafica, importaIscrizioni: importaIscrizioni,
    csvAllieve: csvAllieve, csvIscrizioni: csvIscrizioni
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic; else root.Logic = Logic;
})(typeof self !== 'undefined' ? self : this);
