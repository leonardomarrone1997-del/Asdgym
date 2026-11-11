/* Gym Art Segreteria per Windows - interfaccia. Text is always inserted as text, never as HTML. */
var C = window.Core, L = window.Logic;
var TOKEN = document.querySelector('meta[name="gymart-token"]').content;
var CID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var TABS = [['inizio', 'Inizio'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['corsi', 'Corsi'], ['scadenze', 'Scadenze'], ['registro', 'Registro'], ['impostazioni', 'Impostazioni'], ['guida', 'Guida']];
var TAB_OF = { allieva: 'allieve', iscrizione: 'iscrizioni' };
var S = {
  db: null, rev: 0, salvato: '', cartella: '', versione: '', fatal: '', busy: false, dirty: false, revert: false, nextId: 1, missed: 0,
  fa: { q: '', filtro: 'tutte', tutte: false, sort: { col: 0, desc: false } }, fi: { q: '', stato: 'correnti', corso: '', tutte: false, sort: { col: 0, desc: false } },
  fc: { giorno: '', tutte: false, sort: { col: 0, desc: false } }, reg: { rows: null, q: '', error: '' }, imp: null
};

/* ---------- DOM helpers ---------- */
function el(tag, props) {
  var n = document.createElement(tag), k;
  if (props) for (k in props) {
    var v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'multiple') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (var i = 2; i < arguments.length; i++) add(n, arguments[i]);
  return n;
}
function add(n) {
  for (var i = 1; i < arguments.length; i++) {
    var kid = arguments[i];
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) kid.forEach(function (x) { add(n, x); });
    else n.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}
function $(id) { return document.getElementById(id); }
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
var toastTimer = null;
function toast(msg) { var t = $('toast'); t.textContent = msg; t.className = 'toast on'; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 4200); }
function chip(text, kind) { return el('span', { class: 'chip chip-' + (kind || 'mute'), text: text }); }
function note(kind, title, items) {
  var n = el('div', { class: 'note' + (kind ? ' note-' + kind : '') }, title ? el('b', { text: title }) : null);
  if (items && items.length) n.appendChild(el('ul', null, items.map(function (t) { return el('li', { text: t }); })));
  return n;
}
function field(label, control, hint, extraClass) {
  var id = control.id || ('f' + (S.nextId++)); control.id = id;
  return el('div', { class: 'field' + (extraClass ? ' ' + extraClass : '') }, el('label', { for: id, text: label }), control, hint ? el('span', { class: 'hint', text: hint }) : null);
}
function select(options, value, onchange) {
  var s = el('select', { onchange: function () { onchange(s.value); } });
  options.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : (o === '' ? '(nessuno)' : o); s.appendChild(el('option', { value: String(v), text: t })); });
  if (value !== null && value !== undefined && !options.some(function (o) { return String(Array.isArray(o) ? o[0] : o) === String(value); })) s.appendChild(el('option', { value: String(value), text: String(value) }));
  s.value = value === null || value === undefined ? '' : String(value);
  return s;
}
/** Text-like input bound to obj[key]. */
function input(obj, key, type, onchange, extra) {
  var i = el('input', Object.assign({ type: type || 'text', autocomplete: 'off', value: obj[key] === null || obj[key] === undefined ? '' : String(obj[key]) }, extra || {}));
  i.addEventListener('input', function () { obj[key] = i.value; onchange(); });
  return i;
}
function button(text, onclick, cls) { return el('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick }); }
function link(text, hash, cls) { return el('a', { href: '#' + hash, class: cls || null, text: text }); }

/* Sortable tables. cols: [{ h: title, key: row -> text or number (omit: not sortable), cell: row -> node or text, cls }]. st: { col, desc }, kept by the caller. */
var MAX_ROWS = 250;
function sortKey(v) { return typeof v === 'number' ? v : v === null || v === undefined || v === '' ? null : C.norm(v) || String(v); }
function sorted(rows, cols, st) {
  var c = cols[st.col];
  if (!c || !c.key) return rows;
  var k = rows.map(function (r, i) { return { v: sortKey(c.key(r)), i: i, r: r }; });
  k.sort(function (a, b) {
    if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1; // empty values last in both directions
    var d = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    return (st.desc ? -d : d) || a.i - b.i;
  });
  return k.map(function (x) { return x.r; });
}
function tabella(cols, rows, st, redraw, rowProps) {
  return el('table', null,
    el('thead', null, el('tr', null, cols.map(function (c, i) {
      if (!c.key) return el('th', { class: c.cls || null, text: c.h });
      var on = st.col === i;
      return el('th', { class: c.cls || null, 'aria-sort': on ? (st.desc ? 'descending' : 'ascending') : null },
        el('button', { type: 'button', class: 'th-sort', title: 'Ordina per ' + c.h.toLowerCase(), onclick: function () { if (on) st.desc = !st.desc; else { st.col = i; st.desc = false; } redraw(); } },
          c.h, el('span', { class: 'arrow', 'aria-hidden': 'true', text: on ? (st.desc ? '▼' : '▲') : '' })));
    }))),
    el('tbody', null, rows.map(function (r) { return el('tr', rowProps ? rowProps(r) : null, cols.map(function (c) { return el('td', { class: c.cls || null }, c.cell(r)); })); })));
}
/** Sorted rows, cut at MAX_ROWS unless the user asked for all of them. Returns { table, more }: more = link to show the rest, or null. */
function elenco(cols, rows, st, redraw, rowProps, stato) {
  var all = sorted(rows, cols, st), cut = !stato.tutte && all.length > MAX_ROWS;
  return { table: tabella(cols, cut ? all.slice(0, MAX_ROWS) : all, st, redraw, rowProps),
    more: cut ? el('p', { class: 'muted small' }, 'Mostro le prime ' + MAX_ROWS + ' righe su ' + all.length + ': restringi la ricerca oppure ', button('mostra tutte', function () { stato.tutte = true; redraw(); }, 'btn-small'), '.') : null };
}
function debounce(fn, ms) { var t = null; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
/** Prints a title and a table on their own, without the rest of the page. cols: [{ h, cell: (row, index) -> text, cls }]. */
function stampa(titolo, sottotitolo, cols, rows) {
  var p = clear($('print'));
  add(p, el('div', { class: 'print-club', text: 'A.S.D. Gym Art Avezzano' }), el('h1', { text: titolo }), el('p', { class: 'print-sub', text: sottotitolo }),
    el('table', null, el('thead', null, el('tr', null, cols.map(function (c) { return el('th', { class: c.cls || null, text: c.h }); }))),
      el('tbody', null, rows.map(function (r, i) { return el('tr', null, cols.map(function (c) { return el('td', { class: c.cls || null, text: c.cell(r, i) }); })); }))));
  document.body.classList.add('stampa');
  window.print();
}
window.addEventListener('afterprint', function () { document.body.classList.remove('stampa'); clear($('print')); });
function waButton(tel, testo, cls) {
  if (!tel || !C.validPhone(tel)) return null;
  return el('a', { class: cls || 'btn btn-small', href: C.waLink(tel, testo), target: '_blank', rel: 'noopener noreferrer', title: testo ? 'Apre WhatsApp con il messaggio già scritto' : 'Apre la chat di WhatsApp', text: 'WhatsApp' });
}

function today() { return C.todayIso(); }
function nowIso() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return today() + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
function quando(iso) { var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || ''); return m ? C.isoToIt(m[1]) + ' ' + m[2] : ''; }
function eta(a) { return C.isIso(a.nascita) ? C.ageOn(a.nascita, today()) + ' anni' : ''; }
function giorniTesto(g) { return g === 0 ? 'oggi' : g === 1 ? 'domani' : g === -1 ? 'da ieri' : g < 0 ? 'da ' + (-g) + ' giorni' : 'tra ' + g + ' giorni'; }
var STATO_KIND = { 'ATTIVO': 'ok', 'IN SCADENZA': 'warn', 'SCADUTO': 'bad', 'DA COMPLETARE': 'warn', 'STORICO': 'mute', 'ANNULLATO': 'mute' };
function chipStato(st) { return chip(st, STATO_KIND[st]); }

/* ---------- talking to the program ---------- */
function api(method, path, body) {
  return fetch(path, { method: method, headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
    if (r.status === 204) return null;
    return r.json().catch(function () { return null; }).then(function (j) {
      if (!r.ok) { var e = new Error((j && j.errore) || ('Errore ' + r.status + '.')); e.status = r.status; throw e; }
      return j;
    });
  }, function () { throw new Error('Il programma non risponde. Chiudi questa finestra e riapri Gym Art Segreteria.'); });
}
function setConn() {
  var c = $('conn');
  if (S.busy) { c.textContent = 'Salvataggio…'; return; }
  c.textContent = S.salvato ? 'Salvato il ' + quando(S.salvato) : 'Archivio nuovo';
}
function load() {
  return api('GET', '/api/stato').then(function (j) {
    S.cartella = j.cartella; S.versione = j.versione; S.rev = j.rev; S.salvato = j.salvato;
    if (j.db) {
      var bad = L.validaArchivio(j.db);
      if (bad) { S.fatal = 'L\'archivio sul computer non si può leggere: ' + bad + ' Non è stato modificato. Le copie precedenti sono nella cartella "copie" dentro ' + j.cartella + '.'; S.db = null; return; }
      S.db = L.completa(j.db, today());
    } else S.db = L.nuovoArchivio(today());
    S.fatal = ''; S.reg.rows = null;
  }, function (e) { S.fatal = e.message; }).then(function () { setConn(); render(); });
}
/** Saves a new archive produced by Logic ({ db, registro }). Resolves true when it is on disk. */
function commit(res, okMsg, copia) {
  if (S.busy) return Promise.resolve(false);
  S.busy = true; setConn();
  return api('POST', '/api/salva', { rev: S.rev, db: res.db, registro: res.registro || [], copia: copia === true }).then(function (j) {
    S.db = res.db; S.rev = j.rev; S.salvato = j.salvato; S.reg.rows = null; S.busy = false; setConn();
    toast(j.avviso || okMsg || 'Salvato.');
    return true;
  }, function (e) {
    S.busy = false; setConn();
    if (e.status === 409) { toast(e.message); S.dirty = false; return load().then(function () { return false; }); }
    alert('Non salvato.\n\n' + e.message);
    return false;
  });
}
function attempt(fn) { try { return fn(); } catch (e) { alert(e.message); return null; } }

/* ---------- navigation ---------- */
function parseHash() { var p = (location.hash.replace(/^#/, '') || 'inizio').split('/'); return { view: p[0], args: p.slice(1).map(decodeURIComponent) }; }
var lastHash = location.hash;
function go(hash) { S.dirty = false; if (location.hash === '#' + hash) render(); else location.hash = hash; }
window.addEventListener('hashchange', function () {
  if (S.revert) { S.revert = false; return; }
  if (S.dirty && !confirm('Ci sono modifiche non salvate. Vuoi uscire senza salvarle?')) { S.revert = true; location.hash = lastHash; return; }
  S.dirty = false; lastHash = location.hash; render();
});
window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
function touch() { S.dirty = true; }

function render() {
  var r = parseHash(), tabs = clear($('tabs')), cur = TAB_OF[r.view] || r.view;
  TABS.forEach(function (t) { tabs.appendChild(el('a', { href: '#' + t[0], text: t[1], 'aria-current': t[0] === cur ? 'page' : null })); });
  var v = clear($('view'));
  if (S.fatal) { add(v, note('bad', S.fatal)); return; }
  if (!S.db) { add(v, el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Apro l\'archivio…')); return; }
  $('stagione').textContent = S.db.impostazioni.stagione;
  var views = { inizio: vInizio, allieve: vAllieve, allieva: vAllieva, iscrizioni: vIscrizioni, iscrizione: vIscrizione, corsi: vCorsi, scadenze: vScadenze, registro: vRegistro, impostazioni: vImpostazioni, guida: vGuida };
  (views[r.view] || vInizio)(v, r.args);
  window.scrollTo(0, 0);
}

/* ---------- Inizio ---------- */
function tile(n, label, kind, hash) { return el('a', { class: 'tile' + (kind ? ' t-' + kind : ''), href: '#' + hash }, el('b', { text: String(n) }), el('span', { text: label })); }
function vInizio(v) {
  var r = L.riepilogo(S.db, today()), sc = L.scadenze(S.db, today());
  add(v, el('h1', { text: 'Inizio' }));
  if (!S.db.allieve.length) add(v, note('', 'L\'archivio è vuoto.', ['Per portare qui i dati del foglio Google vai in Impostazioni, alla voce "Importa dal foglio Google".', 'Oppure inserisci la prima allieva con il pulsante "Nuova allieva".']));
  add(v, el('div', { class: 'grid' },
    tile(r.allieve, 'Allieve', '', 'allieve'),
    tile(r.correnti, 'Iscrizioni aperte', 'ok', 'iscrizioni'),
    tile(r.inScadenza, 'In scadenza', 'warn', 'scadenze'),
    tile(r.scadute, 'Scadute', 'bad', 'scadenze'),
    tile(r.daCompletare, 'Da completare', 'mute', 'iscrizioni'),
    tile(r.senzaIscrizione, 'Senza iscrizione', 'mute', 'allieve')));
  add(v, el('div', { class: 'row' }, link('Nuova allieva', 'allieva/nuova', 'btn btn-primary btn-big'), link('Cerca un\'allieva', 'allieve', 'btn btn-big'), link('Nuova iscrizione', 'iscrizione/nuova', 'btn btn-big')));
  var pc = L.promemoriaCopia(S.db, today());
  if (pc.serve) add(v, el('div', { class: 'note note-warn' }, el('b', { text: pc.giorni === null ? 'Non hai ancora scaricato una copia di sicurezza.' : 'L\'ultima copia di sicurezza scaricata è di ' + pc.giorni + ' giorni fa.' }),
    el('span', null, 'Scaricane una e conservala fuori dal computer: ', link('vai a Impostazioni', 'impostazioni'), '.')));
  var perCorso = L.corsiRiepilogo(S.db).filter(function (x) { return x.iscritte > 0; });
  if (perCorso.length) add(v, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Iscritte per corso' }), link('Elenchi e fogli presenze', 'corsi')),
    el('div', { class: 'row' }, perCorso.map(function (x) { return link((x.corso || 'Corso da definire') + ' · ' + x.iscritte, 'corsi/' + encodeURIComponent(x.corso), 'chip chip-mute chip-link'); }))));
  var all = sc.scadute.concat(sc.inScadenza), card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Abbonamenti da seguire' }), all.length ? link('Vedi tutte le scadenze', 'scadenze') : null));
  if (!all.length) add(card, el('p', { class: 'empty', text: 'Nessun abbonamento scaduto o in scadenza nei prossimi ' + S.db.impostazioni.preavvisoAbb + ' giorni.' }));
  else add(card, el('div', { class: 'list' }, all.slice(0, 8).map(function (x) { return rigaScadenza(x, false); })));
  add(v, card);
}

/* ---------- Allieve ---------- */
function vAllieve(v) {
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' });
  var cols = [
    { h: 'Allieva', key: function (r) { return r.a.name; }, cell: function (r) { return [link(r.a.name, 'allieva/' + r.a.id, 'name'), r.a.archiviata ? [' ', chip('Archiviata')] : null]; } },
    { h: 'Età', cls: 'nowrap', key: function (r) { return C.isIso(r.a.nascita) ? C.daysBetween(r.a.nascita, r.t) : null; }, cell: function (r) { return eta(r.a); } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (r) { return r.a.tel; } },
    { h: 'Genitore / Referente', key: function (r) { return r.a.genitore; }, cell: function (r) { return r.a.genitore; } },
    { h: 'Iscrizioni', key: function (r) { return r.isc.map(function (x) { return x.e.corso; }).join(' '); }, cell: function (r) {
      return r.isc.length ? r.isc.map(function (x) { return chip((x.e.corso || 'Corso da definire') + (x.s.stato === 'ATTIVO' ? '' : ' · ' + x.s.stato.toLowerCase()), STATO_KIND[x.s.stato]); }) : el('span', { class: 'muted small', text: 'nessuna' });
    } }
  ];
  function draw() {
    var t = today(), rows = L.cercaAllieve(S.db, S.fa.q, S.fa.filtro).map(function (a) {
      return { a: a, t: t, isc: L.iscrizioniDi(S.db, a.id).filter(L.corrente).map(function (e) { return { e: e, s: L.statoIscrizione(S.db, e, t) }; }) };
    });
    count.textContent = rows.length === 1 ? '1 allieva' : rows.length + ' allieve';
    clear(box); clear(more);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.allieve.length ? 'Nessuna allieva corrisponde alla ricerca.' : 'Non ci sono ancora allieve.' })); return; }
    var e = elenco(cols, rows, S.fa.sort, draw, function (r) { return { class: 'link', onclick: function () { go('allieva/' + r.a.id); } }; }, S.fa);
    add(box, e.table); add(more, e.more);
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: S.fa.q, placeholder: 'Nome, telefono, genitore, codice fiscale…', oninput: function () { S.fa.q = search.value; S.fa.tutte = false; later(); } });
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Allieve' }), link('Nuova allieva', 'allieva/nuova', 'btn btn-primary')));
  add(v, el('div', { class: 'card' },
    el('div', { class: 'toolbar' }, field('Cerca', search),
      field('Mostra', select([['tutte', 'Tutte'], ['con', 'Con iscrizione aperta'], ['senza', 'Senza iscrizione'], ['archiviate', 'Archiviate']], S.fa.filtro, function (x) { S.fa.filtro = x; S.fa.tutte = false; draw(); }), null, 'narrow')),
    count, box, more));
  draw();
  search.focus();
}

/* ---------- Scheda allieva ---------- */
function vAllieva(v, args) {
  var id = args[0] === 'nuova' ? null : args[0], cur = id ? L.byId(S.db.allieve, id) : null;
  if (id && !cur) { add(v, note('bad', 'Allieva non trovata.'), link('Torna all\'elenco', 'allieve', 'back')); return; }
  var f = cur ? JSON.parse(JSON.stringify(cur)) : { privacy: 'Sì', liberatoria: 'Sì' };
  var notes = el('div', { class: 'notes' }), save = button(cur ? 'Salva le modifiche' : 'Salva la nuova allieva', submit, 'btn-primary'), cfHint = el('span', { class: 'hint' }), shown = !!cur;
  function refresh() {
    var chk = L.controllaAllieva(S.db, f, id, today());
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di salvare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    save.disabled = shown && chk.errors.length > 0;
    var k = f.cf ? C.cfCheck(f.cf, { fullName: f.name, birthIso: C.parseDate(f.nascita) || '' }) : null;
    cfHint.textContent = !k ? '' : !k.valid ? k.errors[0] : k.warnings.length ? 'Valido, ma da controllare.' : 'Codice fiscale valido.';
    cfHint.className = 'hint' + (!k ? '' : !k.valid ? ' h-bad' : k.warnings.length ? '' : ' h-ok');
  }
  function ch() { touch(); shown = true; refresh(); }
  function inp(k, type, extra) { return input(f, k, type, ch, extra); }
  function submit() {
    var chk = L.controllaAllieva(S.db, f, id, today());
    shown = true;
    if (chk.errors.length) { refresh(); return; }
    var res = attempt(function () { return L.salvaAllieva(S.db, id, f, nowIso()); });
    if (!res) return;
    if (cur && !res.registro.length) { toast('Nessuna modifica da salvare.'); go('allieva/' + id); return; }
    commit(res, cur ? 'Modifiche salvate.' : 'Allieva salvata.').then(function (ok) { if (ok) go('allieva/' + res.id); });
  }
  var cfField = field(L.A_CAMPI.cf, inp('cf', 'text', { maxlength: 20, spellcheck: 'false' })); cfField.appendChild(cfHint);
  var noteArea = el('textarea', { value: f.note || '', oninput: function () { f.note = noteArea.value; ch(); } });

  add(v, link('Tutte le allieve', 'allieve', 'back'));
  add(v, el('div', { class: 'head-row' }, el('h1', { text: cur ? cur.name : 'Nuova allieva' }),
    cur ? el('div', { class: 'row' }, chip('n. ' + cur.id), eta(cur) ? chip(eta(cur)) : null, cur.archiviata ? chip('Archiviata', 'warn') : null, waButton(cur.tel, '')) : null));
  add(v, el('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submit(); } },
    el('h2', { text: 'Dati dell\'allieva' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.name, inp('name', 'text', { placeholder: 'Cognome Nome' }), 'Prima il cognome, poi il nome.'), field(L.A_CAMPI.nascita, inp('nascita', 'date')), field(L.A_CAMPI.luogo, inp('luogo')), cfField,
      field(L.A_CAMPI.indirizzo, inp('indirizzo')), field(L.A_CAMPI.citta, inp('citta')), field(L.A_CAMPI.cap, inp('cap', 'text', { inputmode: 'numeric', maxlength: 5 })), field(L.A_CAMPI.tessera, inp('tessera'))),
    el('h2', { text: 'Genitore e contatti' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.genitore, inp('genitore', 'text', { placeholder: 'Cognome Nome' })), field(L.A_CAMPI.cfGenitore, inp('cfGenitore', 'text', { maxlength: 20, spellcheck: 'false' })),
      field(L.A_CAMPI.tel, inp('tel', 'tel')), field(L.A_CAMPI.tel2, inp('tel2', 'tel')), field(L.A_CAMPI.email, inp('email', 'email'))),
    el('h2', { text: 'Consensi e note' }),
    el('div', { class: 'fields' },
      field(L.A_CAMPI.privacy, select([['', '(non indicato)'], 'Sì', 'No'], f.privacy || '', function (x) { f.privacy = x; ch(); })),
      field(L.A_CAMPI.liberatoria, select([['', '(non indicato)'], 'Sì', 'No'], f.liberatoria || '', function (x) { f.liberatoria = x; ch(); })),
      field(L.A_CAMPI.dataModulo, inp('dataModulo', 'date')),
      field(L.A_CAMPI.note, noteArea, 'Non scrivere qui note sanitarie.', 'wide')),
    notes,
    el('div', { class: 'actions' }, save, button('Annulla', function () { go(cur ? 'allieva/' + id : 'allieve'); }),
      el('span', { class: 'spacer' }),
      cur ? button(cur.archiviata ? 'Togli dall\'archivio' : 'Archivia', function () {
        if (!confirm(cur.archiviata ? 'Rimettere ' + cur.name + ' tra le allieve?' : 'Archiviare ' + cur.name + '? Non comparirà più negli elenchi, ma i suoi dati restano.')) return;
        var res = attempt(function () { return L.archiviaAllieva(S.db, id, !cur.archiviata, nowIso()); });
        if (res) commit(res, cur.archiviata ? 'Allieva ripristinata.' : 'Allieva archiviata.').then(function (ok) { if (ok) go('allieva/' + id); });
      }) : null,
      cur && !L.iscrizioniDi(S.db, id).length ? button('Elimina', function () {
        if (!confirm('Eliminare definitivamente ' + cur.name + '? Questa operazione non si può annullare.')) return;
        var res = attempt(function () { return L.eliminaAllieva(S.db, id); });
        if (res) commit(res, 'Allieva eliminata.', true).then(function (ok) { if (ok) go('allieve'); });
      }, 'btn-danger') : null)));
  refresh();

  if (cur) {
    var isc = L.iscrizioniDi(S.db, id).sort(function (a, b) { return (b.inizio || '') < (a.inizio || '') ? -1 : 1; });
    var card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Iscrizioni' }), link('Nuova iscrizione', 'iscrizione/nuova/' + id, 'btn btn-primary btn-small')));
    if (!isc.length) add(card, el('p', { class: 'empty', text: 'Nessuna iscrizione.' }));
    else add(card, el('div', { class: 'list' }, isc.map(function (e) {
      var s = L.statoIscrizione(S.db, e, today()), q = L.quotaDovuta(S.db, e);
      return el('div', { class: 'list-item' },
        el('div', { class: 'grow' }, el('div', null, el('b', { text: e.corso || 'Corso da definire' }), ' ', chipStato(s.stato)),
          el('div', { class: 'muted small', text: [e.giorni.join(', '), e.fascia, e.tipo, e.inizio ? 'dal ' + C.isoToIt(e.inizio) : '', s.scadenza ? 'al ' + C.isoToIt(s.scadenza) : '', q === null ? '' : C.fmtMoney(q)].filter(Boolean).join(' · ') })),
        el('div', { class: 'row' }, L.corrente(e) && s.scadenza ? button('Rinnova', function () { rinnova(e.id, 'allieva/' + id); }, 'btn-small') : null, link('Apri', 'iscrizione/' + e.id, 'btn btn-small')));
    })));
    add(v, card);
    var fam = L.famiglia(S.db, id);
    if (fam.length) add(v, el('div', { class: 'card' }, el('h2', { text: 'Stessa famiglia' }),
      el('p', { class: 'muted small', text: 'Allieve con lo stesso telefono o lo stesso genitore.' }),
      el('div', { class: 'list' }, fam.map(function (b) {
        var corsi = L.iscrizioniDi(S.db, b.id).filter(L.corrente).map(function (e) { return e.corso || 'corso da definire'; });
        return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, link(b.name, 'allieva/' + b.id, 'name'), b.archiviata ? [' ', chip('Archiviata')] : null,
          el('div', { class: 'muted small', text: [eta(b), corsi.length ? corsi.join(', ') : 'nessuna iscrizione aperta'].filter(Boolean).join(' · ') })), link('Apri', 'allieva/' + b.id, 'btn btn-small'));
      }))));
  } else v.querySelector('input').focus();
}
function rinnova(iscrId, poi) {
  var e = L.byId(S.db.iscrizioni, iscrId), nome = L.nomeAllieva(S.db, e.allievaId), sc = L.scadenza(e);
  if (!confirm('Rinnovare l\'abbonamento ' + (e.tipo || '').toLowerCase() + ' di ' + nome + ' (' + e.corso + ')?\n\nIl nuovo periodo parte dal ' + C.isoToIt(sc) + ' con gli stessi dati. L\'iscrizione attuale resta nello storico.')) return;
  var res = attempt(function () { return L.rinnova(S.db, iscrId, nowIso(), today()); });
  if (res) commit(res, 'Abbonamento rinnovato.').then(function (ok) { if (ok) go(poi); });
}

/* ---------- Iscrizioni ---------- */
var STATO_ORDINE = { 'SCADUTO': 0, 'IN SCADENZA': 1, 'DA COMPLETARE': 2, 'ATTIVO': 3, 'STORICO': 4, 'ANNULLATO': 5 };
function vIscrizioni(v) {
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' });
  var cols = [
    { h: 'Allieva', key: function (x) { return x.nome; }, cell: function (x) { return link(x.nome, 'iscrizione/' + x.e.id, 'name'); } },
    { h: 'Corso', key: function (x) { return x.e.corso; }, cell: function (x) { return x.e.corso; } },
    { h: 'Giorni', cls: 'nowrap', cell: function (x) { return x.e.giorni.join(', '); } },
    { h: 'Fascia', cls: 'nowrap', key: function (x) { return x.e.fascia; }, cell: function (x) { return x.e.fascia; } },
    { h: 'Abbonamento', key: function (x) { return x.e.tipo; }, cell: function (x) { return x.e.tipo; } },
    { h: 'Inizio', cls: 'nowrap mono', key: function (x) { return x.e.inizio; }, cell: function (x) { return C.isoToIt(x.e.inizio); } },
    { h: 'Scadenza', cls: 'nowrap mono', key: function (x) { return x.s.scadenza; }, cell: function (x) { return C.isoToIt(x.s.scadenza); } },
    { h: 'Quota', cls: 'num', key: function (x) { return x.q; }, cell: function (x) { return x.q === null ? '' : C.fmtMoney(x.q); } },
    { h: 'Stato', key: function (x) { return STATO_ORDINE[x.s.stato]; }, cell: function (x) { return chipStato(x.s.stato); } }
  ];
  function draw() {
    var t = today(), words = C.norm(S.fi.q).split(' ').filter(Boolean), rows = [];
    S.db.iscrizioni.forEach(function (e) {
      if (S.fi.stato === 'correnti' ? !L.corrente(e) : S.fi.stato === 'chiuse' ? L.corrente(e) : false) return;
      if (S.fi.corso && e.corso !== S.fi.corso) return;
      var s = L.statoIscrizione(S.db, e, t);
      if (S.fi.stato !== 'correnti' && S.fi.stato !== 'chiuse' && S.fi.stato !== 'tutte' && s.stato !== S.fi.stato) return;
      var nome = L.nomeAllieva(S.db, e.allievaId);
      if (words.length) { var hay = C.norm(nome + ' ' + e.corso + ' ' + e.id); if (!words.every(function (w) { return hay.indexOf(w) >= 0; })) return; }
      rows.push({ e: e, s: s, nome: nome, q: L.quotaDovuta(S.db, e) });
    });
    count.textContent = rows.length === 1 ? '1 iscrizione' : rows.length + ' iscrizioni';
    clear(box); clear(more);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.iscrizioni.length ? 'Nessuna iscrizione corrisponde ai filtri.' : 'Non ci sono ancora iscrizioni.' })); return; }
    var l = elenco(cols, rows, S.fi.sort, draw, function (x) { return { class: 'link', onclick: function () { go('iscrizione/' + x.e.id); } }; }, S.fi);
    add(box, l.table); add(more, l.more);
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: S.fi.q, placeholder: 'Nome dell\'allieva o corso…', oninput: function () { S.fi.q = search.value; S.fi.tutte = false; later(); } });
  var corsi = [['', 'Tutti i corsi']].concat(S.db.liste.corsi);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Iscrizioni' }), link('Nuova iscrizione', 'iscrizione/nuova', 'btn btn-primary')));
  add(v, el('div', { class: 'card' },
    el('div', { class: 'toolbar' }, field('Cerca', search),
      field('Stato', select([['correnti', 'Aperte'], ['ATTIVO', 'Attive'], ['IN SCADENZA', 'In scadenza'], ['SCADUTO', 'Scadute'], ['DA COMPLETARE', 'Da completare'], ['chiuse', 'Chiuse o annullate'], ['tutte', 'Tutte']], S.fi.stato, function (x) { S.fi.stato = x; S.fi.tutte = false; draw(); }), null, 'narrow'),
      field('Corso', select(corsi, S.fi.corso, function (x) { S.fi.corso = x; S.fi.tutte = false; draw(); }), null, 'narrow')),
    count, box, more));
  draw();
}

/* ---------- Corsi: class lists ---------- */
var GIORNO_NOME = { Lun: 'lunedì', Mar: 'martedì', Mer: 'mercoledì', Gio: 'giovedì', Ven: 'venerdì', Sab: 'sabato' };
function vCorsi(v, args) {
  var corso = args.length ? args[0] : null, t = today(), riep = L.corsiRiepilogo(S.db);
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' }), rows = [];
  var cols = [
    { h: 'Allieva', key: function (x) { return x.allieva.name; }, cell: function (x) { return link(x.allieva.name, 'allieva/' + x.allieva.id, 'name'); } },
    { h: 'Età', cls: 'nowrap', key: function (x) { return C.isIso(x.allieva.nascita) ? C.daysBetween(x.allieva.nascita, t) : null; }, cell: function (x) { return eta(x.allieva); } },
    corso === null ? { h: 'Corso', key: function (x) { return x.iscrizione.corso; }, cell: function (x) { return x.iscrizione.corso; } } : null,
    { h: 'Giorni', cls: 'nowrap', cell: function (x) { return x.iscrizione.giorni.join(', '); } },
    { h: 'Fascia', cls: 'nowrap', key: function (x) { return x.iscrizione.fascia; }, cell: function (x) { return x.iscrizione.fascia; } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (x) { return x.allieva.tel; } },
    { h: 'Genitore / Referente', key: function (x) { return x.allieva.genitore; }, cell: function (x) { return x.allieva.genitore; } },
    { h: 'Scadenza', cls: 'nowrap mono', key: function (x) { return x.stato.scadenza; }, cell: function (x) { return C.isoToIt(x.stato.scadenza); } },
    { h: 'Stato', key: function (x) { return STATO_ORDINE[x.stato.stato]; }, cell: function (x) { return chipStato(x.stato.stato); } }
  ].filter(Boolean);
  function titolo() { return (corso === null ? 'Tutti i corsi' : 'Corso ' + (corso || 'da definire')) + (S.fc.giorno ? ' · ' + GIORNO_NOME[S.fc.giorno] : ''); }
  function sotto() { return 'Stagione ' + S.db.impostazioni.stagione + ' · ' + (rows.length === 1 ? '1 iscritta' : rows.length + ' iscritte') + ' · stampato il ' + C.isoToIt(t); }
  function draw() {
    rows = L.iscritte(S.db, { corso: corso === null ? '' : corso, giorno: S.fc.giorno }, t);
    if (corso === '') rows = rows.filter(function (x) { return !x.iscrizione.corso; });
    count.textContent = rows.length === 1 ? '1 iscritta' : rows.length + ' iscritte';
    clear(box); clear(more);
    if (!rows.length) add(box, el('p', { class: 'empty', text: 'Nessuna iscrizione aperta per questa scelta.' }));
    else { var l = elenco(cols, rows, S.fc.sort, draw, function (x) { return { class: 'link', onclick: function () { go('allieva/' + x.allieva.id); } }; }, S.fc); add(box, l.table); add(more, l.more); }
    print1.disabled = print2.disabled = !rows.length;
  }
  var print1 = button('Stampa l\'elenco', function () {
    stampa(titolo(), sotto(), [{ h: 'N.', cls: 'num', cell: function (x, i) { return i + 1; } }, { h: 'Allieva', cell: function (x) { return x.allieva.name; } }, { h: 'Nata il', cell: function (x) { return C.isoToIt(x.allieva.nascita); } },
      corso === null ? { h: 'Corso', cell: function (x) { return x.iscrizione.corso; } } : null,
      { h: 'Giorni', cell: function (x) { return x.iscrizione.giorni.join(', '); } }, { h: 'Fascia', cell: function (x) { return x.iscrizione.fascia; } },
      { h: 'Telefono', cell: function (x) { return x.allieva.tel; } }, { h: 'Genitore / Referente', cell: function (x) { return x.allieva.genitore; } }].filter(Boolean), sorted(rows, cols, S.fc.sort));
  });
  var print2 = button('Stampa il foglio presenze', function () {
    var vuote = []; for (var i = 0; i < 12; i++) vuote.push({ h: '', cls: 'box', cell: function () { return ''; } });
    stampa(titolo(), sotto() + ' · scrivi la data in cima a ogni colonna', [{ h: 'N.', cls: 'num', cell: function (x, i) { return i + 1; } }, { h: 'Allieva', cell: function (x) { return x.allieva.name; } }].concat(vuote), sorted(rows, cols, S.fc.sort));
  });
  add(v, el('h1', { text: 'Corsi' }));
  add(v, el('div', { class: 'grid' }, riep.filter(function (x) { return x.iscritte > 0; }).map(function (x) {
    return el('a', { class: 'tile' + (corso === x.corso ? ' t-ok' : ''), href: '#corsi/' + encodeURIComponent(x.corso), 'aria-current': corso === x.corso ? 'true' : null }, el('b', { text: String(x.iscritte) }), el('span', { text: x.corso || 'Da definire' }));
  })));
  add(v, el('div', { class: 'card' },
    el('div', { class: 'toolbar' },
      field('Corso', select([['*', 'Tutti i corsi']].concat(riep.map(function (x) { return [x.corso, (x.corso || 'Da definire') + ' (' + x.iscritte + ')']; })), corso === null ? '*' : corso, function (x) { go(x === '*' ? 'corsi' : 'corsi/' + encodeURIComponent(x)); }), null, 'narrow'),
      field('Giorno', select([['', 'Tutti i giorni']].concat(L.GIORNI.map(function (d) { return [d, GIORNO_NOME[d].charAt(0).toUpperCase() + GIORNO_NOME[d].slice(1)]; })), S.fc.giorno, function (x) { S.fc.giorno = x; S.fc.tutte = false; draw(); }), null, 'narrow'),
      el('div', { class: 'row' }, print1, print2)),
    count, box, more,
    el('p', { class: 'muted small', text: 'Sono elencate le iscrizioni aperte delle allieve non archiviate. Gli elenchi stampati contengono dati personali: non lasciarli in giro.' })));
  draw();
}

/* ---------- Scheda iscrizione ---------- */
function vIscrizione(v, args) {
  var id = args[0] === 'nuova' ? null : args[0], cur = id ? L.byId(S.db.iscrizioni, id) : null;
  if (id && !cur) { add(v, note('bad', 'Iscrizione non trovata.'), link('Torna all\'elenco', 'iscrizioni', 'back')); return; }
  var f = cur ? JSON.parse(JSON.stringify(cur)) : { allievaId: args[1] || '', corso: '', giorni: [], fascia: '', pacchetto: '', tipo: '', inizio: today(), quota: null, annullata: false, storica: false, note: '' };
  f.quota = typeof f.quota === 'number' ? String(f.quota).replace('.', ',') : '';
  var al = L.byId(S.db.allieve, f.allievaId), back = al ? 'allieva/' + al.id : 'iscrizioni';
  var pacchettoScelto = !!f.pacchetto, notes = el('div', { class: 'notes' }), info = el('div', { class: 'info-line' }), save = button(cur ? 'Salva le modifiche' : 'Salva l\'iscrizione', submit, 'btn-primary'), shown = !!cur;
  var pac = select([['', '(nessuna)']].concat(S.db.tariffario.map(function (p) { return p.chiave; })), f.pacchetto, function (x) { f.pacchetto = x; pacchettoScelto = !!x; ch(); });
  var quota = input(f, 'quota', 'text', ch, { inputmode: 'decimal' });
  function refresh() {
    if (!pacchettoScelto) { var sug = C.suggestPacchetto(S.db.tariffario, f.corso, f.giorni.length || null); if (sug !== f.pacchetto) { f.pacchetto = sug; pac.value = sug; } }
    var chk = L.controllaIscrizione(S.db, f, id), o = chk.valori, sc = L.scadenza(o), listino = C.quotaTariffario(S.db.tariffario, o.pacchetto, o.tipo);
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di salvare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    save.disabled = shown && chk.errors.length > 0;
    quota.placeholder = listino === null ? '' : 'da tariffario: ' + C.fmtMoney(listino);
    clear(info);
    add(info, el('span', null, 'Scadenza: ', el('b', { text: sc ? C.isoToIt(sc) : 'da definire' })),
      el('span', null, 'Quota da tariffario: ', el('b', { text: listino === null ? 'non prevista' : C.fmtMoney(listino) })),
      typeof o.quota === 'number' ? el('span', null, 'Quota concordata: ', el('b', { text: C.fmtMoney(o.quota) })) : null);
  }
  function ch() { touch(); shown = true; refresh(); }
  function submit() {
    var chk = L.controllaIscrizione(S.db, f, id);
    shown = true;
    if (chk.errors.length) { refresh(); return; }
    var res = attempt(function () { return L.salvaIscrizione(S.db, id, f, nowIso()); });
    if (!res) return;
    if (cur && !res.registro.length) { toast('Nessuna modifica da salvare.'); go(back); return; }
    commit(res, cur ? 'Modifiche salvate.' : 'Iscrizione salvata.').then(function (ok) { if (ok) go('allieva/' + f.allievaId); });
  }
  function check(key, label) { var c = el('input', { type: 'checkbox', checked: f[key] === true, onchange: function () { f[key] = c.checked; ch(); } }); return el('label', { class: 'check' }, c, el('span', { text: label })); }
  var days = el('div', { class: 'days' }, L.GIORNI.map(function (d) {
    var c = el('input', { type: 'checkbox', checked: f.giorni.indexOf(d) >= 0, onchange: function () { f.giorni = L.GIORNI.filter(function (x) { return x === d ? c.checked : f.giorni.indexOf(x) >= 0; }); ch(); } });
    return el('label', null, c, d);
  }));
  var fasceId = 'fasce' + (S.nextId++), fascia = input(f, 'fascia', 'text', ch, { list: fasceId, placeholder: 'es. 17:00-18:30' });
  var noteArea = el('textarea', { value: f.note || '', oninput: function () { f.note = noteArea.value; ch(); } });
  var allievaCtl = al && (cur || args[1])
    ? el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Allieva' }), el('div', null, link(al.name, 'allieva/' + al.id, 'name'), ' ', chip('n. ' + al.id)))
    : field('Allieva', select([['', '(scegli l\'allieva)']].concat(L.cercaAllieve(S.db, '', 'tutte').map(function (a) { return [a.id, a.name + ' (n. ' + a.id + ')']; })), f.allievaId, function (x) { f.allievaId = x; ch(); }));

  add(v, link(al ? 'Scheda di ' + al.name : 'Tutte le iscrizioni', back, 'back'));
  add(v, el('div', { class: 'head-row' }, el('h1', { text: cur ? 'Iscrizione n. ' + cur.id : 'Nuova iscrizione' }), cur ? chipStato(L.statoIscrizione(S.db, cur, today()).stato) : null));
  add(v, el('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submit(); } },
    el('div', { class: 'fields' }, allievaCtl,
      field(L.I_CAMPI.corso, select([['', '(scegli il corso)']].concat(S.db.liste.corsi), f.corso, function (x) { f.corso = x; ch(); })),
      el('div', { class: 'field wide2' }, el('span', { class: 'lab', text: L.I_CAMPI.giorni }), days),
      el('div', { class: 'field' }, el('label', { for: fascia.id = 'f' + (S.nextId++), text: L.I_CAMPI.fascia }), fascia, el('datalist', { id: fasceId }, S.db.liste.fasce.map(function (x) { return el('option', { value: x }); }))),
      field(L.I_CAMPI.pacchetto, pac, 'Proposta in base a corso e giorni: puoi cambiarla.'),
      field(L.I_CAMPI.tipo, select([['', '(da definire)']].concat(L.TIPI.map(function (t) { return t.nome; })), f.tipo, function (x) { f.tipo = x; ch(); })),
      field(L.I_CAMPI.inizio, input(f, 'inizio', 'date', ch)),
      field(L.I_CAMPI.quota, quota, 'Solo se diversa dal tariffario.'),
      field(L.I_CAMPI.note, noteArea, null, 'wide')),
    info,
    cur ? el('div', { class: 'row' }, check('annullata', 'Annullata (iscrizione fatta per errore o ritirata)'), check('storica', 'Chiusa: periodo concluso, resta nello storico')) : null,
    notes,
    el('div', { class: 'actions' }, save, button('Annulla', function () { go(back); }), el('span', { class: 'spacer' }),
      cur && L.corrente(cur) && L.scadenza(cur) ? button('Rinnova', function () { rinnova(id, 'allieva/' + cur.allievaId); }) : null,
      cur ? button('Elimina', function () {
        if (!confirm('Eliminare definitivamente questa iscrizione? Per un abbonamento finito è meglio "Chiusa". Questa operazione non si può annullare.')) return;
        var res = attempt(function () { return L.eliminaIscrizione(S.db, id); });
        if (res) commit(res, 'Iscrizione eliminata.', true).then(function (ok) { if (ok) go(back); });
      }, 'btn-danger') : null)));
  refresh();
}

/* ---------- Scadenze ---------- */
function rigaScadenza(x, conRinnovo) {
  var e = x.iscrizione, a = x.allieva || { name: '(allieva mancante)', id: '', tel: '' }, scaduto = x.giorni < 0;
  return el('div', { class: 'list-item' },
    el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', chip(scaduto ? 'Scaduto' : 'In scadenza', scaduto ? 'bad' : 'warn')),
      el('div', { class: 'muted small', text: [e.corso, e.tipo, a.tel ? 'tel. ' + a.tel : ''].filter(Boolean).join(' · ') })),
    el('div', { class: 'when small' }, (scaduto ? 'Scaduto il ' : 'Scade il ') + C.isoToIt(x.scadenza) + ' (' + giorniTesto(x.giorni) + ')'),
    el('div', { class: 'row' }, conRinnovo ? waButton(a.tel, L.messaggioScadenza(S.db, x)) : null, conRinnovo ? button('Rinnova', function () { rinnova(e.id, 'scadenze'); }, 'btn-small btn-primary') : null, link('Apri', 'iscrizione/' + e.id, 'btn btn-small')));
}
function vScadenze(v) {
  var sc = L.scadenze(S.db, today()), n = S.db.impostazioni.preavvisoAbb;
  add(v, el('h1', { text: 'Scadenze degli abbonamenti' }));
  add(v, el('div', { class: 'grid' }, tile(sc.scadute.length, 'Scaduti', 'bad', 'scadenze'), tile(sc.inScadenza.length, 'In scadenza entro ' + n + ' giorni', 'warn', 'scadenze')));
  [['Scaduti', sc.scadute, 'Nessun abbonamento scaduto.'], ['In scadenza entro ' + n + ' giorni', sc.inScadenza, 'Nessun abbonamento in scadenza.']].forEach(function (g) {
    add(v, el('div', { class: 'card' }, el('h2', { text: g[0] }), g[1].length ? el('div', { class: 'list' }, g[1].map(function (x) { return rigaScadenza(x, true); })) : el('p', { class: 'empty', text: g[2] })));
  });
  add(v, el('p', { class: 'muted small', text: '"Rinnova" apre un nuovo periodo con gli stessi dati, a partire dalla scadenza; quello vecchio resta nello storico. "WhatsApp" apre la chat con il promemoria già scritto: lo leggi e lo invii tu (serve internet). Preavviso e testo del promemoria si cambiano in Impostazioni.' }));
}

/* ---------- Registro ---------- */
function vRegistro(v) {
  add(v, el('h1', { text: 'Registro delle modifiche' }));
  var box = el('div', { class: 'scroll-x' }), count = el('span', { class: 'count' });
  function draw() {
    clear(box);
    if (S.reg.error) { add(box, note('bad', S.reg.error)); return; }
    if (!S.reg.rows) { add(box, el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Leggo il registro…')); return; }
    var words = C.norm(S.reg.q).split(' ').filter(Boolean);
    var rows = S.reg.rows.filter(function (r) { var hay = C.norm([r.allieva, r.operazione, r.campo, r.prima, r.dopo, r.nota].join(' ')); return words.every(function (w) { return hay.indexOf(w) >= 0; }); });
    count.textContent = rows.length + (rows.length === 1 ? ' riga' : ' righe') + (S.reg.rows.length >= 2000 ? ' (le ultime 2000 modifiche)' : '');
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.reg.rows.length ? 'Nessuna riga corrisponde alla ricerca.' : 'Ancora nessuna modifica registrata.' })); return; }
    add(box, el('table', null, el('thead', null, el('tr', null, ['Data e ora', 'Allieva', 'Operazione', 'Campo', 'Prima', 'Dopo', 'Note'].map(function (h) { return el('th', { text: h }); }))),
      el('tbody', null, rows.slice(0, 500).map(function (r) {
        return el('tr', null, el('td', { class: 'nowrap mono', text: quando(r.quando) }), el('td', { text: r.allieva }), el('td', { text: r.operazione }), el('td', { text: r.campo || '' }), el('td', { class: 'was', text: r.prima || '' }), el('td', { text: r.dopo || '' }), el('td', { class: 'muted', text: r.nota || '' }));
      }))));
    if (rows.length > 500) add(box, el('p', { class: 'muted small', text: 'Mostro le prime 500 righe: usa la ricerca per restringere.' }));
  }
  var search = el('input', { type: 'search', value: S.reg.q, placeholder: 'Nome, campo, valore…', oninput: function () { S.reg.q = search.value; draw(); } });
  add(v, el('div', { class: 'card' }, el('div', { class: 'toolbar' }, field('Cerca nel registro', search)), count, box));
  draw();
  if (!S.reg.rows) api('GET', '/api/registro?limite=2000').then(function (j) { S.reg.rows = j.righe || []; S.reg.error = ''; }, function (e) { S.reg.error = e.message; }).then(function () { if (parseHash().view === 'registro') draw(); });
}

/* ---------- Impostazioni ---------- */
function download(name, text, type) {
  var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
}
function stamp() { return nowIso().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'); }
function vImpostazioni(v) {
  var db = S.db, f = { stagione: db.impostazioni.stagione, preavvisoAbb: String(db.impostazioni.preavvisoAbb), corsi: db.liste.corsi.join('\n'), fasce: db.liste.fasce.join('\n'), messaggioScadenza: db.impostazioni.messaggioScadenza || L.MESSAGGIO,
    tariffario: db.tariffario.map(function (p) { var o = { pacchetto: p.pacchetto, frequenza: p.frequenza, iscrizione: p.iscrizione ? String(p.iscrizione).replace('.', ',') : '' }; L.TIPI.forEach(function (t) { o[t.nome] = typeof p[t.nome] === 'number' ? String(p[t.nome]).replace('.', ',') : ''; }); return o; }) };
  var notes = el('div', { class: 'notes' }), tbody = el('tbody');
  function area(k) { var a = el('textarea', { rows: 7, value: f[k], oninput: function () { f[k] = a.value; touch(); } }); return a; }
  function drawTariff() {
    clear(tbody);
    f.tariffario.forEach(function (p, i) {
      tbody.appendChild(el('tr', null, ['pacchetto', 'frequenza', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale', 'iscrizione'].map(function (k) { return el('td', null, input(p, k, 'text', touch, { 'aria-label': k + ' riga ' + (i + 1), inputmode: k === 'pacchetto' || k === 'frequenza' ? null : 'decimal' })); }),
        el('td', null, button('Togli', function () { f.tariffario.splice(i, 1); touch(); drawTariff(); }, 'btn-small'))));
    });
  }
  function salva() {
    var err = L.controllaImpostazioni(f);
    clear(notes);
    if (err.length) { add(notes, note('bad', 'Da correggere prima di salvare', err)); return; }
    commit(L.salvaImpostazioni(S.db, f), 'Impostazioni salvate.').then(function (ok) { if (ok) go('impostazioni'); });
  }
  drawTariff();
  add(v, el('h1', { text: 'Impostazioni' }));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Stagione, corsi e tariffe' }),
    el('div', { class: 'fields' }, field('Stagione sportiva', input(f, 'stagione', 'text', touch), 'Per esempio 2026/2027.'), field('Giorni di preavviso per gli abbonamenti', input(f, 'preavvisoAbb', 'text', touch, { inputmode: 'numeric' }), 'Quanti giorni prima un abbonamento risulta "in scadenza".'),
      field('Corsi', area('corsi'), 'Uno per riga.'), field('Fasce orarie', area('fasce'), 'Una per riga, per esempio 17:00-18:30.'),
      field('Promemoria di scadenza per WhatsApp', area('messaggioScadenza'), 'Il programma sostituisce {nome}, {corso}, {tipo} e {scadenza} con i dati dell\'abbonamento.', 'wide')),
    el('h3', { text: 'Tariffario' }),
    el('p', { class: 'muted small', text: 'Prezzi in euro per tipo di abbonamento. Lascia vuoto un prezzo se quell\'abbonamento non è previsto per la tariffa.' }),
    el('div', { class: 'scroll-x' }, el('table', { class: 'tariff' }, el('thead', null, el('tr', null, ['Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale', 'Iscrizione', ''].map(function (h) { return el('th', { text: h }); }))), tbody)),
    el('div', { class: 'row' }, button('Aggiungi una tariffa', function () { f.tariffario.push({ pacchetto: '', frequenza: '', Mensile: '', Trimestrale: '', Semestrale: '', Annuale: '', iscrizione: '' }); touch(); drawTariff(); }, 'btn-small')),
    notes, el('div', { class: 'actions' }, button('Salva le impostazioni', salva, 'btn-primary'))));

  /* data on this computer */
  var ultima = el('p', { class: 'small' });
  function drawUltima() { var u = S.db.impostazioni.ultimaCopia; ultima.textContent = C.isIso(u) ? 'Ultima copia di sicurezza scaricata: ' + C.isoToIt(u) + '.' : 'Non hai ancora scaricato una copia di sicurezza.'; }
  drawUltima();
  var restore = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: function () { if (restore.files[0]) ripristina(restore.files[0]); restore.value = ''; } });
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Dati su questo computer' }),
    el('p', { text: 'L\'archivio, il registro e le copie automatiche sono in questa cartella:' }), el('div', { class: 'path', text: S.cartella }),
    el('div', { class: 'row' }, button('Apri la cartella', function () { api('POST', '/api/apri-cartella').catch(function (e) { alert(e.message); }); }),
      button('Scarica una copia di sicurezza', function () {
        download('gymart-copia-' + stamp() + '.json', JSON.stringify({ programma: 'Gym Art Segreteria', salvato: S.salvato, rev: S.rev, db: S.db }, null, 1), 'application/json');
        commit(L.segnaCopia(S.db, today()), 'Copia scaricata: conservala fuori dal computer.').then(drawUltima);
      }),
      button('Ripristina da una copia…', function () { restore.click(); }), restore),
    ultima,
    el('p', { class: 'muted small', text: 'Il programma fa da solo una copia dell\'archivio prima di modificarlo (al massimo una ogni mezz\'ora, e sempre prima di un\'importazione, di un ripristino o di un\'eliminazione; conserva le ultime 100) nella sottocartella "copie". Tieni anche una copia fuori dal computer, per esempio su una chiavetta.' })));

  /* import */
  var imp = el('div'), files = el('input', { type: 'file', accept: '.csv,text/csv', multiple: true, onchange: function () { if (files.files.length) leggiFogli(files.files, function () { drawImport(); }); } });
  function drawImport() {
    clear(imp);
    if (S.imp && S.imp.rev !== S.rev) S.imp = null; // the archive changed since the summary was prepared: it no longer applies
    if (!S.imp) return;
    S.imp.parti.forEach(function (p) { add(imp, note(p.kind, p.titolo, p.righe)); });
    if (S.imp.registro.length) add(imp, el('div', { class: 'actions' }, button('Importa nell\'archivio', function () {
      var res = { db: S.imp.db, registro: S.imp.registro };
      commit(res, 'Importazione completata.', true).then(function (ok) { if (ok) { S.imp = null; go('impostazioni'); } });
    }, 'btn-primary'), button('Annulla', function () { S.imp = null; files.value = ''; drawImport(); })));
    else add(imp, el('p', { class: 'muted', text: 'Non c\'è niente di nuovo da importare.' }));
  }
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Importa dal foglio Google' }),
    el('ol', { class: 'steps' }, el('li', { text: 'Apri il gestionale su Google Sheets e vai sul foglio ANAGRAFICA.' }), el('li', { text: 'Menu File, Scarica, "Valori separati da virgola (.csv)".' }), el('li', { text: 'Fai lo stesso con il foglio ISCRIZIONI.' }), el('li', { text: 'Scegli qui sotto i due file scaricati (anche insieme).' })),
    files,
    el('p', { class: 'muted small', text: 'Prima di scrivere vedi un riepilogo. Un\'allieva già presente non viene sovrascritta: si completano solo i campi vuoti. Certificati medici e pagamenti non vengono importati. Finita l\'importazione cancella i file scaricati: contengono dati personali.' }),
    imp));
  drawImport();

  /* export */
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Esporta per Excel' }),
    el('div', { class: 'row' }, button('Elenco allieve (.csv)', function () { download('allieve-' + stamp() + '.csv', '﻿' + L.csvAllieve(S.db), 'text/csv'); }), button('Elenco iscrizioni (.csv)', function () { download('iscrizioni-' + stamp() + '.csv', '﻿' + L.csvIscrizioni(S.db, today()), 'text/csv'); })),
    el('p', { class: 'muted small', text: 'I file esportati contengono dati personali: conservali con attenzione. Versione del programma: ' + S.versione + '.' })));
}
function plurale(n, uno, molti) { return n + ' ' + (n === 1 ? uno : molti); }
function leggiFogli(fileList, poi) {
  Promise.all(Array.prototype.map.call(fileList, function (f) { return f.text().then(function (t) { return { name: f.name, text: t }; }); })).then(function (list) {
    var fogli = list.map(function (x) { var r = L.riconosciFoglio(L.leggiCsv(x.text)); r.name = x.name; return r; }), db = S.db, reg = [], parti = [], adesso = nowIso();
    fogli.filter(function (x) { return x.tipo === 'anagrafica'; }).forEach(function (x) {
      var r = L.importaAnagrafica(db, x.vals, adesso); db = r.db; reg = reg.concat(r.registro);
      var righe = [plurale(r.nuove, 'allieva nuova', 'allieve nuove') + '.', plurale(r.completate, 'allieva già presente completata', 'allieve già presenti completate') + ' (' + plurale(r.campiCompletati, 'campo', 'campi') + ').', plurale(r.invariate, 'allieva già presente senza novità', 'allieve già presenti senza novità') + '.'];
      if (r.mancanti.length) righe.push('Colonne non trovate nel file: ' + r.mancanti.join(', ') + '.');
      parti.push({ kind: r.saltate.length || r.diverse.length ? 'warn' : 'ok', titolo: 'ANAGRAFICA · ' + x.name, righe: righe.concat(r.saltate.slice(0, 30), r.diverse.slice(0, 30), r.saltate.length + r.diverse.length > 60 ? ['… e altre segnalazioni.'] : []) });
    });
    fogli.filter(function (x) { return x.tipo === 'iscrizioni'; }).forEach(function (x) {
      var r = L.importaIscrizioni(db, x.vals, adesso); db = r.db; reg = reg.concat(r.registro);
      var righe = [plurale(r.nuove, 'iscrizione nuova', 'iscrizioni nuove') + '.', plurale(r.giaPresenti, 'iscrizione già presente', 'iscrizioni già presenti') + '.'];
      if (r.mancanti.length) righe.push('Colonne non trovate nel file: ' + r.mancanti.join(', ') + '.');
      parti.push({ kind: r.saltate.length ? 'warn' : 'ok', titolo: 'ISCRIZIONI · ' + x.name, righe: righe.concat(r.saltate.slice(0, 40), r.saltate.length > 40 ? ['… e altre ' + (r.saltate.length - 40) + ' righe saltate.'] : []) });
    });
    fogli.filter(function (x) { return !x.tipo; }).forEach(function (x) { parti.push({ kind: 'bad', titolo: x.name, righe: ['Non riconosco questo file: deve essere il foglio ANAGRAFICA o ISCRIZIONI scaricato come CSV.'] }); });
    S.imp = { parti: parti, db: db, registro: reg, rev: S.rev };
    poi();
  }, function () { alert('Non riesco a leggere i file scelti.'); });
}
function ripristina(file) {
  file.text().then(function (t) {
    var obj; try { obj = JSON.parse(t); } catch (e) { alert('Il file scelto non è una copia dell\'archivio.'); return; }
    var db = obj && obj.db && typeof obj.db === 'object' ? obj.db : obj, bad = L.validaArchivio(db);
    if (bad) { alert(bad); return; }
    if (!confirm('Sostituire l\'archivio attuale (' + plurale(S.db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(S.db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ') con la copia "' + file.name + '" (' + plurale(db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ')?\n\nPrima della sostituzione il programma conserva una copia dell\'archivio attuale.')) return;
    commit({ db: L.completa(db, today()), registro: [{ allieva: '', operazione: 'Ripristino da copia', campo: '', prima: '', dopo: '', nota: file.name }] }, 'Archivio ripristinato.', true).then(function (ok) { if (ok) go('inizio'); });
  });
}

/* ---------- Guida ---------- */
function vGuida(v) {
  function sec(title, items, open) { return el('details', { open: open || null }, el('summary', { text: title }), el('div', { class: 'guide' }, items.map(function (t) { return el('p', { text: t }); }))); }
  add(v, el('h1', { text: 'Guida' }));
  add(v, sec('Cosa fa questo programma', [
    'Tiene l\'anagrafica delle allieve e le loro iscrizioni ai corsi, con il tipo di abbonamento e la scadenza. Funziona senza internet: i dati stanno solo su questo computer.',
    'Certificati medici e pagamenti non sono gestiti qui.'], true));
  add(v, sec('Allieve e iscrizioni', [
    'Da "Allieve" cerchi una persona per nome, telefono, genitore o codice fiscale e apri la sua scheda. "Nuova allieva" ne aggiunge una: il programma controlla codice fiscale, data di nascita, telefono ed email e avvisa se esiste già un nome uguale o molto simile.',
    'Dalla scheda, "Nuova iscrizione" registra il corso, i giorni, la fascia oraria e l\'abbonamento. La scadenza si calcola da sola dalla data di inizio e dal tipo (mensile, trimestrale, semestrale, annuale). La quota viene dal tariffario; scrivi la quota concordata solo se è diversa.',
    'Un\'allieva che non frequenta più si può archiviare: sparisce dagli elenchi ma i suoi dati restano.']));
  add(v, sec('Corsi, elenchi e fogli presenze', [
    'La pagina "Corsi" mostra quante iscritte ha ogni corso e l\'elenco delle allieve, anche per un solo giorno della settimana.',
    '"Stampa l\'elenco" stampa nomi, giorni, fascia e contatti; "Stampa il foglio presenze" stampa i nomi con dodici caselle vuote da riempire a penna.',
    'Le tabelle si ordinano con un clic sul titolo di una colonna; un secondo clic inverte l\'ordine.']));
  add(v, sec('Scadenze e rinnovi', [
    'La pagina "Scadenze" elenca gli abbonamenti scaduti e quelli che scadono entro i giorni di preavviso scelti in Impostazioni.',
    '"Rinnova" apre un nuovo periodo con gli stessi dati a partire dalla scadenza, e sposta il periodo vecchio nello storico.',
    '"WhatsApp" apre la chat del numero dell\'allieva con il promemoria già scritto: il messaggio parte solo quando lo invii tu. Serve internet e WhatsApp sul computer o nel browser. Il testo si cambia in Impostazioni.',
    'Per un numero di telefono estero scrivi anche il prefisso, per esempio +355.']));
  add(v, sec('Dove sono i dati e come proteggerli', [
    'La cartella dei dati è indicata in Impostazioni. Contiene l\'archivio (archivio.json), il registro delle modifiche e la sottocartella "copie" con le copie automatiche.',
    'Ogni modifica viene scritta subito e annotata nel Registro con il valore precedente. Fai ogni tanto "Scarica una copia di sicurezza" e conservala fuori dal computer.',
    'Sono dati personali di minori: proteggi il computer con una password e non lasciare i file esportati in cartelle condivise.',
    'Per usare il programma su un altro computer copia lì il programma e la cartella dei dati, oppure ripristina una copia di sicurezza da Impostazioni. Non usare lo stesso archivio da due computer nello stesso momento.']));
  add(v, sec('Chiudere il programma', ['Basta chiudere la finestra: non c\'è niente da salvare a mano.']));
}

/* ---------- start ---------- */
function alive() {
  fetch('/api/vivo?id=' + CID, { method: 'POST', headers: { 'X-Gymart-Token': TOKEN } }).then(function (r) { S.missed = r.ok ? 0 : S.missed + 1; }, function () { S.missed++; }).then(function () { $('offline').hidden = S.missed < 2; });
}
window.addEventListener('pagehide', function () { navigator.sendBeacon('/api/chiudi?id=' + CID + '&t=' + TOKEN); });
window.addEventListener('pageshow', function (e) { if (e.persisted) alive(); });
document.addEventListener('visibilitychange', function () { if (!document.hidden) alive(); });
alive();
setInterval(alive, 10000);
render();
load();
