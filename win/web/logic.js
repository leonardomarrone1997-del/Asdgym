/* Gym Art Segreteria per Windows - logica dell'archivio sul PC (no DOM, no network). Runs in the browser and in Node tests. */
(function (root) {
  'use strict';
  var C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;

  var SCHEMA = 1;
  var TIPI = [{ nome: 'Mensile', mesi: 1 }, { nome: 'Trimestrale', mesi: 3 }, { nome: 'Semestrale', mesi: 6 }, { nome: 'Annuale', mesi: 12 }];
  var GIORNI = C.DAY_ORDER;
  /* Student and enrollment fields, with the labels used in the Google sheet (shown in forms, log and exports). */
  var A_CAMPI = { name: 'Cognome e Nome', nascita: 'Data di nascita', luogo: 'Luogo di nascita', cf: 'Codice fiscale', indirizzo: 'Indirizzo', citta: 'Città', cap: 'CAP',
    genitore: 'Genitore / Referente', cfGenitore: 'CF genitore', tel: 'Telefono', tel2: 'Secondo telefono', email: 'Email',
    privacy: 'Consenso privacy', liberatoria: 'Liberatoria foto/video', dataModulo: 'Data modulo iscrizione', tessera: 'N° tessera EPS/FGI', note: 'Note' };
  var A_DATE = { nascita: 1, dataModulo: 1 };
  var I_CAMPI = { corso: 'Corso', giorni: 'Giorni', fascia: 'Fascia oraria', pacchetto: 'Tariffa / Pacchetto', tipo: 'Tipo abbonamento', inizio: 'Data inizio',
    quota: 'Quota concordata', annullata: 'Annullata', storica: 'Chiusa (storico)', note: 'Note' };

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
      impostazioni: { stagione: stagioneDi(today || C.todayIso()), preavvisoAbb: 30 },
      liste: { corsi: ['Propedeutico', 'Base', 'Avanzato', 'Preagonismo', 'Agonismo', 'FitKid', 'Da definire'], fasce: [] },
      tariffario: [
        tariffa('Corso Propedeutico', '1 giorno/settimana', 35, 105, null, 300),
        tariffa('Corso Base e Avanzato', '2 giorni/settimana', 60, 170, null, 500),
        tariffa('Corso Base e Avanzato', '3 giorni/settimana', 70, 200, null, 580),
        tariffa('Corso Preagonistico', '2 giorni/settimana', 70, 200, null, 580),
        tariffa('Corso Agonistico', '3 giorni/settimana', 85, 250, null, 1000),
        tariffa('FitKid (1 giorno)', '1 giorno/settimana', 25, 70, null, null, 10),
        tariffa('FitKid (2 giorni)', '2 giorni/settimana', 40, 110, null, null, 10)
      ],
      allieve: [], iscrizioni: [],
      prossimi: { allieva: 1, iscrizione: 1 }
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
    out.prossimi = { allieva: prossimoLibero(out.allieve, (out.prossimi || {}).allieva), iscrizione: prossimoLibero(out.iscrizioni, (out.prossimi || {}).iscrizione) };
    return out;
  }
  function prossimoLibero(list, from) {
    var n = from > 0 ? from : 1;
    list.forEach(function (x) { var k = parseInt(x.id, 10); if (k >= n) n = k + 1; });
    return n;
  }

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
  function iscrizioniDi(db, allievaId) { return db.iscrizioni.filter(function (e) { return e.allievaId === allievaId; }); }
  function nomeAllieva(db, id) { var a = byId(db.allieve, id); return a ? a.name : ''; }

  function riepilogo(db, today) {
    var r = { allieve: 0, archiviate: 0, senzaIscrizione: 0, correnti: 0, attive: 0, inScadenza: 0, scadute: 0, daCompletare: 0 };
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
      var s = statoIscrizione(db, e, today), item = { iscrizione: e, allieva: byId(db.allieve, e.allievaId), scadenza: s.scadenza, giorni: s.giorni };
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
    return db.allieve.filter(function (a) {
      if (filtro === 'archiviate') { if (!a.archiviata) return false; }
      else if (a.archiviata) return false;
      if (filtro === 'con' && !conCorrente[a.id]) return false;
      if (filtro === 'senza' && conCorrente[a.id]) return false;
      if (!words.length) return true;
      var hay = C.norm([a.name, a.genitore, a.tel, a.tel2, a.cf, a.email, a.citta, a.id].join(' '));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) { return C.norm(a.name) < C.norm(b.name) ? -1 : C.norm(a.name) > C.norm(b.name) ? 1 : 0; });
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
    return o;
  }
  /** Errors stop the save, warnings do not. id = the student being edited (null for a new one). */
  function controllaAllieva(db, f, id, today) {
    var o = pulisciAllieva(f), r = C.checkModulo(o, today || C.todayIso());
    var altre = db.allieve.filter(function (a) { return a.id !== id; });
    var m = C.matchStudent(altre, o.name);
    if (m.exact) r.warnings.push('Esiste già un\'allieva con lo stesso nome: ' + m.exact.name + ' (n. ' + m.exact.id + (m.exact.nascita ? ', nata il ' + C.isoToIt(m.exact.nascita) : '') + '). Salva solo se è un\'altra persona.');
    else m.candidates.filter(function (c) { return c.score >= 0.9; }).forEach(function (c) { r.warnings.push('Nome molto simile a un\'allieva già presente: ' + c.student.name + ' (n. ' + c.student.id + ').'); });
    if (o.cf) altre.forEach(function (a) { if (a.cf && a.cf === o.cf) r.errors.push('Questo codice fiscale è già di ' + a.name + ' (n. ' + a.id + ').'); });
    return { errors: r.errors, warnings: r.warnings, valori: o };
  }
  function mostra(k, v, date) {
    if (v === null || v === undefined || v === '') return '';
    if (Array.isArray(v)) return v.join(', ');
    if (v === true) return 'Sì';
    if (v === false) return 'No';
    if (date && date[k]) return C.isoToIt(v) || String(v);
    if (k === 'quota') return C.fmtMoney(v);
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
    if (iscrizioniDi(out, id).length) throw new Error('Questa allieva ha delle iscrizioni: non si può eliminare. Puoi archiviarla.');
    out.allieve = out.allieve.filter(function (a) { return a.id !== id; });
    return { db: out, registro: [riga(cur.name, 'Allieva eliminata', null, 'n. ' + id)] };
  }

  /* ---------- enrollments ---------- */
  function ordinaGiorni(list) {
    var g = (Array.isArray(list) ? list : C.str(list).split(/[,;\/\s]+/)).map(function (d) { return C.titleCase(C.str(d)).slice(0, 3); });
    return GIORNI.filter(function (d) { return g.indexOf(d) >= 0; });
  }
  function pulisciIscrizione(f) {
    var q = f.quota === '' || f.quota === null || f.quota === undefined ? null : C.parseMoney(f.quota);
    return {
      corso: C.str(f.corso), giorni: ordinaGiorni(f.giorni), fascia: C.str(f.fascia), pacchetto: C.str(f.pacchetto), tipo: mesiTipo(C.str(f.tipo)) ? C.str(f.tipo) : '',
      inizio: C.parseDate(f.inizio) || C.str(f.inizio), quota: q, annullata: f.annullata === true, storica: f.storica === true, note: C.str(f.note)
    };
  }
  function controllaIscrizione(db, f, id) {
    var o = pulisciIscrizione(f), r = C.checkIscrizione(Object.assign({}, o, { quota: f.quota === '' || f.quota === null || f.quota === undefined ? '' : (o.quota === null ? 'x' : o.quota) }));
    if (!byId(db.allieve, f.allievaId)) r.errors.unshift('Scegli l\'allieva.');
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
      quota: cur.quota, annullata: false, storica: false, note: '', creata: adesso, modificata: adesso };
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
    out.iscrizioni = out.iscrizioni.filter(function (e) { return e.id !== id; });
    return { db: out, registro: [riga(nomeAllieva(out, cur.allievaId), 'Iscrizione eliminata', null, etichettaIscrizione(cur))] };
  }

  /* ---------- settings ---------- */
  function righe(testo) { var seen = {}, out = []; C.str(testo).split(/\r?\n/).forEach(function (l) { l = C.str(l); if (l && !seen[l]) { seen[l] = 1; out.push(l); } }); return out; }
  /** f: { stagione, preavvisoAbb, corsi (text, one per line), fasce (text), tariffario: [{pacchetto, frequenza, Mensile, ...}] }. */
  function controllaImpostazioni(f) {
    var err = [], n = parseInt(f.preavvisoAbb, 10);
    if (!/^\d{4}\/\d{4}$/.test(C.str(f.stagione))) err.push('Stagione: scrivila come 2026/2027.');
    if (!(n >= 0 && n <= 365) || String(n) !== C.str(f.preavvisoAbb)) err.push('Giorni di preavviso: un numero da 0 a 365.');
    if (!righe(f.corsi).length) err.push('Scrivi almeno un corso.');
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
  /** Finds the header row in the first lines and says which sheet it is: { tipo: 'anagrafica'|'iscrizioni'|'', vals }. */
  function riconosciFoglio(rows) {
    for (var i = 0; i < rows.length && i < 12; i++) {
      var h = (rows[i] || []).map(C.str);
      if (h.indexOf(C.S_COLS.name) >= 0) return { tipo: 'anagrafica', vals: rows.slice(i) };
      if (h.indexOf(C.E_COLS.allieva) >= 0 && h.indexOf(C.E_COLS.corso) >= 0 && h.indexOf(C.E_COLS.tipo) >= 0) return { tipo: 'iscrizioni', vals: rows.slice(i) };
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
    var res = { nuove: 0, giaPresenti: 0, saltate: [], mancanti: t.missing.filter(function (h) { return [C.E_COLS.allieva, C.E_COLS.corso, C.E_COLS.tipo, C.E_COLS.inizio].indexOf(h) >= 0; }) };
    var usati = {}; out.iscrizioni.forEach(function (e) { usati[e.id] = 1; });
    t.rows.forEach(function (r) {
      var key = C.tokenKey(r.allieva), trovate = out.allieve.filter(function (a) { return C.tokenKey(a.name) === key; });
      if (!trovate.length) { res.saltate.push('Riga ' + r.row + ': l\'allieva "' + r.allieva + '" non è nell\'archivio (importa prima il foglio ANAGRAFICA).'); return; }
      if (trovate.length > 1) { res.saltate.push('Riga ' + r.row + ': ci sono ' + trovate.length + ' allieve che si chiamano "' + r.allieva + '". Inserisci questa iscrizione a mano dalla scheda giusta.'); return; }
      var m = { exact: trovate[0] };
      var o = pulisciIscrizione({ corso: r.corso, giorni: r.giorni, fascia: r.fascia, pacchetto: r.pacchetto, tipo: r.tipo, inizio: r.inizio, quota: r.quotaN, annullata: r.annullata === 'Sì' || r.stato === 'ANNULLATO', storica: r.stato === 'STORICO', note: r.note });
      var e = Object.assign({ allievaId: m.exact.id }, o);
      if (out.iscrizioni.some(function (x) { return stessaIscrizione(x, e); })) { res.giaPresenti++; return; }
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
    var rows = [['N.', 'N. allieva', 'Allieva', 'Corso', 'Giorni', 'Fascia oraria', 'Tariffa / Pacchetto', 'Tipo abbonamento', 'Data inizio', 'Scadenza', 'Stato abbonamento', 'Quota', 'Note']];
    db.iscrizioni.forEach(function (e) {
      var s = statoIscrizione(db, e, today), q = quotaDovuta(db, e);
      rows.push([e.id, e.allievaId, nomeAllieva(db, e.allievaId), e.corso, e.giorni.join(', '), e.fascia, e.pacchetto, e.tipo, C.isoToIt(e.inizio), C.isoToIt(s.scadenza), s.stato, q === null ? '' : String(q).replace('.', ','), e.note]);
    });
    return csv(rows);
  }

  var Logic = {
    SCHEMA: SCHEMA, TIPI: TIPI, GIORNI: GIORNI, A_CAMPI: A_CAMPI, I_CAMPI: I_CAMPI,
    nuovoArchivio: nuovoArchivio, validaArchivio: validaArchivio, completa: completa, stagioneDi: stagioneDi, byId: byId,
    scadenza: scadenza, statoIscrizione: statoIscrizione, corrente: corrente, quotaDovuta: quotaDovuta, iscrizioniDi: iscrizioniDi, nomeAllieva: nomeAllieva,
    riepilogo: riepilogo, scadenze: scadenze, cercaAllieve: cercaAllieve,
    pulisciAllieva: pulisciAllieva, controllaAllieva: controllaAllieva, salvaAllieva: salvaAllieva, archiviaAllieva: archiviaAllieva, eliminaAllieva: eliminaAllieva,
    pulisciIscrizione: pulisciIscrizione, controllaIscrizione: controllaIscrizione, salvaIscrizione: salvaIscrizione, rinnova: rinnova, eliminaIscrizione: eliminaIscrizione,
    controllaImpostazioni: controllaImpostazioni, salvaImpostazioni: salvaImpostazioni,
    leggiCsv: leggiCsv, riconosciFoglio: riconosciFoglio, importaAnagrafica: importaAnagrafica, importaIscrizioni: importaIscrizioni,
    csvAllieve: csvAllieve, csvIscrizioni: csvIscrizioni
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic; else root.Logic = Logic;
})(typeof self !== 'undefined' ? self : this);
