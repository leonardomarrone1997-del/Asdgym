/* Gym Art Segreteria - pure logic (no DOM, no network). Runs in the browser and in Node tests. */
(function (root) {
  'use strict';

  var SHEET_ID = '1QSztBzW-HojdXPCUbSGWqihCD8XD9dntB0m_hNJB5cU';
  var SERVER = 'Google Sheets';
  var SHEETS = {
    ANA: { name: 'ANAGRAFICA', range: 'ANAGRAFICA!2:402', maxRow: 402 },
    ISC: { name: 'ISCRIZIONI', range: 'ISCRIZIONI!2:502', maxRow: 502 },
    PAG: { name: 'PAGAMENTI', range: 'PAGAMENTI!2:1502', maxRow: 1502 },
    REG: { name: 'REGISTRO SCANSIONI', range: "'REGISTRO SCANSIONI'!2:1000", append: "'REGISTRO SCANSIONI'!A2:J" },
    LIS: { name: 'LISTE', range: 'LISTE!3:13' },
    TAR: { name: 'TARIFFARIO', range: 'TARIFFARIO!3:15' }
  };

  /* ---------- small utilities ---------- */
  function colLetter(i) { var s = ''; i += 1; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function stripAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function norm(s) { return stripAccents(str(s).toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var PARTICLES = { di: 1, de: 1, del: 1, della: 1, dello: 1, dei: 1, degli: 1, da: 1, dal: 1, la: 1, lo: 1, li: 1, le: 1 };
  function capWord(w) {
    if (!w) return w;
    // keep apostrophes: D'ALESSANDRO -> D'Alessandro, L'AQUILA -> L'Aquila
    return w.split("'").map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p; }).join("'");
  }
  function titleCase(s) {
    s = str(s).replace(/\s+/g, ' ').replace(/[‘’`]/g, "'");
    if (!s) return '';
    return s.split(' ').map(function (w) { return w.split('-').map(capWord).join('-'); }).join(' ');
  }
  function titleCasePlace(s) {
    // places and addresses: lowercase particles in the middle ("Magliano dei Marsi", "Via dei Mille 76")
    var words = titleCase(s).split(' ');
    return words.map(function (w, i) { return i > 0 && PARTICLES[w.toLowerCase()] ? w.toLowerCase() : w; }).join(' ');
  }

  /* ---------- dates ---------- */
  function validYmd(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function isIso(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s)); return !!m && validYmd(+m[1], +m[2], +m[3]); }
  /** Italian date (dd/mm/yyyy, dd.mm.yy, d-m-yyyy) or ISO -> ISO string, else null. Two-digit years: 00..(pivot) -> 20xx, else 19xx. */
  function parseDate(s, pivotYear) {
    s = str(s);
    if (!s) return null;
    if (isIso(s)) return s;
    var m = /^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    var d = +m[1], mo = +m[2], y = +m[3];
    if (m[3].length === 2) { var piv = pivotYear === undefined ? 40 : pivotYear; y = y <= piv ? 2000 + y : 1900 + y; }
    return validYmd(y, mo, d) ? y + '-' + pad2(mo) + '-' + pad2(d) : null;
  }
  function isoToIt(iso) { return isIso(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }
  function todayIso(now) { now = now || new Date(); return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()); }
  function isoToUtc(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function daysBetween(fromIso, toIso) { return Math.round((isoToUtc(toIso) - isoToUtc(fromIso)) / 86400000); }
  function addMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n, d = +iso.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    if (d > last) d = last;
    return y + '-' + pad2(m + 1) + '-' + pad2(d);
  }
  function addYears(iso, n) { return addMonths(iso, 12 * n); }
  function ageOn(birthIso, onIso) {
    var a = +onIso.slice(0, 4) - +birthIso.slice(0, 4);
    if (onIso.slice(5) < birthIso.slice(5)) a -= 1;
    return a;
  }
  /** Google Sheets serial number (days since 1899-12-30) for a local date-time. */
  function toSerial(now) {
    now = now || new Date();
    var days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
    var frac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
    return Math.round((days + frac) * 1e6) / 1e6;
  }

  /* ---------- money, phone, email ---------- */
  /** "1.234,56 €" (sheet display) or "170", "170,5", 170 -> number; empty / "-" / text -> null. */
  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).replace(/[€\s ]/g, '');
    if (!s || s === '-') return null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
    else if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return '';
    var neg = n < 0; n = Math.abs(Math.round(n * 100) / 100);
    var parts = n.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + parts[0] + ',' + parts[1] + ' €';
  }
  function cleanPhone(s) {
    var d = str(s).replace(/[^\d+]/g, '');
    if (d.indexOf('+39') === 0) d = d.slice(3);
    else if (d.indexOf('0039') === 0) d = d.slice(4);
    return d.replace(/\D/g, '');
  }
  /** Number for a 'number' field: a JS number, or typed / displayed text read like parseMoney ("1.200" is 1200); NaN if unreadable. */
  function toNum(v) { var n = parseMoney(v); return n === null ? NaN : n; }
  function validPhone(s) { var d = cleanPhone(s); return d.length >= 9 && d.length <= 11; }
  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(str(s)); }

  /* ---------- codice fiscale ---------- */
  var CF_ODD = { '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
  var CF_MONTHS = 'ABCDEHLMPRST';
  var CF_OMO = 'LMNPQRSTUV';
  var CF_RE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
  function cfNormalize(s) { return str(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function cfControlChar(cf15) {
    var sum = 0;
    for (var i = 0; i < 15; i++) {
      var c = cf15.charAt(i);
      if (i % 2 === 0) sum += CF_ODD[c];
      else sum += /\d/.test(c) ? +c : c.charCodeAt(0) - 65;
    }
    return String.fromCharCode(65 + (sum % 26));
  }
  function cfDeomocode(cf) {
    var out = cf.split('');
    [6, 7, 9, 10, 12, 13, 14].forEach(function (i) { var k = CF_OMO.indexOf(out[i]); if (k >= 0) out[i] = String(k); });
    return out.join('');
  }
  function consonants(s) { return stripAccents(str(s).toUpperCase()).replace(/[^A-Z]/g, '').replace(/[AEIOU]/g, ''); }
  function vowels(s) { return stripAccents(str(s).toUpperCase()).replace(/[^A-Z]/g, '').replace(/[^AEIOU]/g, ''); }
  function cfSurnameCode(s) { return (consonants(s) + vowels(s) + 'XXX').slice(0, 3); }
  function cfNameCode(s) {
    var c = consonants(s);
    if (c.length >= 4) return c.charAt(0) + c.charAt(2) + c.charAt(3);
    return (c + vowels(s) + 'XXX').slice(0, 3);
  }
  /**
   * Checks a codice fiscale. opts: { fullName: "Cognome Nome" (any order), birthIso }.
   * Returns { cf, valid, errors[], warnings[], decoded }. `valid` is false only for format / control-character errors.
   */
  function cfCheck(raw, opts) {
    opts = opts || {};
    var cf = cfNormalize(raw);
    var res = { cf: cf, valid: false, errors: [], warnings: [], decoded: null };
    if (!cf) { res.errors.push('Codice fiscale vuoto.'); return res; }
    if (cf.length !== 16) { res.errors.push('Deve avere 16 caratteri: ne ha ' + cf.length + '.'); return res; }
    if (!CF_RE.test(cf)) { res.errors.push('Formato non valido: controlla lettere e numeri.'); return res; }
    var expected = cfControlChar(cf.slice(0, 15));
    if (expected !== cf.charAt(15)) { res.errors.push('Carattere di controllo errato: un carattere è stato letto o scritto male.'); return res; }
    res.valid = true;
    var plain = cfDeomocode(cf);
    var yy = +plain.slice(6, 8), mm = CF_MONTHS.indexOf(plain.charAt(8)) + 1, dd = +plain.slice(9, 11);
    var sex = dd > 40 ? 'F' : 'M';
    if (dd > 40) dd -= 40;
    res.decoded = { yy: yy, month: mm, day: dd, sex: sex, place: plain.slice(11, 15) };
    if (opts.birthIso && isIso(opts.birthIso)) {
      var b = opts.birthIso;
      if (+b.slice(2, 4) !== yy || +b.slice(5, 7) !== mm || +b.slice(8, 10) !== dd) {
        res.warnings.push('Non corrisponde alla data di nascita (' + isoToIt(b) + '): dal codice risulta ' + pad2(dd) + '/' + pad2(mm) + '/…' + pad2(yy) + '.');
      }
    }
    if (opts.fullName && norm(opts.fullName)) {
      var t = norm(opts.fullName).split(' '), ok = false, sc = cf.slice(0, 3), nc = cf.slice(3, 6);
      if (t.length === 1) ok = cfSurnameCode(t[0]) === sc || cfNameCode(t[0]) === nc;
      for (var k = 1; k < t.length && !ok; k++) {
        var a = t.slice(0, k).join(''), z = t.slice(k).join('');
        if ((cfSurnameCode(a) === sc && cfNameCode(z) === nc) || (cfSurnameCode(z) === sc && cfNameCode(a) === nc)) ok = true;
      }
      if (!ok) res.warnings.push('Non corrisponde a cognome e nome (' + str(opts.fullName) + ').');
    }
    return res;
  }

  /* ---------- names and matching ---------- */
  function tokenKey(name) { return norm(name).split(' ').filter(Boolean).sort().join(' '); }
  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function similarity(a, b) {
    var x = norm(a), y = norm(b); if (!x || !y) return 0;
    var s1 = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
    var kx = tokenKey(a), ky = tokenKey(b);
    var s2 = 1 - levenshtein(kx, ky) / Math.max(kx.length, ky.length);
    return Math.max(s1, s2);
  }
  /** Finds a student by full name. exact = same words in any order; candidates = similar names (score >= 0.72). */
  function matchStudent(students, fullName) {
    var key = tokenKey(fullName), exact = null, cands = [];
    if (!key) return { exact: null, candidates: [] };
    students.forEach(function (s) {
      if (tokenKey(s.name) === key) { if (!exact) exact = s; return; }
      var sc = similarity(s.name, fullName);
      if (sc >= 0.72) cands.push({ student: s, score: Math.round(sc * 100) / 100 });
    });
    cands.sort(function (p, q) { return q.score - p.score; });
    return { exact: exact, candidates: cands.slice(0, 5) };
  }
  /** Puts the surname first when the parent's name shares a word with the athlete's name ("Daniela Neri" + "Daniel Neri" -> "Neri Daniela"). */
  function surnameFirst(athlete, parent) {
    var a = titleCase(athlete).split(' ').filter(Boolean), p = norm(parent).split(' ').filter(Boolean);
    if (a.length < 2 || !p.length) return { name: a.join(' '), changed: false };
    var shared = a.filter(function (w) { return p.indexOf(norm(w)) >= 0; });
    if (!shared.length || shared.length === a.length) return { name: a.join(' '), changed: false };
    var rest = a.filter(function (w) { return shared.indexOf(w) < 0; });
    var out = shared.concat(rest).join(' ');
    return { name: out, changed: out !== a.join(' ') };
  }

  /* ---------- sheet parsing ---------- */
  function headerMap(row) { var m = {}; (row || []).forEach(function (h, i) { h = str(h); if (h && !(h in m)) m[h] = i; }); return m; }
  function missingHeaders(map, names) { return names.filter(function (n) { return !(n in map); }); }
  function cell(row, map, header) { var i = map[header]; return i === undefined || !row ? '' : str(row[i]); }

  var S_COLS = { name: 'Cognome e Nome', tel: 'Telefono', tel2: 'Secondo telefono', genitore: 'Genitore / Referente', cfGenitore: 'CF genitore', email: 'Email', nascita: 'Data di nascita', luogo: 'Luogo di nascita', cf: 'Codice fiscale', indirizzo: 'Indirizzo', citta: 'Città', cap: 'CAP', privacy: 'Consenso privacy', liberatoria: 'Liberatoria foto/video', dataModulo: 'Data modulo iscrizione', certTipo: 'Certificato medico', certRilascio: 'Rilascio certificato', certScadenza: 'Scadenza certificato', note: 'Note' };
  var S_KIND = { nascita: 'date', dataModulo: 'date', certRilascio: 'date', certScadenza: 'date', privacy: 'list', liberatoria: 'list', certTipo: 'list' };
  var S_EXTRA = { id: 'ID', stato: 'Stato iscrizione', dovuto: 'Totale dovuto', pagato: 'Totale pagato', residuo: 'Residuo', certStato: 'Stato certificato', tessera: 'N° tessera EPS/FGI' };
  var E_COLS = { allieva: 'Allieva', corso: 'Corso', fascia: 'Fascia oraria', giorni: 'Giorni', pacchetto: 'Tariffa / Pacchetto', tipo: 'Tipo abbonamento', inizio: 'Data inizio', quota: 'Quota concordata (sostituisce il tariffario)', annullata: 'Annullata?', note: 'Note' };
  var E_KIND = { inizio: 'date', quota: 'number', corso: 'list', pacchetto: 'list', tipo: 'list', annullata: 'list' };
  var E_EXTRA = { id: 'ID', scadenza: 'Scadenza', stato: 'Stato abbonamento', dovuto: 'Totale dovuto', pagato: 'Totale pagato', residuo: 'Residuo', statoPag: 'Stato pagamento', chiave: 'Chiave elenco' };
  var P_COLS = { data: 'Data pagamento', iscrizione: "Iscrizione (scegli dall'elenco)", importo: 'Importo', metodo: 'Metodo', note: 'Note' };
  var P_KIND = { data: 'date', importo: 'number', iscrizione: 'list', metodo: 'list' };
  var P_EXTRA = { ricevuta: 'N. ricevuta', idIscr: 'ID iscrizione', allieva: 'Allieva', corso: 'Corso' };
  var REG_HEAD = ['Data e ora', 'Allieva', 'Documento', 'Operazione', 'Foglio', 'Riga', 'Campo', 'Valore precedente', 'Valore nuovo', 'Note'];

  function values(obj) { return Object.keys(obj).map(function (k) { return obj[k]; }); }
  function parseTable(vals, cols, kinds, extra, keyField, moneyFields) {
    vals = vals || [];
    var map = headerMap(vals[0]);
    var missing = missingHeaders(map, values(cols).concat(values(extra)));
    var rows = [], firstEmpty = null;
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i] || [], rowNo = i + 2;
      var o = { row: rowNo };
      Object.keys(cols).forEach(function (k) {
        var v = cell(r, map, cols[k]);
        if (kinds[k] === 'date') v = parseDate(v) || '';
        o[k] = v;
      });
      Object.keys(extra).forEach(function (k) { o[k] = cell(r, map, extra[k]); });
      (moneyFields || []).forEach(function (k) { o[k + 'N'] = parseMoney(o[k]); });
      var empty = keyField.every(function (k) { return !o[k]; });
      if (empty) { if (firstEmpty === null) firstEmpty = rowNo; continue; }
      rows.push(o);
    }
    if (firstEmpty === null) firstEmpty = vals.length + 2;
    if (vals.length === 0) firstEmpty = 3;
    return { map: map, missing: missing, rows: rows, firstEmpty: firstEmpty };
  }
  function parseStudents(vals) {
    var t = parseTable(vals, S_COLS, S_KIND, S_EXTRA, ['name'], ['dovuto', 'pagato', 'residuo']);
    if (t.firstEmpty > SHEETS.ANA.maxRow) t.firstEmpty = null;
    return t;
  }
  function parseEnrollments(vals) {
    var t = parseTable(vals, E_COLS, E_KIND, E_EXTRA, ['allieva'], ['dovuto', 'pagato', 'residuo', 'quota']);
    t.rows.forEach(function (e) { e.scadenza = parseDate(e.scadenza) || ''; e.active = e.annullata !== 'Sì' && e.stato !== 'STORICO' && e.stato !== 'ANNULLATO'; });
    if (t.firstEmpty > SHEETS.ISC.maxRow) t.firstEmpty = null;
    return t;
  }
  function parsePayments(vals) {
    var t = parseTable(vals, P_COLS, P_KIND, P_EXTRA, ['data', 'iscrizione', 'importo', 'metodo'], ['importo']);
    if (t.firstEmpty > SHEETS.PAG.maxRow) t.firstEmpty = null;
    return t;
  }
  function parseRegistro(vals) {
    vals = vals || [];
    var out = [];
    for (var i = 1; i < vals.length; i++) {
      var r = vals[i] || [];
      if (!str(r[1]) && !str(r[0])) continue;
      out.push({ row: i + 2, quando: str(r[0]), allieva: str(r[1]), documento: str(r[2]), operazione: str(r[3]), foglio: str(r[4]), riga: str(r[5]), campo: str(r[6]), prima: str(r[7]), dopo: str(r[8]), note: str(r[9]) });
    }
    return { headerOk: str((vals[0] || [])[0]) === REG_HEAD[0], rows: out };
  }
  /** LISTE!3:13 -> { corsi, fasce, tipi:[{nome,mesi}], metodi, certTipi, params:{label:value} }. Lists are found by their header text. */
  function parseListe(vals) {
    vals = vals || [];
    var map = headerMap(vals[0]);
    function list(h) { var i = map[h], out = []; if (i === undefined) return out; for (var r = 1; r < vals.length; r++) { var v = str((vals[r] || [])[i]); if (v) out.push(v); } return out; }
    var tipi = [], it = map['Tipo abbonamento'], im = map['Mesi'];
    if (it !== undefined) for (var r = 1; r < vals.length; r++) { var n = str((vals[r] || [])[it]); if (n) tipi.push({ nome: n, mesi: im === undefined ? null : parseInt(str(vals[r][im]), 10) || null }); }
    var params = {}, ip = map['Parametro'], iv = map['Valore'];
    if (ip !== undefined && iv !== undefined) for (var q = 1; q < vals.length; q++) { var lab = str((vals[q] || [])[ip]); if (lab) params[lab] = str(vals[q][iv]); }
    function param(prefix) { var k = Object.keys(params).filter(function (l) { return l.indexOf(prefix) === 0; })[0]; return k ? params[k] : ''; }
    return {
      corsi: list('Corsi'), fasce: list('Fascia oraria'), tipi: tipi, metodi: list('Metodo di pagamento'), certTipi: list('Certificato medico'),
      missing: missingHeaders(map, ['Corsi', 'Fascia oraria', 'Tipo abbonamento', 'Metodo di pagamento', 'Certificato medico', 'Parametro', 'Valore']),
      fasceCol: map['Fascia oraria'],
      settings: {
        stagione: param('Stagione sportiva') || '2026/2027',
        preavvisoCert: parseInt(param('Giorni di preavviso: certificato'), 10) || 30,
        preavvisoAbb: parseInt(param('Giorni di preavviso: abbonamento'), 10) || 30,
        legale: param('Legale rappresentante'), ente: param('Ente di affiliazione'), codice: param('Codice di affiliazione')
      }
    };
  }
  function parseTariffario(vals) {
    vals = vals || [];
    var map = headerMap(vals[0]), out = [];
    for (var r = 1; r < vals.length; r++) {
      var row = vals[r] || [], chiave = cell(row, map, 'Chiave pacchetto (menu a tendina)');
      if (!chiave) continue;
      out.push({ chiave: chiave, pacchetto: cell(row, map, 'Corso / Pacchetto'), frequenza: cell(row, map, 'Frequenza'),
        Mensile: parseMoney(cell(row, map, 'Mensile')), Trimestrale: parseMoney(cell(row, map, 'Trimestrale')), Semestrale: parseMoney(cell(row, map, 'Semestrale')), Annuale: parseMoney(cell(row, map, 'Annuale')),
        iscrizione: parseMoney(cell(row, map, 'Iscrizione (€)')) || 0 });
    }
    return { rows: out, missing: missingHeaders(map, ['Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Annuale', 'Chiave pacchetto (menu a tendina)']) };
  }

  /* ---------- tariff suggestions ---------- */
  function freqDays(p) { var m = /^(\d)\s*giorn/.exec(norm(p.frequenza)); if (m) return +m[1]; m = /\((\d)\s*giorn/.exec(p.pacchetto.toLowerCase()); return m ? +m[1] : null; }
  function suggestPacchetto(tariff, corso, nGiorni) {
    var c = norm(corso), re = null;
    if (!c) return '';
    if (c.indexOf('propedeutico') >= 0) re = /propedeutico/;
    else if (c.indexOf('preagon') >= 0 || c.indexOf('pre agon') >= 0) re = /preagonistic/;
    else if (c.indexOf('agonis') >= 0) re = /^corso agonistic/;
    else if (c.indexOf('fitkid') >= 0) re = /fitkid/;
    else if (c.indexOf('base') >= 0 || c.indexOf('avanzato') >= 0) re = /base e avanzato/;
    if (!re) return '';
    var hits = tariff.filter(function (p) { return re.test(norm(p.pacchetto)); });
    if (nGiorni) hits = hits.filter(function (p) { return freqDays(p) === nGiorni; });
    return hits.length === 1 ? hits[0].chiave : '';
  }
  function quotaTariffario(tariff, chiave, tipo) {
    var p = tariff.filter(function (x) { return x.chiave === chiave; })[0];
    if (!p || !tipo) return null;
    var q = p[tipo];
    return typeof q === 'number' ? q : null;
  }

  /* ---------- values for the sheet ---------- */
  /** Value as sent to update_values (parsed like typed input): text gets a leading apostrophe so it is never turned into a number or date. */
  function encodeValue(value, kind) {
    if (value === null || value === undefined || value === '') return '';
    if (kind === 'number') return toNum(value);
    if (kind === 'date' || kind === 'list') return String(value);
    return "'" + String(value);
  }
  /** What the sheet should show after writing value. */
  function expectedDisplay(value, kind) {
    if (value === null || value === undefined || value === '') return '';
    if (kind === 'date') return isoToIt(String(value));
    if (kind === 'number') return fmtMoney(toNum(value));
    return String(value).trim();
  }
  function sameDisplay(shown, value, kind) {
    shown = str(shown);
    if (kind === 'number') { var a = parseMoney(shown), b = value === '' || value === null || value === undefined ? null : toNum(value); return a === b || (a !== null && b !== null && Math.abs(a - b) < 0.005); }
    return shown === expectedDisplay(value, kind);
  }
  /** One update for one row: contiguous range from the first to the last touched column, null where nothing changes. */
  function buildRowUpdate(sheetName, map, row, ops) {
    if (!ops || !ops.length) throw new Error('Nessuna modifica da scrivere nel foglio ' + sheetName + '.');
    var idx = ops.map(function (o) { return map[o.header]; });
    if (idx.some(function (i) { return i === undefined; })) throw new Error('Colonna non trovata nel foglio ' + sheetName + ': ' + ops.filter(function (o) { return map[o.header] === undefined; }).map(function (o) { return o.header; }).join(', '));
    var lo = Math.min.apply(null, idx), hi = Math.max.apply(null, idx), vals = [];
    for (var i = lo; i <= hi; i++) vals.push(null);
    ops.forEach(function (o) { vals[map[o.header] - lo] = encodeValue(o.value, o.kind); });
    var q = /[^A-Za-z0-9_]/.test(sheetName) ? "'" + sheetName.replace(/'/g, "''") + "'" : sheetName;
    return { range: q + '!' + colLetter(lo) + row + ':' + colLetter(hi) + row, values: [vals] };
  }
  function verifyRow(displayRow, map, ops) {
    var bad = [];
    ops.forEach(function (o) { var shown = cell(displayRow, map, o.header); if (!sameDisplay(shown, o.value, o.kind)) bad.push({ header: o.header, atteso: expectedDisplay(o.value, o.kind), trovato: shown }); });
    return bad;
  }
  function registroRows(serial, allieva, documento, operazione, foglio, riga, ops) {
    return ops.map(function (o) {
      var prev = expectedDisplay(o.prev === undefined ? '' : o.prev, o.kind), now = expectedDisplay(o.value, o.kind);
      return [serial, allieva, documento, operazione, foglio, riga, o.header, prev ? "'" + prev : '', now ? "'" + now : '', o.note || ''];
    });
  }

  /* ---------- building the changes ---------- */
  function sameValue(a, b, kind) {
    if (kind === 'number') return Math.abs(toNum(a) - toNum(b)) < 0.005;
    if (kind === 'date') return String(a) === String(b);
    return norm(a) === norm(b);
  }
  /**
   * Compares form values with a student row (or null for a new one).
   * fields: { key: value } using S_COLS keys. force: keys that always replace (certificate data).
   * Returns { ops:[{key, header, kind, value, prev, note}], conflicts:[{key, header, kind, current, proposed}] }.
   */
  function diffRecord(current, fields, cols, kinds, force, notes) {
    var ops = [], conflicts = [];
    force = force || {}; notes = notes || {};
    Object.keys(fields).forEach(function (k) {
      if (!(k in cols)) return;
      var v = fields[k]; if (v === null || v === undefined || v === '') return;
      var kind = kinds[k] || 'text', cur = current ? current[k] : '';
      if (kind === 'number' && current) cur = current[k + 'N'] === null || current[k + 'N'] === undefined ? '' : current[k + 'N'];
      if (cur !== '' && cur !== null && cur !== undefined && sameValue(cur, v, kind)) return;
      var op = { key: k, header: cols[k], kind: kind, value: v, prev: cur === null || cur === undefined ? '' : cur, note: notes[k] || '' };
      if (cur === '' || cur === null || cur === undefined || force[k]) ops.push(op);
      else conflicts.push({ key: k, header: cols[k], kind: kind, current: cur, proposed: v, note: notes[k] || '' });
    });
    return { ops: ops, conflicts: conflicts };
  }
  function diffStudent(current, fields, force, notes) {
    var f = {}; Object.keys(fields).forEach(function (k) { f[k] = fields[k]; });
    // "Mancante" in the sheet means no certificate: a real type always replaces it
    if (current && current.certTipo === 'Mancante' && f.certTipo && f.certTipo !== 'Mancante') { force = Object.assign({}, force, { certTipo: true }); }
    if (current && f.certTipo === 'Mancante') delete f.certTipo;
    return diffRecord(current, f, S_COLS, S_KIND, force, notes);
  }
  function diffEnrollment(current, fields, notes) { return diffRecord(current, fields, E_COLS, E_KIND, null, notes); }
  function conflictToOp(c) { return { key: c.key, header: c.header, kind: c.kind, value: c.proposed, prev: c.current, note: c.note ? c.note + ' Valore precedente sostituito.' : 'Valore precedente sostituito.' }; }

  function mergeNote(existing, addition) {
    existing = str(existing); addition = str(addition);
    if (!addition) return '';
    if (!existing) return addition;
    if (existing.indexOf(addition) >= 0) return '';
    return existing + ' | ' + addition;
  }

  /* ---------- checks ---------- */
  function checkModulo(f, today) {
    today = today || todayIso();
    var err = [], warn = [];
    if (!norm(f.name)) err.push('Manca cognome e nome dell\'atleta.');
    else if (norm(f.name).split(' ').length < 2) err.push('Cognome e nome: servono almeno due parole.');
    if (f.nascita) {
      if (!isIso(f.nascita)) err.push('Data di nascita non valida.');
      else { var age = ageOn(f.nascita, today); if (age < 2 || age > 90) err.push('Data di nascita impossibile (' + isoToIt(f.nascita) + ', ' + age + ' anni): spesso sul modulo viene scritto l\'anno corrente. Correggi l\'anno.'); }
    } else warn.push('Data di nascita mancante.');
    if (f.cf) { var c = cfCheck(f.cf, { fullName: f.name, birthIso: f.nascita }); c.errors.forEach(function (e) { err.push('Codice fiscale atleta: ' + e); }); c.warnings.forEach(function (w) { warn.push('Codice fiscale atleta: ' + w); }); }
    if (f.cfGenitore) { var g = cfCheck(f.cfGenitore, { fullName: f.genitore }); g.errors.forEach(function (e) { err.push('Codice fiscale genitore: ' + e); }); g.warnings.forEach(function (w) { warn.push('Codice fiscale genitore: ' + w); }); }
    if (f.tel && !validPhone(f.tel)) err.push('Telefono non valido: deve avere 9-11 cifre.');
    if (!f.tel) warn.push('Telefono mancante.');
    if (f.tel2 && !validPhone(f.tel2)) err.push('Secondo telefono non valido.');
    if (f.email && !validEmail(f.email)) err.push('Email non valida.');
    if (f.cap && !/^\d{5}$/.test(str(f.cap))) err.push('CAP non valido: servono 5 cifre.');
    if (f.dataModulo && (!isIso(f.dataModulo) || f.dataModulo > today)) err.push('Data del modulo non valida o futura.');
    if (f.certScadenza && !isIso(f.certScadenza)) err.push('Scadenza del certificato non valida.');
    if (f.certScadenza && (!f.certTipo || f.certTipo === 'Mancante')) warn.push('C\'è una scadenza del certificato ma non il tipo.');
    return { errors: err, warnings: warn };
  }
  function checkIscrizione(e) {
    var err = [], warn = [];
    if (!e.corso) err.push('Scegli il corso (se non lo sai, "Da definire").');
    if (e.inizio && !isIso(e.inizio)) err.push('Data di inizio non valida.');
    if ((e.tipo && !e.inizio) || (!e.tipo && e.inizio)) warn.push('Per avere la scadenza dell\'abbonamento servono sia il tipo sia la data di inizio.');
    if (!e.tipo && !e.inizio) warn.push('Tipo di abbonamento e data di inizio mancanti: l\'iscrizione resterà "da completare".');
    if (e.quota !== '' && e.quota !== null && e.quota !== undefined && !(Number(e.quota) >= 0)) err.push('Quota concordata non valida.');
    return { errors: err, warnings: warn };
  }
  function checkPagamento(p, enrollment, payments, today) {
    today = today || todayIso();
    var err = [], warn = [];
    if (!enrollment) err.push('Scegli l\'iscrizione a cui si riferisce il pagamento.');
    var imp = typeof p.importo === 'number' ? p.importo : parseMoney(p.importo);
    if (imp === null || !(imp > 0)) err.push('Importo mancante o non valido.');
    if (!p.metodo) err.push('Scegli il metodo di pagamento.');
    if (!p.data || !isIso(p.data)) err.push('Data del pagamento mancante o non valida.');
    else if (p.data > today) err.push('La data del pagamento è nel futuro.');
    else if (p.data < '2025-01-01') err.push('La data del pagamento è troppo vecchia.');
    if (enrollment && imp > 0) {
      var res = enrollment.residuoN, dov = enrollment.dovutoN;
      if (dov !== null && dov > 0 && res !== null && imp > res + 0.005) warn.push('L\'importo (' + fmtMoney(imp) + ') supera il residuo dell\'iscrizione (' + fmtMoney(res) + '): risulterà un\'eccedenza.');
      if (dov === 0 || dov === null) warn.push('Questa iscrizione non ha ancora un totale dovuto: il pagamento sarà registrato ma non risulterà saldata finché non c\'è una quota.');
      var id = parseInt(enrollment.id, 10);
      var dup = (payments || []).filter(function (x) { return parseInt(x.idIscr, 10) === id && x.data === p.data && x.importoN !== null && Math.abs(x.importoN - imp) < 0.005; });
      if (dup.length) warn.push('Esiste già un pagamento uguale (stessa iscrizione, stessa data, stesso importo, ricevuta ' + (dup[0].ricevuta || 'senza numero') + '). Controlla di non registrarlo due volte.');
    }
    return { errors: err, warnings: warn, importo: imp };
  }
  function checkCertificato(c, student, today) {
    today = today || todayIso();
    var err = [], warn = [];
    if (!student) err.push('Scegli l\'allieva a cui appartiene il certificato.');
    if (c.certTipo !== 'Agonistico' && c.certTipo !== 'Non Agonistico') err.push('Scegli il tipo: Agonistico o Non Agonistico.');
    if (!c.certRilascio || !isIso(c.certRilascio)) err.push('Data di rilascio mancante o non valida.');
    else if (c.certRilascio > today) err.push('La data di rilascio è nel futuro.');
    if (!c.certScadenza || !isIso(c.certScadenza)) err.push('Data di scadenza mancante o non valida.');
    if (isIso(c.certRilascio) && isIso(c.certScadenza)) {
      var d = daysBetween(c.certRilascio, c.certScadenza);
      if (d <= 0) err.push('La scadenza è prima del rilascio.');
      else if (d > 366) err.push('La scadenza è a più di un anno dal rilascio: un certificato vale al massimo un anno.');
      else if (d < 300) warn.push('La validità è più corta di un anno (' + d + ' giorni): controlla le date.');
      if (c.certScadenza < today) warn.push('Questo certificato è già scaduto il ' + isoToIt(c.certScadenza) + '.');
    }
    if (student && student.certScadenza && isIso(c.certScadenza) && student.certScadenza > c.certScadenza) warn.push('Nel foglio c\'è già una scadenza più recente (' + isoToIt(student.certScadenza) + '): questo certificato sembra più vecchio.');
    if (c.originale === 'ludico_motoria') warn.push('Il certificato è per attività ludico-motoria, non per attività sportiva non agonistica: è un tipo diverso.');
    if (c.originale === 'altro') warn.push('Il tipo di certificato non è chiaro: controlla il titolo sulla foto.');
    if (c.rilascioAPenna) warn.push('La data di rilascio è scritta a penna sul certificato.');
    if (c.cf) { var k = cfCheck(c.cf, { fullName: c.name || (student && student.name), birthIso: c.nascita || (student && student.nascita) }); k.errors.forEach(function (e) { err.push('Codice fiscale: ' + e); }); k.warnings.forEach(function (w) { warn.push('Codice fiscale: ' + w); }); }
    if (c.nascita && student && student.nascita && c.nascita !== student.nascita) warn.push('La data di nascita sul certificato (' + isoToIt(c.nascita) + ') è diversa da quella nel foglio (' + isoToIt(student.nascita) + ').');
    return { errors: err, warnings: warn };
  }

  /* ---------- deadlines ---------- */
  function certStatus(s, today, preavviso) {
    if (!s.certTipo || s.certTipo === 'Mancante' || !s.certScadenza) return { stato: 'MANCANTE', giorni: null };
    var g = daysBetween(today, s.certScadenza);
    return { stato: g < 0 ? 'SCADUTO' : g <= preavviso ? 'IN SCADENZA' : 'VALIDO', giorni: g };
  }
  function scadenze(db, today) {
    today = today || todayIso();
    var out = { validi: 0, inScadenza: [], scaduti: [], mancanti: [], abbonamenti: [] };
    db.students.forEach(function (s) {
      var c = certStatus(s, today, db.settings.preavvisoCert), item = { student: s, giorni: c.giorni };
      if (c.stato === 'VALIDO') out.validi++; else if (c.stato === 'IN SCADENZA') out.inScadenza.push(item); else if (c.stato === 'SCADUTO') out.scaduti.push(item); else out.mancanti.push(item);
    });
    out.inScadenza.sort(function (a, b) { return a.giorni - b.giorni; });
    out.scaduti.sort(function (a, b) { return b.giorni - a.giorni; });
    db.enrollments.forEach(function (e) {
      if (!e.active || !e.scadenza) return;
      var g = daysBetween(today, e.scadenza);
      if (g <= db.settings.preavvisoAbb) out.abbonamenti.push({ enrollment: e, giorni: g });
    });
    out.abbonamenti.sort(function (a, b) { return a.giorni - b.giorni; });
    return out;
  }
  function waLink(tel, text) { var d = cleanPhone(tel); if (!d) return ''; return 'https://wa.me/39' + d + (text ? '?text=' + encodeURIComponent(text) : ''); }

  /* ---------- reading the photos ---------- */
  var CORSO_FROM_FORM = { baby: 'Propedeutico', base: 'Base', avanzato: 'Avanzato', preagonismo: 'Preagonismo', agonismo: 'Agonismo' };
  var DAY_ORDER = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  function buildPrompt() {
    return [
      'Sei l\'addetto alla segreteria di una palestra di ginnastica artistica italiana (A.S.D. Gym Art Avezzano). Ricevi la foto di UN documento: un modulo di iscrizione compilato a penna oppure un certificato medico sportivo.',
      'La prima immagine è la pagina intera; le eventuali immagini successive sono ingrandimenti di fasce orizzontali della stessa pagina, dall\'alto verso il basso, parzialmente sovrapposte: usale per leggere meglio la scrittura.',
      '',
      'REGOLE DI LETTURA',
      '- Trascrivi solo ciò che vedi. Se un valore è illeggibile o assente metti null: non inventare e non completare a senso.',
      '- Ogni volta che una lettura è incerta (una cifra, una lettera, un civico, un\'email) aggiungi una voce in "dubbi" con il campo e il motivo.',
      '- Date: nei campi data scrivi il formato AAAA-MM-GG. Nel modulo riporta anche la data di nascita esattamente come è scritta, in "data_nascita_come_scritta".',
      '- Codici fiscali: 16 caratteri, maiuscoli, senza spazi. Telefoni: solo cifre.',
      '- Caselle: true solo se la casella è davvero barrata o segnata; false se è barrata la casella opposta; null se nessuna delle due è barrata.',
      '- NON trascrivere note sanitarie, allergie, diagnosi o altri dati sulla salute: indica solo se sono presenti (note_sanitarie_presenti).',
      '',
      'ANNOTAZIONI DELLA SEGRETERIA (scritte a mano in un punto qualsiasi del modulo, spesso in basso a destra, oppure nel riquadro "RISERVATO ALLA SEGRETERIA")',
      '- Una "P", cerchiata o no, significa PAGATO.',
      '- "TRIM" = Trimestrale, "MENS" = Mensile, "SEM" = Semestrale, "ANN" = Annuale.',
      '- "mono" = 1 giorno a settimana, "bi" = 2 giorni, "tri" = 3 giorni.',
      '- Una data scritta vicino a queste annotazioni è la DATA DI INIZIO dell\'abbonamento, non la data del pagamento.',
      '',
      'CERTIFICATI MEDICI',
      '- tipo: "agonistico" se il titolo parla di pratica/attività sportiva AGONISTICA; "non_agonistico" se parla di attività sportiva NON agonistica; "ludico_motoria" se parla di attività ludico-motoria; altrimenti "altro".',
      '- data_rilascio: la data in cui il certificato è stato rilasciato (campo "Data", "Luogo e data di rilascio"). Se è scritta a penna su un certificato stampato, data_rilascio_a_penna = true.',
      '- data_scadenza: solo se una data di scadenza è scritta sul certificato ("scadrà il ..."); se c\'è scritto solo "validità annuale" lascia null.',
      '- In "atleta.cognome_nome" scrivi prima il cognome e poi il nome.',
      '',
      'Rispondi SOLO con un oggetto JSON con questa forma esatta (usa null dove manca il dato):',
      '{"tipo_documento":"modulo_iscrizione|certificato_medico|altro",',
      ' "atleta":{"cognome_nome":null,"data_nascita":null,"data_nascita_come_scritta":null,"luogo_nascita":null,"codice_fiscale":null,"indirizzo":null,"citta":null,"cap":null},',
      ' "genitore":{"cognome_nome":null,"codice_fiscale":null,"telefono":null,"email":null,"secondo_telefono":null},',
      ' "iscrizione":{"corso":"baby|base|avanzato|preagonismo|agonismo|null","giorni":["Lun","Mar","Mer","Gio","Ven","Sab"],"orario":null,"quota_iscrizione":null,"quota_mensile":null,"sconto_fratelli":null,"modalita_pagamento":"Contanti|Bonifico|Carta|null","certificato_tipo":"agonistico|non_agonistico|null","certificato_scadenza":null,"note_sanitarie_presenti":false},',
      ' "consensi":{"privacy":null,"liberatoria":null,"data_modulo":null,"firma_genitore":false,"firma_societa":false},',
      ' "segreteria":{"pagato":false,"importo":null,"metodo":"Contanti|Bonifico|POS|null","data_pagamento":null,"tipo_abbonamento":"Mensile|Trimestrale|Semestrale|Annuale|null","giorni_settimana":null,"data_inizio":null,"annotazioni":null},',
      ' "certificato":{"tipo":"agonistico|non_agonistico|ludico_motoria|altro|null","titolo":null,"data_rilascio":null,"data_rilascio_a_penna":false,"data_scadenza":null,"validita_testo":null},',
      ' "dubbi":[{"campo":"","motivo":""}]}',
      '"giorni" contiene solo i giorni barrati (lista vuota se nessuno). Per un certificato compila "atleta" e "certificato" e lascia il resto ai valori vuoti; per un modulo lascia "certificato" ai valori vuoti.'
    ].join('\n');
  }
  function pick(o, k) { return o && typeof o === 'object' && o[k] !== undefined && o[k] !== null ? o[k] : null; }
  function txt(v) { return typeof v === 'string' || typeof v === 'number' ? str(v) : ''; }
  function tri(v) {
    if (typeof v === 'string') { var t = v.trim().toLowerCase(); v = t === 'true' ? true : t === 'false' ? false : null; } // a boolean sent as text
    return v === true ? true : v === false ? false : null;
  }
  function fascia(orario, fasce) {
    var o = txt(orario); if (!o) return { value: '', custom: false };
    var m = /(\d{1,2})(?:\s*[:.,]\s*(\d{2}))?/.exec(o); if (!m) return { value: o, custom: true };
    var start = pad2(+m[1]) + ':' + (m[2] || '00');
    var hit = (fasce || []).filter(function (f) { return f === start; })[0];
    if (hit) return { value: hit, custom: false };
    var all = o.match(/\d{1,2}(?:\s*[:.,]\s*\d{2})?/g) || [];
    if (all.length >= 2) { var e = /(\d{1,2})(?:\s*[:.,]\s*(\d{2}))?/.exec(all[1]); var lab = start + '-' + pad2(+e[1]) + ':' + (e[2] || '00'); var h2 = (fasce || []).filter(function (f) { return f === lab; })[0]; return { value: h2 || lab, custom: !h2 }; }
    return { value: start, custom: true };
  }
  /** Turns the model's JSON into clean form values. Never throws: anything unexpected becomes an empty field plus a doubt. */
  function normalizeAi(j, lists, tariff) {
    j = j && typeof j === 'object' ? j : {};
    lists = lists || { fasce: [] }; tariff = tariff || [];
    var a = pick(j, 'atleta') || {}, g = pick(j, 'genitore') || {}, i = pick(j, 'iscrizione') || {}, c = pick(j, 'consensi') || {}, s = pick(j, 'segreteria') || {}, ce = pick(j, 'certificato') || {};
    var dubbi = (Array.isArray(j.dubbi) ? j.dubbi : []).map(function (d) { return { campo: txt(pick(d, 'campo')), motivo: txt(pick(d, 'motivo')) }; }).filter(function (d) { return d.campo || d.motivo; });
    var tipoDoc = txt(j.tipo_documento); if (tipoDoc !== 'modulo_iscrizione' && tipoDoc !== 'certificato_medico') tipoDoc = 'altro';
    var genitore = titleCase(txt(g.cognome_nome));
    var nm = surnameFirst(txt(a.cognome_nome), tipoDoc === 'modulo_iscrizione' ? genitore : '');
    if (nm.changed) dubbi.push({ campo: 'Cognome e nome', motivo: 'Ho messo prima il cognome (uguale a quello del genitore): controlla l\'ordine.' });
    var nascita = parseDate(txt(a.data_nascita)) || parseDate(txt(a.data_nascita_come_scritta)) || '';
    var giorni = (Array.isArray(i.giorni) ? i.giorni : []).map(function (d) { return titleCase(txt(d)).slice(0, 3); }).filter(function (d) { return DAY_ORDER.indexOf(d) >= 0; });
    giorni = DAY_ORDER.filter(function (d) { return giorni.indexOf(d) >= 0; });
    var ck = txt(i.corso).toLowerCase(), corso = Object.prototype.hasOwnProperty.call(CORSO_FROM_FORM, ck) ? CORSO_FROM_FORM[ck] : '';
    var fa = fascia(i.orario, lists.fasce);
    var nG = giorni.length || (parseInt(txt(s.giorni_settimana), 10) || 0);
    var tipoAbb = ['Mensile', 'Trimestrale', 'Semestrale', 'Annuale'].indexOf(txt(s.tipo_abbonamento)) >= 0 ? txt(s.tipo_abbonamento) : '';
    var pacchetto = suggestPacchetto(tariff, corso, nG || null);
    var metodo = txt(s.metodo); if (['Contanti', 'Bonifico', 'POS'].indexOf(metodo) < 0) metodo = '';
    var modal = txt(i.modalita_pagamento); if (!metodo && modal) metodo = modal === 'Carta' ? 'POS' : (['Contanti', 'Bonifico'].indexOf(modal) >= 0 ? modal : '');
    var certTipoForm = txt(i.certificato_tipo) === 'agonistico' ? 'Agonistico' : txt(i.certificato_tipo) === 'non_agonistico' ? 'Non Agonistico' : '';
    var orig = txt(ce.tipo);
    var certTipo = orig === 'agonistico' ? 'Agonistico' : (orig === 'non_agonistico' || orig === 'ludico_motoria') ? 'Non Agonistico' : '';
    var rilascio = parseDate(txt(ce.data_rilascio)) || '', scadStampata = parseDate(txt(ce.data_scadenza)) || '';
    var priv = tri(c.privacy), lib = tri(c.liberatoria);
    return {
      tipoDocumento: tipoDoc, dubbi: dubbi,
      student: {
        name: nm.name, nascita: nascita, nascitaScritta: txt(a.data_nascita_come_scritta), luogo: titleCasePlace(txt(a.luogo_nascita)), cf: cfNormalize(txt(a.codice_fiscale)),
        indirizzo: titleCasePlace(txt(a.indirizzo)), citta: titleCasePlace(txt(a.citta)), cap: txt(a.cap).replace(/\D/g, ''),
        genitore: genitore, cfGenitore: cfNormalize(txt(g.codice_fiscale)), tel: cleanPhone(txt(g.telefono)), tel2: cleanPhone(txt(g.secondo_telefono)), email: txt(g.email).toLowerCase().replace(/\s+/g, ''),
        privacy: priv === false ? 'No' : 'Sì', liberatoria: lib === false ? 'No' : 'Sì', privacyBarrata: priv, liberatoriaBarrata: lib,
        dataModulo: parseDate(txt(c.data_modulo)) || '', firmaGenitore: c.firma_genitore === true, firmaSocieta: c.firma_societa === true,
        certTipo: certTipoForm, certScadenza: parseDate(txt(i.certificato_scadenza)) || '', noteSanitarie: i.note_sanitarie_presenti === true
      },
      enrollment: { corso: corso, giorni: giorni, fascia: fa.value, fasciaCustom: fa.custom, orarioScritto: txt(i.orario), pacchetto: pacchetto, tipo: tipoAbb, inizio: parseDate(txt(s.data_inizio)) || '', nGiorni: nG || null,
        quotaIscrizione: parseMoney(pick(i, 'quota_iscrizione')), quotaMensile: parseMoney(pick(i, 'quota_mensile')), scontoFratelli: tri(i.sconto_fratelli), modalita: modal, annotazioni: txt(s.annotazioni) },
      payment: { pagato: s.pagato === true, importo: parseMoney(pick(s, 'importo')), metodo: metodo, data: parseDate(txt(s.data_pagamento)) || '' },
      cert: { name: nm.name, certTipo: certTipo, originale: orig || '', titolo: txt(ce.titolo), certRilascio: rilascio, rilascioAPenna: ce.data_rilascio_a_penna === true,
        certScadenza: scadStampata || (rilascio ? addYears(rilascio, 1) : ''), scadenzaStampata: !!scadStampata, validita: txt(ce.validita_testo),
        nascita: nascita, luogo: titleCasePlace(txt(a.luogo_nascita)), cf: cfNormalize(txt(a.codice_fiscale)), indirizzo: titleCasePlace(txt(a.indirizzo)), citta: titleCasePlace(txt(a.citta)), cap: txt(a.cap).replace(/\D/g, '') }
    };
  }
  /** Text for the "Note" column of ISCRIZIONI, built only from what the form really says. */
  function notaModulo(st, en, pay) {
    var p = [];
    if (en.nGiorni && !en.giorni.length) p.push(en.nGiorni === 1 ? 'monosettimanale' : en.nGiorni + ' giorni a settimana');
    if (en.orarioScritto) p.push('orario ' + en.orarioScritto);
    if (en.quotaIscrizione !== null && en.quotaIscrizione !== undefined) p.push('iscrizione e tesseramento ' + fmtMoney(en.quotaIscrizione));
    if (en.quotaMensile !== null && en.quotaMensile !== undefined) p.push('quota mensile ' + fmtMoney(en.quotaMensile));
    if (en.scontoFratelli === true) p.push('sconto fratelli');
    if (en.modalita) p.push('pagamento previsto: ' + en.modalita);
    if (pay && pay.pagato) p.push('P sul modulo (pagato)');
    if (en.annotazioni) p.push('annotazioni: ' + en.annotazioni);
    var head = 'Modulo' + (st.dataModulo ? ' del ' + isoToIt(st.dataModulo) : '');
    return p.length ? head + ': ' + p.join('; ') + '.' : head + '.';
  }

  var Core = {
    SHEET_ID: SHEET_ID, SERVER: SERVER, SHEETS: SHEETS, S_COLS: S_COLS, S_KIND: S_KIND, E_COLS: E_COLS, E_KIND: E_KIND, P_COLS: P_COLS, P_KIND: P_KIND, REG_HEAD: REG_HEAD, DAY_ORDER: DAY_ORDER,
    colLetter: colLetter, str: str, norm: norm, titleCase: titleCase, titleCasePlace: titleCasePlace,
    parseDate: parseDate, isIso: isIso, isoToIt: isoToIt, todayIso: todayIso, daysBetween: daysBetween, addMonths: addMonths, addYears: addYears, ageOn: ageOn, toSerial: toSerial,
    parseMoney: parseMoney, fmtMoney: fmtMoney, cleanPhone: cleanPhone, validPhone: validPhone, validEmail: validEmail,
    cfNormalize: cfNormalize, cfControlChar: cfControlChar, cfSurnameCode: cfSurnameCode, cfNameCode: cfNameCode, cfCheck: cfCheck,
    tokenKey: tokenKey, levenshtein: levenshtein, similarity: similarity, matchStudent: matchStudent, surnameFirst: surnameFirst,
    headerMap: headerMap, cell: cell, parseStudents: parseStudents, parseEnrollments: parseEnrollments, parsePayments: parsePayments, parseRegistro: parseRegistro, parseListe: parseListe, parseTariffario: parseTariffario,
    suggestPacchetto: suggestPacchetto, quotaTariffario: quotaTariffario,
    encodeValue: encodeValue, expectedDisplay: expectedDisplay, sameDisplay: sameDisplay, buildRowUpdate: buildRowUpdate, verifyRow: verifyRow, registroRows: registroRows,
    diffStudent: diffStudent, diffEnrollment: diffEnrollment, conflictToOp: conflictToOp, mergeNote: mergeNote,
    checkModulo: checkModulo, checkIscrizione: checkIscrizione, checkPagamento: checkPagamento, checkCertificato: checkCertificato,
    certStatus: certStatus, scadenze: scadenze, waLink: waLink,
    buildPrompt: buildPrompt, normalizeAi: normalizeAi, fascia: fascia, notaModulo: notaModulo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
