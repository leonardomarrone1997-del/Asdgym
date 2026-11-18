/* Gym Art Segreteria per Windows - interfaccia. Text is always inserted as text, never as HTML. */
var C = window.Core, L = window.Logic;
var TOKEN = document.querySelector('meta[name="gymart-token"]').content;
var CID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var TABS = [['inizio', 'Inizio'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['corsi', 'Corsi'], ['pagamenti', 'Pagamenti'], ['analisi', 'Analisi'], ['scadenze', 'Scadenze'], ['registro', 'Registro'], ['impostazioni', 'Impostazioni'], ['guida', 'Guida']];
var TAB_OF = { allieva: 'allieve', iscrizione: 'iscrizioni', stagione: 'impostazioni', promemoria: 'scadenze' };
var S = {
  db: null, rev: 0, salvato: '', cartella: '', versione: '', fatal: '', busy: false, dirty: false, revert: false, nextId: 1, missed: 0,
  fa: { q: '', filtro: 'tutte', tutte: false, sort: { col: 0, desc: false } }, fi: { q: '', stato: 'correnti', corso: '', tutte: false, sort: { col: 0, desc: false } },
  fc: { giorno: '', tutte: false, sort: { col: 0, desc: false } }, fp: { dal: '', al: '', metodo: '', q: '', tutte: false, sort: { col: 0, desc: true }, sortD: { col: 0, desc: false } },
  det: false, an: { periodo: 'stagione' }, remoto: false, rete: null,
  bloccato: false, protetto: false, sic: null, copie2: { cartella: '', ultima: '', errore: '' }, sceltaCartella: false, reg: { rows: null, q: '', error: '' }, imp: null
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
/** Columns marked det: true are only shown in the detailed view. */
function vis(cols) { return cols.filter(function (c) { return !c.det || S.det; }); }
function sorted(rows, cols, st) {
  cols = vis(cols); if (st.col >= cols.length) st.col = 0;
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
  cols = vis(cols); if (st.col >= cols.length) st.col = 0;
  return el('table', { class: 'tab-card' },
    el('thead', null, el('tr', null, cols.map(function (c, i) {
      if (!c.key) return el('th', { class: c.cls || null, text: c.h });
      var on = st.col === i;
      return el('th', { class: c.cls || null, 'aria-sort': on ? (st.desc ? 'descending' : 'ascending') : null },
        el('button', { type: 'button', class: 'th-sort', title: 'Ordina per ' + c.h.toLowerCase(), onclick: function () { if (on) st.desc = !st.desc; else { st.col = i; st.desc = false; } redraw(); } },
          c.h, el('span', { class: 'arrow', 'aria-hidden': 'true', text: on ? (st.desc ? '▼' : '▲') : '' })));
    }))),
    el('tbody', null, rows.map(function (r) { return el('tr', rowProps ? rowProps(r) : null, cols.map(function (c) { return el('td', { class: c.cls || null, 'data-label': c.h || null }, c.cell(r)); })); })));
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

function scaricaPdf(nome, bytes) { download(nome.replace(/[^A-Za-z0-9._-]+/g, '_') + '.pdf', bytes, 'application/pdf'); }
var CERT_KIND = { 'VALIDO': 'ok', 'IN SCADENZA': 'warn', 'SCADUTO': 'bad', 'MANCANTE': 'mute' };
/** Chip for a certificate status; a type that does not cover sport is always marked. */
function chipCert(s) { return chip((s.stato === 'MANCANTE' ? 'Manca' : s.stato === 'VALIDO' ? 'Valido' : s.stato === 'SCADUTO' ? 'Scaduto' : 'In scadenza') + (s.ludico ? ' · ludico-motoria' : ''), s.ludico && s.stato === 'VALIDO' ? 'warn' : CERT_KIND[s.stato]); }
var CONTO_KIND = { 'SALDATO': 'ok', 'PARZIALE': 'warn', 'DA PAGARE': 'bad', 'SENZA QUOTA': 'mute' };
function chipConto(c) { return chip(c.stato === 'SENZA QUOTA' ? 'Senza quota' : c.stato === 'SALDATO' ? 'Saldato' : c.stato === 'PARZIALE' ? 'Pagato in parte' : 'Da pagare', CONTO_KIND[c.stato]); }
function soldi(n) { return n === null || n === undefined ? '' : C.fmtMoney(n); }

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
      if (!r.ok) {
        var e = new Error((j && j.errore) || ('Errore ' + r.status + '.')); e.status = r.status; e.servePassword = !!(j && j.servePassword);
        if (r.status === 423 && !S.bloccato) { S.bloccato = true; S.db = null; S.dirty = false; render(); }
        if (r.status === 401 && S.remoto) { S.dirty = false; location.href = '/login'; } // the login of this device has expired
        throw e;
      }
      return j;
    });
  }, function () { throw new Error('Il programma non risponde. Chiudi questa finestra e riapri Gym Art Segreteria.'); });
}
function setConn() {
  var c = $('conn');
  if (S.busy) { c.textContent = 'Salvataggio…'; return; }
  c.textContent = S.bloccato ? 'Archivio protetto' : S.salvato ? 'Salvato il ' + quando(S.salvato) : 'Archivio nuovo';
}
function load() {
  return api('GET', '/api/stato').then(function (j) {
    S.cartella = j.cartella; S.versione = j.versione;
    S.bloccato = j.bloccato === true;
    if (S.bloccato) { S.db = null; S.fatal = ''; return; }
    S.rev = j.rev; S.salvato = j.salvato; S.protetto = j.protetto === true; S.sceltaCartella = j.sceltaCartella === true; S.remoto = j.remoto === true; document.body.classList.toggle('remoto', S.remoto);
    if (j.copie2) S.copie2 = j.copie2;
    if (j.sicurezza) S.sic = j.sicurezza;
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
    setTimeout(aggiornaSicurezza, 1200); // the snapshot of the day and the copy to the second folder run around the save
    return true;
  }, function (e) {
    S.busy = false; setConn();
    if (e.status === 409) { toast(e.message); S.dirty = false; return load().then(function () { return false; }); }
    alert('Non salvato.\n\n' + e.message);
    return false;
  });
}
function attempt(fn) { try { return fn(); } catch (e) { alert(e.message); return null; } }
/** The state of the safety copies: the summary and the second folder. */
function aggiornaSicurezza() { return api('GET', '/api/sicurezza').then(function (j) { S.sic = j.sicurezza; S.copie2 = j.copie2; if (parseHash().view === 'inizio' && !S.dirty) render(); }, function () {}); }
function aggiornaCopie2() { return api('GET', '/api/copie2').then(function (j) { S.copie2 = j.copie2; }, function () {}); }

/* ---------- password page ---------- */
function vSblocca(v) {
  var f = { password: '' }, msg = el('div', { class: 'notes' }), pw = input(f, 'password', 'password', function () {}, { autocomplete: 'current-password' });
  var apri = button('Apri l\'archivio', invia, 'btn-primary');
  function invia() {
    if (!f.password) return;
    apri.disabled = true; clear(msg);
    api('POST', '/api/sblocca', { password: f.password }).then(function () { return load(); }, function (e) {
      apri.disabled = false; add(msg, note('bad', e.status === 401 ? 'Password errata.' : e.message)); pw.value = ''; f.password = ''; pw.focus();
    });
  }
  add(v, el('form', { class: 'card lock', onsubmit: function (e) { e.preventDefault(); invia(); } },
    el('h1', { text: 'Archivio protetto' }), el('p', { class: 'muted', text: 'Scrivi la password per aprire i dati della segreteria.' }),
    field('Password', pw), msg, el('div', { class: 'actions' }, apri),
    el('p', { class: 'muted small', text: 'Senza la password i dati non si possono leggere: non esiste un modo per recuperarla.' })));
  pw.focus();
}

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

var ICONE = {
  inizio: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  allieve: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.2c2.7.2 4.5 2 4.5 4.8"/>',
  iscrizioni: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  pagamenti: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.7a4.5 4.5 0 1 0 0 6.6M7.5 11h6.2M7.5 13.5h6.2"/>',
  altro: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  corsi: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  analisi: '<path d="M3 20h18"/><rect x="5" y="11" width="3.5" height="9" rx="1"/><rect x="10.5" y="5" width="3.5" height="15" rx="1"/><rect x="16" y="13" width="3.5" height="7" rx="1"/>',
  scadenze: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  registro: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7.5V12l3 2"/>',
  impostazioni: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  guida: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  attenzione: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
};
var ICONA_TESSERA = { ok: 'ok', warn: 'attenzione', bad: 'attenzione', mute: 'info' };
function icona(k) { var n = document.createElementNS(SVGNS, 'svg'); n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('class', 'ico'); n.setAttribute('aria-hidden', 'true'); n.innerHTML = ICONE[k]; return n; }
/** On a phone the sections are at the bottom of the screen, like an app; the less used ones are behind "Altro". */
function disegnaBarra(cur, vista) {
  var principali = [['inizio', 'Inizio'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['pagamenti', 'Incassi']], altri = TABS.filter(function (t) { return !principali.some(function (p) { return p[0] === t[0]; }); });
  altri.splice(altri.findIndex(function (t) { return t[0] === 'scadenze'; }) + 1, 0, ['promemoria', 'Promemoria']);
  altri.splice(altri.findIndex(function (t) { return t[0] === 'impostazioni'; }) + 1, 0, ['stagione', 'Nuova stagione']);
  var bar = clear($('bottom')), sheet = clear($('sheet')), inAltri = altri.some(function (t) { return t[0] === cur; });
  vista = vista || cur;
  function chiudi() { sheet.hidden = true; $('bottom').querySelector('.altro').setAttribute('aria-expanded', 'false'); }
  principali.forEach(function (t) { bar.appendChild(el('a', { href: '#' + t[0], 'aria-current': t[0] === cur ? 'page' : null, onclick: chiudi }, icona(t[0]), el('span', { text: t[1] }))); });
  bar.appendChild(el('button', { type: 'button', class: 'altro', 'aria-expanded': 'false', 'aria-current': inAltri ? 'page' : null, onclick: function () { sheet.hidden = !sheet.hidden; this.setAttribute('aria-expanded', String(!sheet.hidden)); } }, icona('altro'), el('span', { text: 'Altro' })));
  add(sheet, el('div', { class: 'sheet-in' }, altri.map(function (t) { return el('a', { href: '#' + t[0], 'aria-current': t[0] === vista ? 'page' : null, text: t[1], onclick: chiudi }); }),
    el('button', { type: 'button', class: 'sheet-det', text: S.det ? 'Vista dettagliata: attiva' : 'Vista dettagliata: spenta', onclick: function () { $('det').click(); } }),
    S.remoto ? el('button', { type: 'button', class: 'sheet-esci', text: 'Esci da questo telefono', onclick: esci }) : null));
  sheet.onclick = function (e) { if (e.target === sheet) chiudi(); };
}
/** Menu a sinistra (barra stretta su tablet): le sezioni a gruppi, con le pagine che si raggiungono da una sezione sotto di essa. */
var GRUPPI = [['Segreteria', ['inizio', 'allieve', 'iscrizioni', 'corsi']], ['Denaro', ['pagamenti', 'analisi']], ['Controllo', ['scadenze', 'registro']], ['Sistema', ['impostazioni', 'guida']]];
var SOTTOVOCI = { scadenze: [['promemoria', 'Promemoria']], impostazioni: [['stagione', 'Nuova stagione']] };
function disegnaMenu(nav, cur, vista) {
  var nomi = {}; TABS.forEach(function (t) { nomi[t[0]] = t[1]; });
  function voce(k, testo, sub) {
    var corrente = sub ? vista === k : (cur === k && !(SOTTOVOCI[k] || []).some(function (x) { return x[0] === vista; }));
    return el('a', { href: '#' + k, class: sub ? 'nav-sub' : null, 'aria-current': corrente ? 'page' : null }, sub ? null : icona(k), el('span', { text: testo }));
  }
  GRUPPI.forEach(function (g) {
    var box = el('div', { class: 'nav-gruppo' }, el('div', { class: 'nav-titolo', text: g[0] }));
    g[1].forEach(function (k) { add(box, voce(k, nomi[k]), (SOTTOVOCI[k] || []).map(function (x) { return voce(x[0], x[1], true); })); });
    nav.appendChild(box);
  });
}
function render() {
  var r = parseHash(), tabs = clear($('tabs')), cur = TAB_OF[r.view] || r.view;
  var v = clear($('view'));
  setConn();
  document.body.classList.toggle('bloccato', S.bloccato);
  if (S.bloccato) { vSblocca(v); return; }
  disegnaMenu(tabs, cur, r.view);
  disegnaBarra(cur, r.view);
  if (S.fatal) { add(v, note('bad', S.fatal)); return; }
  if (!S.db) { add(v, el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Apro l\'archivio…')); return; }
  $('stagione').textContent = S.db.impostazioni.stagione;
  var ex = $('esci'); if (ex) ex.hidden = !S.remoto;
  var nuova = document.querySelector('.top-actions a.btn-ghost'); if (nuova) nuova.textContent = S.remoto ? '+ Allieva' : 'Nuova allieva';
  $('offline').textContent = S.remoto ? 'Non riesco a raggiungere il computer della segreteria: controlla che sia acceso e collegato alla rete. Le modifiche non vengono salvate finché non torna.' : 'Il programma è stato chiuso: le modifiche non vengono più salvate. Chiudi questa finestra e riapri Gym Art Segreteria.';
  var views = { inizio: vInizio, allieve: vAllieve, allieva: vAllieva, iscrizioni: vIscrizioni, iscrizione: vIscrizione, corsi: vCorsi, pagamenti: vPagamenti, analisi: vAnalisi, scadenze: vScadenze, registro: vRegistro, impostazioni: vImpostazioni, stagione: vStagione, promemoria: vPromemoria, guida: vGuida };
  (views[r.view] || vInizio)(v, r.args);
  window.scrollTo(0, 0);
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); // the page rises in
  animaNumeri(v);
}

/* ---------- Inizio ---------- */
/** n: a number, or a text (then eur/pct tell what it is, so that it can count up). sub: extra line shown in the detailed view. */
function tile(n, label, kind, hash, sub, eur) {
  var b = el('b', { text: String(n) });
  if (typeof n === 'number') { b.setAttribute('data-v', n); b.setAttribute('data-f', 'int'); }
  else if (typeof eur === 'number') { b.setAttribute('data-v', eur); b.setAttribute('data-f', 'eur'); }
  else if (/^\d+%$/.test(String(n))) { b.setAttribute('data-v', parseInt(n, 10)); b.setAttribute('data-f', 'pct'); }
  return el(hash ? 'a' : 'div', { class: 'tile' + (kind ? ' t-' + kind : '') + (typeof n === 'string' ? ' tile-text' : ''), href: hash ? '#' + hash : null }, ICONA_TESSERA[kind] ? el('div', { class: 'tile-ico' }, icona(ICONA_TESSERA[kind])) : null, b, el('span', { text: label }), sub ? el('small', { class: 'solo-det', text: sub }) : null);
}
/** Numbers in tiles count up from 0 when a page opens (not with reduced motion, not in a hidden window). */
function animaNumeri(root) {
  if ((window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.hidden) return;
  [].forEach.call(root.querySelectorAll('[data-v]'), function (b) {
    var v = parseFloat(b.getAttribute('data-v')), f = b.getAttribute('data-f'), t0 = null, dur = 750;
    function fmt(x) { return f === 'eur' ? C.fmtMoney(x) : f === 'pct' ? Math.round(x) + '%' : String(Math.round(x)); }
    function fine() { b.textContent = fmt(v); }
    function passo(t) { if (t0 === null) t0 = t; var p = Math.min(1, (t - t0) / dur); b.textContent = fmt(v * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(passo); else fine(); }
    b.textContent = fmt(0); requestAnimationFrame(passo); setTimeout(fine, dur + 250);
  });
}

/* ---------- charts: hand-made SVG, no libraries ---------- */
var SVGNS = 'http://www.w3.org/2000/svg', chartId = 0;
function sv(tag, attrs) {
  var n = document.createElementNS(SVGNS, tag), k;
  for (k in (attrs || {})) if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  (function aggiungi(list) {
    list.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) aggiungi(c); else n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  })([].slice.call(arguments, 2));
  return n;
}
var CS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
/** Width of a chart in drawing units: the width of the page minus the margins and the padding of the card, up to 640. */
function larghezzaGrafico() { var w = (document.documentElement && document.documentElement.clientWidth) || 640; return Math.max(290, Math.min(640, w - (w < 700 ? 76 : 120))); }
function belloMax(m) { if (m <= 0) return 1; var e = Math.pow(10, Math.floor(Math.log(m) / Math.LN10)), f = m / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
function eurCorto(v) { return v >= 1000 ? (Math.round(v / 100) / 10).toString().replace('.', ',') + 'k' : String(Math.round(v)); }
/**
 * Vertical bars. cats: labels; serie: [{ nome, colore, valori[] }]. o: { h, fmt (full text for the hint), corto (axis and labels), etichetta, media }.
 * In the detailed view each bar also carries its value.
 */
function graficoBarre(cats, serie, o) {
  o = o || {};
  var W = larghezzaGrafico(), stretto = W < 480, H = o.h || (stretto ? 200 : 230), pl = stretto ? 38 : 46, pr = 8, pt = 20, pb = 30, iw = W - pl - pr, ih = H - pt - pb, id = ++chartId, n = cats.length, k = serie.length;
  var max = 0; serie.forEach(function (x) { x.valori.forEach(function (v) { if (v > max) max = v; }); });
  var top = o.corto ? belloMax(max) : Math.max(4, Math.ceil(max / 4) * 4), fmt = o.fmt || String, corto = o.corto || String, gw = iw / n, bw = Math.min(34, gw * 0.7 / k), gap = Math.min(3, bw * 0.15);
  var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': o.etichetta || '' });
  svg.appendChild(sv('defs', null, serie.map(function (x, i) {
    var c = x.colore || CS[i % CS.length];
    return sv('linearGradient', { id: 'gb' + id + '-' + i, x1: 0, y1: 0, x2: 0, y2: 1 }, sv('stop', { offset: '0%', 'stop-color': c, 'stop-opacity': 1 }), sv('stop', { offset: '100%', 'stop-color': c, 'stop-opacity': 0.62 }));
  })));
  for (var j = 0; j <= 4; j++) {
    var y = pt + ih - ih * j / 4;
    svg.appendChild(sv('line', { x1: pl, x2: W - pr, y1: y, y2: y, class: j ? 'grid' : 'axis' }));
    svg.appendChild(sv('text', { x: pl - 8, y: y + 3.5, class: 'ytick', 'text-anchor': 'end' }, corto(top * j / 4)));
  }
  cats.forEach(function (c, i) {
    var x0 = pl + gw * i + (gw - (k * bw + (k - 1) * gap)) / 2, tip = c + ': ' + serie.map(function (x) { return (k > 1 ? x.nome + ' ' : '') + fmt(x.valori[i]); }).join(' · ');
    svg.appendChild(sv('rect', { x: pl + gw * i + 2, y: pt, width: gw - 4, height: ih, rx: 8, class: 'colhov' }, sv('title', null, tip)));
    serie.forEach(function (x, si) {
      var v = x.valori[i], h = ih * v / top, bx = x0 + si * (bw + gap);
      if (v > 0) {
        svg.appendChild(sv('rect', { x: bx, y: pt + ih - Math.max(h, 3), width: bw, height: Math.max(h, 3), rx: Math.min(7, bw / 2), fill: 'url(#gb' + id + '-' + si + ')', class: 'bar', style: 'animation-delay:' + ((i * k + si) * 32) + 'ms' }));
        if (S.det) svg.appendChild(sv('text', { x: bx + bw / 2, y: pt + ih - h - 5, class: 'vlab', 'text-anchor': 'middle' }, corto(v)));
      }
    });
    svg.appendChild(sv('text', { x: pl + gw * i + gw / 2, y: H - 10, class: 'xtick', 'text-anchor': 'middle' }, stretto && n > 9 && i % 2 ? '' : c));
  });
  if (o.media > 0 && o.media <= top) {
    var ym = pt + ih - ih * o.media / top;
    svg.appendChild(sv('line', { x1: pl, x2: W - pr, y1: ym, y2: ym, class: 'media' }));
    svg.appendChild(sv('text', { x: pl + 6, y: ym - 6, class: 'medialab', 'text-anchor': 'start' }, 'media ' + corto(o.media)));
  }
  var legenda = k > 1 ? el('div', { class: 'legenda' }, serie.map(function (x, i) { return el('span', null, el('i', { style: 'background:' + (x.colore || CS[i % CS.length]) }), x.nome); })) : null;
  return el('div', { class: 'grafico' }, svg, legenda, tabellaDati(cats, serie, fmt));
}
/** The numbers behind a chart, shown in the detailed view. */
function tabellaDati(cats, serie, fmt) {
  return el('div', { class: 'solo-det scroll-x' }, el('table', { class: 'dati' },
    el('thead', null, el('tr', null, el('th', { text: '' }), cats.map(function (c) { return el('th', { class: 'num', text: c }); }))),
    el('tbody', null, serie.map(function (x) { return el('tr', null, el('th', { text: x.nome || 'Totale' }), x.valori.map(function (v) { return el('td', { class: 'num', text: v ? (fmt || String)(v) : '·' }); })); }))));
}
/** Donut with a legend. fette: [{ l, v, c, testo }]; centro: { t, s }. */
function graficoCiambella(fette, centro, o) {
  o = o || {};
  var R = 68, SW = 24, CIRC = 2 * Math.PI * R, tot = 0; fette.forEach(function (f) { tot += f.v; });
  var svg = sv('svg', { viewBox: '0 0 200 200', class: 'chart ciambella', role: 'img', 'aria-label': o.etichetta || '' });
  svg.appendChild(sv('circle', { cx: 100, cy: 100, r: R, fill: 'none', class: 'anello', 'stroke-width': SW }));
  var off = 0;
  if (tot > 0) fette.forEach(function (f, i) {
    if (f.v <= 0) return;
    var len = f.v / tot * CIRC, vis = Math.max(0.5, len - (fette.filter(function (x) { return x.v > 0; }).length > 1 ? 3 : 0));
    svg.appendChild(sv('circle', { cx: 100, cy: 100, r: R, fill: 'none', stroke: f.c || CS[i % CS.length], 'stroke-width': SW, 'stroke-linecap': 'round', class: 'fetta',
      'stroke-dasharray': vis + ' ' + CIRC, 'stroke-dashoffset': -off - 1.5, transform: 'rotate(-90 100 100)', style: '--len:' + vis + ';--circ:' + CIRC + ';animation-delay:' + (i * 120) + 'ms' }, sv('title', null, f.l + ': ' + (f.testo || f.v))));
    off += len;
  });
  svg.appendChild(sv('text', { x: 100, y: 102, class: 'cent-t', 'text-anchor': 'middle' }, centro.t));
  svg.appendChild(sv('text', { x: 100, y: 120, class: 'cent-s', 'text-anchor': 'middle' }, centro.s || ''));
  return el('div', { class: 'ciambella-box' }, svg, el('ul', { class: 'legenda-v' }, fette.map(function (f, i) {
    return el('li', null, el('i', { style: 'background:' + (f.c || CS[i % CS.length]) }), el('span', { class: 'ln', text: f.l }), el('b', { text: f.testo || String(f.v) }), el('small', { class: 'solo-det', text: tot ? Math.round(f.v / tot * 100) + '%' : '' }));
  })));
}
/** Horizontal bars as plain HTML (they link to pages). rows: [{ l, v, testo, href, c }]. */
function barreOrizzontali(rows) {
  var max = 0; rows.forEach(function (r) { if (r.v > max) max = r.v; }); max = max || 1;
  return el('div', { class: 'hbars' }, rows.map(function (r, i) {
    return el('div', { class: 'hbar' }, r.href ? link(r.l, r.href, 'hl') : el('span', { class: 'hl', text: r.l }),
      el('div', { class: 'ht' }, el('i', { style: '--w:' + Math.max(r.v > 0 ? 2 : 0, r.v / max * 100) + '%;--d:' + (i * 60) + 'ms;background:' + (r.c || CS[0]) })), el('span', { class: 'hv', text: r.testo }));
  }));
}
function vInizio(v) {
  var r = L.riepilogo(S.db, today()), sc = L.scadenze(S.db, today());
  var an = L.analisi(S.db, today(), '12mesi'), mese = an.incassiMese[11], mesePrec = an.incassiMese[10];
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Inizio' }), el('span', { class: 'muted small', text: 'Oggi è ' + C.isoToIt(today()) })));
  if (!S.db.allieve.length) add(v, note('', 'L\'archivio è vuoto.', ['Per portare qui i dati del foglio Google vai in Impostazioni, alla voce "Importa dal foglio Google".', 'Oppure inserisci la prima allieva con il pulsante "Nuova allieva".']));
  if (L.stagioneDi(today()) > S.db.impostazioni.stagione && r.correnti) add(v, el('div', { class: 'note note-warn' }, el('b', { text: 'È iniziata la stagione ' + L.stagioneDi(today()) + ': l\'archivio è ancora sulla ' + S.db.impostazioni.stagione + '.' }),
    el('span', null, 'Hai ' + plurale(r.correnti, 'iscrizione aperta', 'iscrizioni aperte') + ' da rinnovare o chiudere: ', link('avvia la Nuova stagione', 'stagione'), '.')));
  var pm = L.elencoPromemoria(S.db, today(), {}).conteggi;
  add(v, el('h2', { class: 'sezione', text: 'Da fare' }));
  add(v, el('div', { class: 'grid' },
    tile(r.scadute, 'Scadute', r.scadute ? 'bad' : 'ok', 'scadenze', 'da rinnovare'),
    tile(r.inScadenza, 'In scadenza', r.inScadenza ? 'warn' : 'ok', 'scadenze', 'entro ' + S.db.impostazioni.preavvisoAbb + ' giorni'),
    tile(r.certScaduti + r.certInScadenza, 'Certificati da rinnovare', r.certScaduti ? 'bad' : r.certInScadenza ? 'warn' : 'ok', 'scadenze', r.certScaduti + ' scaduti, ' + r.certInScadenza + ' in scadenza'),
    tile(r.certMancanti, 'Certificati mancanti', r.certMancanti ? 'warn' : 'ok', 'scadenze', 'di allieve con iscrizione aperta'),
    tile(soldi(r.totaleDaIncassare), 'Da incassare (' + plurale(r.daIncassare, 'iscrizione', 'iscrizioni') + ')', r.daIncassare ? 'warn' : 'ok', 'pagamenti', 'residuo su iscrizioni non annullate', r.totaleDaIncassare),
    r.bonificiDaVerificare ? tile(r.bonificiDaVerificare, 'Bonifici da verificare', 'warn', 'pagamenti', soldi(r.totaleBonificiDaVerificare) + ' in attesa di conferma') : null,
    pm.daFare ? tile(pm.daFare, 'Promemoria da contattare', 'warn', 'promemoria', 'abbonamenti e certificati') : null));
  add(v, el('div', { class: 'row' }, link('Nuova allieva', 'allieva/nuova', 'btn btn-primary btn-big'), link('Cerca un\'allieva', 'allieve', 'btn btn-big'), link('Nuova iscrizione', 'iscrizione/nuova', 'btn btn-big')));
  var sic = S.sic;
  if (sic && sic.recupero) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'L\'archivio era ' + (sic.recupero.motivo === 'mancante' ? 'sparito' : 'danneggiato') + ' ed è stato rimesso da una copia.' }),
    el('span', null, 'Copia usata: ' + sic.recupero.da + ', salvata il ' + quando(sic.recupero.salvato) + '. ' + (sic.recupero.danneggiato ? 'Il file rovinato è stato tenuto da parte con il nome ' + sic.recupero.danneggiato + '. ' : '') +
      'Le modifiche fatte dopo quella copia potrebbero mancare: controlla gli ultimi inserimenti.'),
    S.remoto ? null : el('div', { class: 'row' }, button('Ho letto', function () { api('POST', '/api/sicurezza/letto').then(function () { S.sic.recupero = null; render(); }, function (e) { alert(e.message); }); }, 'btn-small'))));
  if (sic && sic.errore) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'La copia giornaliera non è riuscita.' }), el('span', null, sic.errore + ' Controlla lo spazio sul disco e riprova da Impostazioni → Sicurezza dei dati.')));
  if (!S.remoto && S.db.allieve.length && !S.copie2.cartella) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'Le copie di sicurezza stanno solo su questo computer.' }),
    el('span', null, 'Se il disco si rompe o il computer viene perso, si perdono anche le copie. Scegli una seconda cartella su una chiavetta, un disco esterno o una cartella sincronizzata (OneDrive, Google Drive): ', link('imposta la seconda cartella', 'impostazioni'), '.')));
  if (S.copie2.cartella && S.copie2.avviso) add(v, el('div', { class: 'note note-warn' }, el('b', { text: 'La seconda cartella non protegge da un guasto del disco.' }), el('span', null, S.copie2.avviso)));
  if (S.copie2.cartella && S.copie2.errore) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'La copia sulla seconda cartella non riesce.' }),
    el('span', null, S.copie2.errore + ' Collega la chiavetta o il disco, oppure ', link('scegli un\'altra cartella in Impostazioni', 'impostazioni'), '.')));
  var pc = L.promemoriaCopia(S.db, today(), S.copie2);
  if (pc.serve) add(v, el('div', { class: 'note note-warn' }, el('b', { text: pc.giorni === null ? 'Non hai ancora scaricato una copia di sicurezza.' : 'L\'ultima copia di sicurezza scaricata è di ' + pc.giorni + ' giorni fa.' }),
    el('span', null, 'Scaricane una e conservala fuori dal computer: ', link('vai a Impostazioni', 'impostazioni'), '.')));
  if (an.incassiTot > 0 || S.db.pagamenti.length) {
    var diff = mesePrec > 0 ? Math.round((mese - mesePrec) / mesePrec * 100) : null;
    add(v, el('div', { class: 'cols2' },
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Incassi degli ultimi 12 mesi' }), link('Tutta l\'analisi', 'analisi')),
        el('p', { class: 'grande' }, el('b', { text: C.fmtMoney(mese) }), el('span', { class: 'muted', text: ' questo mese' + (diff === null ? '' : ' · ' + (diff >= 0 ? '+' : '') + diff + '% sul mese scorso') })),
        graficoBarre(an.mesi.map(function (m) { return m.l; }), [{ nome: 'Incassi', valori: an.incassiMese }], { h: 170, fmt: C.fmtMoney, corto: eurCorto, etichetta: 'Incassi per mese', media: an.mediaMensile })),
      cardCompleanni(7)));
  } else if (L.compleanni(S.db, today(), 7).length) add(v, cardCompleanni(7));
  add(v, el('h2', { class: 'sezione', text: 'L\'archivio' }));
  add(v, el('div', { class: 'grid' },
    tile(r.allieve, 'Allieve', '', 'allieve', r.archiviate ? plurale(r.archiviate, 'archiviata', 'archiviate') : 'nessuna archiviata'),
    tile(r.correnti, 'Iscrizioni aperte', 'ok', 'iscrizioni', r.attive + ' attive'),
    tile(r.daCompletare, 'Da completare', 'mute', 'iscrizioni', 'senza tipo o data di inizio'),
    tile(r.senzaIscrizione, 'Senza iscrizione', 'mute', 'allieve', 'nessun corso aperto')));
  var perCorso = L.corsiRiepilogo(S.db).filter(function (x) { return x.iscritte > 0; });
  if (perCorso.length) add(v, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Iscritte per corso' }), link('Elenchi e fogli presenze', 'corsi')),
    el('div', { class: 'row' }, perCorso.map(function (x) { return link((x.corso || 'Corso da definire') + ' · ' + x.iscritte, 'corsi/' + encodeURIComponent(x.corso), 'chip chip-mute chip-link'); }))));
  var all = sc.scadute.concat(sc.inScadenza), card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Abbonamenti da seguire' }), all.length ? link('Vedi tutte le scadenze', 'scadenze') : null));
  if (!all.length) add(card, el('p', { class: 'empty', text: 'Nessun abbonamento scaduto o in scadenza nei prossimi ' + S.db.impostazioni.preavvisoAbb + ' giorni.' }));
  else add(card, el('div', { class: 'list' }, all.slice(0, 8).map(function (x) { return rigaScadenza(x, false); })));
  add(v, card);
}

function cardCompleanni(giorni) {
  var c = L.compleanni(S.db, today(), giorni), card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Compleanni' }), el('span', { class: 'muted small', text: 'prossimi ' + giorni + ' giorni' })));
  if (!c.length) return add(card, el('p', { class: 'empty', text: 'Nessun compleanno in arrivo.' })) || card;
  add(card, el('div', { class: 'list' }, c.slice(0, 8).map(function (x) {
    return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, link(x.allieva.name, 'allieva/' + x.allieva.id, 'name'), el('div', { class: 'muted small', text: 'compie ' + x.eta + ' anni' })),
      el('span', { class: 'chip ' + (x.giorni === 0 ? 'chip-ok' : 'chip-mute'), text: x.giorni === 0 ? 'Oggi' : x.giorni === 1 ? 'Domani' : C.isoToIt(x.data).slice(0, 5) }));
  })));
  return card;
}

/* ---------- Analisi ---------- */
function vAnalisi(v) {
  var t = today(), a = L.analisi(S.db, t, S.an.periodo), mesi = a.mesi.map(function (m) { return m.l; }), det = S.det;
  var titolo = S.an.periodo === 'stagione' ? 'Stagione ' + S.db.impostazioni.stagione : 'Ultimi 12 mesi';
  var seg = el('div', { class: 'segmenti', role: 'tablist' }, [['stagione', 'Stagione'], ['12mesi', 'Ultimi 12 mesi']].map(function (x) {
    return el('button', { type: 'button', role: 'tab', 'aria-selected': S.an.periodo === x[0] ? 'true' : 'false', text: x[1], onclick: function () { S.an.periodo = x[0]; render(); } });
  }));
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Analisi' }), el('p', { class: 'muted', text: titolo + ' · ' + C.isoToIt(a.dal) + ' – oggi' })), seg));

  var r = L.riepilogo(S.db, t);
  add(v, el('div', { class: 'grid' },
    tile(soldi(a.incassiTot), 'Incassato', 'ok', 'pagamenti', plurale(a.incassiN, 'pagamento', 'pagamenti') + ' · medio ' + C.fmtMoney(a.incassoMedio) + (a.daVerificareN ? ' · ' + C.fmtMoney(a.daVerificareTot) + ' da verificare' : ''), a.incassiTot),
    tile(soldi(a.daIncassare), 'Da incassare', a.daIncassare ? 'warn' : 'ok', 'pagamenti', plurale(a.daIncassareN, 'iscrizione', 'iscrizioni') + ' con residuo', a.daIncassare),
    tile(a.tasso === null ? '–' : a.tasso + '%', 'Tasso di incasso', a.tasso === null ? 'mute' : a.tasso >= 90 ? 'ok' : a.tasso >= 70 ? 'warn' : 'bad', null, 'pagato su dovuto, iscrizioni avviate nel periodo'),
    tile(r.correnti, 'Iscrizioni aperte', '', 'iscrizioni', r.attive + ' attive · ' + r.inScadenza + ' in scadenza'),
    tile(a.etaMedia === null ? '–' : String(a.etaMedia).replace('.', ','), 'Età media', 'mute', 'allieve', 'anni, allieve non archiviate')));

  function card(titolo, corpo, nota, extra) { return el('div', { class: 'card' + (extra ? ' ' + extra : '') }, el('div', { class: 'card-head' }, el('h2', { text: titolo })), nota ? el('p', { class: 'muted small', text: nota }) : null, corpo); }

  // takings
  var metodi = Object.keys(a.perMetodo).sort(function (x, y) { return a.perMetodo[y] - a.perMetodo[x]; });
  var corsiInc = Object.keys(a.perCorso).sort(function (x, y) { return a.perCorso[y] - a.perCorso[x]; });
  add(v, el('div', { class: 'cols2 wide-left' },
    card('Incassi per mese', graficoBarre(mesi, [{ nome: 'Incassi', valori: a.incassiMese }], { fmt: C.fmtMoney, corto: eurCorto, etichetta: 'Incassi per mese', media: a.mediaMensile }),
      a.mediaMensile ? 'La linea tratteggiata è la media dei mesi con incassi: ' + C.fmtMoney(a.mediaMensile) + '.' : 'Nessun pagamento in questo periodo.'),
    card('Incassi per metodo', a.incassiTot > 0 ? graficoCiambella(metodi.map(function (m, i) { return { l: m, v: a.perMetodo[m], c: CS[i % CS.length], testo: C.fmtMoney(a.perMetodo[m]) }; }), { t: eurCorto(a.incassiTot) + ' €', s: 'incassato' }, { etichetta: 'Incassi per metodo' }) : el('p', { class: 'empty', text: 'Nessun pagamento in questo periodo.' }))));

  // what is still owed
  var palRes = ['var(--c2)', 'var(--c6)', 'var(--c3)', 'var(--c5)', 'var(--c4)'];
  var resRows = a.residui.filter(function (f) { return f.n > 0; });
  var cardRes = card('Da incassare, per anzianità', a.daIncassareN ? el('div', null,
    barreOrizzontali(resRows.map(function (f, i) { return { l: f.l, v: f.euro, testo: C.fmtMoney(f.euro) + ' · ' + f.n, c: palRes[a.residui.indexOf(f)] }; })),
    el('h3', { class: 'sotto', text: 'Residui più alti' }),
    el('div', { class: 'list' }, a.debitori.map(function (d) {
      return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, link(d.allieva.name, 'iscrizione/' + d.iscrizione.id, 'name'), el('div', { class: 'muted small', text: [d.iscrizione.corso, d.giorni === null ? 'senza data di inizio' : d.giorni < 0 ? 'inizia tra ' + (-d.giorni) + ' giorni' : 'iniziata da ' + d.giorni + ' giorni'].join(' · ') })),
        el('b', { class: 'mono', text: C.fmtMoney(d.residuo) }), waButton(d.allieva.tel, 'Buongiorno, ci risulta un residuo di ' + C.fmtMoney(d.residuo) + ' per il corso ' + (d.iscrizione.corso || '') + ' di ' + d.allieva.name + '. Grazie, A.S.D. Gym Art Avezzano'));
    }))) : el('p', { class: 'empty', text: 'Niente da incassare: tutte le iscrizioni con una quota risultano saldate.' }),
    'Anzianità = giorni dalla data di inizio dell\'iscrizione: il programma non ha scadenze di pagamento, usa l\'inizio come riferimento.');
  var cardSett = card('Prossime 8 settimane', graficoBarre(a.settimane.map(function (x) { return x.l; }), [
      { nome: 'Abbonamenti in scadenza', colore: 'var(--c1)', valori: a.settimane.map(function (x) { return x.abb; }) }, { nome: 'Certificati in scadenza', colore: 'var(--c3)', valori: a.settimane.map(function (x) { return x.cert; }) }], { etichetta: 'Scadenze nelle prossime settimane', h: 220 }),
    'Ogni colonna è una settimana, con la data di inizio. "Scaduti" raccoglie quelli già oltre la scadenza.');
  add(v, el('div', { class: 'cols2' }, cardRes, cardSett));
  var rinnovi = a.settimane.filter(function (x) { return x.euro > 0; });
  if (det && rinnovi.length) add(v, card('Rinnovi attesi', el('div', { class: 'scroll-x' }, el('table', { class: 'dati' }, el('thead', null, el('tr', null, el('th', { text: 'Settimana' }), el('th', { class: 'num', text: 'Abbonamenti' }), el('th', { class: 'num', text: 'Quote da rinnovare' }))),
    el('tbody', null, rinnovi.map(function (x) { return el('tr', null, el('th', { text: x.l }), el('td', { class: 'num', text: x.abb }), el('td', { class: 'num', text: C.fmtMoney(x.euro) })); })))), 'Quota di ogni abbonamento in scadenza: indica quanto entrerebbe se tutti rinnovassero.', 'solo-det'));

  // who attends
  var cs = a.corsi.map(function (x, i) { return { l: x.corso || 'Da definire', v: x.iscritte, testo: String(x.iscritte), href: 'corsi/' + encodeURIComponent(x.corso), c: CS[i % CS.length] }; });
  add(v, el('div', { class: 'cols2' },
    card('Iscritte per corso', cs.length ? barreOrizzontali(cs) : el('p', { class: 'empty', text: 'Nessuna iscrizione aperta.' }), plurale(a.iscritteTot, 'iscrizione aperta', 'iscrizioni aperte') + ' · un clic apre l\'elenco del corso.'),
    card('Presenze previste per giorno', graficoBarre(a.giorni.map(function (g) { return g.l; }), [{ nome: 'Iscrizioni', valori: a.giorni.map(function (g) { return g.n; }), colore: 'var(--c4)' }], { etichetta: 'Iscrizioni aperte per giorno', h: 200 }), 'Quante iscrizioni aperte hanno lezione in ciascun giorno.')));
  add(v, el('div', { class: 'cols2' },
    card('Iscrizioni avviate per mese', graficoBarre(mesi, [{ nome: 'Iscrizioni', valori: a.avviateMese, colore: 'var(--c2)' }], { etichetta: 'Iscrizioni avviate per mese', h: 200 }), 'Conta la data di inizio di ogni iscrizione non annullata, rinnovi compresi.'),
    card('Certificati medici', (a.certValidi + a.certInScadenza + a.certScaduti + a.certMancanti) ? graficoCiambella([
      { l: 'Validi', v: a.certValidi, c: 'var(--c2)', testo: String(a.certValidi) }, { l: 'In scadenza', v: a.certInScadenza, c: 'var(--c3)', testo: String(a.certInScadenza) },
      { l: 'Scaduti', v: a.certScaduti, c: 'var(--c5)', testo: String(a.certScaduti) }, { l: 'Mancanti', v: a.certMancanti, c: 'var(--grigio)', testo: String(a.certMancanti) }],
      { t: String(a.certValidi + a.certInScadenza + a.certScaduti + a.certMancanti), s: 'allieve' }, { etichetta: 'Stato dei certificati' }) : el('p', { class: 'empty', text: 'Nessuna allieva con iscrizione aperta.' }), 'Allieve non archiviate con almeno un\'iscrizione aperta.')));

  // incassi per corso + small things
  var m = a.mancanti, dati = [['telefono', 'Senza telefono', m.telefono], ['cf', 'Senza codice fiscale', m.cf], ['nascita', 'Senza data di nascita', m.nascita], ['privacy', 'Consenso privacy non indicato', m.privacy], ['genitore', 'Minorenni senza genitore indicato', m.genitore]];
  var mCard = card('Dati da completare', dati.some(function (x) { return x[2].length; }) ? el('div', { class: 'list' }, dati.filter(function (x) { return x[2].length; }).map(function (x) {
    return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, el('b', { text: x[1] }), el('div', { class: 'muted small solo-det', text: x[2].slice(0, 12).join(', ') + (x[2].length > 12 ? '… e altre ' + (x[2].length - 12) : '') })), chip(String(x[2].length), 'warn'));
  })) : el('p', { class: 'empty', text: 'Le schede delle allieve sono complete.' }), 'Allieve non archiviate. Nella vista dettagliata compaiono i nomi.');
  add(v, el('div', { class: 'cols2' },
    card('Incassi per corso', corsiInc.length ? barreOrizzontali(corsiInc.map(function (c, i) { return { l: c, v: a.perCorso[c], testo: C.fmtMoney(a.perCorso[c]), c: CS[i % CS.length] }; })) : el('p', { class: 'empty', text: 'Nessun pagamento in questo periodo.' })),
    mCard));
  add(v, cardCompleanni(14));
}

/* ---------- Allieve ---------- */
function vAllieve(v) {
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' });
  var cols = [
    { h: 'Allieva', key: function (r) { return r.a.name; }, cell: function (r) { return [link(r.a.name, 'allieva/' + r.a.id, 'name'), r.a.archiviata ? [' ', chip('Archiviata')] : null]; } },
    { h: 'Età', cls: 'nowrap', key: function (r) { return C.isIso(r.a.nascita) ? C.daysBetween(r.a.nascita, r.t) : null; }, cell: function (r) { return eta(r.a); } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (r) { return r.a.tel; } },
    { h: 'Genitore / Referente', key: function (r) { return r.a.genitore; }, cell: function (r) { return r.a.genitore; } },
    { h: 'Certificato', key: function (r) { return r.cert.stato === 'MANCANTE' ? null : r.cert.scadenza; }, cell: function (r) { return r.isc.length || r.cert.stato !== 'MANCANTE' ? chipCert(r.cert) : ''; } },
    { h: 'Email', det: true, key: function (r) { return r.a.email; }, cell: function (r) { return r.a.email; } },
    { h: 'Città', det: true, key: function (r) { return r.a.citta; }, cell: function (r) { return r.a.citta; } },
    { h: 'Codice fiscale', det: true, cls: 'nowrap mono', cell: function (r) { return r.a.cf; } },
    { h: 'Da pagare', det: true, cls: 'num', key: function (r) { return r.conto.residuo; }, cell: function (r) { return r.conto.residuo > 0.005 ? C.fmtMoney(r.conto.residuo) : ''; } },
    { h: 'Iscrizioni', key: function (r) { return r.isc.map(function (x) { return x.e.corso; }).join(' '); }, cell: function (r) {
      return r.isc.length ? r.isc.map(function (x) { return chip((x.e.corso || 'Corso da definire') + (x.s.stato === 'ATTIVO' ? '' : ' · ' + x.s.stato.toLowerCase()), STATO_KIND[x.s.stato]); }) : el('span', { class: 'muted small', text: 'nessuna' });
    } }
  ];
  function draw() {
    var t = today(), rows = L.cercaAllieve(S.db, S.fa.q, S.fa.filtro).map(function (a) {
      return { a: a, t: t, conto: L.contoAllieva(S.db, a.id), cert: L.statoCertificato(S.db, a, t), isc: L.iscrizioniDi(S.db, a.id).filter(L.corrente).map(function (e) { return { e: e, s: L.statoIscrizione(S.db, e, t) }; }) };
    });
    count.textContent = rows.length === 1 ? '1 allieva' : rows.length + ' allieve';
    clear(box); clear(more);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.allieve.length ? 'Nessuna allieva corrisponde alla ricerca.' : 'Non ci sono ancora allieve.' })); return; }
    var e = elenco(cols, rows, S.fa.sort, draw, function (r) { return { class: 'link', onclick: function () { go('allieva/' + r.a.id); } }; }, S.fa);
    add(box, e.table); add(more, e.more);
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: S.fa.q, placeholder: 'Nome, telefono, genitore, codice fiscale…', oninput: function () { S.fa.q = search.value; S.fa.tutte = false; later(); } });
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Allieve' }), el('div', { class: 'row' }, button('Modulo di iscrizione in bianco (PDF)', function () { scaricaPdf('Modulo_iscrizione_in_bianco', window.GymPdf.moduloIscrizione({ stagione: S.db.impostazioni.stagione })); }), link('Nuova allieva', 'allieva/nuova', 'btn btn-primary'))));
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
    drawCert();
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
  // A certificate is valid one year from its issue date, unless a different expiry is printed on it: the date is proposed and can be changed.
  var scadAuto = !f.certScadenza, certStato = el('span');
  var scad = input(f, 'certScadenza', 'date', function () { scadAuto = false; ch(); });
  var ril = input(f, 'certRilascio', 'date', function () { if (scadAuto && C.isIso(f.certRilascio)) { f.certScadenza = C.addYears(f.certRilascio, 1); scad.value = f.certScadenza; } ch(); });
  function drawCert() { clear(certStato); if (f.certTipo || f.certScadenza) add(certStato, chipCert(L.statoCertificato(S.db, { certTipo: f.certTipo, certScadenza: C.parseDate(f.certScadenza) || '' }, today()))); }
  var noteArea = el('textarea', { value: f.note || '', oninput: function () { f.note = noteArea.value; ch(); } });

  add(v, link('Tutte le allieve', 'allieve', 'back'));
  add(v, el('div', { class: 'head-row' }, el('h1', { text: cur ? cur.name : 'Nuova allieva' }),
    cur ? el('div', { class: 'row' }, chip('n. ' + cur.id), eta(cur) ? chip(eta(cur)) : null, cur.archiviata ? chip('Archiviata', 'warn') : null, waButton(cur.tel, '')) : null));
  if (cur) { var ct = L.contoAllieva(S.db, id); if (ct.pagato > 0 || ct.residuo > 0) add(v, el('div', { class: 'info-line riepilogo-allieva' }, el('span', null, 'Pagato in totale: ', el('b', { text: C.fmtMoney(ct.pagato) })), ct.residuo > 0.005 ? el('span', null, 'Da pagare: ', el('b', { text: C.fmtMoney(ct.residuo) })) : el('span', null, 'Tutto saldato'), el('span', { class: 'solo-det' }, 'Dovuto in totale: ', el('b', { text: C.fmtMoney(ct.dovuto) })), el('span', { class: 'solo-det', text: 'Creata il ' + C.isoToIt((cur.creata || '').slice(0, 10)) }))); }
  add(v, el('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submit(); } },
    el('h2', { text: 'Dati dell\'allieva' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.name, inp('name', 'text', { placeholder: 'Cognome Nome' }), 'Prima il cognome, poi il nome.'), field(L.A_CAMPI.nascita, inp('nascita', 'date')), field(L.A_CAMPI.luogo, inp('luogo')), cfField,
      field(L.A_CAMPI.indirizzo, inp('indirizzo')), field(L.A_CAMPI.citta, inp('citta')), field(L.A_CAMPI.cap, inp('cap', 'text', { inputmode: 'numeric', maxlength: 5 })), field(L.A_CAMPI.tessera, inp('tessera'))),
    el('h2', { text: 'Genitore e contatti' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.genitore, inp('genitore', 'text', { placeholder: 'Cognome Nome' })), field(L.A_CAMPI.cfGenitore, inp('cfGenitore', 'text', { maxlength: 20, spellcheck: 'false' })),
      field(L.A_CAMPI.tel, inp('tel', 'tel')), field(L.A_CAMPI.tel2, inp('tel2', 'tel')), field(L.A_CAMPI.email, inp('email', 'email'))),
    el('div', { class: 'row' }, el('h2', { text: 'Certificato medico' }), certStato),
    el('div', { class: 'fields' },
      field('Tipo', select([['', '(nessun certificato)']].concat(L.CERT_TIPI), f.certTipo || '', function (x) { f.certTipo = x; ch(); }), 'Il certificato per attività ludico-motoria non vale per l\'attività sportiva: va segnalato.'),
      field('Data di rilascio', ril), field('Scadenza', scad, 'Un anno dal rilascio, salvo una scadenza diversa stampata sul certificato.')),
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
      var s = L.statoIscrizione(S.db, e, today()), c = L.conto(S.db, e);
      return el('div', { class: 'list-item' },
        el('div', { class: 'grow' }, el('div', null, el('b', { text: e.corso || 'Corso da definire' }), ' ', chipStato(s.stato), ' ', e.annullata || c.stato === 'SENZA QUOTA' ? null : chipConto(c)),
          el('div', { class: 'muted small', text: [e.giorni.join(', '), e.fascia, e.tipo, e.inizio ? 'dal ' + C.isoToIt(e.inizio) : '', s.scadenza ? 'al ' + C.isoToIt(s.scadenza) : '',
            c.dovuto === null ? '' : 'dovuto ' + C.fmtMoney(c.dovuto), c.residuo > 0.005 ? 'da pagare ' + C.fmtMoney(c.residuo) : ''].filter(Boolean).join(' · ') })),
        el('div', { class: 'row' }, L.corrente(e) && s.scadenza ? button('Rinnova', function () { rinnova(e.id, 'allieva/' + id); }, 'btn-small') : null,
          link(c.residuo > 0.005 && !e.annullata ? 'Apri e registra un pagamento' : 'Apri', 'iscrizione/' + e.id, 'btn btn-small')));
    })));
    add(v, card);
    var aperta = isc.filter(L.corrente)[0], imp = S.db.impostazioni;
    add(v, el('div', { class: 'card' }, el('h2', { text: 'Documenti da stampare' }),
      el('p', { class: 'muted small', text: 'PDF in formato A4 con i dati dell\'allieva già scritti; il resto si compila a penna.' }),
      el('div', { class: 'row' },
        button('Modulo di iscrizione', function () { scaricaPdf('Modulo_iscrizione_' + cur.name, window.GymPdf.moduloIscrizione(datiPdf(cur, aperta))); }),
        button('Richiesta certificato non agonistico', function () { scaricaPdf('Richiesta_certificato_' + cur.name, window.GymPdf.richiestaCertificato(datiPdf(cur, aperta, 'non_agonistico'))); }),
        button('Richiesta certificato agonistico', function () { scaricaPdf('Richiesta_certificato_agonistico_' + cur.name, window.GymPdf.richiestaCertificato(datiPdf(cur, aperta, 'agonistico'))); })),
      imp.legale && imp.ente ? null : el('p', { class: 'muted small' }, 'Nella richiesta di certificato restano in bianco il legale rappresentante e l\'ente di affiliazione: si scrivono una volta in ', link('Impostazioni', 'impostazioni'), '.')));
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
/** Data for the PDF forms: the student, her parent and, for the enrollment form, the course she attends. */
function datiPdf(a, e, tipoCertificato) {
  var imp = S.db.impostazioni, d = { stagione: imp.stagione, data: C.isoToIt(today()),
    atleta: { nome: a.name, nascita: C.isoToIt(a.nascita), luogo: a.luogo, cf: a.cf, indirizzo: a.indirizzo, citta: a.citta, cap: a.cap },
    genitore: { nome: a.genitore, cf: a.cfGenitore, tel: a.tel, email: a.email, tel2: a.tel2 } };
  if (e) { d.corso = /propedeutico/i.test(e.corso) ? 'baby' : e.corso; d.giorni = e.giorni; d.orario = e.fascia; } // the form calls the Propedeutico course "Artistica Baby"
  if (tipoCertificato) { d.tipo = tipoCertificato; d.societa = { legale: imp.legale, ente: imp.ente, codice: imp.codice }; }
  return d;
}
/** A transfer is checked by a person with the bank statement in hand: the program asks, never decides. */
function verifica(id, on) {
  var p = L.byId(S.db.pagamenti, id);
  if (!p) return;
  var nome = (L.byId(S.db.allieve, (L.byId(S.db.iscrizioni, p.iscrizioneId) || {}).allievaId) || {}).name || '';
  if (on && !confirm('Hai controllato l\'estratto conto? Il bonifico di ' + C.fmtMoney(p.importo) + (nome ? ' di ' + nome : '') + ' del ' + C.isoToIt(p.data) + ' risulta accreditato?')) return;
  var res = attempt(function () { return L.verificaPagamento(S.db, id, on, nowIso()); });
  if (res) commit(res, on ? 'Bonifico segnato come verificato.' : 'Verifica annullata.').then(function (ok) { if (ok) render(); });
}
function statoBonifico(p) {
  if (p.daVerificare) return chip('Da verificare', 'warn');
  return L.richiedeVerifica(p.metodo) && p.verificatoIl ? chip('Verificato il ' + C.isoToIt(p.verificatoIl).slice(0, 5), 'ok') : null;
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
    { h: 'Tariffa', det: true, key: function (x) { return x.e.pacchetto; }, cell: function (x) { return x.e.pacchetto; } },
    { h: 'N.', det: true, cls: 'nowrap mono', key: function (x) { return x.e.id; }, cell: function (x) { return x.e.id; } },
    { h: 'Dovuto', cls: 'num', key: function (x) { return x.c.dovuto; }, cell: function (x) { return soldi(x.c.dovuto); } },
    { h: 'Resta', cls: 'num', key: function (x) { return x.e.annullata ? null : x.c.residuo; }, cell: function (x) { return x.e.annullata || x.c.residuo === null ? '' : x.c.residuo > 0.005 ? C.fmtMoney(x.c.residuo) : 'saldato'; } },
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
      rows.push({ e: e, s: s, nome: nome, c: L.conto(S.db, e) });
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
    { h: 'Stato', key: function (x) { return STATO_ORDINE[x.stato.stato]; }, cell: function (x) { return chipStato(x.stato.stato); } },
    { h: 'Certificato', key: function (x) { var c = L.statoCertificato(S.db, x.allieva, t); return c.stato === 'MANCANTE' ? null : c.scadenza; }, cell: function (x) { return chipCert(L.statoCertificato(S.db, x.allieva, t)); } }
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
  f.quotaIscrizione = typeof f.quotaIscrizione === 'number' ? String(f.quotaIscrizione).replace('.', ',') : '';
  var al = L.byId(S.db.allieve, f.allievaId), back = al ? 'allieva/' + al.id : 'iscrizioni';
  var pacchettoScelto = !!f.pacchetto, notes = el('div', { class: 'notes' }), info = el('div', { class: 'info-line' }), save = button(cur ? 'Salva le modifiche' : 'Salva l\'iscrizione', submit, 'btn-primary'), shown = !!cur;
  var pac = select([['', '(nessuna)']].concat(S.db.tariffario.map(function (p) { return p.chiave; })), f.pacchetto, function (x) { f.pacchetto = x; pacchettoScelto = !!x; ch(); });
  var quota = input(f, 'quota', 'text', ch, { inputmode: 'decimal' });
  // For a new enrollment the registration fee of the price list is proposed, until the user writes her own.
  var feeAuto = !cur, fee = input(f, 'quotaIscrizione', 'text', function () { feeAuto = false; ch(); }, { inputmode: 'decimal' });
  function refresh() {
    if (!pacchettoScelto) { var sug = C.suggestPacchetto(S.db.tariffario, f.corso, f.giorni.length || null); if (sug !== f.pacchetto) { f.pacchetto = sug; pac.value = sug; } }
    if (feeAuto) { var tar = S.db.tariffario.filter(function (p) { return p.chiave === f.pacchetto; })[0]; f.quotaIscrizione = tar && tar.iscrizione ? String(tar.iscrizione).replace('.', ',') : ''; fee.value = f.quotaIscrizione; }
    var chk = L.controllaIscrizione(S.db, f, id), o = chk.valori, sc = L.scadenza(o), listino = C.quotaTariffario(S.db.tariffario, o.pacchetto, o.tipo);
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di salvare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    save.disabled = shown && chk.errors.length > 0;
    quota.placeholder = listino === null ? '' : 'da tariffario: ' + C.fmtMoney(listino);
    clear(info);
    add(info, el('span', null, 'Scadenza: ', el('b', { text: sc ? C.isoToIt(sc) : 'da definire' })),
      el('span', null, 'Quota da tariffario: ', el('b', { text: listino === null ? 'non prevista' : C.fmtMoney(listino) })),
      typeof o.quota === 'number' ? el('span', null, 'Quota concordata: ', el('b', { text: C.fmtMoney(o.quota) })) : null,
      el('span', null, 'Totale dovuto: ', el('b', { text: L.dovuto(S.db, o) === null ? 'da definire' : C.fmtMoney(L.dovuto(S.db, o)) })));
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
      field(L.I_CAMPI.quotaIscrizione, fee, 'Una volta sola: si somma alla quota. Nei rinnovi resta vuota.'),
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
  if (cur) add(v, cardPagamenti(cur, al));
}
/** Payments of one enrollment: what is due, what was paid, the list with its receipts, and the form for a new one. */
function cardPagamenti(e, al) {
  var c = L.conto(S.db, e), lista = L.pagamentiDi(S.db, e.id), metodi = S.db.liste.metodi;
  var f = { iscrizioneId: e.id, data: today(), importo: c.residuo > 0.005 ? String(c.residuo).replace('.', ',') : '', metodo: '', note: '' };
  var notes = el('div', { class: 'notes' }), registra = button('Registra il pagamento', submit, 'btn-primary'), shown = false;
  function refresh() {
    var chk = L.controllaPagamento(S.db, f, today());
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di registrare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
  }
  function ch() { shown = true; refresh(); }
  function submit() {
    shown = true;
    if (S.dirty) { alert('Hai modificato l\'iscrizione senza salvare: salva (o annulla) prima di registrare il pagamento.'); return; }
    var chk = L.controllaPagamento(S.db, f, today());
    if (chk.errors.length) { refresh(); return; }
    if (chk.warnings.length && !confirm('Da controllare:\n\n- ' + chk.warnings.join('\n- ') + '\n\nRegistrare lo stesso il pagamento?')) return;
    var res = attempt(function () { return L.salvaPagamento(S.db, f, nowIso()); });
    if (res) commit(res, 'Pagamento registrato.').then(function (ok) { if (ok) go('iscrizione/' + e.id); });
  }
  return el('div', { class: 'card', id: 'pagamenti' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Pagamenti' }), e.annullata ? null : chipConto(c)),
    el('div', { class: 'info-line' }, el('span', null, 'Dovuto: ', el('b', { text: c.dovuto === null ? 'da definire' : C.fmtMoney(c.dovuto) })), el('span', null, 'Pagato: ', el('b', { text: C.fmtMoney(c.pagato) })),
      c.residuo === null ? null : el('span', null, c.residuo < -0.005 ? 'Eccedenza: ' : 'Resta da pagare: ', el('b', { text: C.fmtMoney(Math.abs(c.residuo)) }))),
    lista.length ? el('div', { class: 'scroll-x' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Data' }), el('th', { class: 'num', text: 'Importo' }), el('th', { text: 'Metodo' }), el('th', { text: 'Ricevuta n.' }), el('th', { text: 'Note' }), el('th'))),
      el('tbody', null, lista.map(function (p) {
        return el('tr', null, el('td', { class: 'nowrap mono', text: C.isoToIt(p.data) }), el('td', { class: 'num', text: C.fmtMoney(p.importo) }), el('td', null, p.metodo, statoBonifico(p) ? [' ', statoBonifico(p)] : null), el('td', { class: 'nowrap', text: p.ricevuta }), el('td', { class: 'muted', text: p.note }),
          el('td', { class: 'nowrap' }, L.richiedeVerifica(p.metodo) ? [button(p.daVerificare ? 'Segna verificato' : 'Annulla verifica', function () { verifica(p.id, !!p.daVerificare); }, 'btn-small' + (p.daVerificare ? ' btn-primary' : '')), ' '] : null, button('Ricevuta (PDF)', function () { ricevutaPdf(p.id); }, 'btn-small'), ' ', button('Elimina', function () {
            if (!confirm('Eliminare il pagamento di ' + C.fmtMoney(p.importo) + ' del ' + C.isoToIt(p.data) + ' (ricevuta ' + p.ricevuta + ')? Il numero di ricevuta non verrà riusato.')) return;
            var res = attempt(function () { return L.eliminaPagamento(S.db, p.id); });
            if (res) commit(res, 'Pagamento eliminato.', true).then(function (ok) { if (ok) go('iscrizione/' + e.id); });
          }, 'btn-small btn-danger')));
      })))) : el('p', { class: 'empty', text: 'Nessun pagamento registrato.' }),
    el('h3', { text: 'Nuovo pagamento' }),
    el('div', { class: 'fields' }, field('Data del pagamento', input(f, 'data', 'date', ch)), field('Importo', input(f, 'importo', 'text', ch, { inputmode: 'decimal' })),
      field('Metodo', select([['', '(scegli)']].concat(metodi), '', function (x) { f.metodo = x; ch(); })), field('Note del pagamento', input(f, 'note', 'text', ch))),
    notes, el('div', { class: 'actions' }, registra),
    el('p', { class: 'muted small', text: 'Un pagamento si registra solo con importo, metodo e data. La ricevuta prende il numero successivo di questa iscrizione.' }));
}
function ricevutaPdf(pagamentoId) {
  var d = attempt(function () { return L.datiRicevuta(S.db, pagamentoId); });
  if (d) scaricaPdf('Ricevuta_' + d.numero + '_' + d.atleta.nome, window.GymPdf.ricevuta(d));
}

/* ---------- Pagamenti ---------- */
function vPagamenti(v) {
  if (!S.fp.dal && !S.fp.al) { S.fp.dal = today().slice(0, 8) + '01'; S.fp.al = today(); } // this month so far
  var box = el('div', { class: 'scroll-x' }), more = el('div'), tot = el('div', { class: 'info-line' });
  var cols = [
    { h: 'Data', cls: 'nowrap mono', key: function (x) { return x.pagamento.data + x.pagamento.id; }, cell: function (x) { return C.isoToIt(x.pagamento.data); } },
    { h: 'Allieva', key: function (x) { return x.allieva ? x.allieva.name : ''; }, cell: function (x) { return x.iscrizione ? link(x.allieva ? x.allieva.name : '(allieva mancante)', 'iscrizione/' + x.iscrizione.id, 'name') : ''; } },
    { h: 'Corso', key: function (x) { return x.iscrizione ? x.iscrizione.corso : ''; }, cell: function (x) { return x.iscrizione ? x.iscrizione.corso : ''; } },
    { h: 'Abbonamento', det: true, key: function (x) { return x.iscrizione ? x.iscrizione.tipo : ''; }, cell: function (x) { return x.iscrizione ? x.iscrizione.tipo : ''; } },
    { h: 'Importo', cls: 'num', key: function (x) { return x.pagamento.importo; }, cell: function (x) { return C.fmtMoney(x.pagamento.importo); } },
    { h: 'Metodo', key: function (x) { return x.pagamento.metodo; }, cell: function (x) { return [x.pagamento.metodo, statoBonifico(x.pagamento) ? [' ', statoBonifico(x.pagamento)] : null]; } },
    { h: 'Ricevuta n.', cls: 'nowrap', key: function (x) { return x.pagamento.ricevuta; }, cell: function (x) { return x.pagamento.ricevuta; } },
    { h: 'Note', cell: function (x) { return x.pagamento.note; } },
    { h: '', cell: function (x) { return x.iscrizione && x.allieva ? button('Ricevuta (PDF)', function (ev) { ev.stopPropagation(); ricevutaPdf(x.pagamento.id); }, 'btn-small') : ''; } }
  ];
  function draw() {
    var r = L.incassi(S.db, { dal: C.parseDate(S.fp.dal) || '', al: C.parseDate(S.fp.al) || '', metodo: S.fp.metodo, q: S.fp.q });
    clear(tot); clear(box); clear(more);
    add(tot, el('span', null, plurale(r.righe.length, 'pagamento', 'pagamenti') + ' · incassato: ', el('b', { text: C.fmtMoney(r.totale) })),
      Object.keys(r.perMetodo).sort().map(function (m) { return el('span', null, m + ': ', el('b', { text: C.fmtMoney(r.perMetodo[m]) })); }),
      r.daVerificareN ? el('span', { class: 'attenzione' }, 'di cui da verificare: ', el('b', { text: C.fmtMoney(r.daVerificareTot) })) : null);
    if (!r.righe.length) { add(box, el('p', { class: 'empty', text: (S.db.pagamenti || []).length ? 'Nessun pagamento in questo periodo.' : 'Non ci sono ancora pagamenti: si registrano dalla scheda di un\'iscrizione.' })); return; }
    var l = elenco(cols, r.righe, S.fp.sort, draw, null, S.fp);
    add(box, l.table); add(more, l.more);
  }
  var later = debounce(draw, 120), f = S.fp;
  var search = el('input', { type: 'search', value: f.q, placeholder: 'Allieva, corso, numero di ricevuta…', oninput: function () { f.q = search.value; f.tutte = false; later(); } });
  var d = L.daIncassare(S.db);
  add(v, el('h1', { text: 'Pagamenti' }));
  var dv = L.daVerificare(S.db);
  if (dv.n) add(v, el('div', { class: 'card', id: 'da-verificare' }, el('div', { class: 'card-head' }, el('h2', { text: 'Bonifici da verificare (' + dv.n + ')' }), el('b', { class: 'mono', text: C.fmtMoney(dv.totale) })),
    el('p', { class: 'muted small', text: 'Un bonifico registrato conta negli incassi, ma resta "da verificare" finché non lo confermi guardando l\'estratto conto. Il programma non lo verifica mai da solo.' }),
    el('div', { class: 'list' }, dv.righe.map(function (x) {
      var p = x.pagamento;
      return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, x.allieva ? link(x.allieva.name, 'iscrizione/' + p.iscrizioneId, 'name') : el('b', { text: '(allieva mancante)' }),
        el('div', { class: 'muted small', text: [C.isoToIt(p.data), x.iscrizione ? x.iscrizione.corso : '', p.ricevuta, p.note].filter(Boolean).join(' · ') })),
        el('b', { class: 'mono', text: C.fmtMoney(p.importo) }), button('Segna verificato', function () { verifica(p.id, true); }, 'btn-small btn-primary'));
    }))));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Incassi' }),
    el('div', { class: 'toolbar' }, field('Dal', input(f, 'dal', 'date', draw), null, 'narrow'), field('Al', input(f, 'al', 'date', draw), null, 'narrow'),
      field('Metodo', select([['', 'Tutti i metodi']].concat(S.db.liste.metodi), f.metodo, function (x) { f.metodo = x; draw(); }), null, 'narrow'), field('Cerca', search)),
    tot, box, more));
  var colsD = [
    { h: 'Allieva', key: function (x) { return x.allieva.name; }, cell: function (x) { return link(x.allieva.name, 'iscrizione/' + x.iscrizione.id, 'name'); } },
    { h: 'Corso', key: function (x) { return x.iscrizione.corso; }, cell: function (x) { return x.iscrizione.corso; } },
    { h: 'Abbonamento', key: function (x) { return x.iscrizione.tipo; }, cell: function (x) { return x.iscrizione.tipo; } },
    { h: 'Inizio', cls: 'nowrap mono', key: function (x) { return x.iscrizione.inizio; }, cell: function (x) { return C.isoToIt(x.iscrizione.inizio); } },
    { h: 'Dovuto', cls: 'num', key: function (x) { return x.conto.dovuto; }, cell: function (x) { return C.fmtMoney(x.conto.dovuto); } },
    { h: 'Pagato', cls: 'num', key: function (x) { return x.conto.pagato; }, cell: function (x) { return C.fmtMoney(x.conto.pagato); } },
    { h: 'Resta', cls: 'num', key: function (x) { return x.conto.residuo; }, cell: function (x) { return C.fmtMoney(x.conto.residuo); } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (x) { return x.allieva.tel; } }
  ];
  var boxD = el('div', { class: 'scroll-x' });
  function drawD() { clear(boxD); add(boxD, tabella(colsD, sorted(d.righe, colsD, f.sortD), f.sortD, drawD, function (x) { return { class: 'link', onclick: function () { go('iscrizione/' + x.iscrizione.id); } }; })); }
  add(v, el('div', { class: 'card', id: 'da-incassare' }, el('h2', { text: 'Da incassare' }),
    d.righe.length ? [el('div', { class: 'info-line' }, el('span', null, plurale(d.righe.length, 'iscrizione', 'iscrizioni') + ' con un residuo · totale: ', el('b', { text: C.fmtMoney(d.totale) }))), boxD]
      : el('p', { class: 'empty', text: 'Niente da incassare: tutte le iscrizioni con una quota risultano saldate.' }),
    el('p', { class: 'muted small', text: 'Sono contate le iscrizioni non annullate che hanno una quota. Un clic sulla riga apre l\'iscrizione, dove si registra il pagamento.' })));
  draw();
  if (d.righe.length) drawD();
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
function rigaCertificato(x) {
  var a = x.allieva, s = x.stato;
  return el('div', { class: 'list-item' },
    el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', chipCert(s)),
      el('div', { class: 'muted small', text: [a.certTipo, a.genitore, a.tel ? 'tel. ' + a.tel : ''].filter(Boolean).join(' · ') })),
    el('div', { class: 'when small' }, s.stato === 'MANCANTE' ? 'Nessun certificato registrato' : (s.giorni < 0 ? 'Scaduto il ' : 'Scade il ') + C.isoToIt(s.scadenza) + ' (' + giorniTesto(s.giorni) + ')'),
    el('div', { class: 'row' }, waButton(a.tel, L.messaggioCertificato(S.db, a, s)), link('Apri', 'allieva/' + a.id, 'btn btn-small')));
}
function vScadenze(v) {
  var sc = L.scadenze(S.db, today()), ce = L.scadenzeCertificati(S.db, today()), n = S.db.impostazioni.preavvisoAbb, nc = S.db.impostazioni.preavvisoCert;
  function gruppo(titolo, righe, vuoto, riga, id) {
    return el('div', { class: 'card', id: id || null }, el('h2', { text: titolo + (righe.length ? ' (' + righe.length + ')' : '') }), righe.length ? el('div', { class: 'list' }, righe.map(riga)) : el('p', { class: 'empty', text: vuoto }));
  }
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Scadenze' }), link('Promemoria in blocco', 'promemoria', 'btn btn-primary')));
  add(v, el('div', { class: 'grid' }, tile(sc.scadute.length, 'Abbonamenti scaduti', 'bad', 'scadenze'), tile(sc.inScadenza.length, 'Abbonamenti in scadenza', 'warn', 'scadenze'),
    tile(ce.scaduti.length, 'Certificati scaduti', 'bad', 'scadenze'), tile(ce.inScadenza.length, 'Certificati in scadenza', 'warn', 'scadenze'), tile(ce.mancanti.length, 'Certificati mancanti', 'mute', 'scadenze')));
  var abb = function (x) { return rigaScadenza(x, true); };
  add(v, gruppo('Abbonamenti scaduti', sc.scadute, 'Nessun abbonamento scaduto.', abb));
  add(v, gruppo('Abbonamenti in scadenza entro ' + n + ' giorni', sc.inScadenza, 'Nessun abbonamento in scadenza.', abb));
  add(v, gruppo('Certificati medici scaduti', ce.scaduti, 'Nessun certificato scaduto.', rigaCertificato, 'cert-scaduti'));
  add(v, gruppo('Certificati medici in scadenza entro ' + nc + ' giorni', ce.inScadenza, 'Nessun certificato in scadenza.', rigaCertificato, 'cert-in-scadenza'));
  add(v, gruppo('Certificati medici mancanti', ce.mancanti, 'Tutte le allieve iscritte hanno un certificato registrato.', rigaCertificato, 'cert-mancanti'));
  add(v, el('p', { class: 'muted small', text: '"Rinnova" apre un nuovo periodo con gli stessi dati, a partire dalla scadenza; quello vecchio resta nello storico. "WhatsApp" apre la chat con il promemoria già scritto: lo leggi e lo invii tu (serve internet). I certificati sono elencati solo per le allieve non archiviate che hanno un\'iscrizione aperta. Preavvisi e testi dei promemoria si cambiano in Impostazioni.' }));
}

/* ---------- Nuova stagione ---------- */
var SCELTE = [['rinnova', 'Rinnova'], ['chiudi', 'Chiudi'], ['lascia', 'Lascia com\'è']];
function vStagione(v) {
  var db = S.db, cur = db.impostazioni.stagione, nuova = L.stagioneSuccessiva(cur) || L.stagioneDi(today());
  var f = { stagione: nuova, inizio: L.inizioStagione(nuova), quotaIscrizione: false, mantieniQuote: true }, inizioAuto = true;
  var piano = L.pianoStagione(db, today(), f.inizio), scelte = {};
  piano.righe.forEach(function (r) { scelte[r.iscrizione.id] = r.scelta; });
  var tab = el('div', { class: 'scroll-x' }), esito = el('div', { class: 'stack' }), conta = el('p', { class: 'muted' }), selects = {};
  function opz() { return { stagione: C.str(f.stagione), inizio: f.inizio, scelte: scelte, quotaIscrizione: f.quotaIscrizione, mantieniQuote: f.mantieniQuote }; }
  function imposta(sc) { piano.righe.forEach(function (r) { if (sc === 'proposta') scelte[r.iscrizione.id] = r.scelta; else scelte[r.iscrizione.id] = sc; if (selects[r.iscrizione.id]) selects[r.iscrizione.id].value = scelte[r.iscrizione.id]; }); anteprima(); }
  function anteprima() {
    clear(esito);
    var o = opz(), chk = L.controllaStagione(db, o, today()), n = { rinnova: 0, chiudi: 0, lascia: 0 };
    piano.righe.forEach(function (r) { n[scelte[r.iscrizione.id]]++; });
    conta.textContent = n.rinnova + ' da rinnovare · ' + n.chiudi + ' da chiudere · ' + n.lascia + ' lasciate come sono';
    if (chk.errors.length) add(esito, note('bad', 'Da correggere prima di continuare', chk.errors));
    if (chk.warnings.length) add(esito, note('warn', 'Controlla', chk.warnings));
    if (chk.errors.length) return;
    var r = L.nuovaStagione(db, o, nowIso(), today()), q = r.riepilogo, righe = [];
    righe.push('Stagione: da ' + cur + ' a ' + o.stagione + (cur === o.stagione ? ' (non cambia)' : '') + '.');
    righe.push(plurale(q.rinnovate, 'iscrizione rinnovata', 'iscrizioni rinnovate') + ' dal ' + C.isoToIt(o.inizio) + ', ' + q.chiuse + (q.chiuse === 1 ? ' chiusa' : ' chiuse') + ' senza rinnovo, ' + q.lasciate + ' non toccate.');
    if (q.rinnovate) righe.push('Dovuto delle nuove iscrizioni: ' + C.fmtMoney(q.nuovoDovuto) + (q.senzaQuota ? ' (' + plurale(q.senzaQuota, 'iscrizione senza quota nota', 'iscrizioni senza quota nota') + ': completa tipo o quota dopo)' : '') + '.');
    if (q.residuoVecchie > 0.005) righe.push('Ancora da incassare sui periodi che si chiudono: ' + C.fmtMoney(q.residuoVecchie) + '. Resta sul periodo vecchio e si vede in Pagamenti.');
    add(esito, note('', 'Cosa succede se confermi', righe));
    var tutto = q.rinnovate + q.chiuse === 0 && cur === o.stagione;
    var ok = button('Conferma la nuova stagione', function () {
      if (!confirm('Confermi?\n\n' + righe.join('\n') + '\n\nPrima di scrivere il programma salva una copia dell\'archivio. Ogni cambio finisce nel Registro.')) return;
      var res = attempt(function () { return L.nuovaStagione(S.db, opz(), nowIso(), today()); });
      if (res) commit(res, 'Nuova stagione ' + o.stagione + ' pronta.', true).then(function (fatto) { if (fatto) go('iscrizioni'); });
    }, 'btn-primary btn-big');
    ok.disabled = tutto;
    add(esito, el('div', { class: 'actions' }, ok));
  }
  function disegna() {
    clear(tab); selects = {};
    if (!piano.righe.length) { add(tab, el('p', { class: 'empty', text: 'Non ci sono iscrizioni aperte da portare avanti.' })); return; }
    var cols = [
      { h: 'Allieva', cell: function (r) { return el('div', null, link(r.allieva.name, 'iscrizione/' + r.iscrizione.id, 'name'), r.motivo ? el('div', { class: 'muted small', text: r.motivo }) : null); } },
      { h: 'Corso', cell: function (r) { return r.iscrizione.corso; } },
      { h: 'Giorni', cls: 'nowrap', cell: function (r) { return r.iscrizione.giorni.join(', '); } },
      { h: 'Abbonamento', cell: function (r) { return r.iscrizione.tipo; } },
      { h: 'Tariffa', det: true, cell: function (r) { return r.iscrizione.pacchetto; } },
      { h: 'Quota concordata', det: true, cls: 'num', cell: function (r) { return soldi(r.iscrizione.quota); } },
      { h: 'Scadenza', cls: 'nowrap mono', cell: function (r) { return C.isoToIt(r.stato.scadenza); } },
      { h: 'Resta', cls: 'num', cell: function (r) { return r.conto.residuo !== null && r.conto.residuo > 0.005 ? C.fmtMoney(r.conto.residuo) : ''; } },
      { h: 'Stato', cell: function (r) { return chipStato(r.stato.stato); } },
      { h: 'Cosa fare', cell: function (r) {
        var id = r.iscrizione.id, sel = select(SCELTE, scelte[id], function (x) { scelte[id] = x; anteprima(); });
        sel.setAttribute('aria-label', 'Cosa fare con l\'iscrizione di ' + r.allieva.name); selects[id] = sel; return sel; } }
    ];
    add(tab, tabella(cols, piano.righe, { col: 99, desc: false }, disegna));
  }
  var stag = input(f, 'stagione', 'text', function () { if (inizioAuto) { f.inizio = L.inizioStagione(C.str(f.stagione)) || f.inizio; ini.value = f.inizio; } anteprima(); }, { placeholder: '2027/2028' });
  var ini = input(f, 'inizio', 'date', function () { inizioAuto = false; anteprima(); });
  function check(key, label) { var c = el('input', { type: 'checkbox', checked: f[key] === true, onchange: function () { f[key] = c.checked; anteprima(); } }); return el('label', { class: 'check' }, c, el('span', { text: label })); }
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Nuova stagione' }), link('Torna alle impostazioni', 'impostazioni', 'btn')));
  add(v, note('', 'Come funziona', ['Scegli per ogni iscrizione aperta: rinnovare (nuovo periodo con gli stessi dati dalla data scelta), chiudere (non torna), oppure lasciarla com\'è.',
    'Nulla si cancella: i periodi vecchi restano nello storico, con i loro pagamenti e il residuo da incassare. Dati delle allieve e certificati non cambiano.',
    'Il programma propone una scelta, ma decidi tu: controlla soprattutto chi non torna. Prima di scrivere fa una copia dell\'archivio e ogni cambio va nel Registro.']));
  add(v, el('div', { class: 'card' }, el('h2', { text: '1 · Stagione e data di inizio' }),
    el('div', { class: 'fields' }, field('Nuova stagione', stag, 'Attuale: ' + cur + '.'), field('I nuovi periodi partono dal', ini, 'Di solito il primo giorno di corso.')),
    el('div', { class: 'stack' }, check('mantieniQuote', 'Mantieni le quote concordate a mano (altrimenti si usa il tariffario)'), check('quotaIscrizione', 'Addebita di nuovo "iscrizione e tesseramento" dove il tariffario la prevede'))));
  add(v, el('div', { class: 'card' }, el('h2', { text: '2 · Scegli per ogni iscrizione' }), conta,
    el('div', { class: 'row' }, button('Rinnova tutte', function () { imposta('rinnova'); }, 'btn-small'), button('Chiudi tutte', function () { imposta('chiudi'); }, 'btn-small'),
      button('Lascia tutte', function () { imposta('lascia'); }, 'btn-small'), button('Torna alla proposta', function () { imposta('proposta'); }, 'btn-small')), tab));
  add(v, el('div', { class: 'card' }, el('h2', { text: '3 · Controlla e conferma' }), esito));
  disegna(); anteprima();
}

/* ---------- Promemoria in blocco ---------- */
var CONTATTO_KIND = { 'da contattare': 'warn', 'da ricontattare': 'bad', 'contattata': 'ok' };
/** Notes that someone was contacted. A second click while the first is still being saved waits a moment instead of being lost. */
function segnaContatto(r, on, tentativo) {
  if (S.busy && (tentativo || 0) < 8) return new Promise(function (ok) { setTimeout(function () { ok(segnaContatto(r, on, (tentativo || 0) + 1)); }, 300); });
  var res = attempt(function () { return L.segnaPromemoria(S.db, { tipo: r.tipo, rif: r.rif, scadenza: r.scadenza, on: on }, nowIso(), today()); });
  if (!res) return Promise.resolve(false);
  if (!res.registro.length) return Promise.resolve(true);
  return commit(res, on ? 'Segnata come contattata.' : 'Segno tolto.');
}
function copiaTesto(testo) {
  var ok = function () { toast('Messaggio copiato.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(testo).then(ok, function () { prompt('Copia il messaggio:', testo); });
  else prompt('Copia il messaggio:', testo);
}
function vPromemoria(v) {
  S.fpm = S.fpm || { tipo: '', contatto: 'fare', corso: '', q: '' };
  var f = S.fpm, box = el('div', { class: 'list' }), more = el('div'), count = el('span', { class: 'count' }), tiles = el('div', { class: 'grid' }), ultimo = [];
  function riga(r) {
    var a = r.allieva, c = r.contatto, quando = c.quando ? C.isoToIt(c.quando).slice(0, 5) : '';
    var stato = r.stato === 'MANCANTE' ? chip('Certificato mancante', 'mute') : r.tipo === 'certificato' ? chipCert(L.statoCertificato(S.db, a, today())) : chipStato(r.stato === 'SCADUTO' ? 'SCADUTO' : 'IN SCADENZA');
    var quando2 = r.stato === 'MANCANTE' ? 'Nessun certificato registrato' : (r.giorni < 0 ? 'Scaduto il ' : 'Scade il ') + C.isoToIt(r.scadenza) + ' (' + giorniTesto(r.giorni) + ')';
    var wa = r.tel ? el('a', { class: 'btn btn-small btn-primary', href: C.waLink(r.tel, r.testo), target: '_blank', rel: 'noopener noreferrer', title: 'Apre WhatsApp con il messaggio già scritto: lo invii tu',
      onclick: function () { segnaContatto(r, true).then(function (ok) { if (ok) draw(); }); }, text: 'WhatsApp' }) : null;
    return el('div', { class: 'list-item' },
      el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', chip(r.tipo === 'abbonamento' ? 'Abbonamento' : 'Certificato', 'mute'), ' ', stato, ' ',
        chip(c.stato === 'da contattare' ? 'Da contattare' : c.stato === 'da ricontattare' ? 'Da ricontattare · ultimo ' + quando : 'Contattata il ' + quando, CONTATTO_KIND[c.stato]), r.tel ? null : ' ', r.tel ? null : chip('Senza telefono', 'bad')),
        el('div', { class: 'muted small', text: [r.corso, a.genitore, r.tel ? 'tel. ' + r.tel : ''].filter(Boolean).join(' · ') }),
        el('div', { class: 'muted small solo-det', text: r.testo })),
      el('div', { class: 'when small' }, quando2),
      el('div', { class: 'row' }, wa, r.tel ? button('Copia testo', function () { copiaTesto(r.testo); }, 'btn-small') : null,
        c.stato === 'contattata' ? button('Annulla', function () { segnaContatto(r, false).then(function (ok) { if (ok) draw(); }); }, 'btn-small')
          : button('Fatto', function () { segnaContatto(r, true).then(function (ok) { if (ok) draw(); }); }, 'btn-small'),
        link('Apri', r.tipo === 'abbonamento' ? 'iscrizione/' + r.rif : 'allieva/' + a.id, 'btn btn-small')));
  }
  function draw() {
    var res = L.elencoPromemoria(S.db, today(), f), cn = res.conteggi, righe = res.righe;
    ultimo = righe;
    clear(tiles);
    add(tiles, tile(cn.daFare, 'Da contattare', cn.daFare ? 'warn' : 'ok', null, 'abbonamenti e certificati'), tile(cn.contattate, 'Contattate di recente', 'ok', null, 'meno di ' + L.GIORNI_RICONTATTO + ' giorni fa'),
      tile(cn.senzaTelefono, 'Senza telefono valido', cn.senzaTelefono ? 'bad' : 'mute', null, 'da chiamare o da correggere'));
    animaNumeri(tiles);
    count.textContent = righe.length === 1 ? '1 promemoria' : righe.length + ' promemoria';
    clear(box); clear(more);
    if (!righe.length) { add(box, el('p', { class: 'empty', text: cn.totale ? (f.contatto === 'fare' ? 'Hai contattato tutti: niente da fare per ora.' : 'Nessun promemoria corrisponde ai filtri.') : 'Nessun abbonamento o certificato da sollecitare.' })); return; }
    righe.slice(0, MAX_ROWS).forEach(function (r) { add(box, riga(r)); });
    if (righe.length > MAX_ROWS) add(more, el('p', { class: 'muted small', text: 'Mostro i primi ' + MAX_ROWS + ' promemoria su ' + righe.length + ': usa i filtri per restringere.' }));
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: f.q, placeholder: 'Nome, genitore o corso…', oninput: function () { f.q = search.value; later(); } });
  var corsi = [['', 'Tutti i corsi']].concat(S.db.liste.corsi);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Promemoria' }), link('Torna alle scadenze', 'scadenze', 'btn')));
  add(v, note('', 'Come funziona', ['Qui trovi in un elenco solo chi ha un abbonamento scaduto o in scadenza e chi ha il certificato medico scaduto, in scadenza o mancante.',
    '"WhatsApp" apre la chat con il messaggio già scritto: lo invii tu, uno alla volta. Il programma segna "contattata" quando apri la chat, ma non può sapere se hai davvero inviato: se non l\'hai fatto, premi "Annulla".',
    'Chi hai contattato sparisce dall\'elenco "Da contattare". Se dopo ' + L.GIORNI_RICONTATTO + ' giorni è ancora da sollecitare, ricompare come "Da ricontattare". Con "Fatto" segni chi hai chiamato al telefono.']));
  add(v, tiles);
  add(v, el('div', { class: 'card' }, el('div', { class: 'toolbar' },
    field('Cerca', search), field('Mostra', select([['abbonamento', 'Abbonamenti'], ['certificato', 'Certificati'], ['', 'Abbonamenti e certificati']], f.tipo, function (x) { f.tipo = x; draw(); })),
    field('Stato', select([['fare', 'Da contattare'], ['contattate', 'Già contattate'], ['tutte', 'Tutte']], f.contatto, function (x) { f.contatto = x; draw(); })),
    field('Corso', select(corsi, f.corso, function (x) { f.corso = x; draw(); })),
    el('div', { class: 'row' }, button('Stampa l\'elenco', function () {
      if (!ultimo.length) { alert('Non c\'è niente da stampare con questi filtri.'); return; }
      stampa('Promemoria da fare', 'A.S.D. Gym Art Avezzano · ' + C.isoToIt(today()) + ' · ' + ultimo.length + (ultimo.length === 1 ? ' persona' : ' persone'),
        [{ h: 'Allieva', cell: function (r) { return r.allieva.name; } }, { h: 'Telefono', cls: 'nowrap', cell: function (r) { return r.tel || r.allieva.tel || r.allieva.tel2 || ''; } },
          { h: 'Genitore', cell: function (r) { return r.allieva.genitore || ''; } }, { h: 'Cosa', cell: function (r) { return (r.tipo === 'abbonamento' ? 'Abbonamento' : 'Certificato') + (r.corso && r.tipo === 'abbonamento' ? ' ' + r.corso : ''); } },
          { h: 'Scadenza', cls: 'nowrap', cell: function (r) { return r.stato === 'MANCANTE' ? 'manca' : C.isoToIt(r.scadenza); } }, { h: 'Fatto', cls: 'nowrap', cell: function () { return '☐'; } }], ultimo);
    }, 'btn-small'))),
    count, box, more));
  draw();
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
/** Sicurezza dei dati: lo stato delle copie, una copia subito, il controllo di tutte, l'elenco delle copie giornaliere con il ripristino. */
function cardSicurezza() {
  var stato = el('div', { class: 'stack' }), esito = el('div', { class: 'notes' }), elenco = el('div'), caricato = false;
  function disegna() {
    var s = S.sic || {}, c = S.copie2 || {}, ok = s.ultimaGiorno === today();
    clear(stato);
    add(stato, el('div', { class: 'row' }, chip(ok ? 'Copia di oggi fatta e controllata' : 'Copia di oggi non ancora fatta', ok ? 'ok' : 'warn'),
      chip(!c.cartella ? 'Seconda cartella: non impostata' : c.errore ? 'Seconda cartella: errore' : 'Seconda cartella attiva', !c.cartella || c.errore ? 'bad' : 'ok')),
      el('ul', { class: 'steps' },
        el('li', { text: 'Copie giornaliere: ' + (s.giornaliere || 0) + (s.prima ? ' (dal ' + C.isoToIt(s.prima) + ' al ' + C.isoToIt(s.ultimaGiorno) + ')' : '') + '. Una al giorno, di archivio e registro, riletta dopo la scrittura.' }),
        el('li', { text: 'Copie prima delle modifiche: ' + (s.recenti || 0) + ' (al massimo una ogni 10 minuti, le ultime 200).' }),
        el('li', { text: 'Registro delle modifiche: ' + (s.registroRighe || 0) + ' righe.' }),
        el('li', { text: c.cartella ? 'Seconda cartella: ' + (c.giornaliere || 0) + ' copie giornaliere' + (c.ultima ? ', aggiornata il ' + quando(c.ultima) : '') + '.' : 'Seconda cartella: non impostata. Senza, le copie stanno sullo stesso disco dei dati.' })),
      s.errore ? note('bad', 'La copia giornaliera non è riuscita', [s.errore]) : null, c.errore ? note('bad', c.errore) : null, c.avviso ? note('warn', c.avviso) : null);
  }
  function mostraElenco() {
    api('GET', '/api/giornaliere').then(function (j) {
      clear(elenco);
      var righe = j.copie || [];
      if (!righe.length) { add(elenco, el('p', { class: 'empty', text: 'Ancora nessuna copia giornaliera.' })); return; }
      add(elenco, el('div', { class: 'scroll-x' }, tabella([
        { h: 'Data', cls: 'nowrap', cell: function (b) { return C.isoToIt(b.nome.slice(0, 10)); } },
        { h: 'Ora', cls: 'nowrap mono', cell: function (b) { return quando(b.creato).slice(-5) + (b.motivo === 'manuale' ? ' (manuale)' : ''); } },
        { h: 'Allieve', cls: 'num', cell: function (b) { return b.allieve < 0 ? 'cifrata' : String(b.allieve); } },
        { h: 'Iscrizioni', cls: 'num', cell: function (b) { return b.iscrizioni < 0 ? '' : String(b.iscrizioni); } },
        { h: 'Pagamenti', cls: 'num', cell: function (b) { return b.pagamenti < 0 ? '' : String(b.pagamenti); } },
        { h: 'Registro', cls: 'num', cell: function (b) { return b.registroRighe + ' righe'; } },
        { h: '', cell: function (b) { return button('Ripristina…', function () {
          api('GET', '/api/giornaliere/archivio?nome=' + encodeURIComponent(b.nome)).then(function (r) { leggiCopia(r.testo, '', 'copia del ' + C.isoToIt(b.nome.slice(0, 10)) + ' ' + quando(b.creato).slice(-5)); }, function (e) { alert(e.message); });
        }, 'btn-small'); } }
      ], righe.slice(0, 120), { col: 99, desc: false }, function () {})));
      if (righe.length > 120) add(elenco, el('p', { class: 'muted small', text: 'Mostro le ultime 120 copie su ' + righe.length + '.' }));
    }, function (e) { clear(elenco); add(elenco, note('bad', e.message)); });
  }
  disegna();
  var adesso = button('Fai una copia ora', function () {
    adesso.disabled = true; clear(esito);
    api('POST', '/api/sicurezza/adesso').then(function (j) {
      adesso.disabled = false; S.sic = j.sicurezza; if (j.copie2) S.copie2 = j.copie2; disegna(); if (caricato) mostraElenco();
      toast('Copia fatta e controllata.');
      if (j.avviso) add(esito, note('warn', 'La seconda cartella non è stata aggiornata', [j.avviso]));
    }, function (e) { adesso.disabled = false; add(esito, note('bad', e.message)); });
  }, 'btn-primary');
  var controlla = button('Controlla tutte le copie', function () {
    controlla.disabled = true; clear(esito);
    api('POST', '/api/sicurezza/controlla').then(function (j) {
      controlla.disabled = false;
      var l = j.locali || { controllate: 0, errori: [] }, sc = j.seconda;
      add(esito, l.errori.length ? note('bad', 'Su questo computer ' + l.errori.length + ' copie su ' + l.controllate + ' non risultano integre', l.errori) : note('ok', 'Su questo computer: ' + plurale(l.controllate, 'copia controllata', 'copie controllate') + ', tutte integre.'));
      if (j.secondaErrore) add(esito, note('bad', 'Seconda cartella: ' + j.secondaErrore));
      else if (sc) add(esito, sc.errori.length ? note('bad', 'Nella seconda cartella ' + sc.errori.length + ' copie su ' + sc.controllate + ' non risultano integre', sc.errori) : note('ok', 'Nella seconda cartella: ' + plurale(sc.controllate, 'copia controllata', 'copie controllate') + ', tutte integre.'));
    }, function (e) { controlla.disabled = false; add(esito, note('bad', e.message)); });
  });
  var det = el('details', { ontoggle: function () { if (det.open && !caricato) { caricato = true; mostraElenco(); } } }, el('summary', { text: 'Elenco delle copie giornaliere e ripristino' }),
    el('p', { class: 'muted small', text: 'Ripristinare sostituisce l\'archivio con quella copia, ma prima il programma ne fa una di quello attuale: non si perde niente. Il registro delle modifiche non viene toccato.' }), elenco);
  return el('div', { class: 'card' }, el('h2', { text: 'Sicurezza dei dati' }),
    el('p', { class: 'muted small', text: 'Ogni giorno il programma salva una copia dell\'archivio e del registro e la rilegge per essere sicuro che sia uguale. Le copie dei primi 60 giorni restano tutte, poi una a settimana per un anno, poi una al mese. Se l\'archivio si rovina o sparisce, al prossimo avvio il programma lo rimette da solo dall\'ultima copia buona e tiene da parte il file rovinato.' }),
    stato, el('div', { class: 'row' }, adesso, controlla), esito, det);
}

/** Scelta dell'aspetto: vale per questo dispositivo (il telefono può avere uno stile diverso dal computer). */
var STILI_INFO = [
  { k: 'club', nome: 'Gym Art', testo: 'Colori del club: barra blu, riga a quattro colori, carta calda. Lo stile predefinito.', p: { side: '#1B2F6A', bg: '#F3F1EC', r: '5px', rb: '4px', pri: '#1B2F6A' } },
  { k: 'morbido', nome: 'Morbido', testo: 'Angoli grandi, ombre leggere, pulsanti a pillola, blu brillante.', p: { side: '#F5F5F7', bg: '#F5F5F7', r: '10px', rb: '999px', pri: '#0071E3' } },
  { k: 'sobrio', nome: 'Sobrio', testo: 'Denso e nitido, bordi netti, contrasto alto: per elenchi lunghi su un computer.', p: { side: '#FFFFFF', bg: '#F4F5F7', r: '2px', rb: '2px', pri: '#1B2F6A' } }
];
var TEMI_INFO = [['auto', 'Automatico'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']];
function cardAspetto() {
  var box = el('div', { class: 'stili' }), tema = el('div', { class: 'segmenti', role: 'group', 'aria-label': 'Chiaro o scuro' });
  function disegna() {
    clear(box); clear(tema);
    STILI_INFO.forEach(function (x) {
      var an = el('div', { class: 'anteprima-stile', 'aria-hidden': 'true' }, el('i', { class: 'a-side' }), el('div', { class: 'a-main' }, el('i', { class: 'a-card' }), el('i', { class: 'a-btn' })));
      an.style.setProperty('--p-side', x.p.side); an.style.setProperty('--p-bg', x.p.bg); an.style.setProperty('--p-r', x.p.r); an.style.setProperty('--p-rb', x.p.rb); an.style.setProperty('--p-pri', x.p.pri);
      add(box, el('button', { type: 'button', class: 'stile-scelta', 'aria-pressed': Aspetto.stile() === x.k ? 'true' : 'false', onclick: function () { Aspetto.imposta({ stile: x.k }); disegna(); toast('Stile "' + x.nome + '" attivo su questo dispositivo.'); } },
        an, el('b', { text: x.nome }), el('span', { text: x.testo })));
    });
    TEMI_INFO.forEach(function (t) {
      add(tema, el('button', { type: 'button', 'aria-pressed': Aspetto.tema() === t[0] ? 'true' : 'false', text: t[1], onclick: function () { Aspetto.imposta({ tema: t[0] }); disegna(); } }));
    });
  }
  disegna();
  return el('div', { class: 'card' }, el('h2', { text: 'Aspetto' }),
    el('p', { class: 'muted small', text: 'Scegli lo stile grafico e se usare il tema chiaro o scuro. Cambia solo l\'aspetto: i dati e le funzioni sono gli stessi. La scelta vale per questo dispositivo.' }),
    box, el('div', { class: 'row' }, el('span', { class: 'small muted', text: 'Tema:' }), tema));
}
function download(name, text, type) {
  var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
}
function stamp() { return nowIso().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'); }
function vImpostazioni(v) {
  var db = S.db, f = { stagione: db.impostazioni.stagione, preavvisoAbb: String(db.impostazioni.preavvisoAbb), corsi: db.liste.corsi.join('\n'), fasce: db.liste.fasce.join('\n'), messaggioScadenza: db.impostazioni.messaggioScadenza || L.MESSAGGIO,
    preavvisoCert: String(db.impostazioni.preavvisoCert), messaggioCertificato: db.impostazioni.messaggioCertificato || L.MESSAGGIO_CERT, metodi: db.liste.metodi.join('\n'),
    legale: db.impostazioni.legale, ente: db.impostazioni.ente, codice: db.impostazioni.codice, cfAssociazione: db.impostazioni.cfAssociazione,
    tariffario: db.tariffario.map(function (p) { var o = { pacchetto: p.pacchetto, frequenza: p.frequenza, iscrizione: p.iscrizione ? String(p.iscrizione).replace('.', ',') : '' }; L.TIPI.forEach(function (t) { o[t.nome] = typeof p[t.nome] === 'number' ? String(p[t.nome]).replace('.', ',') : ''; }); return o; }) };
  var notes = el('div', { class: 'notes' }), tbody = el('tbody');
  function area(k) { var a = el('textarea', { rows: 7, value: f[k], oninput: function () { f[k] = a.value; touch(); } }); return a; }
  function drawTariff() {
    clear(tbody);
    f.tariffario.forEach(function (p, i) {
      tbody.appendChild(el('tr', null, ['pacchetto', 'frequenza', 'Mensile', 'Trimestrale', 'Annuale', 'iscrizione'].map(function (k) { return el('td', null, input(p, k, 'text', touch, { 'aria-label': k + ' riga ' + (i + 1), inputmode: k === 'pacchetto' || k === 'frequenza' ? null : 'decimal' })); }),
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
  if (!S.remoto) add(v, cardSicurezza());
  add(v, cardAspetto());
  add(v, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Nuova stagione' }), link('Avvia la procedura', 'stagione', 'btn btn-primary')),
    el('p', { class: 'muted small', text: 'Stagione attuale: ' + S.db.impostazioni.stagione + '. Procedura guidata per rinnovare o chiudere le iscrizioni aperte all\'inizio dell\'anno, senza cancellare nulla.' })));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Stagione, corsi e tariffe' }),
    el('div', { class: 'fields' }, field('Stagione sportiva', input(f, 'stagione', 'text', touch), 'Per esempio 2026/2027.'), field('Giorni di preavviso per gli abbonamenti', input(f, 'preavvisoAbb', 'text', touch, { inputmode: 'numeric' }), 'Quanti giorni prima un abbonamento risulta "in scadenza".'),
      field('Giorni di preavviso per i certificati', input(f, 'preavvisoCert', 'text', touch, { inputmode: 'numeric' }), 'Quanti giorni prima un certificato medico risulta "in scadenza".'),
      field('Corsi', area('corsi'), 'Uno per riga.'), field('Fasce orarie', area('fasce'), 'Una per riga, per esempio 17:00-18:30.'), field('Metodi di pagamento', area('metodi'), 'Uno per riga.'),
      field('Promemoria di scadenza per WhatsApp', area('messaggioScadenza'), 'Il programma sostituisce {nome}, {corso}, {tipo} e {scadenza} con i dati dell\'abbonamento.', 'wide'),
      field('Promemoria del certificato per WhatsApp', area('messaggioCertificato'), 'Il programma sostituisce {nome} e {scadenza}. Per un certificato mancante usa un testo fisso.', 'wide')),
    el('h3', { text: 'Dati dell\'associazione' }),
    el('p', { class: 'muted small', text: 'Compaiono nella richiesta di certificato medico e nelle ricevute. Si possono lasciare vuoti.' }),
    el('div', { class: 'fields' }, field('Legale rappresentante', input(f, 'legale', 'text', touch)), field('Ente di affiliazione', input(f, 'ente', 'text', touch)),
      field('Codice di affiliazione', input(f, 'codice', 'text', touch)), field('Codice fiscale dell\'associazione', input(f, 'cfAssociazione', 'text', touch), 'Stampato in fondo alle ricevute.')),
    el('h3', { text: 'Tariffario' }),
    el('p', { class: 'muted small', text: 'Prezzi in euro per tipo di abbonamento. Lascia vuoto un prezzo se quell\'abbonamento non è previsto per la tariffa.' }),
    el('div', { class: 'scroll-x' }, el('table', { class: 'tariff' }, el('thead', null, el('tr', null, ['Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Annuale', 'Iscrizione', ''].map(function (h) { return el('th', { text: h }); }))), tbody)),
    el('div', { class: 'row' }, button('Aggiungi una tariffa', function () { f.tariffario.push({ pacchetto: '', frequenza: '', Mensile: '', Trimestrale: '', Annuale: '', iscrizione: '' }); touch(); drawTariff(); }, 'btn-small')),
    notes, el('div', { class: 'actions' }, button('Salva le impostazioni', salva, 'btn-primary'))));

  /* data on this computer */
  var ultima = el('p', { class: 'small' });
  function drawUltima() { var u = S.db.impostazioni.ultimaCopia; ultima.textContent = C.isIso(u) ? 'Ultima copia di sicurezza scaricata: ' + C.isoToIt(u) + '.' : 'Non hai ancora scaricato una copia di sicurezza.'; }
  drawUltima();
  var c2box = el('div', { class: 'stack' });
  function drawC2() {
    var c = S.copie2, fld = { cartella: c.cartella }, campo = input(fld, 'cartella', 'text', function () {}, { placeholder: 'E:\\Copie Gym Art', spellcheck: 'false' });
    clear(c2box);
    add(c2box, el('h3', { text: 'Seconda copia automatica' }),
      el('p', { class: 'muted small', text: 'A ogni salvataggio il programma aggiorna anche una copia dell\'archivio e del registro in un\'altra cartella, più le copie giornaliere, tutte rilette dopo la scrittura. Meglio una chiavetta, un disco esterno o una cartella che OneDrive o Google Drive sincronizzano: così le copie stanno anche fuori dal computer. Se la cartella non si raggiunge (chiavetta staccata) il programma continua a funzionare e lo segnala.' }),
      el('div', { class: 'toolbar' }, field('Cartella della seconda copia', campo, 'Meglio su una chiavetta o su un disco esterno. Lascia vuoto per non farla.'),
        el('div', { class: 'row' },
          S.sceltaCartella ? button('Scegli…', function () { api('POST', '/api/scegli-cartella').then(function (j) { if (j.cartella) { fld.cartella = j.cartella; campo.value = j.cartella; } }, function (e) { alert(e.message); }); }) : null,
          button('Salva la cartella', function () {
            api('POST', '/api/copie2', { cartella: fld.cartella }).then(function (j) {
              S.copie2 = j.copie2; drawC2();
              toast(!j.copie2.cartella ? 'Seconda copia disattivata.' : j.copie2.errore ? 'Cartella salvata, ma la copia non è riuscita.' : 'Seconda cartella salvata.');
            }, function (e) { alert(e.message); });
          }),
          c.cartella ? button('Copia adesso', function () { api('POST', '/api/copie2/adesso').then(function (j) { S.copie2 = j.copie2; drawC2(); toast('Copia fatta nella seconda cartella.'); }, function (e) { aggiornaCopie2().then(drawC2); alert(e.message); }); }) : null)),
      !c.cartella ? null : c.errore ? note('bad', c.errore) : el('p', { class: 'small', text: c.ultima ? 'Ultima copia nella seconda cartella: ' + quando(c.ultima) + '.' : 'Nessuna copia ancora fatta nella seconda cartella.' }));
  }
  drawC2();
  var restore = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Scegli la copia di sicurezza da ripristinare', onchange: function () { if (restore.files[0]) ripristina(restore.files[0]); restore.value = ''; } });
  add(v, S.remoto ? null : el('div', { class: 'card' }, el('h2', { text: 'Dati su questo computer' }),
    el('p', { text: 'L\'archivio, il registro e le copie automatiche sono in questa cartella:' }), el('div', { class: 'path', text: S.cartella }),
    el('div', { class: 'row' }, button('Apri la cartella', function () { api('POST', '/api/apri-cartella').catch(function (e) { alert(e.message); }); }),
      button('Scarica una copia di sicurezza', function () {
        api('GET', '/api/copia').then(function (j) {
          download('gymart-copia-' + stamp() + '.json', j.testo, 'application/json');
          commit(L.segnaCopia(S.db, today()), j.protetto ? 'Copia scaricata: è cifrata, si apre con la password di oggi.' : 'Copia scaricata: conservala fuori dal computer.').then(drawUltima);
        }, function (e) { alert(e.message); });
      }),
      button('Ripristina da una copia…', function () { restore.click(); }), restore),
    ultima, c2box,
    el('p', { class: 'muted small', text: 'Il programma fa da solo una copia dell\'archivio prima di modificarlo (al massimo una ogni 10 minuti, e sempre prima di un\'importazione, di un ripristino o di un\'eliminazione; conserva le ultime 200) nella sottocartella "copie". Tieni anche una copia fuori dal computer, per esempio su una chiavetta.' })));

  var cp = S.remoto ? null : cardPassword(); if (cp) add(v, cp);
  if (!S.remoto) add(v, cardRete());

  /* import */
  var imp = el('div'), files = el('input', { type: 'file', accept: '.csv,text/csv', multiple: true, 'aria-label': 'Scegli i file CSV scaricati dal foglio Google', onchange: function () { if (files.files.length) leggiFogli(files.files, function () { drawImport(); }); } });
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
  add(v, S.remoto ? null : el('div', { class: 'card' }, el('h2', { text: 'Importa dal foglio Google' }),
    el('ol', { class: 'steps' }, el('li', { text: 'Apri il gestionale su Google Sheets e vai sul foglio ANAGRAFICA.' }), el('li', { text: 'Menu File, Scarica, "Valori separati da virgola (.csv)".' }), el('li', { text: 'Fai lo stesso con i fogli ISCRIZIONI e PAGAMENTI.' }), el('li', { text: 'Scegli qui sotto i file scaricati (anche tutti insieme).' })),
    files,
    el('p', { class: 'muted small', text: 'Prima di scrivere vedi un riepilogo. Un\'allieva già presente non viene sovrascritta: si completano solo i campi vuoti. Dall\'anagrafica arrivano anche i certificati medici; i pagamenti si agganciano alle iscrizioni già importate. Finita l\'importazione cancella i file scaricati: contengono dati personali.' }),
    imp));
  drawImport();

  /* export */
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Esporta per Excel' }),
    el('div', { class: 'row' }, button('Elenco allieve (.csv)', function () { download('allieve-' + stamp() + '.csv', '﻿' + L.csvAllieve(S.db), 'text/csv'); }), button('Elenco iscrizioni (.csv)', function () { download('iscrizioni-' + stamp() + '.csv', '﻿' + L.csvIscrizioni(S.db, today()), 'text/csv'); }),
      button('Elenco pagamenti (.csv)', function () { download('pagamenti-' + stamp() + '.csv', '\uFEFF' + L.csvPagamenti(S.db), 'text/csv'); })),
    el('p', { class: 'muted small', text: 'I file esportati contengono dati personali e non sono cifrati, nemmeno quando l\'archivio ha una password: conservali con attenzione. Versione del programma: ' + S.versione + '.' })));
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
      if (r.completate) righe.push(plurale(r.completate, 'iscrizione già presente completata', 'iscrizioni già presenti completate') + ' con la quota di iscrizione o il totale dovuto del foglio.');
      if (r.mancanti.length) righe.push('Colonne non trovate nel file: ' + r.mancanti.join(', ') + '.');
      parti.push({ kind: r.saltate.length ? 'warn' : 'ok', titolo: 'ISCRIZIONI · ' + x.name, righe: righe.concat(r.saltate.slice(0, 40), r.saltate.length > 40 ? ['… e altre ' + (r.saltate.length - 40) + ' righe saltate.'] : []) });
    });
    fogli.filter(function (x) { return x.tipo === 'pagamenti'; }).forEach(function (x) {
      var r = L.importaPagamenti(db, x.vals, adesso); db = r.db; reg = reg.concat(r.registro);
      var righe = [plurale(r.nuovi, 'pagamento nuovo', 'pagamenti nuovi') + ' per ' + C.fmtMoney(r.totale) + '.', plurale(r.giaPresenti, 'pagamento già presente', 'pagamenti già presenti') + '.'];
      if (r.mancanti.length) righe.push('Colonne non trovate nel file: ' + r.mancanti.join(', ') + '.');
      parti.push({ kind: r.saltati.length ? 'warn' : 'ok', titolo: 'PAGAMENTI · ' + x.name, righe: righe.concat(r.saltati.slice(0, 40), r.saltati.length > 40 ? ['… e altre ' + (r.saltati.length - 40) + ' righe saltate.'] : []) });
    });
    fogli.filter(function (x) { return !x.tipo; }).forEach(function (x) { parti.push({ kind: 'bad', titolo: x.name, righe: ['Non riconosco questo file: deve essere il foglio ANAGRAFICA, ISCRIZIONI o PAGAMENTI scaricato come CSV.'] }); });
    S.imp = { parti: parti, db: db, registro: reg, rev: S.rev };
    poi();
  }, function () { alert('Non riesco a leggere i file scelti.'); });
}
/** Password is switched off in the interface for now. An archive that is already protected can still be opened (lock page) and unprotected here. */
/** Access from phones: switched on from this computer only. The state is read from the program every time the card is drawn. */
function cardRete() {
  var card = el('div', { class: 'card', id: 'rete' }, el('div', { class: 'card-head' }, el('h2', { text: 'Accesso dal telefono' })), el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Controllo lo stato…'));
  function ridisegna(j) {
    var st = j.stato, f = { nuova: '', ripeti: '', attuale: '' }, notes = el('div', { class: 'notes' }), body = [];
    function errore(t) { clear(notes); add(notes, note('bad', t)); }
    function invia(path, corpo, ok) {
      api('POST', path, corpo).then(function (r) { S.rete = r; toast(ok); ridisegna(r); }, function (e) { errore(e.message); });
    }
    function pw(k, auto) { return input(f, k, 'password', function () {}, { autocomplete: auto }); }
    function nuovaOk() { return f.nuova.length < 8 ? (errore('La password deve avere almeno 8 caratteri.'), false) : f.nuova !== f.ripeti ? (errore('Le due password non sono uguali.'), false) : true; }
    add(clear(card), el('div', { class: 'card-head' }, el('h2', { text: 'Accesso dal telefono' }), chip(st.attiva ? (st.inAscolto ? 'Attivo' : 'Non parte') : 'Spento', st.attiva ? (st.inAscolto ? 'ok' : 'bad') : 'mute')));
    add(card, el('p', { class: 'muted', text: 'Permette di aprire il programma da iPhone, iPad o altri computer collegati alla stessa rete (o a Tailscale), senza Claude. I dati restano su questo computer, che deve essere acceso. Da fuori serve la password della segreteria.' }));
    if (!st.attiva) {
      add(card, el('div', { class: 'fields' }, field(st.haPassword ? 'Nuova password (facoltativa: c\'è già quella di prima)' : 'Password della segreteria', pw('nuova', 'new-password'), 'Almeno 8 caratteri. È diversa dalle altre: serve solo per entrare dal telefono.'), field('Ripeti la password', pw('ripeti', 'new-password'))),
        notes, el('div', { class: 'actions' }, button('Attiva l\'accesso dal telefono', function () {
          if (f.nuova || !st.haPassword) { if (!nuovaOk()) return; }
          invia('/api/rete', { attiva: true, nuova: f.nuova, attuale: '' }, 'Accesso dal telefono attivato.');
        }, 'btn-primary')));
    } else {
      if (st.errore) add(card, note('bad', st.errore));
      if (st.inAscolto) {
        add(card, el('h3', { text: 'Indirizzo da aprire sul telefono' }),
          el('div', { class: 'indirizzi' }, st.indirizzi.map(function (a) { return el('div', { class: 'path' }, a); })),
          el('p', { class: 'muted small', text: 'Scrivilo in Safari (con lo stesso Wi-Fi), poi "Condividi" → "Aggiungi a Home". Se un indirizzo non funziona prova l\'altro: il primo è quello numerico del computer.' }));
        if (st.certificato === 'autofirmato') add(card, note('warn', 'Certificato del programma', [
          'Il telefono avviserà che la connessione non è privata finché non si installa il certificato: è normale, è stato creato dal programma stesso.',
          'Su iPhone: apri questo indirizzo in Safari, scarica il certificato, poi Impostazioni → Generali → VPN e gestione dispositivo → installalo; infine Impostazioni → Generali → Info → Attendibilità certificati → attivalo.',
          'Impronta: ' + j.impronta]), el('div', { class: 'actions' }, el('a', { class: 'btn btn-small', href: '/certificato', text: 'Scarica il certificato' })));
        else add(card, el('p', { class: 'muted small', text: 'Certificato fornito da te (per esempio da Tailscale): il telefono lo riconosce senza avvisi.' }));
        add(card, el('p', { class: 'small', text: plurale(st.sessioni, 'dispositivo ha fatto', 'dispositivi hanno fatto') + ' l\'accesso.' }));
      }
      add(card, el('h3', { text: 'Cambia la password' }),
        el('div', { class: 'fields' }, field('Password attuale', pw('attuale', 'current-password')), field('Nuova password', pw('nuova', 'new-password')), field('Ripeti la nuova password', pw('ripeti', 'new-password'))),
        notes, el('div', { class: 'actions' },
          button('Cambia la password', function () { if (!f.attuale) { errore('Scrivi la password attuale.'); return; } if (nuovaOk()) invia('/api/rete', { attiva: true, attuale: f.attuale, nuova: f.nuova }, 'Password cambiata: i telefoni devono rientrare.'); }, 'btn-primary'),
          button('Esci da tutti i dispositivi', function () { invia('/api/rete/esci-tutti', {}, 'Tutti i dispositivi sono usciti.'); }),
          el('span', { class: 'spacer' }),
          button('Spegni l\'accesso dal telefono', function () { if (confirm('Spegnere l\'accesso dal telefono? I telefoni non potranno più aprire il programma.')) invia('/api/rete', { attiva: false }, 'Accesso dal telefono spento.'); }, 'btn-danger')));
    }
    if (j.avvioDisponibile) {
      var cb = el('input', { type: 'checkbox', checked: j.avvioWindows, onchange: function () { api('POST', '/api/rete/avvio', { attiva: cb.checked }).then(function (r) { toast(cb.checked ? 'Il programma partirà con Windows.' : 'Avvio con Windows tolto.'); }, function (e) { cb.checked = !cb.checked; alert(e.message); }); } });
      add(card, el('label', { class: 'check' }, cb, el('span', { text: 'Avvia il programma quando si accende il computer (senza aprire la finestra): serve perché i telefoni lo trovino sempre pronto.' })));
    }
    add(card, el('p', { class: 'muted small', text: 'Promemoria: il computer deve restare acceso e non andare in stop (Impostazioni di Windows → Alimentazione). Alla prima attivazione Windows può chiedere di consentire il programma nel firewall: scegli "Reti private".' }));
  }
  api('GET', '/api/rete').then(function (j) { S.rete = j; ridisegna(j); }, function (e) { add(clear(card), el('h2', { text: 'Accesso dal telefono' }), note('bad', e.message)); });
  return card;
}
function cardPassword() {
  if (!S.protetto) return null;
  var f = { attuale: '' }, notes = el('div', { class: 'notes' });
  function errore(t) { clear(notes); add(notes, note('bad', t)); }
  return el('div', { class: 'card', id: 'protezione' }, el('div', { class: 'card-head' }, el('h2', { text: 'Protezione con password' }), chip('Attiva', 'ok')),
    el('p', { text: 'Questo archivio è protetto da una password (impostata con la versione 1.2). La protezione non si può più attivare da qui; si può togliere.' }),
    el('div', { class: 'fields' }, field('Password attuale', input(f, 'attuale', 'password', function () {}, { autocomplete: 'current-password' }))),
    notes, el('div', { class: 'actions' }, button('Togli la protezione', function () {
      if (S.dirty) { alert('Salva (o annulla) prima le modifiche alle impostazioni qui sopra.'); return; }
      if (!f.attuale) { errore('Scrivi la password attuale.'); return; }
      if (!confirm('Togliere la protezione? I dati torneranno leggibili da chiunque apra i file su questo computer.')) return;
      api('POST', '/api/password', { attuale: f.attuale, nuova: '' }).then(function (j) { S.protetto = j.protetto; toast(j.avviso || 'Protezione tolta.'); go('impostazioni'); },
        function (e) { errore(e.status === 401 ? 'La password attuale non è giusta.' : e.message); });
    }, 'btn-danger')));
}
function ripristina(file) { file.text().then(function (t) { leggiCopia(t, '', file.name); }); }
/** Reads a copy through the program (it may be encrypted), shows what it holds and, on confirmation, puts it in place of the archive. */
function leggiCopia(testo, password, nome) {
  var file = { name: nome };
  api('POST', '/api/decifra', { testo: testo, password: password }).then(function (j) {
    var db = j.db, bad = L.validaArchivio(db);
    if (bad) { alert(bad); return; }
    if (!confirm('Sostituire l\'archivio attuale (' + plurale(S.db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(S.db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ') con la copia "' + file.name + '" (' + plurale(db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ')?\n\nPrima della sostituzione il programma conserva una copia dell\'archivio attuale.')) return;
    commit({ db: L.completa(db, today()), registro: [{ allieva: '', operazione: 'Ripristino da copia', campo: '', prima: '', dopo: '', nota: file.name }] }, 'Archivio ripristinato.', true).then(function (ok) { if (ok) go('inizio'); });
  }, function (e) {
    if (e.servePassword || (e.status === 401 && password)) {
      var pw = prompt(e.servePassword ? 'Questa copia è protetta da una password diversa da quella in uso.\nScrivi la password che c\'era quando la copia è stata fatta:' : 'Password errata. Riprova:');
      if (pw) leggiCopia(testo, pw, nome);
      return;
    }
    alert(e.message);
  });
}

/* ---------- Guida ---------- */
function vGuida(v) {
  function sec(title, items, open) { return el('details', { open: open || null }, el('summary', { text: title }), el('div', { class: 'guide' }, items.map(function (t) { return el('p', { text: t }); }))); }
  add(v, el('h1', { text: 'Guida' }));
  add(v, sec('Cosa fa questo programma', [
    'Tiene l\'anagrafica delle allieve, le iscrizioni ai corsi con abbonamenti e scadenze, i certificati medici e i pagamenti con le ricevute. Funziona senza internet: i dati stanno solo su questo computer.'], true));
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
  add(v, sec('Nuova stagione', [
    'A settembre apri Impostazioni, "Nuova stagione" (o il richiamo nella pagina Inizio). Scegli la nuova stagione e la data da cui partono i nuovi periodi, poi per ogni iscrizione aperta: "Rinnova" (stessi dati dalla nuova data), "Chiudi" (non torna) o "Lascia com\'è".',
    'Il programma propone una scelta ma non decide da solo: controlla chi non torna. Nulla si cancella: i periodi vecchi restano nello storico con i loro pagamenti e con quanto resta da incassare. Prima di scrivere fa una copia dell\'archivio e ogni cambio va nel Registro.',
    'Puoi mantenere le quote concordate a mano oppure ripartire dal tariffario, e addebitare di nuovo la quota di iscrizione dove il tariffario la prevede.']));
  add(v, sec('Promemoria in blocco', [
    'Da "Scadenze" → "Promemoria in blocco": un elenco solo di chi ha un abbonamento scaduto o in scadenza e di chi ha il certificato medico scaduto, in scadenza o mancante. Si filtra per tipo, stato e corso.',
    '"WhatsApp" apre la chat con il messaggio già scritto: lo invii tu, uno alla volta. Il programma segna "contattata" quando apri la chat, ma non può sapere se hai davvero inviato: se non l\'hai fatto premi "Annulla". Con "Fatto" segni chi hai chiamato al telefono.',
    'Chi hai contattato esce dall\'elenco "Da contattare"; se dopo 7 giorni è ancora da sollecitare ricompare come "Da ricontattare". Chi non ha un telefono valido è segnalato: "Stampa l\'elenco" ti dà un foglio con i numeri e una casella da spuntare.']));
  add(v, sec('Certificati medici', [
    'Nella scheda dell\'allieva scrivi il tipo, la data di rilascio e la scadenza: la scadenza viene proposta a un anno dal rilascio, e si cambia se sul certificato ne è stampata un\'altra.',
    'Un certificato per attività ludico-motoria non vale per l\'attività sportiva: resta segnalato finché non viene sostituito.',
    'La pagina "Scadenze" elenca i certificati scaduti, in scadenza e mancanti delle allieve che hanno un\'iscrizione aperta.']));
  add(v, sec('Pagamenti e ricevute', [
    'Ogni iscrizione ha un totale dovuto: la quota del periodo (dal tariffario, o quella concordata) più l\'eventuale quota di iscrizione e tesseramento, che si paga una volta sola.',
    'I pagamenti si registrano dalla scheda dell\'iscrizione, sempre con importo, metodo e data. Ogni pagamento ha la sua ricevuta in PDF, numerata per iscrizione; un numero non viene mai riusato.',
    'La pagina "Pagamenti" mostra gli incassi di un periodo, divisi per metodo, e l\'elenco di chi deve ancora pagare.',
    'Un bonifico nuovo resta "da verificare" finché non lo confermi con "Segna verificato", dopo aver controllato l\'estratto conto: lo trovi nella scheda dell\'iscrizione e in cima alla pagina Pagamenti. Contanti e POS non hanno bisogno di verifica. Il programma non verifica mai nulla da solo.',
    'La ricevuta riporta i dati che trova nella scheda (genitore, codici fiscali) e il codice fiscale dell\'associazione scritto in Impostazioni. Per gli obblighi fiscali dell\'associazione chiedi conferma a chi segue la contabilità.']));
  add(v, sec('Moduli da stampare', [
    'Dalla scheda dell\'allieva scarichi il modulo di iscrizione e la richiesta di certificato medico in PDF, con i suoi dati già scritti. Dalla pagina "Allieve" scarichi il modulo in bianco.']));
  add(v, sec('Accesso dal telefono', [
    'In Impostazioni, "Accesso dal telefono", si sceglie una password e si attiva: il programma si apre allora da iPhone, iPad o altri computer collegati alla stessa rete, senza Claude. I dati restano su questo computer, che deve restare acceso.',
    'Da telefono si lavora come qui (allieve, iscrizioni, pagamenti, scadenze, analisi); restano solo sul computer importazione, ripristino, copie di sicurezza e impostazioni di rete.',
    'I passi completi, il certificato e Tailscale per l\'accesso da fuori sede sono nel file GUIDA_TELEFONO.txt accanto al programma.']));
  add(v, sec('Sicurezza dei dati e copie', [
    'I dati stanno in un solo file (archivio.json) e le modifiche nel registro (registro.jsonl). Il programma li difende su più livelli: ogni salvataggio viene riletto dal disco; prima di una modifica si fa una copia (al massimo ogni 10 minuti); ogni giorno si salva una copia di archivio e registro, controllata con un\'impronta digitale; e se hai impostato la seconda cartella le stesse copie finiscono anche lì.',
    'Se l\'archivio si rovina o sparisce, all\'avvio il programma lo rimette da solo dall\'ultima copia buona (anche dalla seconda cartella) e tiene da parte il file rovinato. Nella pagina Inizio compare un avviso con la copia usata: controlla gli ultimi inserimenti.',
    'Per sicurezza il programma non salva un archivio che avrebbe perso la maggior parte dei dati, a meno che tu stia usando una funzione che lo prevede (elimina, importa, ripristina), e che prima fa una copia.',
    'La regola dei professionisti: almeno tre copie, su due supporti diversi, una fuori sede. Qui: l\'archivio, le copie sul computer, e la seconda cartella. Metti la seconda cartella su una chiavetta o su una cartella sincronizzata (OneDrive, Google Drive) e, ogni tanto, scarica una copia e conservala altrove.',
    'Non cancellare il file Excel o il foglio Google di prima: tienilo come archivio di sola lettura. Se un giorno servisse, i dati originali sono ancora lì.',
    'In Impostazioni → Sicurezza dei dati puoi fare una copia subito, controllare tutte le copie e ripristinarne una. Nessun sistema è sicuro al 100%: la sicurezza viene dall\'avere le copie in posti diversi e dal controllarle ogni tanto.']));
  add(v, sec('Seconda copia', [
    'In Impostazioni puoi indicare una seconda cartella, per esempio su una chiavetta: il programma ci tiene una copia aggiornata, un file al giorno.',
    'I file esportati per Excel e i PDF contengono dati personali: conservali con attenzione.']));
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
function esci() {
  fetch('/logout', { method: 'POST' }).then(function () { location.href = '/login'; }, function () { location.href = '/login'; });
}
function applicaDettaglio() {
  document.body.classList.toggle('det', S.det);
  var b = $('det'); if (b) b.setAttribute('aria-checked', S.det ? 'true' : 'false');
}
try { S.det = localStorage.getItem('gymart-dettaglio') === '1'; } catch (e) {}
applicaDettaglio();
var larghezzaPrima = larghezzaGrafico();
window.addEventListener('resize', debounce(function () { var w = larghezzaGrafico(); if (Math.abs(w - larghezzaPrima) > 60 && S.db && !S.dirty && !S.busy) { larghezzaPrima = w; render(); } }, 250));
$('esci').addEventListener('click', esci);
$('det').addEventListener('click', function () {
  S.det = !S.det; applicaDettaglio();
  try { localStorage.setItem('gymart-dettaglio', S.det ? '1' : '0'); } catch (e) {}
  if (S.db && !S.dirty) render();
});
alive();
setInterval(alive, 10000);
render();
load();
