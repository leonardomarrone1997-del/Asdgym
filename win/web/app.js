/* Gym Art Segreteria per Windows - interfaccia. Text is always inserted as text, never as HTML. */
var C = window.Core, L = window.Logic;
var TOKEN = document.querySelector('meta[name="gymart-token"]').content;
var CID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var TABS = [['inizio', 'Home'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['corsi', 'Corsi'], ['pagamenti', 'Pagamenti'], ['analisi', 'Grafici'], ['scadenze', 'Scadenze'], ['calendario', 'Calendario'], ['certificati', 'Certificati'], ['registro', 'Registro'], ['impostazioni', 'Impostazioni'], ['guida', 'Manuale'], ['assistente', 'Assistente'], ['aggiornamenti', 'Aggiornamenti']];
var TAB_OF = { allieva: 'allieve', iscrizione: 'iscrizioni', promemoria: 'scadenze', assistente: 'altro', stagione: 'altro', corsi: 'altro', registro: 'altro', impostazioni: 'altro', guida: 'altro', aggiornamenti: 'altro' };
var S = {
  storia: [], tornando: false, // the pages visited in this window, for «Indietro»
  db: null, rev: 0, salvato: '', cartella: '', versione: '', fatal: '', busy: false, dirty: false, revert: false, nextId: 1, missed: 0,
  fa: { q: '', filtro: 'tutte', tutte: false, sort: { col: 0, desc: false } }, fi: { q: '', stato: 'correnti', corso: '', tutte: false, sort: { col: 0, desc: false } },
  fc: { giorno: '', tutte: false, sort: { col: 0, desc: false } }, fp: { dal: '', al: '', metodo: '', q: '', tutte: false, sort: { col: 0, desc: true }, sortD: { col: 0, desc: false } },
  det: false, an: { periodo: 'stagione' }, sc: { tab: '', tutte: false }, fcz: { filtro: '', q: '', sort: { col: 0, desc: false } }, scanner: false, logo: null, ultimoHash: null, remoto: false, rete: null,
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
/** The notice just shown gets a button (testo: "Annulla" for something undone with one click, "Ricevuta" after a payment): it stays a little longer. */
function toastAzione(testo, fn) {
  var t = $('toast');
  t.appendChild(document.createTextNode(' '));
  t.appendChild(el('button', { type: 'button', class: 'toast-annulla', text: testo, onclick: function () { clearTimeout(toastTimer); t.className = 'toast'; fn(); } }));
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 8000);
}
function toastAnnulla(fn) { toastAzione('Annulla', fn); }
function chip(text, kind) { return el('span', { class: 'chip chip-' + (kind || 'mute'), text: text }); }
function note(kind, title, items) {
  var n = el('div', { class: 'note' + (kind ? ' note-' + kind : ''), tabindex: kind === 'bad' ? '-1' : null }, title ? el('b', { text: title }) : null); // the box of the errors can take the focus (portaAlErrore)
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
  i.setAttribute('data-campo', key); // which field it is: the errors of the forms mark it (segnaCampi)
  i.addEventListener('input', function () { obj[key] = i.value; onchange(); });
  return i;
}
/** Which field an error message is about: [pattern, key of the field] (the first that fits wins). A message that is not listed marks no field. */
var ERR_CAMPO = [[/^Manca cognome e nome/, 'name'], [/^Data di nascita/, 'nascita'], [/^(Questo )?[Cc]odice fiscale/, 'cf'], [/^Secondo telefono/, 'tel2'], [/^Telefono/, 'tel'], [/^Email/, 'email'], [/^CAP/, 'cap'],
  [/^Data del modulo/, 'dataModulo'], [/^Scadenza del certificato/, 'certScadenza'], [/^Data di inizio/, 'inizio'], [/^Quota/, 'quota'], [/^Iscrizione e tesseramento/, 'quotaIscrizione'], [/importo/i, 'importo'], [/^Data del pagamento/, 'data']];
/** After every check of a form: the fields the errors are about get aria-invalid and aria-describedby (the message), the others are cleaned. */
function segnaCampi(radice, notes, errori) {
  [].forEach.call(radice.querySelectorAll('[data-campo]'), function (c) { c.removeAttribute('aria-invalid'); c.removeAttribute('aria-describedby'); });
  var voci = notes.querySelectorAll('.note-bad li');
  errori.forEach(function (e, i) {
    for (var k = 0; k < ERR_CAMPO.length; k++) {
      if (!ERR_CAMPO[k][0].test(e)) continue;
      var c = radice.querySelector('[data-campo="' + ERR_CAMPO[k][1] + '"]');
      if (c) {
        c.setAttribute('aria-invalid', 'true');
        if (voci[i]) { voci[i].id = voci[i].id || 'err' + (S.nextId++); c.setAttribute('aria-describedby', ((c.getAttribute('aria-describedby') || '') + ' ' + voci[i].id).trim()); }
      }
      break;
    }
  });
}
/** The person tried to save and there are errors: the first field to correct takes the focus (a screen reader reads its name, "invalid" and the message), or else the box of the errors. */
function portaAlErrore(radice, notes) {
  var x = radice.querySelector('[aria-invalid="true"]') || notes.querySelector('.note-bad');
  if (x && x.focus) x.focus();
}
/** Optional data: closed, so that a form shows only what is essential. Open with «Mostra tutto» (Impostazioni › Preferenze; or the switch gymart-aperto, used by the robots), and by itself when something in it must be corrected. */
function tuttoAperto() { try { return S.det || localStorage.getItem('gymart-aperto') === '1'; } catch (e) { return S.det; } }
function altri(titolo, figli, aperto) {
  return el('details', { class: 'altri', open: aperto || tuttoAperto() ? true : null }, el('summary', { text: titolo }), el('div', { class: 'altri-corpo' }, figli));
}
/** Shown only with «Mostra tutto». */
function soloDet(n) { n.classList.add('solo-det'); return n; }
/** A settings section: closed, with a title and one line that says what is in it. */
var SEZ_NOME = { 'Preferenze': 'preferenze', 'Aiuto e visita guidata': 'aiuto', 'Messaggi per i genitori': 'messaggi', 'Sicurezza dei dati': 'sicurezza', 'Aspetto': 'aspetto', 'Nuova stagione': 'stagione', 'Stagione, corsi e tariffe': 'tariffe', 'Dati su questo computer': 'dati', 'Accesso dal telefono': 'telefono', 'Importa dal file Excel o dal foglio Google': 'importa', 'Esporta per Excel': 'esporta', 'Assistenza': 'assistenza' };
function sezione(titolo, descr, corpo) {
  return el('details', { class: 'gruppo', 'data-sez': SEZ_NOME[titolo] || null, open: tuttoAperto() ? true : null }, el('summary', null, el('b', { text: titolo }), descr ? el('span', { class: 'muted small', text: descr }) : null), el('div', { class: 'gruppo-corpo' }, corpo));
}
var SEZIONI_DESCR = { 'Preferenze': 'Pagina all\'apertura, testo, elenchi, valori proposti nei moduli, orari dei corsi', 'Aiuto e visita guidata': 'Ricomincia il tutorial, apri il manuale', 'Sicurezza dei dati': 'Copia di oggi, copie giornaliere e ripristino', 'Aspetto': 'Stile, chiaro o scuro, movimento, suoni', 'Nuova stagione': 'A settembre: rinnovare o chiudere le iscrizioni',
  'Messaggi per i genitori': 'I testi di WhatsApp per avvisare di una scadenza', 'Stagione, corsi e tariffe': 'Corsi, fasce orarie, tariffario, dati dell\'associazione', 'Dati su questo computer': 'Dove sono i dati, copia di sicurezza, seconda copia', 'Accesso dal telefono': 'Usare il programma da iPhone o da un altro computer',
  'Importa dal file Excel o dal foglio Google': 'Portare qui i dati di prima', 'Esporta per Excel': 'Un file Excel, o elenchi in CSV', 'Assistenza': 'Se qualcosa non funziona: controlla il computer, il file da mandare a chi cura il programma' };
/** label = the name for a screen reader when several buttons say the same thing ("Avvisa" in every row): it begins with the visible text and says who or what. */
function button(text, onclick, cls, label) { return el('button', { type: 'button', class: 'btn' + (cls ? ' ' + cls : ''), text: text, onclick: onclick, 'aria-label': label || null }); }
function link(text, hash, cls, label) { return el('a', { href: '#' + hash, class: cls || null, text: text, 'aria-label': label || null }); }

/* ---------- finestre del programma, al posto di quelle del browser (confirm, alert, prompt) ----------
   Quelle del browser hanno in cima «127.0.0.1:… dice», pulsanti «OK» e «Annulla» che non dicono che cosa fanno, e non seguono né lo stile né il tema scuro.
   Dentro una finestra già aperta la domanda compare in fondo a quella: mai due finestre una sopra l'altra. */
/** A text with line breaks: paragraphs, and the lines that begin with "- " as a list. */
function testoFinestra(testo) {
  var out = el('div', { class: 'conferma-testo' }), lista = null;
  String(testo || '').split('\n').forEach(function (r) {
    if (/^- /.test(r)) { if (!lista) add(out, lista = el('ul')); add(lista, el('li', { text: r.slice(2) })); return; }
    lista = null;
    if (r.trim()) add(out, el('p', { text: r }));
  });
  return out;
}
/** A question with two answers. o: { titolo, si: text of the button that goes ahead, no: of the one that does not, pericolo: true when it deletes something (red button, the focus on "no") }.
 *  Resolves true or false; Esc, a click outside and closing the window are "no". */
function conferma(testo, o) {
  o = o || {};
  return new Promise(function (fine) {
    var fatto = false, d = null, box = null, aperta = document.querySelector('dialog.modale[open]');
    function scegli(x) { if (fatto) return; fatto = true; if (box) box.remove(); if (d && d.open) d.close(); fine(x); }
    var si = button(o.si || 'Sì', function () { scegli(true); }, o.pericolo ? 'btn-danger' : 'btn-primary'), no = button(o.no || 'Annulla', function () { scegli(false); });
    si.setAttribute('data-scelta', 'si'); no.setAttribute('data-scelta', 'no');
    var corpo = [testoFinestra(testo), el('div', { class: 'actions' }, si, no)];
    if (aperta) {
      box = el('div', { class: 'conferma-box', role: 'group', 'aria-label': o.titolo || 'Conferma' }, o.titolo ? el('b', { text: o.titolo }) : null, corpo);
      aperta.appendChild(box); aperta.addEventListener('close', function () { scegli(false); }, { once: true });
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
    } else {
      d = modale(o.titolo || 'Conferma', el('div', { class: 'stack' }, corpo), function () { scegli(false); }, 'conferma');
    }
    (o.pericolo ? no : si).focus();
  });
}
/** A message that needs only to be read (an error, a reason why something cannot be done). Resolves when it is closed. */
function avviso(testo, titolo) {
  return new Promise(function (fine) {
    var aperta = document.querySelector('dialog.modale[open]'), ok;
    if (aperta) {
      var box = el('div', { class: 'conferma-box avviso-box', role: 'alert' }, testoFinestra(testo), el('div', { class: 'actions' }, ok = button('Ho capito', function () { box.remove(); fine(); }, 'btn-primary')));
      aperta.appendChild(box); ok.focus(); return;
    }
    var d = modale(titolo || 'Attenzione', el('div', { class: 'stack' }, testoFinestra(testo), el('div', { class: 'actions' }, ok = button('Ho capito', function () { d.close(); }, 'btn-primary'))), function () { fine(); }, 'avviso');
    ok.focus();
  });
}
/** A text to copy by hand (when the clipboard refuses): selected, with Ctrl+C written under it. */
function mostraDaCopiare(testo, titolo) {
  var ta = el('textarea', { rows: 6, readonly: true, 'aria-label': titolo || 'Testo da copiare' }); ta.value = testo;
  var d = modale(titolo || 'Copia il testo', el('div', { class: 'stack' }, el('p', { class: 'muted small', text: 'Il testo è già selezionato: premi Ctrl+C per copiarlo (sul telefono: tieni premuto, poi «Copia»).' }), ta,
    el('div', { class: 'actions' }, button('Chiudi', function () { d.close(); }, 'btn-primary'))));
  ta.focus(); ta.select();
}
/** A password asked in a window of the program. Resolves the text, or null when the person gives up. */
function chiediPassword(testo, titolo) {
  return new Promise(function (fine) {
    var f = { pw: '' }, fatto = false, campo = input(f, 'pw', 'password', function () {}, { autocomplete: 'current-password' });
    function chiudi(x) { if (fatto) return; fatto = true; if (d.open) d.close(); fine(x); }
    var d = modale(titolo || 'Password', el('form', { class: 'stack', onsubmit: function (e) { e.preventDefault(); if (f.pw) chiudi(f.pw); } }, testoFinestra(testo), field('Password', campo),
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn btn-primary', text: 'Apri la copia' }), button('Annulla', function () { chiudi(null); }))), function () { chiudi(null); });
    campo.focus();
  });
}

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
      if (!c.key) return c.h ? el('th', { class: c.cls || null, text: c.h }) : el('th', { class: c.cls || null }, el('span', { class: 'sr-only', text: 'Azioni' })); // a column of buttons has no title on screen: a screen reader still says what it is
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
/** The head of every printed page: the logo and the name of the club. */
function testaStampa() { return el('div', { class: 'print-testa' }, window.GymLogo ? el('span', { class: 'print-logo' }, GymLogo.crea({})) : null, el('div', { class: 'print-club', text: 'A.S.D. Gym Art Avezzano' })); }
function stampa(titolo, sottotitolo, cols, rows) {
  var p = clear($('print'));
  add(p, testaStampa(), el('h1', { text: titolo }), el('p', { class: 'print-sub', text: sottotitolo }),
    el('table', null, el('thead', null, el('tr', null, cols.map(function (c) { return c.h ? el('th', { class: c.cls || null, text: c.h }) : el('th', { class: c.cls || null }, el('span', { class: 'sr-only', text: 'Azioni' })); }))),
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
var CERT_KIND = { 'VALIDO': 'ok', 'IN SCADENZA': 'warn', 'SCADUTO': 'bad', 'MANCANTE': 'mute', 'IN ATTESA': 'info' };
var CERT_ORDINE = { 'SCADUTO': 0, 'MANCANTE': 1, 'IN ATTESA': 2, 'IN SCADENZA': 3, 'VALIDO': 4 };
/** Per ordinare per stato: prima chi ha un problema, poi chi aspetta, poi chi è a posto; a parità, per giorni. */
function chiaveCert(s) { return CERT_ORDINE[s.stato] * 100000 + (s.giorni || 0); }
/** Chip for a certificate status; a type that does not cover sport is always marked. */
function chipCert(s) {
  var testo = s.stato === 'MANCANTE' ? 'Manca' : s.stato === 'VALIDO' ? 'Valido' : s.stato === 'SCADUTO' ? 'Scaduto' : s.stato === 'IN ATTESA' ? 'In attesa · entro ' + C.isoToIt(s.consegna).slice(0, 5) : 'In scadenza';
  var c = chip(testo + (s.ludico ? ' · ludico-motoria' : ''), s.ludico && s.stato === 'VALIDO' ? 'warn' : CERT_KIND[s.stato]);
  if (s.stato === 'IN ATTESA') c.title = 'Da consegnare entro il ' + C.isoToIt(s.consegna) + ' (' + giorniTesto(s.giorni) + ')';
  else if (s.stato === 'MANCANTE' && s.consegna) c.title = 'Era da consegnare entro il ' + C.isoToIt(s.consegna);
  return c;
}
var CERT_TIPO_NOME = { 'Agonistico': 'Agonistico', 'Non Agonistico': 'Non agonistico', 'Ludico-motoria': 'Ludico-motoria' };
var CERT_TIPO_KIND = { 'Agonistico': 'agon', 'Non Agonistico': 'mute', 'Ludico-motoria': 'warn' };
/** Il tipo del certificato in un riquadro: si vede subito se è agonistico o no (nessun riquadro se il tipo non c'è). */
function chipTipoCert(a) { var t = a && a.certTipo; return t ? el('span', { class: 'chip chip-' + (CERT_TIPO_KIND[t] || 'mute'), title: 'Tipo di certificato medico', text: CERT_TIPO_NOME[t] || t }) : null; }
var CONTO_KIND = { 'SALDATO': 'ok', 'PARZIALE': 'warn', 'DA PAGARE': 'bad', 'SENZA QUOTA': 'mute' };
function chipConto(c) { return chip(c.stato === 'SENZA QUOTA' ? 'Senza quota' : c.stato === 'SALDATO' ? 'Saldato' : c.stato === 'PARZIALE' ? 'Pagato in parte' : 'Da pagare', CONTO_KIND[c.stato]); }
function soldi(n) { return n === null || n === undefined ? '' : C.fmtMoney(n); }

function today() { return C.todayIso(); }
function piuGiorni(iso, n) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10); }
function nowIso() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return today() + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }
function quando(iso) { var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso || ''); return m ? C.isoToIt(m[1]) + ' ' + m[2] : ''; }
function eta(a) { return C.isIso(a.nascita) ? C.ageOn(a.nascita, today()) + ' anni' : ''; }
function giorniTesto(g) { return g === 0 ? 'oggi' : g === 1 ? 'domani' : g === -1 ? 'da ieri' : g < 0 ? 'da ' + (-g) + ' giorni' : 'tra ' + g + ' giorni'; }
var STATO_KIND = { 'ATTIVO': 'ok', 'IN SCADENZA': 'warn', 'SCADUTO': 'bad', 'DA COMPLETARE': 'warn', 'STORICO': 'mute', 'ANNULLATO': 'mute' };
var STATO_NOME = { 'ATTIVO': 'Attiva', 'IN SCADENZA': 'In scadenza', 'SCADUTO': 'Scaduta', 'DA COMPLETARE': 'Da completare', 'STORICO': 'Chiusa', 'ANNULLATO': 'Annullata' };
function chipStato(st) { return chip(STATO_NOME[st] || st, STATO_KIND[st]); }
/** The certificate in one short line, for the lists: its type when all is well, what is wrong when something is (1.25.0: one piece of information, not two labels). */
function certBreve(a, s) {
  var tipo = CERT_TIPO_NOME[a.certTipo] || a.certTipo || 'Certificato', c;
  if (s.stato === 'MANCANTE') c = chip('Manca', 'warn');
  else if (s.stato === 'IN ATTESA') c = chip('Da consegnare entro il ' + C.isoToIt(s.consegna).slice(0, 5), 'info');
  else if (s.stato === 'SCADUTO') c = chip(tipo + ' · scaduto', 'bad');
  else if (s.stato === 'IN SCADENZA') c = chip(tipo + ' · scade il ' + C.isoToIt(s.scadenza).slice(0, 5), 'warn');
  else c = chip(tipo + (s.ludico ? ' · ludico-motoria' : ''), s.ludico ? 'warn' : a.certTipo === 'Agonistico' ? 'agon' : 'ok');
  if (s.scadenza && s.stato !== 'IN SCADENZA') c.title = 'Scade il ' + C.isoToIt(s.scadenza);
  return c;
}

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
  if (window.GymLogo) GymLogo.salvando(S.busy); // the logo turns while the data are written
  if (S.busy) { c.textContent = 'Salvataggio…'; return; }
  c.textContent = S.bloccato ? 'Archivio protetto' : S.salvato ? 'Salvato il ' + quando(S.salvato) : 'Archivio nuovo';
}
function load() {
  return api('GET', '/api/stato').then(function (j) {
    S.cartella = j.cartella; S.versione = j.versione;
    S.bloccato = j.bloccato === true;
    if (S.bloccato) { S.db = null; S.fatal = ''; return; }
    S.rev = j.rev; S.salvato = j.salvato; S.protetto = j.protetto === true; S.sceltaCartella = j.sceltaCartella === true; S.remoto = j.remoto === true; S.scanner = j.scanner === true; S.logo = j.logo || null; Aspetto.applicaLogo(S.logo ? '/api/logo?t=' + encodeURIComponent(TOKEN) + '&v=' + S.logo.v : ''); document.body.classList.toggle('remoto', S.remoto);
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
    if (window.GymLogo) GymLogo.salvato();
    toast(j.avviso || okMsg || 'Salvato.');
    setTimeout(aggiornaSicurezza, 1200); // the snapshot of the day and the copy to the second folder run around the save
    return true;
  }, function (e) {
    S.busy = false; setConn();
    if (e.status === 409) { toast(e.message); S.dirty = false; return load().then(function () { return false; }); }
    avviso('Non salvato.\n\n' + e.message);
    return false;
  });
}
function attempt(fn) { try { return fn(); } catch (e) { avviso(e.message); return null; } }
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
  if (S.dirty) { // the page stays where it is while the question is asked; "Esci senza salvare" goes on
    var dove = location.hash; S.revert = true; location.hash = lastHash;
    conferma('Hai cambiato qualcosa in questa pagina e non l\'hai salvato. Se esci adesso, le modifiche si perdono.', { titolo: 'Uscire senza salvare?', si: 'Esci senza salvare', no: 'Resta qui', pericolo: true })
      .then(function (ok) { if (ok) { S.dirty = false; location.hash = dove; } });
    return;
  }
  [].forEach.call(document.querySelectorAll('dialog.modale[open]'), function (d) { d.close(); }); // a window belongs to the page it was opened on: another page closes it
  if (!S.tornando && lastHash && lastHash !== location.hash) { S.storia.push(lastHash); if (S.storia.length > 60) S.storia.shift(); }
  S.tornando = false;
  S.dirty = false; lastHash = location.hash; render();
});
window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
function touch() { S.dirty = true; }

/* Icons: Lucide (ISC license, see vendor/LICENZE.txt). */
var ICONE = {
  inizio: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  allieve: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  iscrizioni: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  corsi: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  pagamenti: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  analisi: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  scadenze: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  registro: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  impostazioni: '<path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/>',
  assistente: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>',
  spegni: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  guida: '<circle cx="12" cy="12" r="10"/><path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"/><path d="M12 17h.01"/>',
  altro: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  ok: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  attenzione: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  promemoria: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  stagione: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  cerca: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  su: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  giu: '<path d="m7 7 10 10"/><path d="M17 7v10H7"/>',
  calendario: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  compleanno: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/><path d="M7 4h.01"/><path d="M12 4h.01"/><path d="M17 4h.01"/>',
  euro: '<path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  ricevuta: '<path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>',
  allieva: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  chiudi: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sinistra: '<path d="m15 18-6-6 6-6"/>',
  destra: '<path d="m9 18 6-6-6-6"/>',
  certificati: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M9 15l2 2 4-4"/>',
  certificato: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  nota: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>'
};
var ICONA_TESSERA = { ok: 'ok', warn: 'attenzione', bad: 'attenzione', mute: 'info' };
function icona(k) { var n = document.createElementNS(SVGNS, 'svg'); n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('class', 'ico'); n.setAttribute('aria-hidden', 'true'); n.innerHTML = ICONE[k]; return n; }
/** On a phone the sections are at the bottom of the screen, like an app; the less used ones are behind "Altro". */
function disegnaBarra(cur, vista) {
  var principali = [['inizio', 'Home'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['pagamenti', 'Incassi']], altri = TABS.filter(function (t) { return !principali.some(function (p) { return p[0] === t[0]; }); });
  altri.splice(altri.findIndex(function (t) { return t[0] === 'scadenze'; }) + 1, 0, ['promemoria', 'Promemoria']);
  altri.splice(altri.findIndex(function (t) { return t[0] === 'impostazioni'; }) + 1, 0, ['stagione', 'Nuova stagione']);
  var bar = clear($('bottom')), sheet = clear($('sheet')), inAltri = cur === 'altro' || altri.some(function (t) { return t[0] === cur || t[0] === vista; });
  vista = vista || cur;
  function chiudi() { sheet.hidden = true; $('bottom').querySelector('.altro').setAttribute('aria-expanded', 'false'); }
  principali.forEach(function (t) { bar.appendChild(el('a', { href: '#' + t[0], 'aria-current': t[0] === cur ? 'page' : null, onclick: chiudi }, icona(t[0]), el('span', { text: t[1] }))); });
  bar.appendChild(el('button', { type: 'button', class: 'altro', 'aria-expanded': 'false', 'aria-current': inAltri ? 'page' : null, onclick: function () { sheet.hidden = !sheet.hidden; this.setAttribute('aria-expanded', String(!sheet.hidden)); } }, icona('altro'), el('span', { text: 'Altro' })));
  add(sheet, el('div', { class: 'sheet-in' }, altri.map(function (t) { return el('a', { href: '#' + t[0], 'aria-current': t[0] === vista ? 'page' : null, text: t[1], onclick: chiudi }); }),
    S.remoto ? el('button', { type: 'button', class: 'sheet-esci', text: 'Esci da questo telefono', onclick: esci }) : null));
  sheet.onclick = function (e) { if (e.target === sheet) chiudi(); };
}
/** Menu a sinistra: solo quello che serve ogni giorno. Il resto (corsi, analisi, registro, impostazioni, guida...) sta nella pagina "Altro". */
/* (1.25.0) in cima quello che serve per ogni allieva: la scheda, l'iscrizione, il pagamento, il certificato; sotto, quello che si guarda ogni tanto */
var MENU = [['inizio', 'Home'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['pagamenti', 'Pagamenti'], ['certificati', 'Certificati'], ['scadenze', 'Scadenze'], ['calendario', 'Calendario'], ['analisi', 'Grafici'], ['altro', 'Altro']];
var MENU_SEPARA = { scadenze: 1, altro: 1 };
/** I numeri accanto alle voci del menu: quello che aspetta (scadenze da seguire, certificati da rinnovare o mancanti, pagamenti da incassare). Si ricalcolano solo quando i dati cambiano. */
function numeriMenu() {
  if (!S.db) return {};
  var k = S.rev + '|' + today() + '|' + S.db.allieve.length;
  if (!S.badge || S.badge.k !== k) { var t = today(), r = L.riepilogo(S.db, t), nt = L.elencoNote(S.db, t).conteggi; S.badge = { k: k, v: { calendario: nt.scadute + nt.oggi, scadenze: r.scadute + r.inScadenza, certificati: r.certScaduti + r.certInScadenza + r.certMancanti, pagamenti: r.daIncassare + r.bonificiDaVerificare } }; }
  return S.badge.v;
}
function disegnaMenu(nav, cur) {
  var box = el('div', { class: 'nav-gruppo' }), n = numeriMenu();
  MENU.forEach(function (m) {
    if (MENU_SEPARA[m[0]]) add(box, el('div', { class: 'nav-sep', 'aria-hidden': 'true' }));
    add(box, el('a', { href: '#' + m[0], 'data-ant': 'menu:' + m[0], 'aria-current': cur === m[0] ? 'page' : null }, icona(m[0]), el('span', { text: m[1] }), n[m[0]] ? el('em', { class: 'nav-n', title: n[m[0]] + ' da seguire', text: String(n[m[0]]) }) : null));
  });
  nav.appendChild(box);
}
function render() {
  if (window.GymLogo && (S.db || S.bloccato || S.fatal)) GymLogo.pronto(); // the page is ready: the opening screen with the logo may go (not before its minimum time)
  var y0 = window.pageYOffset || 0; // where the person was: drawing again the same page (after a save, a tick) must not take her back to the top
  var r = parseHash(), tabs = clear($('tabs')), cur = TAB_OF[r.view] || r.view;
  var v = clear($('view'));
  setConn();
  document.body.classList.toggle('bloccato', S.bloccato);
  if (S.bloccato) { vSblocca(v); return; }
  disegnaMenu(tabs, cur);
  if (window.Movimento) Movimento.menu(tabs);
  disegnaPercorso(r);
  disegnaBarra(cur, r.view);
  if (S.fatal) { add(v, note('bad', S.fatal)); return; }
  if (!S.db) { add(v, el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Apro l\'archivio…')); return; }
  $('stagione').textContent = S.db.impostazioni.stagione;
  var ex = $('esci'); if (ex) ex.hidden = !S.remoto;
  var cb = $('chiudi'); if (cb) cb.hidden = S.remoto; // closing the program is for the computer it runs on, not for a phone
  $('offline').textContent = S.remoto ? 'Non riesco a raggiungere il computer della segreteria: controlla che sia acceso e collegato alla rete. Le modifiche non vengono salvate finché non torna.' : 'Il programma è stato chiuso: le modifiche non vengono più salvate. Chiudi questa finestra e riapri Gym Art Segreteria.';
  var views = { inizio: vInizio, altro: vAltro, allieve: vAllieve, allieva: vAllieva, iscrizioni: vIscrizioni, iscrizione: vIscrizione, corsi: vCorsi, pagamenti: vPagamenti, analisi: vAnalisi, scadenze: vScadenze, calendario: vCalendario, certificati: vCertificati, tutorial: vTutorial, aggiornamenti: vAggiornamenti, assistente: vAssistente, registro: vRegistro, impostazioni: vImpostazioni, stagione: vStagione, promemoria: vPromemoria, guida: vGuida };
  var nav = location.hash !== S.ultimoHash; S.ultimoHash = location.hash; // false when the same page is only drawn again (after a save, for instance)
  (views[r.view] || vInizio)(v, r.args, nav);
  // a new page starts at the top and rises in; the same page drawn again stays where it was, still (no flicker after every save)
  if (nav) { window.scrollTo(0, 0); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); } else { v.classList.remove('enter'); window.scrollTo(0, y0); }
  if (window.Movimento) { Movimento.entra(v, r.view + '/' + r.args.join('/')); Movimento.decora(v); } // GSAP: entrance of the page, counting digits, light under the pointer
  if (nav && r.args.length && (r.view === 'pagamenti' || r.view === 'impostazioni')) vaiASezione(v, r.view, r.args[0]);
  if (!S.visitaProposta && r.view === 'inizio' && window.Tutorial) { // the guided tour: offered once, on the first start on this device (it never repeats by itself)
    S.visitaProposta = true;
    setTimeout(function () { if (!S.dirty && !S.bloccato && !S.fatal && !Tutorial.avviaSeServe()) mostraNovitaSeServe(); }, 900);
  }
}
/* ---------- la barra in alto: Indietro, Home e dove sei (1.25.0) ---------- */
var NOME_VISTA = { inizio: 'Home', allieve: 'Allieve', iscrizioni: 'Iscrizioni', pagamenti: 'Pagamenti', certificati: 'Certificati', scadenze: 'Scadenze', calendario: 'Calendario', analisi: 'Grafici', altro: 'Altro',
  promemoria: 'Promemoria', corsi: 'Corsi', registro: 'Registro', stagione: 'Nuova stagione', impostazioni: 'Impostazioni', guida: 'Manuale', assistente: 'Assistente', aggiornamenti: 'Aggiornamenti e novità' };
var SOTTO_ALTRO = { corsi: 1, registro: 1, stagione: 1, impostazioni: 1, guida: 1, assistente: 1, aggiornamenti: 1 };
/** Where the person is, as a path of links: Allieve › Rossi Giulia › Iscrizione Base. The last piece is the page itself (not a link). */
function percorsoDi(r) {
  var v = r.view, a = r.args, out = [], al;
  if (v === 'allieva') { out.push(['Allieve', 'allieve']); al = a[0] !== 'nuova' && S.db ? L.byId(S.db.allieve, a[0]) : null; out.push([al ? al.name : 'Nuova allieva']); return out; }
  if (v === 'iscrizione') {
    var e = a[0] !== 'nuova' && S.db ? L.byId(S.db.iscrizioni, a[0]) : null; al = S.db ? L.byId(S.db.allieve, e ? e.allievaId : a[1]) : null;
    if (al) { out.push(['Allieve', 'allieve'], [al.name, 'allieva/' + al.id]); } else out.push(['Iscrizioni', 'iscrizioni']);
    out.push([e ? 'Iscrizione ' + (e.corso || 'da definire') : 'Nuova iscrizione']); return out;
  }
  if (v === 'promemoria') out.push(['Scadenze', 'scadenze']);
  if (SOTTO_ALTRO[v]) out.push(['Altro', 'altro']);
  out.push([NOME_VISTA[v] || 'Home']);
  return out;
}
function disegnaPercorso(r) {
  var ol = $('percorso'); if (!ol) return;
  clear(ol);
  percorsoDi(r).forEach(function (x, i, tutti) {
    add(ol, el('li', null, i === tutti.length - 1 ? el('span', { 'aria-current': 'page', text: x[0] }) : link(x[0], x[1])));
  });
  var ind = $('indietro'); if (ind) ind.disabled = !S.storia.length;
  var h = $('home'); if (h) h.classList.toggle('qui', r.view === 'inizio');
}
/** Indietro: the page before, in this window (the program keeps its own list: the browser's would also go back to pages outside the program). */
function indietro() {
  if (!S.storia.length) return;
  var prima = S.storia.pop(); S.tornando = true;
  location.hash = prima;
}

/** Dalla ricerca veloce: porta alla parte giusta della pagina (apre il gruppo delle impostazioni, mostra i bonifici da verificare...). */
var ANCORE_PAGAMENTI = { incassi: 'incassi', 'da-incassare': 'da-incassare', verifica: 'da-verificare' };
function vaiASezione(v, vista, id) {
  var n = null;
  if (vista === 'impostazioni') { n = v.querySelector('details.gruppo[data-sez="' + id.replace(/[^a-z0-9-]/g, '') + '"]'); if (n) n.open = true; }
  else n = document.getElementById(ANCORE_PAGAMENTI[id] || '-');
  if (n) setTimeout(function () { n.scrollIntoView({ block: 'start' }); }, 0);
  else if (vista === 'pagamenti' && id === 'verifica') toast('Nessun bonifico da verificare.');
}

/* ---------- Inizio ---------- */
/** n: a number, or a text (then eur/pct tell what it is, so that it can count up). sub: extra line shown in the detailed view.
 *  x (optional): { icona } to choose the icon of the tile (by default the one of its kind). */
function tile(n, label, kind, hash, sub, eur, x) {
  x = x || {};
  var b = el('b', { text: String(n) });
  if (typeof n === 'number') { b.setAttribute('data-v', n); b.setAttribute('data-f', 'int'); }
  else if (typeof eur === 'number') { b.setAttribute('data-v', eur); b.setAttribute('data-f', 'eur'); }
  else if (/^\d+%$/.test(String(n))) { b.setAttribute('data-v', parseInt(n, 10)); b.setAttribute('data-f', 'pct'); }
  var ico = x.icona || ICONA_TESSERA[kind];
  // the label is always the first <span> of a tile and the number the first <b>: the tests and the screen readers rely on it
  var ant = chiaveTessera(label);
  return el(hash ? 'a' : 'div', { 'data-ant': ant ? 'tessera:' + ant : null, class: 'tile' + (kind ? ' t-' + kind : '') + (typeof n === 'string' ? ' tile-text' : ''), href: hash ? '#' + hash : null },
    ico ? el('div', { class: 'tile-ico' }, icona(ico)) : null, b, el('span', { text: label }),
    sub ? el('small', { class: 'solo-det', text: sub }) : null);
}
var GIORNI_LUNGHI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
var MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function maiuscola(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
function giornoSettimana(iso) { return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay(); } // 0 = domenica

/** La pagina "Altro": tutto quello che non serve ogni giorno. */
function vAltro(v) {
  add(v, el('h1', { text: 'Altro' }));
  var voci = [['assistente', 'Assistente', 'Domande sui dati, cose da controllare, messaggi pronti'], ['corsi', 'Corsi', 'Elenchi per corso e fogli presenze da stampare'],
    ['promemoria', 'Promemoria', 'Chi contattare per abbonamenti e certificati'], ['registro', 'Registro', 'Che cosa è stato modificato e quando'],
    ['stagione', 'Nuova stagione', 'A settembre: rinnovare o chiudere le iscrizioni'], ['impostazioni', 'Impostazioni', 'Copie di sicurezza, aspetto, tariffe, importazione, telefono, assistenza'],
    ['guida', 'Manuale', 'Come si fa ogni cosa, passo passo, e la visita guidata'], ['aggiornamenti', 'Aggiornamenti e novità', 'Che cosa è cambiato e se c\'è una versione nuova']];
  add(v, el('div', { class: 'card' }, el('div', { class: 'list' }, voci.map(function (x) {
    return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, link(x[1], x[0], 'name'), el('div', { class: 'muted small', text: x[2] })), link('Apri', x[0], 'btn btn-small', 'Apri ' + x[1]));
  }))));
}

/** #tutorial (anche dalla ricerca veloce): torna a Inizio e fa partire la visita guidata. */
function vTutorial(v) {
  add(v, el('p', { class: 'muted', text: 'Avvio la visita guidata…' }));
  setTimeout(function () { go('inizio'); setTimeout(function () { if (window.Tutorial) Tutorial.avvia(); }, 60); }, 0);
}
/** A row of «Da fare» in Inizio: the number, what it is, a line under it, and (optional) a button at its side. eur: the amount, when n is a text in euro (the digits can roll). */
function rigaFare(n, label, kind, hash, sub, azione, eur) {
  var b = n === null ? el('span', { class: 'fare-n fare-ico' }, icona('attenzione')) : el('b', { class: 'fare-n' + (typeof n === 'string' ? ' fare-eur' : ''), text: String(n) });
  if (typeof n === 'number') { b.setAttribute('data-v', n); b.setAttribute('data-f', 'int'); } else if (typeof eur === 'number') { b.setAttribute('data-v', eur); b.setAttribute('data-f', 'eur'); }
  var ant = chiaveTessera(label);
  return el('div', { class: 'fare-riga k-' + (kind || 'mute') },
    el('a', { class: 'fare-link', href: '#' + hash, 'data-ant': ant ? 'tessera:' + ant : null }, b, el('span', { class: 'fare-testo' }, el('span', { class: 'fare-l', text: label }), sub ? el('small', { text: sub }) : null), icona('destra')),
    azione || null);
}
/** A number of «In breve»: the number, what it counts, where it leads, a quiet line under it. */
function dato(n, label, hash, sub, eur) {
  var b = el('b', { text: String(n) });
  if (typeof n === 'number') { b.setAttribute('data-v', n); b.setAttribute('data-f', 'int'); } else if (typeof eur === 'number') { b.setAttribute('data-v', eur); b.setAttribute('data-f', 'eur'); }
  return el('a', { class: 'dato', href: '#' + hash }, b, el('span', { class: 'dato-l', text: label }), sub ? el('small', { text: sub }) : null);
}
function vInizio(v) {
  var t = today(), r = L.riepilogo(S.db, t), an = L.analisi(S.db, t, '12mesi'), mese = an.incassiMese[11], mesePrec = an.incassiMese[10];
  var sic = S.sic, cz = L.elencoCertificati(S.db, t, {}).conteggi, noteC = L.elencoNote(S.db, t).conteggi;
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Home' }),
    el('p', { class: 'muted', text: maiuscola(GIORNI_LUNGHI[giornoSettimana(t)]) + ' ' + (+t.slice(8, 10)) + ' ' + MESI_LUNGHI[+t.slice(5, 7) - 1] + ' ' + t.slice(0, 4) + ' · stagione ' + S.db.impostazioni.stagione })),
    null));
  if (!S.db.allieve.length) add(v, note('', 'L\'archivio è vuoto.', ['Per portare qui i dati del file Excel o del foglio Google vai in Altro → Impostazioni, alla voce "Importa dal file Excel". Il file resta sul computer.', 'Oppure inserisci la prima iscrizione con il pulsante "Nuova iscrizione" in alto.']));
  if (L.stagioneDi(t) > S.db.impostazioni.stagione && r.correnti) add(v, el('div', { class: 'note note-warn' }, el('b', { text: 'È iniziata la stagione ' + L.stagioneDi(t) + ': l\'archivio è ancora sulla ' + S.db.impostazioni.stagione + '.' }),
    el('span', null, 'Hai ' + plurale(r.correnti, 'iscrizione aperta', 'iscrizioni aperte') + ' da rinnovare o chiudere: ', link('avvia la Nuova stagione', 'stagione'), '.')));
  if (sic && sic.recupero) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'L\'archivio era ' + (sic.recupero.motivo === 'mancante' ? 'sparito' : 'danneggiato') + ' ed è stato rimesso da una copia.' }),
    el('span', null, 'Copia usata: ' + sic.recupero.da + ', salvata il ' + quando(sic.recupero.salvato) + '. ' + (sic.recupero.danneggiato ? 'Il file rovinato è stato tenuto da parte con il nome ' + sic.recupero.danneggiato + '. ' : '') +
      'Le modifiche fatte dopo quella copia potrebbero mancare: controlla gli ultimi inserimenti.'),
    S.remoto ? null : el('div', { class: 'row' }, button('Ho letto', function () { api('POST', '/api/sicurezza/letto').then(function () { S.sic.recupero = null; render(); }, function (e) { avviso(e.message); }); }, 'btn-small'))));
  if (sic && sic.errore) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'La copia giornaliera non è riuscita.' }), el('span', null, sic.errore + ' Controlla lo spazio sul disco e riprova da Altro → Impostazioni → Sicurezza dei dati.')));

  add(v, bannerAgg());
  // «Da fare»: one list, the most urgent first; each row opens its list, and where it helps it has the button that starts the messages to the parents
  var conTel = function (tipo) { return L.elencoPromemoria(S.db, t, { tipo: tipo, contatto: 'fare' }).righe.some(function (x) { return x.tel; }); };
  var avvisaAbb = conTel('abbonamento'), avvisaCert = conTel('certificato');
  var bottoneAvvisa = function (tipo, cosa) { return button('Avvisa', function () { avvisaTutti(tipo); }, 'btn-small', 'Avvisa i genitori: ' + cosa); };
  var fare = [
    r.scadute ? rigaFare(r.scadute, 'Abbonamenti scaduti', 'bad', 'scadenze/abb-scaduti', 'da rinnovare o chiudere', avvisaAbb ? bottoneAvvisa('abbonamento', 'abbonamenti scaduti') : null) : null,
    r.inScadenza ? rigaFare(r.inScadenza, 'Abbonamenti in scadenza', 'warn', 'scadenze/abb-in-scadenza', 'entro ' + S.db.impostazioni.preavvisoAbb + ' giorni', avvisaAbb && !r.scadute ? bottoneAvvisa('abbonamento', 'abbonamenti in scadenza') : null) : null,
    r.certScaduti + r.certInScadenza ? rigaFare(r.certScaduti + r.certInScadenza, 'Certificati da rinnovare', r.certScaduti ? 'bad' : 'warn', r.certScaduti ? 'scadenze/cert-scaduti' : 'scadenze/cert-in-scadenza', [r.certScaduti ? plurale(r.certScaduti, 'scaduto', 'scaduti') : '', r.certInScadenza ? r.certInScadenza + ' in scadenza' : ''].filter(Boolean).join(', '), avvisaCert ? bottoneAvvisa('certificato', 'certificati da rinnovare') : null) : null,
    r.certMancanti ? rigaFare(r.certMancanti, 'Certificati mancanti', 'warn', 'scadenze/cert-mancanti', 'iscritte oltre il termine per consegnarlo', avvisaCert && !(r.certScaduti + r.certInScadenza) ? bottoneAvvisa('certificato', 'certificati mancanti') : null) : null,
    r.certInAttesa ? rigaFare(r.certInAttesa, 'Certificati da consegnare', 'mute', 'scadenze/cert-attesa', 'iscritte da poco, ancora nei termini') : null,
    r.daIncassare ? rigaFare(soldi(r.totaleDaIncassare), 'Da incassare', 'warn', 'pagamenti/da-incassare', plurale(r.daIncassare, 'iscrizione', 'iscrizioni') + ' con un residuo', null, r.totaleDaIncassare) : null,
    r.bonificiDaVerificare ? rigaFare(r.bonificiDaVerificare, 'Bonifici da verificare', 'warn', 'pagamenti/verifica', soldi(r.totaleBonificiDaVerificare) + ' da controllare sull\'estratto conto') : null,
    noteC.scadute + noteC.oggi ? rigaFare(noteC.scadute + noteC.oggi, 'Note per oggi', noteC.scadute ? 'bad' : 'warn', 'calendario/note', noteC.scadute ? plurale(noteC.scadute, 'in ritardo', 'in ritardo') + ' e ' + plurale(noteC.oggi, 'di oggi', 'di oggi') : 'con la data di oggi') : null,
    r.daCompletare ? rigaFare(r.daCompletare, 'Iscrizioni da completare', 'warn', 'iscrizioni', 'senza tipo o data di inizio') : null
  ].filter(Boolean);
  // the safety copies: in the same list, with the button that does the thing
  var pc = L.promemoriaCopia(S.db, t, S.copie2);
  if (!S.remoto && S.db.allieve.length && !S.copie2.cartella) fare.push(rigaFare(null, 'Le copie di sicurezza stanno solo su questo computer', 'bad', 'impostazioni/dati', 'Se il disco si rompe si perdono anche loro: scegli una chiavetta o una cartella di OneDrive.', link('Imposta', 'impostazioni/dati', 'btn btn-small', 'Imposta la seconda cartella')));
  if (pc.serve && !S.remoto) fare.push(rigaFare(null, pc.giorni === null ? 'Non hai ancora scaricato una copia di sicurezza' : 'L\'ultima copia di sicurezza scaricata è di ' + pc.giorni + ' giorni fa', 'warn', 'impostazioni/dati', 'Scaricane una e tienila fuori dal computer, per esempio su una chiavetta.', button('Scarica', scaricaCopiaSicurezza, 'btn-small', 'Scarica una copia di sicurezza')));
  add(v, el('div', { class: 'card fare' }, el('h2', { text: 'Da fare' }),
    fare.length ? el('div', { class: 'fare-lista' }, fare) : el('p', { class: 'empty', text: S.db.allieve.length ? 'Niente da fare: è tutto a posto.' : 'Ancora niente: le scadenze compaiono qui dopo le prime iscrizioni.' })));
  add(v, el('div', { class: 'card breve', 'aria-label': 'In breve' },
    dato(r.allieve, 'allieve', 'allieve', r.archiviate ? plurale(r.archiviate, 'archiviata', 'archiviate') : ''),
    dato(r.correnti, 'iscrizioni aperte', 'iscrizioni', r.attive + ' attive'),
    dato(soldi(mese), 'incassati a ' + MESI_LUNGHI[+t.slice(5, 7) - 1], 'analisi', 'mese prima: ' + soldi(mesePrec), mese),
    dato(cz.agonistico + cz.nonAgonistico + cz.ludico, 'certificati registrati', 'certificati', cz.agonistico + ' agonistici')));
  var rin = L.previsioneRinnovi(S.db, t, 6).mesi.filter(function (m) { return m.n > 0; }).slice(0, 3), righe = el('div', { class: 'card home-righe' }); // the lines under the numbers stay in a card: on the glass styles the coloured background behind them moves
  add(v, righe);
  if (rin.length) add(righe, el('p', { class: 'home-nota' }, 'Rinnovi in arrivo: ', rin.map(function (m, i) { return [i ? ' · ' : '', el('b', { text: m.l }), ' ' + plurale(m.n, 'abbonamento', 'abbonamenti') + ' (' + C.fmtMoney(m.euro) + ')']; }), ' · ', link('Grafici', 'analisi')));
  var comp = L.compleanni(S.db, t, 0);
  if (!rin.length && !comp.length) righe.remove(); // nothing to say: no empty card
  if (comp.length) add(righe, el('p', { class: 'home-nota' }, 'Compleanni oggi: ', comp.map(function (x, i) { return [i ? ', ' : '', link(x.allieva.name, 'allieva/' + x.allieva.id), ' (' + x.eta + ' anni)']; })));

  if (S.copie2.cartella && S.copie2.avviso) add(v, el('div', { class: 'note note-warn' }, el('b', { text: 'La seconda cartella non protegge da un guasto del disco.' }), el('span', null, S.copie2.avviso)));
  if (S.copie2.cartella && S.copie2.errore) add(v, el('div', { class: 'note note-bad' }, el('b', { text: 'La copia sulla seconda cartella non riesce.' }),
    el('span', null, S.copie2.errore + ' Collega la chiavetta o il disco, oppure ', link('scegli un\'altra cartella in Impostazioni', 'impostazioni'), '.')));
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
        svg.appendChild(sv('rect', { x: bx, y: pt + ih - Math.max(h, 3), width: bw, height: Math.max(h, 3), rx: Math.min(7, bw / 2), fill: 'url(#gb' + id + '-' + si + ')', class: 'bar', style: 'animation-delay:' + (Math.min(i * k + si, 5) * 30) + 'ms' }));
        if (S.det) svg.appendChild(sv('text', { x: bx + bw / 2, y: pt + ih - h - 5, class: 'vlab', 'text-anchor': 'middle' }, corto(v)));
      }
    });
    svg.appendChild(sv('text', { x: pl + gw * i + gw / 2, y: H - 10, class: 'xtick', 'text-anchor': 'middle' }, stretto && n > 9 && i % 2 ? '' : c));
  });
  if (o.media > 0 && o.media <= top) {
    var ym = pt + ih - ih * o.media / top;
    svg.appendChild(sv('line', { x1: pl, x2: W - pr, y1: ym, y2: ym, class: 'media' }));
    var mt = 'media ' + corto(o.media);
    svg.appendChild(sv('rect', { x: pl + 3, y: ym - 21, width: Math.round(mt.length * 6.4 + 12), height: 18, rx: 5, class: 'medialab-bg' })); // a small label with its own background: it may sit over a bar
    svg.appendChild(sv('text', { x: pl + 8, y: ym - 8, class: 'medialab', 'text-anchor': 'start' }, mt));
  }
  var legenda = k > 1 ? el('div', { class: 'legenda' }, serie.map(function (x, i) { return el('span', null, el('i', { style: 'background:' + (x.colore || CS[i % CS.length]) }), x.nome); })) : null;
  return el('div', { class: 'grafico' }, svg, legenda, tabellaDati(cats, serie, fmt));
}
/** The numbers behind a chart, shown in the detailed view. */
function tabellaDati(cats, serie, fmt) {
  return el('div', { class: 'solo-det scroll-x' }, el('table', { class: 'dati' },
    el('thead', null, el('tr', null, el('th', null, el('span', { class: 'sr-only', text: 'Dato' })), cats.map(function (c) { return el('th', { class: 'num', text: c }); }))),
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
      'stroke-dasharray': vis + ' ' + CIRC, 'stroke-dashoffset': -off - 1.5, transform: 'rotate(-90 100 100)', style: '--len:' + vis + ';--circ:' + CIRC + ';animation-delay:' + (Math.min(i, 5) * 40) + 'ms' }, sv('title', null, f.l + ': ' + (f.testo || f.v))));
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
      el('div', { class: 'ht' }, el('i', { style: '--w:' + Math.max(r.v > 0 ? 2 : 0, r.v / max * 100) + '%;--d:' + (Math.min(i, 5) * 30) + 'ms;background:' + (r.c || CS[0]) })), el('span', { class: 'hv', text: r.testo }));
  }));
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
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Grafici' }), el('p', { class: 'muted', text: titolo + ' · ' + C.isoToIt(a.dal) + ' – oggi' })), seg));

  var r = L.riepilogo(S.db, t);
  add(v, el('div', { class: 'grid' },
    tile(soldi(a.incassiTot), 'Incassato', 'ok', 'pagamenti', plurale(a.incassiN, 'pagamento', 'pagamenti') + ' · medio ' + C.fmtMoney(a.incassoMedio) + (a.daVerificareN ? ' · ' + C.fmtMoney(a.daVerificareTot) + ' da verificare' : ''), a.incassiTot),
    tile(soldi(a.daIncassare), 'Da incassare', a.daIncassare ? 'warn' : 'ok', 'pagamenti', plurale(a.daIncassareN, 'iscrizione', 'iscrizioni') + ' con residuo', a.daIncassare),
    soloDet(tile(a.tasso === null ? '–' : a.tasso + '%', 'Tasso di incasso', a.tasso === null ? 'mute' : a.tasso >= 90 ? 'ok' : a.tasso >= 70 ? 'warn' : 'bad', null, 'pagato su dovuto, iscrizioni avviate nel periodo')),
    tile(r.correnti, 'Iscrizioni aperte', '', 'iscrizioni', r.attive + ' attive · ' + r.inScadenza + ' in scadenza'),
    soloDet(tile(a.etaMedia === null ? '–' : String(a.etaMedia).replace('.', ','), 'Età media', 'mute', 'allieve', 'anni, allieve non archiviate'))));

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
  // the renewals of the coming months: the quarterly fees usually fall in December and in March
  var pr = L.previsioneRinnovi(S.db, t, 12), mesiR = pr.mesi.map(function (x) { return x.l; });
  var righeRin = pr.mesi.filter(function (m) { return m.n > 0; }).slice(0, 6);
  add(v, card('Rinnovi dei prossimi mesi', pr.totale.n ? el('div', null,
    el('div', { class: 'cols2' },
      graficoBarre(mesiR, [{ nome: 'Mensile', colore: 'var(--c1)', valori: pr.mesi.map(function (m) { return m.perTipo.Mensile; }) }, { nome: 'Trimestrale', colore: 'var(--c3)', valori: pr.mesi.map(function (m) { return m.perTipo.Trimestrale; }) },
        { nome: 'Annuale', colore: 'var(--c2)', valori: pr.mesi.map(function (m) { return m.perTipo.Annuale; }) }], { etichetta: 'Abbonamenti che scadono, per mese e per tipo', h: 210 }),
      graficoBarre(mesiR, [{ nome: 'Previsto', colore: 'var(--c2)', valori: pr.mesi.map(function (m) { return m.euro; }) }], { fmt: C.fmtMoney, corto: eurCorto, etichetta: 'Incasso previsto dai rinnovi, per mese', h: 210 })),
    el('div', { class: 'scroll-x' }, el('table', { class: 'rinnovi' }, el('thead', null, el('tr', null, el('th', { text: 'Mese' }), el('th', { class: 'num', text: 'Abbonamenti' }), el('th', { class: 'num', text: 'Previsto' }), el('th', { text: 'Chi' }))),
      el('tbody', null, righeRin.map(function (m) {
        var nomi = m.righe.slice(0, 4).map(function (r) { return r.allieva.name; }).join(', ') + (m.righe.length > 4 ? ' e altre ' + (m.righe.length - 4) : '');
        return el('tr', { 'data-ant': 'mese:' + m.chiave }, el('th', { text: m.l }), el('td', { class: 'num', text: m.n }), el('td', { class: 'num', text: C.fmtMoney(m.euro) }), el('td', { class: 'muted small', text: nomi }));
      })))))
    : el('p', { class: 'empty', text: 'Nessun abbonamento aperto in scadenza nei prossimi 12 mesi.' }),
    'Le rette trimestrali scadono di solito a dicembre e a marzo. "Previsto" è la quota del periodo (concordata o da tariffario) di chi scade in quel mese' + (pr.arretrati.n ? '; ' + plurale(pr.arretrati.n, 'abbonamento è già scaduto', 'abbonamenti sono già scaduti') + ' e non rinnovati (' + C.fmtMoney(pr.arretrati.euro) + ', vedi Scadenze).' : '.')));
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
    card('Certificati medici', (a.certValidi + a.certInScadenza + a.certScaduti + a.certMancanti + a.certInAttesa) ? graficoCiambella([
      { l: 'Validi', v: a.certValidi, c: 'var(--c2)', testo: String(a.certValidi) }, { l: 'In scadenza', v: a.certInScadenza, c: 'var(--c3)', testo: String(a.certInScadenza) },
      { l: 'Scaduti', v: a.certScaduti, c: 'var(--c5)', testo: String(a.certScaduti) }, { l: 'In attesa', v: a.certInAttesa, c: 'var(--c1)', testo: String(a.certInAttesa) }, { l: 'Mancanti', v: a.certMancanti, c: 'var(--grigio)', testo: String(a.certMancanti) }],
      { t: String(a.certValidi + a.certInScadenza + a.certScaduti + a.certMancanti + a.certInAttesa), s: 'allieve' }, { etichetta: 'Stato dei certificati' }) : el('p', { class: 'empty', text: 'Nessuna allieva con iscrizione aperta.' }), 'Allieve non archiviate con almeno un\'iscrizione aperta.')));

  // incassi per corso + small things
  var m = a.mancanti, dati = [['telefono', 'Senza telefono', m.telefono], ['cf', 'Senza codice fiscale', m.cf], ['nascita', 'Senza data di nascita', m.nascita], ['privacy', 'Consenso privacy non indicato', m.privacy], ['genitore', 'Minorenni senza genitore indicato', m.genitore]];
  var mCard = card('Dati da completare', dati.some(function (x) { return x[2].length; }) ? el('div', { class: 'list' }, dati.filter(function (x) { return x[2].length; }).map(function (x) {
    return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, el('b', { text: x[1] }), el('div', { class: 'muted small solo-det', text: x[2].slice(0, 12).join(', ') + (x[2].length > 12 ? '… e altre ' + (x[2].length - 12) : '') })), chip(String(x[2].length), 'warn'));
  })) : el('p', { class: 'empty', text: 'Le schede delle allieve sono complete.' }), 'Allieve non archiviate. Nella vista dettagliata compaiono i nomi.');
  add(v, el('div', { class: 'cols2 solo-det' },
    card('Incassi per corso', corsiInc.length ? barreOrizzontali(corsiInc.map(function (c, i) { return { l: c, v: a.perCorso[c], testo: C.fmtMoney(a.perCorso[c]), c: CS[i % CS.length] }; })) : el('p', { class: 'empty', text: 'Nessun pagamento in questo periodo.' })),
    mCard));
  add(v, soloDet(cardCompleanni(14)));
}

/* ---------- Allieve ---------- */
function vAllieve(v) {
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' });
  var cols = [
    { h: 'Allieva', key: function (r) { return r.a.name; }, cell: function (r) { return [link(r.a.name, 'allieva/' + r.a.id, 'name'), r.a.archiviata ? [' ', chip('Archiviata')] : null]; } },
    { h: 'Età', cls: 'nowrap', key: function (r) { return C.isIso(r.a.nascita) ? C.daysBetween(r.a.nascita, r.t) : null; }, cell: function (r) { return eta(r.a); } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (r) { return r.a.tel; } },
    { h: 'Genitore / Referente', det: true, key: function (r) { return r.a.genitore; }, cell: function (r) { return r.a.genitore; } },
    { h: 'Certificato', key: function (r) { return r.cert.scadenza || null; }, cell: function (r) { return r.isc.length || r.cert.stato !== 'MANCANTE' ? certBreve(r.a, r.cert) : ''; } },
    { h: 'Email', det: true, key: function (r) { return r.a.email; }, cell: function (r) { return r.a.email; } },
    { h: 'Città', det: true, key: function (r) { return r.a.citta; }, cell: function (r) { return r.a.citta; } },
    { h: 'Codice fiscale', det: true, cls: 'nowrap mono', cell: function (r) { return r.a.cf; } },
    { h: 'Da pagare', det: true, cls: 'num', key: function (r) { return r.conto.residuo; }, cell: function (r) { return r.conto.residuo > 0.005 ? C.fmtMoney(r.conto.residuo) : ''; } },
    { h: 'Iscrizioni', key: function (r) { return r.isc.map(function (x) { return x.e.corso; }).join(' '); }, cell: function (r) {
      return r.isc.length ? r.isc.map(function (x, i) { var c = x.e.corso || 'Corso da definire'; return x.s.stato === 'ATTIVO' ? (i ? ', ' : '') + c : [i ? ' ' : '', chip(c + ' · ' + (STATO_NOME[x.s.stato] || x.s.stato).toLowerCase(), STATO_KIND[x.s.stato])]; }) : el('span', { class: 'muted small', text: 'nessuna' });
    } }
  ];
  function draw() {
    var t = today(), rows = L.cercaAllieve(S.db, S.fa.q, S.fa.filtro).map(function (a) {
      return { a: a, t: t, conto: L.contoAllieva(S.db, a.id), cert: L.statoCertificato(S.db, a, t), isc: L.iscrizioniDi(S.db, a.id).filter(L.corrente).map(function (e) { return { e: e, s: L.statoIscrizione(S.db, e, t) }; }) };
    });
    count.textContent = rows.length === 1 ? '1 allieva' : rows.length + ' allieve';
    clear(box); clear(more);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.allieve.length ? 'Nessuna allieva corrisponde alla ricerca.' : 'Non ci sono ancora allieve. Premi «Nuova iscrizione» in alto, oppure porta qui il file Excel da Altro → Impostazioni → «Importa».' })); return; }
    var e = elenco(cols, rows, S.fa.sort, draw, function (r) { return { class: 'link', 'data-ant': 'allieva:' + r.a.id, onclick: function () { go('allieva/' + r.a.id); } }; }, S.fa);
    add(box, e.table); add(more, e.more);
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: S.fa.q, placeholder: 'Nome, telefono, genitore, codice fiscale…', oninput: function () { S.fa.q = search.value; S.fa.tutte = false; later(); } });
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Allieve' }), el('div', { class: 'row' }, button('Modulo in bianco (PDF)', function () { scaricaPdf('Modulo_iscrizione_in_bianco', window.GymPdf.moduloIscrizione({ stagione: S.db.impostazioni.stagione })); }))));
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
  var notes = el('div', { class: 'notes' }), save = button(cur ? 'Salva le modifiche' : 'Salva la nuova allieva', submit, 'btn-primary'), cfHint = el('span', { class: 'hint' }), shown = !!cur, altriDet = null;
  var ESSENZIALI = /^(Manca cognome|Cognome e nome|Data di nascita|Telefono non valido)/;
  function refresh() {
    var chk = L.controllaAllieva(S.db, f, id, today());
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di salvare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    segnaCampi(v, notes, shown ? chk.errors : []);
    save.disabled = shown && chk.errors.length > 0;
    if (shown && altriDet && chk.errors.some(function (e) { return !ESSENZIALI.test(e); })) altriDet.open = true; // an error in an optional field: show it
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
    if (chk.errors.length) { refresh(); portaAlErrore(v, notes); return; }
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
  add(v, el('div', { class: 'head-row' }, el('div', { class: 'testata' }, el('h1', { text: cur ? cur.name : 'Nuova allieva' }),
      cur ? el('p', { class: 'muted testata-sotto' }, [['n. ' + cur.id], [eta(cur)], [cur.tel ? 'tel. ' + cur.tel : ''], [cur.genitore ? 'genitore: ' + cur.genitore : '']].map(function (x) { return x[0]; }).filter(Boolean).join(' · '), cur.archiviata ? [' ', chip('Archiviata', 'warn')] : null) : null)));
  if (cur) add(v, barraAllieva(cur));
  if (cur) { var ct = L.contoAllieva(S.db, id); if (ct.pagato > 0 || ct.residuo > 0) add(v, el('div', { class: 'info-line riepilogo-allieva' }, el('span', null, 'Pagato in totale: ', el('b', { text: C.fmtMoney(ct.pagato) })), ct.residuo > 0.005 ? el('span', null, 'Da pagare: ', el('b', { text: C.fmtMoney(ct.residuo) })) : el('span', null, 'Tutto saldato'), el('span', { class: 'solo-det' }, 'Dovuto in totale: ', el('b', { text: C.fmtMoney(ct.dovuto) })), el('span', { class: 'solo-det', text: 'Creata il ' + C.isoToIt((cur.creata || '').slice(0, 10)) }))); }
  if (cur) add(v, cardDaFareAllieva(cur));
  if (cur) add(v, cardCertificato(cur));
  if (cur) add(v, cardIscrizioniAllieva(cur));
  if (cur) add(v, cardNote(cur));
  altriDet = altri('Altri dati (facoltativi)', [
    el('h3', { text: 'Anagrafica e residenza' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.luogo, inp('luogo')), cfField, field(L.A_CAMPI.indirizzo, inp('indirizzo')), field(L.A_CAMPI.citta, inp('citta')), field(L.A_CAMPI.cap, inp('cap', 'text', { inputmode: 'numeric', maxlength: 5 })), field(L.A_CAMPI.tessera, inp('tessera'))),
    el('h3', { text: 'Altri contatti' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.cfGenitore, inp('cfGenitore', 'text', { maxlength: 20, spellcheck: 'false' })), field(L.A_CAMPI.tel2, inp('tel2', 'tel')), field(L.A_CAMPI.email, inp('email', 'email'))),
    el('div', { class: 'row' }, el('h3', { text: 'Certificato medico' }), certStato),
    el('div', { class: 'fields' },
      field('Tipo', select([['', '(nessun certificato)']].concat(L.CERT_TIPI), f.certTipo || '', function (x) { f.certTipo = x; ch(); }), 'Il certificato per attività ludico-motoria non vale per l\'attività sportiva: va segnalato.'),
      field('Data di rilascio', ril), field('Scadenza', scad, 'Un anno dal rilascio, salvo una scadenza diversa stampata sul certificato.')),
    el('h3', { text: 'Consensi e note' }),
    el('div', { class: 'fields' },
      field(L.A_CAMPI.privacy, select([['', '(non indicato)'], 'Sì', 'No'], f.privacy || '', function (x) { f.privacy = x; ch(); })),
      field(L.A_CAMPI.liberatoria, select([['', '(non indicato)'], 'Sì', 'No'], f.liberatoria || '', function (x) { f.liberatoria = x; ch(); })),
      field(L.A_CAMPI.dataModulo, inp('dataModulo', 'date')),
      field(L.A_CAMPI.note, noteArea, 'Non scrivere qui note sanitarie.', 'wide'))]);
  add(v, el('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submit(); } },
    el('h2', { text: cur ? 'Dati principali' : 'Dati essenziali' }),
    el('div', { class: 'fields' }, field(L.A_CAMPI.name, inp('name', 'text', { placeholder: 'Cognome Nome' }), 'Prima il cognome, poi il nome.'), field(L.A_CAMPI.nascita, inp('nascita', 'date')),
      field(L.A_CAMPI.tel, inp('tel', 'tel')), field(L.A_CAMPI.genitore, inp('genitore', 'text', { placeholder: 'Cognome Nome' }))),
    altriDet,
    notes,
    el('div', { class: 'actions' }, save, button('Annulla', function () { go(cur ? 'allieva/' + id : 'allieve'); }),
      el('span', { class: 'spacer' }),
      cur ? button(cur.archiviata ? 'Togli dall\'archivio' : 'Archivia', function () {
        // archiving is undone with one click: no question first, the notice has "Annulla"
        var res = attempt(function () { return L.archiviaAllieva(S.db, id, !cur.archiviata, nowIso()); }), era = cur.archiviata;
        if (res) commit(res, era ? 'Allieva rimessa tra le allieve.' : 'Allieva archiviata: non compare più negli elenchi.').then(function (ok) {
          if (!ok) return;
          go('allieva/' + id);
          toastAnnulla(function () { var r2 = attempt(function () { return L.archiviaAllieva(S.db, id, era, nowIso()); }); if (r2) commit(r2, 'Fatto: è tornata com\'era.').then(function (k) { if (k) go('allieva/' + id); }); });
        });
      }) : null,
      cur && !L.iscrizioniDi(S.db, id).length ? button('Elimina', function () {
        conferma('I dati di ' + cur.name + ' si tolgono dall\'archivio e non si possono riavere (resta solo la copia di sicurezza fatta prima).', { titolo: 'Eliminare ' + cur.name + '?', si: 'Elimina l\'allieva', no: 'Lascia com\'è', pericolo: true }).then(function (si) {
          if (!si) return;
          var res = attempt(function () { return L.eliminaAllieva(S.db, id); });
          if (res) commit(res, 'Allieva eliminata.', true).then(function (ok) { if (ok) go('allieve'); });
        });
      }, 'btn-danger') : null)));
  refresh();

  if (cur) {
    var isc = L.iscrizioniDi(S.db, id).sort(function (a, b) { return (b.inizio || '') < (a.inizio || '') ? -1 : 1; });
    var aperta = isc.filter(L.corrente)[0], imp = S.db.impostazioni;
    add(v, altri('Documenti da stampare (moduli PDF)', [
      el('div', { class: 'row' },
        button('Modulo di iscrizione', function () { scaricaPdf('Modulo_iscrizione_' + cur.name, window.GymPdf.moduloIscrizione(datiPdf(cur, aperta))); }),
        button('Richiesta certificato non agonistico', function () { scaricaPdf('Richiesta_certificato_' + cur.name, window.GymPdf.richiestaCertificato(datiPdf(cur, aperta, 'non_agonistico'))); }),
        button('Richiesta certificato agonistico', function () { scaricaPdf('Richiesta_certificato_agonistico_' + cur.name, window.GymPdf.richiestaCertificato(datiPdf(cur, aperta, 'agonistico'))); })),
      imp.legale && imp.ente ? null : el('p', { class: 'muted small' }, 'Nella richiesta di certificato restano in bianco il legale rappresentante e l\'ente di affiliazione: si scrivono una volta in ', link('Impostazioni', 'impostazioni'), '.')]));
    var fam = L.famiglia(S.db, id);
    if (fam.length) add(v, el('div', { class: 'card' }, el('h2', { text: 'Stessa famiglia' }),
      el('p', { class: 'muted small', text: 'Allieve con lo stesso telefono o lo stesso genitore.' }),
      el('div', { class: 'list' }, fam.map(function (b) {
        var corsi = L.iscrizioniDi(S.db, b.id).filter(L.corrente).map(function (e) { return e.corso || 'corso da definire'; });
        return el('div', { class: 'list-item' }, el('div', { class: 'grow' }, link(b.name, 'allieva/' + b.id, 'name'), b.archiviata ? [' ', chip('Archiviata')] : null,
          el('div', { class: 'muted small', text: [eta(b), corsi.length ? corsi.join(', ') : 'nessuna iscrizione aperta'].filter(Boolean).join(' · ') })), link('Apri', 'allieva/' + b.id, 'btn btn-small', 'Apri la scheda di ' + b.name));
      }))));
  } else v.querySelector('input').focus();
}
/** The actions of a student's card (1.25.0): enrol, pay, certificate, WhatsApp, always in the same place under the name. */
function barraAllieva(a) {
  var aperte = iscrizioniDaPagare(a.id).length;
  return el('div', { class: 'barra-azioni', role: 'toolbar', 'aria-label': 'Azioni per ' + a.name },
    link('Iscrivi a un corso', 'iscrizione/nuova/' + a.id, 'btn btn-primary'),
    el('button', { type: 'button', class: 'btn', text: 'Registra pagamento', disabled: !aperte, title: aperte ? null : 'Nessuna iscrizione aperta', onclick: function () { finestraPagamento({ allievaId: a.id }); } }),
    button('Registra certificato', function () { if (S.dirty) { avviso('Hai modificato i dati dell\'allieva senza salvare: salva (o annulla) prima.'); return; } finestraCertificato(a); }),
    waButton(a.tel, '', 'btn'));
}
/** «Da fare per lei» (1.25.0): what this student needs now, the most urgent first, each with the button that does it. Nothing to do: one quiet line. */
function cardDaFareAllieva(a) {
  var t = today(), st = L.statoCertificato(S.db, a, t), righe = [], aperte = iscrizioniDaPagare(a.id);
  preparaAvvisi();
  function riga(kind, testo, sotto, azioni) { righe.push(el('div', { class: 'fare-riga k-' + kind }, el('span', { class: 'fare-pallino', 'aria-hidden': 'true' }), el('div', { class: 'fare-testo' }, el('span', { class: 'fare-l', text: testo }), sotto ? el('small', { text: sotto }) : null), el('div', { class: 'row' }, azioni))); }
  function avvisaBtn(chiave, cosa) { var r = AVVISI[chiave]; return r && r.tel ? button('Avvisa', function () { avvisa(r); }, 'btn-small', 'Avvisa il genitore: ' + cosa) : null; }
  var regCert = button('Registra certificato', function () { finestraCertificato(a); }, 'btn-small btn-primary');
  if (st.stato === 'SCADUTO') riga('bad', 'Certificato medico scaduto', 'scaduto il ' + C.isoToIt(st.scadenza) + ' (' + giorniTesto(st.giorni) + ')', [regCert, avvisaBtn('certificato|' + a.id, 'certificato scaduto')]);
  else if (st.stato === 'MANCANTE' && aperte.length) riga('bad', 'Manca il certificato medico', st.consegna ? 'era da consegnare entro il ' + C.isoToIt(st.consegna) : 'senza certificato non può allenarsi', [regCert, avvisaBtn('certificato|' + a.id, 'certificato mancante')]);
  else if (st.stato === 'IN SCADENZA') riga('warn', 'Il certificato scade il ' + C.isoToIt(st.scadenza), giorniTesto(st.giorni), [button('Registra il nuovo', function () { finestraCertificato(a); }, 'btn-small'), avvisaBtn('certificato|' + a.id, 'certificato in scadenza')]);
  else if (st.stato === 'IN ATTESA') riga('info', 'Certificato da consegnare entro il ' + C.isoToIt(st.consegna), giorniTesto(st.giorni), [regCert]);
  aperte.forEach(function (e) {
    var s = L.statoIscrizione(S.db, e, t), c = L.conto(S.db, e), corso = e.corso || 'corso da definire';
    if (s.stato === 'SCADUTO') riga('bad', 'Abbonamento ' + (e.tipo || '').toLowerCase() + ' di ' + corso + ' scaduto', 'il ' + C.isoToIt(s.scadenza), [button('Rinnova', function () { rinnova(e.id, 'allieva/' + a.id); }, 'btn-small btn-primary', 'Rinnova ' + corso), avvisaBtn('abbonamento|' + e.id, 'abbonamento scaduto')]);
    else if (s.stato === 'IN SCADENZA') riga('warn', 'Abbonamento di ' + corso + ' in scadenza', 'scade il ' + C.isoToIt(s.scadenza) + ' (' + giorniTesto(s.giorni) + ')', [button('Rinnova', function () { rinnova(e.id, 'allieva/' + a.id); }, 'btn-small', 'Rinnova ' + corso), avvisaBtn('abbonamento|' + e.id, 'abbonamento in scadenza')]);
    else if (s.stato === 'DA COMPLETARE') riga('warn', 'Iscrizione a ' + corso + ' da completare', 'mancano il tipo di abbonamento o la data di inizio', [link('Completa', 'iscrizione/' + e.id, 'btn btn-small btn-primary', 'Completa l\'iscrizione a ' + corso)]);
    if (c.residuo > 0.005) riga('warn', 'Da pagare ' + C.fmtMoney(c.residuo), corso + (c.pagato > 0 ? ' · già pagati ' + C.fmtMoney(c.pagato) : ''), [button('Registra pagamento', function () { finestraPagamento({ iscrizioneId: e.id }); }, 'btn-small btn-primary', 'Registra pagamento: ' + corso)]);
  });
  if (!aperte.length && !a.archiviata) riga('info', 'Non è iscritta a nessun corso', 'per iscriverla: «Iscrivi a un corso», qui sopra', []);
  return el('div', { class: 'card fare fare-allieva' }, el('h2', { text: 'Da fare per lei' }),
    righe.length ? el('div', { class: 'fare-lista' }, righe) : el('p', { class: 'empty', text: 'Tutto in regola: certificato valido, abbonamento attivo, niente da pagare.' }));
}
/** The enrollments of a student, the latest first, each with its state and the buttons to pay, renew, open. */
function cardIscrizioniAllieva(a) {
  var isc = L.iscrizioniDi(S.db, a.id).sort(function (x, y) { return (y.inizio || '') < (x.inizio || '') ? -1 : 1; });
  var card = el('div', { class: 'card', id: 'iscrizioni-allieva' }, el('h2', { text: 'Iscrizioni' })); // a new one: «Iscrivi a un corso» under the name
  if (!isc.length) add(card, el('p', { class: 'empty', text: 'Nessuna iscrizione.' }));
  else add(card, el('div', { class: 'list' }, isc.map(function (e) {
    var s = L.statoIscrizione(S.db, e, today()), c = L.conto(S.db, e), corso = e.corso || 'Corso da definire', paga = c.residuo > 0.005 && !e.annullata && L.corrente(e);
    return el('div', { class: 'list-item' },
      el('div', { class: 'grow' }, el('div', null, el('b', { text: corso }), ' ', chipStato(s.stato), ' ', e.annullata || c.stato === 'SENZA QUOTA' ? null : chipConto(c)),
        el('div', { class: 'muted small', text: [e.giorni.join(', '), e.fascia, e.tipo, e.inizio ? 'dal ' + C.isoToIt(e.inizio) : '', s.scadenza ? 'al ' + C.isoToIt(s.scadenza) : '',
          c.dovuto === null ? '' : 'dovuto ' + C.fmtMoney(c.dovuto), c.residuo > 0.005 ? 'da pagare ' + C.fmtMoney(c.residuo) : ''].filter(Boolean).join(' · ') })),
      el('div', { class: 'row' }, paga ? button('Paga', function () { finestraPagamento({ iscrizioneId: e.id }); }, 'btn-small btn-primary', 'Paga: ' + corso) : null,
        L.corrente(e) && s.scadenza ? button('Rinnova', function () { rinnova(e.id, 'allieva/' + a.id); }, 'btn-small', 'Rinnova l\'iscrizione ' + corso) : null,
        link('Apri', 'iscrizione/' + e.id, 'btn btn-small', 'Apri: ' + corso)));
  })));
  return card;
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
  (on ? conferma('Il bonifico di ' + C.fmtMoney(p.importo) + (nome ? ' di ' + nome : '') + ' del ' + C.isoToIt(p.data) + ' risulta sull\'estratto conto?', { titolo: 'Bonifico arrivato?', si: 'Sì, è arrivato', no: 'Non ancora' }) : Promise.resolve(true)).then(function (si) {
    if (!si) return;
    var res = attempt(function () { return L.verificaPagamento(S.db, id, on, nowIso()); });
    if (res) commit(res, on ? 'Bonifico segnato come verificato.' : 'Verifica annullata.').then(function (ok) { if (ok) render(); });
  });
}
function statoBonifico(p) {
  if (p.daVerificare) return chip('Da verificare', 'warn');
  return L.richiedeVerifica(p.metodo) && p.verificatoIl ? chip('Verificato il ' + C.isoToIt(p.verificatoIl).slice(0, 5), 'ok') : null;
}
function rinnova(iscrId, poi) {
  var e = L.byId(S.db.iscrizioni, iscrId), nome = L.nomeAllieva(S.db, e.allievaId), sc = L.scadenza(e);
  conferma('Il nuovo periodo parte dal ' + C.isoToIt(sc) + ' con gli stessi dati. L\'iscrizione di adesso resta nello storico.', { titolo: 'Rinnovare l\'abbonamento ' + (e.tipo || '').toLowerCase() + ' di ' + nome + ' (' + e.corso + ')?', si: 'Rinnova', no: 'Annulla' }).then(function (si) {
    if (!si) return;
    var res = attempt(function () { return L.rinnova(S.db, iscrId, nowIso(), today()); });
    if (res) commit(res, 'Abbonamento rinnovato.').then(function (ok) { if (ok) go(poi); });
  });
}

/* ---------- Iscrizioni ---------- */
var STATO_ORDINE = { 'SCADUTO': 0, 'IN SCADENZA': 1, 'DA COMPLETARE': 2, 'ATTIVO': 3, 'STORICO': 4, 'ANNULLATO': 5 };
function vIscrizioni(v) {
  var box = el('div', { class: 'scroll-x' }), more = el('div'), count = el('span', { class: 'count' });
  var cols = [
    { h: 'Allieva', key: function (x) { return x.nome; }, cell: function (x) { return link(x.nome, 'iscrizione/' + x.e.id, 'name'); } },
    { h: 'Corso', key: function (x) { return x.e.corso; }, cell: function (x) { return x.e.corso; } },
    { h: 'Giorni', det: true, cls: 'nowrap', cell: function (x) { return x.e.giorni.join(', '); } },
    { h: 'Fascia', det: true, cls: 'nowrap', key: function (x) { return x.e.fascia; }, cell: function (x) { return x.e.fascia; } },
    { h: 'Abbonamento', det: true, key: function (x) { return x.e.tipo; }, cell: function (x) { return x.e.tipo; } },
    { h: 'Inizio', det: true, cls: 'nowrap mono', key: function (x) { return x.e.inizio; }, cell: function (x) { return C.isoToIt(x.e.inizio); } },
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
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.iscrizioni.length ? 'Nessuna iscrizione corrisponde ai filtri.' : 'Non ci sono ancora iscrizioni: si aggiungono con «Nuova iscrizione» in alto.' })); return; }
    var l = elenco(cols, rows, S.fi.sort, draw, function (x) { return { class: 'link', 'data-ant': 'iscrizione:' + x.e.id, onclick: function () { go('iscrizione/' + x.e.id); } }; }, S.fi);
    add(box, l.table); add(more, l.more);
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: S.fi.q, placeholder: 'Nome dell\'allieva o corso…', oninput: function () { S.fi.q = search.value; S.fi.tutte = false; later(); } });
  var corsi = [['', 'Tutti i corsi']].concat(S.db.liste.corsi);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Iscrizioni' })));
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
    { h: 'Certificato', key: function (x) { return L.statoCertificato(S.db, x.allieva, t).scadenza || null; }, cell: function (x) { return [chipTipoCert(x.allieva), x.allieva.certTipo ? ' ' : null, chipCert(L.statoCertificato(S.db, x.allieva, t))]; } }
  ].filter(Boolean);
  function titolo() { return (corso === null ? 'Tutti i corsi' : 'Corso ' + (corso || 'da definire')) + (S.fc.giorno ? ' · ' + GIORNO_NOME[S.fc.giorno] : ''); }
  function sotto() { return 'Stagione ' + S.db.impostazioni.stagione + ' · ' + (rows.length === 1 ? '1 iscritta' : rows.length + ' iscritte') + ' · stampato il ' + C.isoToIt(t); }
  function draw() {
    rows = L.iscritte(S.db, { corso: corso === null ? '' : corso, giorno: S.fc.giorno }, t);
    if (corso === '') rows = rows.filter(function (x) { return !x.iscrizione.corso; });
    count.textContent = rows.length === 1 ? '1 iscritta' : rows.length + ' iscritte';
    clear(box); clear(more);
    if (!rows.length) add(box, el('p', { class: 'empty', text: 'Nessuna iscrizione aperta per questa scelta.' }));
    else { var l = elenco(cols, rows, S.fc.sort, draw, function (x) { return { class: 'link', 'data-ant': 'allieva:' + x.allieva.id, onclick: function () { go('allieva/' + x.allieva.id); } }; }, S.fc); add(box, l.table); add(more, l.more); }
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
  var imp0 = S.db.impostazioni, propCorso = !cur && S.db.liste.corsi.indexOf(imp0.corsoProposto) >= 0 ? imp0.corsoProposto : '';
  var f = cur ? JSON.parse(JSON.stringify(cur)) : { allievaId: args[1] || '', corso: propCorso, giorni: [], fascia: '', pacchetto: '', tipo: imp0.tipoProposto || '', inizio: today(), quota: null, annullata: false, storica: false, note: '' };
  var giorniScelti = false, orarioScelto = false, days, fascia, selCorso, selTipo; // what the person chose herself is never overwritten by the usual days of the course
  /** After a proposal: the controls show the values of f. */
  function allineaCampi() {
    if (selCorso) selCorso.value = f.corso || ''; if (selTipo) selTipo.value = f.tipo || ''; if (fascia) fascia.value = f.fascia || '';
    if (days) [].forEach.call(days.querySelectorAll('input'), function (c, i) { c.checked = f.giorni.indexOf(L.GIORNI[i]) >= 0; });
    if (pac && f.pacchetto) { pac.value = f.pacchetto; }
  }
  /** A new enrollment: the usual days and time of the course chosen (Impostazioni › Preferenze). */
  function proponiOrario() {
    var o = cur ? null : L.orarioCorso(S.db, f.corso);
    if (!o) return;
    if (!giorniScelti && o.giorni.length) { f.giorni = o.giorni.slice(); if (days) [].forEach.call(days.querySelectorAll('input'), function (c, i) { c.checked = f.giorni.indexOf(L.GIORNI[i]) >= 0; }); }
    if (!orarioScelto && o.fascia) { f.fascia = o.fascia; if (fascia) fascia.value = o.fascia; }
  }
  /** A student already known (from her card, or chosen in the list): her last enrollment proposes course, days, time, package and type, if the person has not chosen them. */
  var propostaDa = el('p', { class: 'muted small proposta' });
  function proponiDallUltima() {
    if (cur) return;
    var ultima = f.allievaId ? L.iscrizioniDi(S.db, f.allievaId).filter(function (x) { return !x.annullata && x.corso; }).sort(function (x, y) { return (y.inizio || '') < (x.inizio || '') ? -1 : 1; })[0] : null;
    propostaDa.textContent = '';
    if (!ultima) return;
    if (!giorniScelti && !orarioScelto && (!f.corso || f.corso === propCorso)) {
      f.corso = ultima.corso; f.giorni = ultima.giorni.slice(); f.fascia = ultima.fascia || ''; if (ultima.pacchetto) f.pacchetto = ultima.pacchetto; if (!f.tipo || f.tipo === (imp0.tipoProposto || '')) f.tipo = ultima.tipo || f.tipo;
      propostaDa.textContent = 'Proposti dall\'ultima iscrizione: ' + [ultima.corso, ultima.giorni.join(', '), ultima.fascia, ultima.tipo].filter(Boolean).join(' · ') + '. Si possono cambiare.';
    }
  }
  proponiDallUltima();
  proponiOrario();
  f.quota = typeof f.quota === 'number' ? String(f.quota).replace('.', ',') : '';
  f.quotaIscrizione = typeof f.quotaIscrizione === 'number' ? String(f.quotaIscrizione).replace('.', ',') : '';
  var al = L.byId(S.db.allieve, f.allievaId), back = al ? 'allieva/' + al.id : 'iscrizioni';
  var nuovoA = !cur && !args[1], fA = { name: '', nascita: '', tel: '', genitore: '', privacy: 'Sì', liberatoria: 'Sì' }; // "Nuova iscrizione" from the top: the student can be a new one, saved together with the enrollment
  function nuovaAllieva() { return nuovoA && !f.allievaId; }
  // The certificate: every enrollment needs one, and many bring it a few days later, so "Lo porta dopo" is the usual answer: the program waits for it ("in attesa").
  var cert = { certTipo: '', certRilascio: '', certScadenza: '' }, certModo = 'attesa', certAuto = true;
  function studente() { return nuovaAllieva() ? null : L.byId(S.db.allieve, f.allievaId); }
  /** Is the question asked? Not when editing, not before the student is chosen, not when she has a valid certificate already. */
  function certChiesto() {
    if (cur) return false;
    if (nuovaAllieva()) return true;
    var a = studente(); if (!a) return false;
    var st = L.statoCertificato(S.db, a, today());
    return !(st.stato === 'VALIDO' || st.stato === 'IN SCADENZA');
  }
  function certDati() { return certChiesto() && certModo === 'consegnato' ? cert : null; }
  function verifica() { return !cur ? L.controllaNuovaIscrizione(S.db, nuovaAllieva() ? fA : null, f, today(), certDati()) : L.controllaIscrizione(S.db, f, id); }
  var altriIsc = null, pacchettoScelto = !!f.pacchetto, notes = el('div', { class: 'notes' }), info = el('div', { class: 'info-line' }), save = button(cur ? 'Salva le modifiche' : 'Salva l\'iscrizione', submit, 'btn-primary'), shown = !!cur;
  var pac = select([['', '(nessuna)']].concat(S.db.tariffario.map(function (p) { return p.chiave; })), f.pacchetto, function (x) { f.pacchetto = x; pacchettoScelto = !!x; ch(); });
  var quota = input(f, 'quota', 'text', ch, { inputmode: 'decimal' });
  // For a new enrollment the registration fee of the price list is proposed, until the user writes her own.
  var feeAuto = !cur, fee = input(f, 'quotaIscrizione', 'text', function () { feeAuto = false; ch(); }, { inputmode: 'decimal' });
  function refresh() {
    if (!certTipoScelto && typeof certTipo !== 'undefined' && certTipo) { cert.certTipo = tipoCertPerCorso(f.corso); certTipo.value = cert.certTipo; } // the course proposes the type of certificate (agonistico for the competitive ones)
    if (!pacchettoScelto) { var sug = C.suggestPacchetto(S.db.tariffario, f.corso, f.giorni.length || null); if (sug !== f.pacchetto) { f.pacchetto = sug; pac.value = sug; } }
    if (feeAuto) { var tar = S.db.tariffario.filter(function (p) { return p.chiave === f.pacchetto; })[0]; f.quotaIscrizione = tar && tar.iscrizione ? String(tar.iscrizione).replace('.', ',') : ''; fee.value = f.quotaIscrizione; }
    var chk = verifica(), o = L.controllaIscrizione(S.db, f, id).valori, sc = L.scadenza(o), listino = C.quotaTariffario(S.db.tariffario, o.pacchetto, o.tipo);
    if (nuovoA) save.textContent = nuovaAllieva() ? (L.serveIscrizione(f) ? 'Salva allieva e iscrizione' : 'Salva solo l\'allieva') : 'Salva l\'iscrizione';
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di salvare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    if (shown && nuovaAllieva() && !L.serveIscrizione(f) && !chk.errors.length) add(notes, note('', 'Non hai scelto il corso: si salva solo l\'allieva, senza iscrizione.'));
    segnaCampi(v, notes, shown ? chk.errors : []);
    save.disabled = shown && chk.errors.length > 0;
    aggiornaCert();
    if (shown && altriIsc && chk.errors.some(function (e) { return /Quota/.test(e); })) altriIsc.open = true;
    quota.placeholder = listino === null ? '' : 'da tariffario: ' + C.fmtMoney(listino);
    clear(info);
    add(info, el('span', null, 'Scadenza: ', el('b', { text: sc ? C.isoToIt(sc) : 'da definire' })),
      el('span', { class: 'solo-det' }, 'Quota da tariffario: ', el('b', { text: listino === null ? 'non prevista' : C.fmtMoney(listino) })),
      typeof o.quota === 'number' ? el('span', { class: 'solo-det' }, 'Quota concordata: ', el('b', { text: C.fmtMoney(o.quota) })) : null,
      el('span', null, 'Totale dovuto: ', el('b', { text: L.dovuto(S.db, o) === null ? 'da definire' : C.fmtMoney(L.dovuto(S.db, o)) })));
  }
  function ch() { touch(); shown = true; refresh(); }
  var certScad = input(cert, 'certScadenza', 'date', function () { certAuto = false; ch(); });
  var certRil = input(cert, 'certRilascio', 'date', function () { if (certAuto && C.isIso(cert.certRilascio)) { cert.certScadenza = C.addYears(cert.certRilascio, 1); certScad.value = cert.certScadenza; } ch(); });
  var certTipoScelto = false, certTipo = select([['', '(scegli il tipo)']].concat(L.CERT_TIPI.map(function (t) { return [t, CERT_TIPO_NOME[t] || t]; })), '', function (x) { certTipoScelto = true; cert.certTipo = x; ch(); });
  var certInfo = el('p'), certNota = el('p', { class: 'muted small' });
  var certScelta = field('Il certificato medico', select([['attesa', 'Lo porta dopo (resta "in attesa")'], ['consegnato', 'Lo ha portato adesso']], certModo, function (x) { certModo = x; ch(); }));
  var certCampi = el('div', { class: 'fields' }, field('Tipo di certificato', certTipo), field('Data di rilascio', certRil), field('Scadenza', certScad, 'Un anno dal rilascio, salvo una scadenza diversa stampata sul certificato.'));
  var boxCert = el('div', { class: 'cert-blocco' }, el('h2', { text: 'Certificato medico' }), certInfo, certScelta, certNota, certCampi);
  function aggiornaCert() {
    var chiesto = certChiesto(), a = studente(), st = a ? L.statoCertificato(S.db, a, today()) : null;
    var valido = !!st && (st.stato === 'VALIDO' || st.stato === 'IN SCADENZA'), atteso = !!st && st.stato === 'IN ATTESA';
    boxCert.hidden = !!cur || (!nuovaAllieva() && !a);
    clear(certInfo);
    if (valido) add(certInfo, certBreve(a, st), ' valido fino al ' + C.isoToIt(st.scadenza) + '.');
    if (atteso) add(certInfo, chipCert(st), ' già atteso: da consegnare entro il ' + C.isoToIt(st.consegna) + '.');
    certInfo.hidden = !valido && !atteso;
    certScelta.hidden = !chiesto;
    certCampi.hidden = !chiesto || certModo !== 'consegnato';
    certNota.hidden = !chiesto || certModo !== 'attesa' || atteso;
    var termine = L.piuGiorni(C.isIso(f.inizio) ? f.inizio : today(), L.giorniAttesaCert(S.db));
    certNota.textContent = termine < today()
      ? 'Il termine per consegnare il certificato (' + C.isoToIt(termine) + ') è già passato: risulterà tra i certificati mancanti finché non lo registri.'
      : 'Si può iscrivere lo stesso: il certificato risulterà "in attesa" fino al ' + C.isoToIt(termine) + ', poi tra i certificati mancanti. Quando arriva lo registri da Scadenze o dalla scheda dell\'allieva.';
  }
  function submit() {
    var chk = verifica();
    shown = true;
    if (chk.errors.length) { refresh(); portaAlErrore(v, notes); return; }
    var res = attempt(function () { return !cur ? L.salvaNuovaIscrizione(S.db, nuovaAllieva() ? fA : null, f, nowIso(), certDati()) : L.salvaIscrizione(S.db, id, f, nowIso()); });
    if (!res) return;
    if (cur && !res.registro.length) { toast('Nessuna modifica da salvare.'); go(back); return; }
    var msg = cur ? 'Modifiche salvate.' : nuovoA && nuovaAllieva() ? (res.id ? 'Allieva e iscrizione salvate.' : 'Allieva salvata.') : 'Iscrizione salvata.';
    if (!cur) { // the certificate that is still to come is said clearly, with the day
      var ac = L.byId(res.db.allieve, res.idAllieva), sc2 = ac ? L.statoCertificato(res.db, ac, today()) : null;
      if (sc2 && sc2.stato === 'IN ATTESA') msg += ' Certificato medico atteso entro il ' + C.isoToIt(sc2.consegna) + '.';
    }
    // from the top the person lands on the new enrollment (where the payment is registered); from a student's page, back on the student
    commit(res, msg).then(function (ok) { if (!ok) return; if (!cur && res.id) S.pagaSubito = res.id; go(nuovoA ? (res.id ? 'iscrizione/' + res.id : 'allieva/' + res.idAllieva) : 'allieva/' + f.allievaId); });
  }
  function check(key, label) { var c = el('input', { type: 'checkbox', checked: f[key] === true, onchange: function () { f[key] = c.checked; ch(); } }); return el('label', { class: 'check' }, c, el('span', { text: label })); }
  days = el('div', { class: 'days' }, L.GIORNI.map(function (d) {
    var c = el('input', { type: 'checkbox', checked: f.giorni.indexOf(d) >= 0, onchange: function () { giorniScelti = true; f.giorni = L.GIORNI.filter(function (x) { return x === d ? c.checked : f.giorni.indexOf(x) >= 0; }); ch(); } });
    return el('label', null, c, d);
  }));
  var fasceId = 'fasce' + (S.nextId++); fascia = input(f, 'fascia', 'text', function () { orarioScelto = true; ch(); }, { list: fasceId, placeholder: 'es. 17:00-18:30' });
  var noteArea = el('textarea', { value: f.note || '', oninput: function () { f.note = noteArea.value; ch(); } });
  var elencoAllieve = L.cercaAllieve(S.db, '', 'tutte').map(function (a) { return [a.id, a.name + ' (n. ' + a.id + ')']; });
  var boxA = el('div', null, el('div', { class: 'fields' }, field(L.A_CAMPI.name, input(fA, 'name', 'text', ch, { placeholder: 'Cognome Nome' }), 'Prima il cognome, poi il nome.'), field(L.A_CAMPI.nascita, input(fA, 'nascita', 'date', ch)),
      field(L.A_CAMPI.tel, input(fA, 'tel', 'tel', ch)), field(L.A_CAMPI.genitore, input(fA, 'genitore', 'text', ch, { placeholder: 'Cognome Nome' }))),
    el('p', { class: 'muted small', text: 'Codice fiscale, indirizzo, email e consensi si aggiungono dopo, dalla scheda dell\'allieva.' }));
  var allievaCtl = al && (cur || args[1])
    ? el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Allieva' }), el('div', null, link(al.name, 'allieva/' + al.id, 'name'), ' ', chip('n. ' + al.id)))
    : nuovoA ? field('Allieva', select([['', 'Nuova allieva']].concat(elencoAllieve), f.allievaId, function (x) { f.allievaId = x; boxA.hidden = !!x; proponiDallUltima(); proponiOrario(); allineaCampi(); touch(); refresh(); }), 'Scegli un\'allieva già presente, oppure lascia "Nuova allieva" e scrivi i suoi dati.')
    : field('Allieva', select([['', '(scegli l\'allieva)']].concat(elencoAllieve), f.allievaId, function (x) { f.allievaId = x; ch(); }));

  add(v, link(al ? 'Scheda di ' + al.name : 'Tutte le iscrizioni', back, 'back'));
  add(v, el('div', { class: 'head-row' }, el('h1', { text: cur ? 'Iscrizione n. ' + cur.id : 'Nuova iscrizione' }), cur ? chipStato(L.statoIscrizione(S.db, cur, today()).stato) : null));
  add(v, el('form', { class: 'card', onsubmit: function (e) { e.preventDefault(); submit(); } },
    nuovoA ? el('h2', { text: 'Allieva' }) : null, nuovoA ? el('div', { class: 'fields' }, allievaCtl) : null, nuovoA ? boxA : null, nuovoA ? el('h2', { text: 'Iscrizione' }) : null,
    el('div', { class: 'fields' }, nuovoA ? null : allievaCtl,
      field(L.I_CAMPI.corso, selCorso = select([['', '(scegli il corso)']].concat(S.db.liste.corsi), f.corso, function (x) { f.corso = x; proponiOrario(); ch(); })),
      field(L.I_CAMPI.tipo, selTipo = select([['', '(da definire)']].concat(L.TIPI.map(function (t) { return t.nome; })), f.tipo, function (x) { f.tipo = x; ch(); })),
      el('div', { class: 'field wide2' }, el('span', { class: 'lab', text: L.I_CAMPI.giorni }), days),
      field(L.I_CAMPI.inizio, input(f, 'inizio', 'date', ch))),
    propostaDa,
    info,
    boxCert,
    altriIsc = altri('Altri dettagli (facoltativi)', [
      el('div', { class: 'fields' },
        el('div', { class: 'field' }, el('label', { for: fascia.id = 'f' + (S.nextId++), text: L.I_CAMPI.fascia }), fascia, el('datalist', { id: fasceId }, S.db.liste.fasce.map(function (x) { return el('option', { value: x }); }))),
        field(L.I_CAMPI.pacchetto, pac, 'Proposta in base a corso e giorni: puoi cambiarla.'),
        field(L.I_CAMPI.quota, quota, 'Solo se diversa dal tariffario.'),
        field(L.I_CAMPI.quotaIscrizione, fee, 'Una volta sola: si somma alla quota. Nei rinnovi resta vuota.'),
        field(L.I_CAMPI.note, noteArea, null, 'wide')),
      cur ? el('div', { class: 'row' }, check('annullata', 'Annullata (iscrizione fatta per errore o ritirata)'), check('storica', 'Chiusa: periodo concluso, resta nello storico')) : null]),
    notes,
    el('div', { class: 'actions' }, save, button('Annulla', function () { go(back); }), el('span', { class: 'spacer' }),
      cur && L.corrente(cur) && L.scadenza(cur) ? button('Rinnova', function () { rinnova(id, 'allieva/' + cur.allievaId); }) : null,
      cur ? button('Elimina', function () {
        conferma('Per un abbonamento finito è meglio «Chiusa» (in Altri dettagli): resta nello storico. Eliminata, l\'iscrizione non si può riavere.', { titolo: 'Eliminare questa iscrizione?', si: 'Elimina l\'iscrizione', no: 'Lascia com\'è', pericolo: true }).then(function (si) {
          if (!si) return;
          var res = attempt(function () { return L.eliminaIscrizione(S.db, id); });
          if (res) commit(res, 'Iscrizione eliminata.', true).then(function (ok) { if (ok) go(back); });
        });
      }, 'btn-danger') : null)));
  refresh();
  if (cur) add(v, cardPagamenti(cur, al));
}
/** Payments of one enrollment: what is due, what was paid, the list with its receipts, and the form for a new one. */
function cardPagamenti(e, al) {
  var c = L.conto(S.db, e), lista = L.pagamentiDi(S.db, e.id), metodi = S.db.liste.metodi;
  var mp = S.db.impostazioni.metodoProposto, f = { iscrizioneId: e.id, data: today(), importo: c.residuo > 0.005 ? String(c.residuo).replace('.', ',') : '', metodo: metodi.indexOf(mp) >= 0 ? mp : '', note: '' };
  var notes = el('div', { class: 'notes' }), registra = button('Registra il pagamento', submit, 'btn-primary'), shown = false, campoImporto = null;
  // just enrolled (from «Nuova iscrizione» or «Iscrivi a un corso»): the cursor waits on the amount, the payment is the next thing to do
  if (S.pagaSubito === e.id) { S.pagaSubito = null; setTimeout(function () { if (campoImporto && document.body.contains(campoImporto) && c.residuo > 0.005) { campoImporto.focus(); campoImporto.select(); } }, 0); }
  function refresh() {
    var chk = L.controllaPagamento(S.db, f, today());
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere prima di registrare', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    segnaCampi(document.getElementById('pagamenti') || notes, notes, shown ? chk.errors : []);
  }
  function ch() { shown = true; refresh(); }
  function submit() {
    shown = true;
    if (S.dirty) { avviso('Hai modificato l\'iscrizione senza salvare: salva (o annulla) prima di registrare il pagamento.'); return; }
    var chk = L.controllaPagamento(S.db, f, today());
    if (chk.errors.length) { refresh(); portaAlErrore(document.getElementById('pagamenti') || notes, notes); return; }
    (chk.warnings.length ? conferma('- ' + chk.warnings.join('\n- '), { titolo: 'Registrare lo stesso il pagamento?', si: 'Registra il pagamento', no: 'Correggo prima' }) : Promise.resolve(true)).then(function (si) {
      if (!si) return;
      var res = attempt(function () { return L.salvaPagamento(S.db, f, nowIso()); });
      if (res) commit(res, 'Pagamento registrato.').then(function (ok) { if (ok) go('iscrizione/' + e.id); });
    });
  }
  return el('div', { class: 'card', id: 'pagamenti' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Pagamenti' }), e.annullata ? null : chipConto(c)),
    el('div', { class: 'info-line' }, el('span', null, 'Dovuto: ', el('b', { text: c.dovuto === null ? 'da definire' : C.fmtMoney(c.dovuto) })), el('span', null, 'Pagato: ', el('b', { text: C.fmtMoney(c.pagato) })),
      c.residuo === null ? null : el('span', null, c.residuo < -0.005 ? 'Eccedenza: ' : 'Resta da pagare: ', el('b', { text: C.fmtMoney(Math.abs(c.residuo)) }))),
    lista.length ? el('div', { class: 'scroll-x' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Data' }), el('th', { class: 'num', text: 'Importo' }), el('th', { text: 'Metodo' }), el('th', { text: 'Ricevuta n.' }), el('th', { text: 'Note' }), el('th', null, el('span', { class: 'sr-only', text: 'Azioni' })))),
      el('tbody', null, lista.map(function (p) {
        return el('tr', null, el('td', { class: 'nowrap mono', text: C.isoToIt(p.data) }), el('td', { class: 'num', text: C.fmtMoney(p.importo) }), el('td', null, p.metodo, statoBonifico(p) ? [' ', statoBonifico(p)] : null), el('td', { class: 'nowrap', text: p.ricevuta }), el('td', { class: 'muted', text: p.note }),
          el('td', { class: 'nowrap' }, L.richiedeVerifica(p.metodo) ? [button(p.daVerificare ? 'Segna verificato' : 'Annulla verifica', function () { verifica(p.id, !!p.daVerificare); }, 'btn-small' + (p.daVerificare ? ' btn-primary' : '')), ' '] : null, button('Ricevuta (PDF)', function () { ricevutaPdf(p.id); }, 'btn-small'), ' ', button('Elimina', function () {
            conferma('Il numero di ricevuta ' + p.ricevuta + ' non verrà riusato.', { titolo: 'Eliminare il pagamento di ' + C.fmtMoney(p.importo) + ' del ' + C.isoToIt(p.data) + '?', si: 'Elimina il pagamento', no: 'Lascia com\'è', pericolo: true }).then(function (si) {
              if (!si) return;
              var res = attempt(function () { return L.eliminaPagamento(S.db, p.id); });
              if (res) commit(res, 'Pagamento eliminato.', true).then(function (ok) { if (ok) go('iscrizione/' + e.id); });
            });
          }, 'btn-small btn-danger')));
      })))) : el('p', { class: 'empty', text: 'Nessun pagamento registrato.' }),
    el('h3', { text: 'Nuovo pagamento' }),
    el('div', { class: 'fields' }, field('Data del pagamento', input(f, 'data', 'date', ch)), field('Importo', campoImporto = input(f, 'importo', 'text', ch, { inputmode: 'decimal' })),
      field('Metodo', select([['', '(scegli)']].concat(metodi), '', function (x) { f.metodo = x; ch(); }))),
    altri('Aggiungi una nota', [el('div', { class: 'fields' }, field('Note del pagamento', input(f, 'note', 'text', ch)))]),
    notes, el('div', { class: 'actions' }, registra));
}
/** The enrollments a payment can be for: open and not cancelled. */
function iscrizioniDaPagare(allievaId) { return L.iscrizioniDi(S.db, allievaId).filter(function (e) { return L.corrente(e) && !e.annullata; }); }
/** The method of the last payment of this student or of her family (same telephone or parent): the family pays the same way. */
function ultimoMetodo(allievaId) {
  var ids = [allievaId].concat(L.famiglia(S.db, allievaId).map(function (b) { return b.id; })), ultimo = null;
  ids.forEach(function (id) { L.iscrizioniDi(S.db, id).forEach(function (e) { L.pagamentiDi(S.db, e.id).forEach(function (p) { if (!ultimo || p.data > ultimo.data) ultimo = p; }); }); });
  return ultimo && S.db.liste.metodi.indexOf(ultimo.metodo) >= 0 ? ultimo.metodo : '';
}
/**
 * Registra pagamento (1.25.0): from any page (the top bar, Alt+P, the student's card, the enrollment), without leaving the page.
 * o = { allievaId, iscrizioneId } to start from a student or an enrollment; without it the first choice is the student (those with something left to pay first).
 * Proposed: the amount left, the method chosen in Preferenze or else the one of the last payment of the family, today.
 */
function finestraPagamento(o) {
  o = o || {};
  if (!S.db || S.bloccato) return;
  if (S.dirty) { avviso('Hai modificato qualcosa in questa pagina: salva (o annulla) prima di registrare un pagamento.'); return; }
  var e0 = o.iscrizioneId ? L.byId(S.db.iscrizioni, o.iscrizioneId) : null;
  var f = { allievaId: o.allievaId || (e0 ? e0.allievaId : ''), iscrizioneId: e0 ? e0.id : '', data: today(), importo: '', metodo: '', note: '' }, shown = false;
  var residuo = function (e) { var c = L.conto(S.db, e); return c.residuo > 0.005 ? c.residuo : 0; };
  var allieve = S.db.allieve.filter(function (a) { return !a.archiviata && iscrizioniDaPagare(a.id).length; }).map(function (a) { return { a: a, r: iscrizioniDaPagare(a.id).reduce(function (t, e) { return t + residuo(e); }, 0) }; })
    .sort(function (x, y) { return (y.r > 0) - (x.r > 0) || C.norm(x.a.name).localeCompare(C.norm(y.a.name)); });
  var selA = select([['', '(scegli l\'allieva)']].concat(allieve.map(function (x) { return [x.a.id, x.a.name + (x.r > 0 ? ' · da pagare ' + C.fmtMoney(x.r) : '')]; })), f.allievaId, function (x) { f.allievaId = x; f.iscrizioneId = ''; proponi(); disegna(); });
  var boxI = el('div'), info = el('div', { class: 'info-line' }), notes = el('div', { class: 'notes' }), campoImp = input(f, 'importo', 'text', ch, { inputmode: 'decimal' });
  var selM = select([['', '(scegli)']].concat(S.db.liste.metodi), '', function (x) { f.metodo = x; ch(); });
  function proponi() {
    var isc = f.allievaId ? iscrizioniDaPagare(f.allievaId) : [];
    if (!f.iscrizioneId && isc.length) f.iscrizioneId = (isc.filter(function (e) { return residuo(e) > 0; })[0] || isc[0]).id;
    var e = f.iscrizioneId ? L.byId(S.db.iscrizioni, f.iscrizioneId) : null, r = e ? residuo(e) : 0;
    f.importo = r ? String(r).replace('.', ',') : ''; campoImp.value = f.importo;
    var mp = S.db.impostazioni.metodoProposto;
    f.metodo = S.db.liste.metodi.indexOf(mp) >= 0 ? mp : f.allievaId ? ultimoMetodo(f.allievaId) : ''; selM.value = f.metodo;
  }
  function disegna() {
    clear(boxI); clear(info);
    var isc = f.allievaId ? iscrizioniDaPagare(f.allievaId) : [];
    if (f.allievaId && !isc.length) add(boxI, note('warn', 'Questa allieva non ha iscrizioni aperte: prima iscrivila a un corso.'));
    if (isc.length > 1) add(boxI, field('Iscrizione', select(isc.map(function (e) { var r = residuo(e); return [e.id, (e.corso || 'Corso da definire') + ' · ' + (e.tipo || 'tipo da definire') + (r ? ' · resta ' + C.fmtMoney(r) : ' · saldata')]; }), f.iscrizioneId, function (x) { f.iscrizioneId = x; proponi(); disegna(); })));
    var e = f.iscrizioneId ? L.byId(S.db.iscrizioni, f.iscrizioneId) : null;
    if (e) { var c = L.conto(S.db, e); add(info, el('span', null, (e.corso || 'Corso da definire') + ' · ' + (e.tipo || '')), el('span', null, 'Dovuto: ', el('b', { text: c.dovuto === null ? 'da definire' : C.fmtMoney(c.dovuto) })), el('span', null, 'Pagato: ', el('b', { text: C.fmtMoney(c.pagato) })), c.residuo === null ? null : el('span', null, 'Resta: ', el('b', { text: C.fmtMoney(Math.max(0, c.residuo)) }))); }
    refresh();
  }
  function refresh() {
    clear(notes);
    if (!shown || !f.iscrizioneId) return;
    var chk = L.controllaPagamento(S.db, f, today());
    if (chk.errors.length) add(notes, note('bad', 'Da correggere prima di registrare', chk.errors));
    segnaCampi(corpo, notes, chk.errors);
  }
  function ch() { shown = true; refresh(); }
  function registra() {
    shown = true;
    if (!f.iscrizioneId) { clear(notes); add(notes, note('bad', 'Scegli l\'allieva e l\'iscrizione.')); return; }
    var chk = L.controllaPagamento(S.db, f, today());
    if (chk.errors.length) { refresh(); portaAlErrore(corpo, notes); return; }
    (chk.warnings.length ? conferma('- ' + chk.warnings.join('\n- '), { titolo: 'Registrare lo stesso il pagamento?', si: 'Registra il pagamento', no: 'Correggo prima' }) : Promise.resolve(true)).then(function (si) {
      if (!si) return;
      var res = attempt(function () { return L.salvaPagamento(S.db, f, nowIso()); });
      if (!res) return;
      var nuovo = res.db.pagamenti[res.db.pagamenti.length - 1];
      commit(res, 'Pagamento registrato: ricevuta ' + nuovo.ricevuta + '.').then(function (ok) {
        if (!ok) return;
        d.close(); render();
        toastAzione('Scarica la ricevuta', function () { ricevutaPdf(nuovo.id); });
      });
    });
  }
  var corpo = el('form', { class: 'stack', onsubmit: function (ev) { ev.preventDefault(); registra(); } },
    o.allievaId || e0 ? el('p', { class: 'muted', text: (L.byId(S.db.allieve, f.allievaId) || {}).name || '' }) : field('Allieva', selA),
    boxI, info,
    el('div', { class: 'fields' }, field('Importo', campoImp), field('Metodo', selM), field('Data del pagamento', input(f, 'data', 'date', ch))),
    field('Note del pagamento (facoltative)', input(f, 'note', 'text', ch)),
    notes,
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn btn-primary', text: 'Registra il pagamento' }), button('Annulla', function () { d.close(); })));
  if (f.allievaId) proponi();
  var d = modale('Registra pagamento', corpo);
  disegna();
  (f.allievaId ? campoImp : selA).focus();
  if (f.allievaId) campoImp.select();
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
    { h: 'Ricevuta n.', det: true, cls: 'nowrap', key: function (x) { return x.pagamento.ricevuta; }, cell: function (x) { return x.pagamento.ricevuta; } },
    { h: 'Note', det: true, cell: function (x) { return x.pagamento.note; } },
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
  add(v, el('div', { class: 'card', id: 'incassi' }, el('h2', { text: 'Incassi' }),
    el('div', { class: 'toolbar' }, field('Dal', input(f, 'dal', 'date', draw), null, 'narrow'), field('Al', input(f, 'al', 'date', draw), null, 'narrow'),
      field('Metodo', select([['', 'Tutti i metodi']].concat(S.db.liste.metodi), f.metodo, function (x) { f.metodo = x; draw(); }), null, 'narrow'), field('Cerca', search)),
    tot, box, more));
  var colsD = [
    { h: 'Allieva', key: function (x) { return x.allieva.name; }, cell: function (x) { return link(x.allieva.name, 'iscrizione/' + x.iscrizione.id, 'name'); } },
    { h: 'Corso', key: function (x) { return x.iscrizione.corso; }, cell: function (x) { return x.iscrizione.corso; } },
    { h: 'Abbonamento', det: true, key: function (x) { return x.iscrizione.tipo; }, cell: function (x) { return x.iscrizione.tipo; } },
    { h: 'Inizio', det: true, cls: 'nowrap mono', key: function (x) { return x.iscrizione.inizio; }, cell: function (x) { return C.isoToIt(x.iscrizione.inizio); } },
    { h: 'Dovuto', det: true, cls: 'num', key: function (x) { return x.conto.dovuto; }, cell: function (x) { return C.fmtMoney(x.conto.dovuto); } },
    { h: 'Pagato', det: true, cls: 'num', key: function (x) { return x.conto.pagato; }, cell: function (x) { return C.fmtMoney(x.conto.pagato); } },
    { h: 'Resta', cls: 'num', key: function (x) { return x.conto.residuo; }, cell: function (x) { return C.fmtMoney(x.conto.residuo); } },
    { h: 'Telefono', cls: 'nowrap mono', cell: function (x) { return x.allieva.tel; } }
  ];
  var boxD = el('div', { class: 'scroll-x' });
  function drawD() { // the first ten rows of the sorted list; the others on request
    clear(boxD);
    var tutte = sorted(d.righe, colsD, f.sortD), max = 10, mostra = f.tutteD ? tutte : tutte.slice(0, max);
    add(boxD, tabella(colsD, mostra, f.sortD, drawD, function (x) { return { class: 'link', 'data-ant': 'iscrizione:' + x.iscrizione.id, onclick: function () { go('iscrizione/' + x.iscrizione.id); } }; }));
    if (tutte.length > max) add(boxD, el('div', { class: 'row' }, button(f.tutteD ? 'Mostra solo le prime ' + max : 'Mostra tutte (' + tutte.length + ')', function () { f.tutteD = !f.tutteD; drawD(); }, 'btn-small')));
  }
  add(v, el('div', { class: 'card', id: 'da-incassare' }, el('h2', { text: 'Da incassare' }),
    d.righe.length ? [el('div', { class: 'info-line' }, el('span', null, plurale(d.righe.length, 'iscrizione', 'iscrizioni') + ' con un residuo · totale: ', el('b', { text: C.fmtMoney(d.totale) }))), boxD]
      : el('p', { class: 'empty', text: 'Niente da incassare: tutte le iscrizioni con una quota risultano saldate.' }),
    el('p', { class: 'muted small', text: 'Sono contate le iscrizioni non annullate che hanno una quota. Un clic sulla riga apre l\'iscrizione, dove si registra il pagamento.' })));
  draw();
  if (d.righe.length) drawD();
}

/* ---------- certificati medici: tipo in vista, documento scansionato, fotografato o scelto ---------- */
function urlDocumento(file) { return '/api/documento/' + file + '?t=' + encodeURIComponent(TOKEN); }
function inviaDocumento(blob) {
  return fetch('/api/documento', { method: 'POST', headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob }).then(function (r) {
    return r.json().catch(function () { return null; }).then(function (j) {
      if (!r.ok) throw new Error((j && j.errore) || 'Il file non è stato caricato.');
      return j;
    });
  }, function () { throw new Error('Il programma non risponde. Chiudi questa finestra e riapri Gym Art Segreteria.'); });
}
/** Una foto o un'immagine diventa un JPEG di al massimo 2400 punti: più leggero, senza i dati di posizione della foto. */
function riduciImmagine(file) {
  return new Promise(function (ok, no) {
    var rd = new FileReader();
    rd.onerror = function () { no(new Error('Non riesco a leggere l\'immagine.')); };
    rd.onload = function () {
      var img = new Image();
      img.onerror = function () { no(new Error('Questa immagine non si può aprire: prova un file JPEG, PNG o PDF.')); };
      img.onload = function () {
        var k = Math.min(1, 2400 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        var cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { if (b) ok(b); else no(new Error('Non riesco a preparare l\'immagine.')); }, 'image/jpeg', 0.88);
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}
function preparaFile(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return Promise.resolve(file);
  if (/^image\//.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)) return riduciImmagine(file);
  return Promise.reject(new Error('Sono ammessi solo file PDF, JPEG e PNG.'));
}
/** Una finestra di dialogo sopra la pagina (elemento <dialog>): si chiude con Esc, con Annulla o cliccando fuori. */
function modale(titolo, corpo, alChiudere, tipo) {
  [].forEach.call(document.querySelectorAll('dialog.modale:not([open])'), function (x) { x.remove(); }); // a window still fading out leaves at once: two of them are never on the page together
  var d = el('dialog', { class: 'modale' + (tipo ? ' ' + tipo : ''), role: tipo ? 'alertdialog' : null, 'aria-labelledby': 'modale-titolo' }, el('h2', { id: 'modale-titolo', text: titolo }), corpo);
  d.addEventListener('close', function () {
    d.inert = true; d.setAttribute('aria-hidden', 'true'); // while it fades out nobody can reach it and a screen reader skips it
    // the window fades out (CSS, gymart.css) and then leaves the page; with the movement off it leaves at once
    var dur = parseFloat(getComputedStyle(d).transitionDuration) || 0;
    if (dur > 0.01) setTimeout(function () { d.remove(); }, Math.round(dur * 1000) + 60); else d.remove();
    if (alChiudere) alChiudere();
  });
  d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  document.body.appendChild(d);
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  return d;
}
/**
 * Tipo e date del certificato, e si salva. Con doc (il file appena scelto, fotografato o scansionato) si salva anche il documento: se si annulla il file viene tolto dal disco.
 * Senza doc si scrivono solo tipo e date ("Registra certificato"). dopo = che cosa fare a salvataggio avvenuto (di norma si apre la scheda dell'allieva).
 */
/** The type of certificate a course asks for: agonistico for the competitive courses (Agonismo, Preagonismo), non agonistico for the others ('' when she attends none). */
function tipoCertPerCorso(corso) { return !corso ? '' : /agonis/i.test(corso) ? 'Agonistico' : 'Non Agonistico'; }
function tipoCertProposto(allievaId) { var isc = iscrizioniDaPagare(allievaId); return isc.some(function (e) { return /agonis/i.test(e.corso || ''); }) ? 'Agonistico' : isc.length ? 'Non Agonistico' : ''; }
function finestraCertificato(a, doc, dopo) {
  var f = { allievaId: a.id, file: doc ? doc.file : '', nome: 'Certificato medico', certTipo: a.certTipo || tipoCertProposto(a.id), rilascio: '', scadenza: '', aggiornaCertificato: true }, scadAuto = true, shown = false, salvato = false;
  var notes = el('div', { class: 'notes' }), salva = button('Salva il certificato', invia, 'btn-primary'), d;
  var scad = input(f, 'scadenza', 'date', function () { scadAuto = false; ch(); });
  var ril = input(f, 'rilascio', 'date', function () { if (scadAuto && C.isIso(f.rilascio)) { f.scadenza = C.addYears(f.rilascio, 1); scad.value = f.scadenza; } ch(); });
  var tipo = select([['', '(scegli il tipo)']].concat(L.CERT_TIPI.map(function (t) { return [t, CERT_TIPO_NOME[t] || t]; })), f.certTipo, function (x) { f.certTipo = x; ch(); });
  function controlla() { return doc ? L.controllaDocumento(S.db, f, today()) : L.controllaCertificato(S.db, f, today()); }
  function refresh() {
    var chk = controlla();
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere', chk.errors));
    if (shown && chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    salva.disabled = shown && chk.errors.length > 0;
  }
  function ch() { shown = true; refresh(); }
  function invia() {
    shown = true;
    var chk = controlla();
    if (chk.errors.length) { refresh(); return; }
    var res = attempt(function () { return doc ? L.salvaDocumento(S.db, f, nowIso(), today()) : L.salvaCertificato(S.db, f, nowIso(), today()); });
    if (!res) return;
    salva.disabled = true;
    commit(res, 'Certificato salvato.').then(function (ok) { if (ok) { salvato = true; d.close(); (dopo || function () { go('allieva/' + a.id); })(); } else salva.disabled = false; });
  }
  var anteprima = !doc ? null : doc.tipo === 'pdf' ? el('p', null, el('a', { href: urlDocumento(doc.file), target: '_blank', rel: 'noopener', text: 'Apri il PDF per rileggerlo' }))
    : el('img', { class: 'doc-anteprima', src: urlDocumento(doc.file), alt: 'Anteprima del certificato' });
  var corpo = el('form', { onsubmit: function (e) { e.preventDefault(); invia(); } },
    el('p', { class: 'muted', text: doc ? 'File salvato per ' + a.name + '. Scrivi che certificato è e le sue date: il tipo (agonistico o no) resta sempre in vista.'
      : 'Scrivi che certificato ha portato ' + a.name + ' e le sue date. Il documento (scansione o foto) si può aggiungere dopo, dalla scheda dell\'allieva.' }),
    anteprima,
    el('div', { class: 'fields' }, field('Tipo di certificato', tipo), field('Data di rilascio', ril), field('Scadenza', scad, 'Un anno dal rilascio, salvo una scadenza diversa stampata sul certificato.')),
    doc ? el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: true, onchange: function (e) { f.aggiornaCertificato = e.target.checked; } }), el('span', { text: 'Usa questi dati anche per l\'allieva (tipo, rilascio e scadenza del certificato)' })) : null,
    notes, el('div', { class: 'actions' }, salva, button('Annulla', function () { d.close(); })));
  d = modale('Certificato medico di ' + a.name, corpo, function () { if (doc && !salvato) api('DELETE', '/api/documento/' + doc.file).catch(function () {}); });
  refresh();
}
/** Il certificato medico dell'allieva: tipo e stato bene in vista, i documenti già salvati, e i modi per aggiungerne uno (scanner, file, foto). */
function cardCertificato(a) {
  var st = L.statoCertificato(S.db, a, today()), docs = L.documentiDi(S.db, a.id), tocco = S.remoto || (navigator.maxTouchPoints || 0) > 0;
  var inputFile = el('input', { id: 'cert-file', type: 'file', accept: 'application/pdf,image/jpeg,image/png', hidden: true, onchange: function () { if (inputFile.files[0]) dopo(inputFile.files[0]); inputFile.value = ''; } });
  var inputFoto = el('input', { id: 'cert-foto', type: 'file', accept: 'image/*', hidden: true, onchange: function () { if (inputFoto.files[0]) dopo(inputFoto.files[0]); inputFoto.value = ''; } });
  inputFoto.setAttribute('capture', 'environment');
  var scansione = S.scanner ? button('Scansiona', scansiona, 'btn-primary') : null, stato = el('p', { class: 'muted small', role: 'status' });
  function libero() { if (S.dirty) { avviso('Hai modificato i dati dell\'allieva senza salvare: salva (o annulla) prima di aggiungere il certificato.'); return false; } return true; }
  function dopo(file) {
    if (!libero()) return;
    stato.textContent = 'Preparo il file…';
    preparaFile(file).then(inviaDocumento).then(function (j) { stato.textContent = ''; finestraCertificato(a, j); }, function (e) { stato.textContent = ''; avviso(e.message); });
  }
  function scansiona() {
    if (!libero()) return;
    scansione.disabled = true; stato.textContent = 'Si apre la finestra dello scanner: scansiona il certificato e conferma. Qui si riparte quando hai finito.';
    api('POST', '/api/scansiona').then(function (j) {
      scansione.disabled = false; stato.textContent = '';
      if (j && j.file) finestraCertificato(a, j);
    }, function (e) { scansione.disabled = false; stato.textContent = ''; avviso(e.message); });
  }
  var dati = a.certTipo || a.certScadenza
    ? el('p', null, a.certRilascio ? 'Rilasciato il ' + C.isoToIt(a.certRilascio) + ' · ' : '', st.scadenza ? [(st.giorni < 0 ? 'scaduto il ' : 'scade il '), el('b', { text: C.isoToIt(st.scadenza) }), ' (' + giorniTesto(st.giorni) + ')'] : 'scadenza non indicata')
    : st.stato === 'IN ATTESA' ? el('p', null, 'Non ancora consegnato: da portare ', el('b', { text: 'entro il ' + C.isoToIt(st.consegna) }), ' (' + giorniTesto(st.giorni) + ').')
    : el('p', { class: 'muted', text: 'Nessun certificato registrato' + (st.consegna ? ': era da consegnare entro il ' + C.isoToIt(st.consegna) : '') + '.' });
  var lista = docs.length ? el('div', { class: 'list doc-lista' }, docs.map(function (d) {
    return el('div', { class: 'list-item' },
      d.nome && /\.(jpe?g|png)$/i.test(d.file) ? el('a', { href: urlDocumento(d.file), target: '_blank', rel: 'noopener' }, el('img', { class: 'doc-mini', src: urlDocumento(d.file), alt: '' })) : null,
      el('div', { class: 'grow' }, el('div', null, el('a', { href: urlDocumento(d.file), target: '_blank', rel: 'noopener', class: 'name', text: 'Certificato ' + (CERT_TIPO_NOME[d.certTipo] || d.certTipo || '').toLowerCase() }), ' ', chip(d.file.slice(-3).toUpperCase())),
        el('div', { class: 'muted small', text: 'Rilasciato il ' + C.isoToIt(d.rilascio) + ' · scade il ' + C.isoToIt(d.scadenza) + ' · aggiunto il ' + C.isoToIt((d.creata || '').slice(0, 10)) })),
      button('Elimina', function () {
        conferma('Il file viene tolto dal computer e non si può riavere.', { titolo: 'Eliminare questo documento?', si: 'Elimina il documento', no: 'Lascia com\'è', pericolo: true }).then(function (si) {
          if (!si) return;
          var res = attempt(function () { return L.eliminaDocumento(S.db, d.id); });
          if (res) commit(res, 'Documento eliminato.', true).then(function (ok) { if (ok) { api('DELETE', '/api/documento/' + res.file).catch(function () {}); go('allieva/' + a.id); } });
        });
      }, 'btn-small btn-danger'));
  })) : null;
  return el('div', { class: 'card', id: 'certificato' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Certificato medico' }), el('div', { class: 'row' }, certBreve(a, st))),
    dati,
    el('div', { class: 'row' }, scansione, button('Allega un file', function () { inputFile.click(); }, scansione ? '' : 'btn-primary'), tocco ? button('Fotografa', function () { inputFoto.click(); }) : null,
      button('Solo i dati', function () { if (libero()) finestraCertificato(a, null); }), inputFile, inputFoto),
    stato,
    lista,
    S.remoto ? null : el('p', { class: 'muted small', text: 'I documenti restano sul computer, nella cartella dei dati. Non sono nelle copie scaricate ("Scarica una copia di sicurezza"): se hai impostato la seconda cartella vengono copiati anche lì.' }));
}

/* ---------- la pagina Certificati: tipo, stato e documento di tutte le allieve, sott'occhio ---------- */
var CERT_FILTRI = [['', 'Tutti', null], ['agonistico', 'Agonistici', { tipo: 'Agonistico' }], ['non-agonistico', 'Non agonistici', { tipo: 'Non Agonistico' }], ['ludico', 'Ludico-motoria', { tipo: 'Ludico-motoria' }],
  ['da-rinnovare', 'Da rinnovare', { stato: 'DA RINNOVARE' }], ['in-attesa', 'In attesa', { stato: 'IN ATTESA' }], ['mancanti', 'Mancanti', { stato: 'MANCANTE' }], ['senza-documento', 'Senza documento', { documento: 'senza' }]];
var CERT_CONTEGGIO = { '': 'totale', agonistico: 'agonistico', 'non-agonistico': 'nonAgonistico', ludico: 'ludico', 'da-rinnovare': 'daRinnovare', 'in-attesa': 'inAttesa', mancanti: 'mancanti', 'senza-documento': 'senzaDocumento' };
function vCertificati(v, args, nav) {
  var f = S.fcz, t = today(), box = el('div', { class: 'scroll-x' }), barra = el('div', { class: 'tab-bar', role: 'tablist', 'aria-label': 'Quali certificati vuoi vedere' }), count = el('span', { class: 'count' });
  if (nav) { f.filtro = CERT_FILTRI.some(function (x) { return x[0] === args[0]; }) ? args[0] : ''; f.tutte = false; }
  var cols = [
    { h: 'Allieva', key: function (r) { return r.allieva.name; }, cell: function (r) { return link(r.allieva.name, 'allieva/' + r.allieva.id, 'name'); } },
    { h: 'Tipo', key: function (r) { return r.tipo; }, cell: function (r) { return chipTipoCert(r.allieva) || el('span', { class: 'muted', text: '—' }); } },
    { h: 'Rilasciato', cls: 'nowrap mono', key: function (r) { return r.allieva.certRilascio || null; }, cell: function (r) { return r.allieva.certRilascio ? C.isoToIt(r.allieva.certRilascio) : ''; } },
    { h: 'Scade', cls: 'nowrap', key: function (r) { return r.stato.scadenza || null; }, cell: function (r) { return r.stato.scadenza ? [el('span', { class: 'mono', text: C.isoToIt(r.stato.scadenza) }), ' ', el('span', { class: 'muted small', text: giorniTesto(r.stato.giorni) })] : ''; } },
    { h: 'Stato', key: function (r) { return chiaveCert(r.stato); }, cell: function (r) { return chipCert(r.stato); } },
    { h: 'Documento', key: function (r) { return r.documento ? r.documento.creata : ''; }, cell: function (r) {
      return r.documento ? el('a', { href: urlDocumento(r.documento.file), target: '_blank', rel: 'noopener', text: 'Apri (' + C.isoToIt(r.documento.creata.slice(0, 10)) + ')' }) : el('span', { class: 'muted', text: 'Non salvato' }); } }
  ];
  function filtro() { var x = CERT_FILTRI.filter(function (y) { return y[0] === f.filtro; })[0]; return Object.assign({ q: f.q }, x && x[2] ? x[2] : {}); }
  var cn = L.elencoCertificati(S.db, t, {}).conteggi; // the numbers on the tabs: the same whatever is searched or chosen, counted once
  function disegna() {
    var res = L.elencoCertificati(S.db, t, filtro());
    clear(barra); clear(box);
    var righeBarra = el('div', { class: 'tab-gruppo' }); add(barra, righeBarra);
    CERT_FILTRI.forEach(function (x) {
      add(righeBarra, el('button', { type: 'button', role: 'tab', 'aria-selected': x[0] === f.filtro ? 'true' : 'false', onclick: function () { f.filtro = x[0]; f.tutte = false; disegna(); } }, x[1], ' ', el('span', { class: 'n n-' + (x[0] === 'da-rinnovare' || x[0] === 'mancanti' ? 'warn' : x[0] === 'in-attesa' ? 'info' : 'mute'), 'aria-hidden': 'true', text: String(cn[CERT_CONTEGGIO[x[0]]]) })));
    });
    count.textContent = plurale(res.righe.length, 'allieva', 'allieve');
    if (!res.righe.length) add(box, el('p', { class: 'empty', text: f.q || f.filtro ? 'Nessuna allieva con questo filtro.' : 'Nessuna allieva con un\'iscrizione aperta.' }));
    else {
      var el2 = elenco(cols, res.righe, f.sort, disegna, function (r) { return { class: 'link', 'data-ant': 'allieva:' + r.allieva.id, onclick: function (e) { if (!e.target.closest('a')) go('allieva/' + r.allieva.id); } }; }, f); // the first 250, like the other lists
      add(box, el2.table, el2.more);
    }
  }
  var search = el('input', { type: 'search', value: f.q, placeholder: 'Nome o genitore…', 'aria-label': 'Cerca un\'allieva', oninput: function () { f.q = search.value; f.tutte = false; later(); } }), later = debounce(disegna, 120);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Certificati medici' })));
  add(v, el('div', { class: 'card' }, barra, el('div', { class: 'toolbar' }, field('Cerca', search), count), box,
    el('p', { class: 'muted small', text: 'Sono elencate le allieve con un\'iscrizione aperta. Per aggiungere il certificato (scanner, file o foto) apri la scheda dell\'allieva. Il certificato per attività ludico-motoria non vale per l\'attività sportiva.' })));
  disegna();
}

/* ---------- "Avvisa il genitore": numero, testo che si può cambiare, WhatsApp; poi l'allieva risulta avvisata ---------- */
var AVVISI = {}; // le righe di avviso (L.elencoPromemoria) per tipo|rif, preparate da chi disegna una lista
function preparaAvvisi() { AVVISI = {}; L.elencoPromemoria(S.db, today(), { contatto: 'tutte', conAttesa: true }).righe.forEach(function (r) { AVVISI[r.tipo + '|' + r.rif] = r; }); }
function chipAvvisato(r) { return r && r.contatto.stato !== 'da contattare' ? chip('Avvisato il ' + C.isoToIt(r.contatto.quando).slice(0, 5), r.contatto.stato === 'contattata' ? 'ok' : 'warn') : null; }
function motivoAvviso(r) {
  var chi = r.tipo === 'abbonamento' ? 'Abbonamento' : 'Certificato medico', st = r.stato === 'SCADUTO' ? 'scaduto' : r.stato === 'MANCANTE' ? 'mancante' : r.stato === 'IN ATTESA' ? 'da consegnare' : 'in scadenza';
  return chi + ' ' + st + (r.scadenza ? (r.stato === 'IN ATTESA' ? ' entro il ' : ' il ') + C.isoToIt(r.scadenza) + ' (' + giorniTesto(r.giorni) + ')' : '') + (r.corso && r.tipo === 'abbonamento' ? ' · ' + r.corso : '');
}
/** r = una riga di L.elencoPromemoria; coda = le righe da proporre dopo (uno alla volta). */
function avvisa(r, coda) {
  coda = coda || [];
  var a = r.allieva, numeri = [[a.tel, 'Telefono'], [a.tel2, 'Secondo telefono']].filter(function (n) { return n[0] && C.validPhone(n[0]); }), d;
  var testo = el('textarea', { rows: 7, 'aria-label': 'Testo del messaggio' }); testo.value = r.testo;
  var sel = numeri.length > 1 ? select(numeri.map(function (n, i) { return [String(i), n[1] + ': ' + n[0]]; }), '0', agg) : null;
  var wa = numeri.length ? el('a', { class: 'btn btn-primary', target: '_blank', rel: 'noopener noreferrer', text: coda.length ? 'Apri WhatsApp e passa al prossimo' : 'Apri WhatsApp' }) : null;
  function agg() { var n = numeri[sel ? +sel.value : 0]; if (wa && n) wa.href = C.waLink(n[0], testo.value); }
  function avanti() { if (coda.length) { d.close(); avvisa(coda[0], coda.slice(1)); } else { d.close(); render(); } }
  testo.addEventListener('input', agg); agg();
  if (wa) wa.addEventListener('click', function () { setTimeout(function () { segnaContatto(r, true).then(function (ok) { if (ok) avanti(); }); }, 0); }); // the link opens WhatsApp; then the student is marked as warned
  var corpo = el('div', null,
    el('p', null, el('b', { text: a.name }), a.genitore ? [' · genitore: ', a.genitore] : null),
    el('p', { class: 'muted small', text: motivoAvviso(r) }),
    r.contatto.stato !== 'da contattare' ? note(r.contatto.stato === 'contattata' ? '' : 'warn', (r.contatto.stato === 'contattata' ? 'Già avvisato il ' : 'Avvisato il ') + C.isoToIt(r.contatto.quando) + (r.contatto.stato === 'contattata' ? '. Puoi avvisare di nuovo.' : ' e ancora da risolvere.')) : null,
    numeri.length ? null : note('bad', 'Manca un numero di telefono valido.', ['Aggiungilo nella scheda di ' + a.name + ': qui sotto puoi comunque copiare il testo.']),
    sel ? field('Numero', sel) : numeri.length ? el('p', { class: 'muted small', text: 'Numero: ' + numeri[0][0] }) : null,
    field('Messaggio', testo, 'Si può cambiare prima di inviare. I testi di partenza si cambiano in Impostazioni > Messaggi per i genitori.'),
    el('div', { class: 'actions' }, wa, button('Copia testo', function () { copiaTesto(testo.value); }),
      coda.length ? button('Salta', function () { avanti(); }) : null, button(coda.length ? 'Ferma' : 'Annulla', function () { d.close(); }),
      coda.length ? el('span', { class: 'muted small', text: 'Dopo questo: ' + plurale(coda.length, 'altra persona', 'altre persone') }) : null,
      numeri.length ? null : link('Apri la scheda', 'allieva/' + a.id, 'btn')));
  d = modale('Avvisa il genitore', corpo);
  var primo = d.querySelector('a.btn-primary') || d.querySelector('textarea'); if (primo && primo.focus) primo.focus();
}

/* ---------- anteprime: se il mouse si ferma su una riga, una tessera, una voce del menu o un mese dei rinnovi, dopo un po' compaiono più dettagli e le azioni ---------- */
var ANT_CHIAVE = 'gymart-anteprime', ANT_RITARDO = 'gymart-anteprime-ritardo';
function anteprimeAttive() { try { return localStorage.getItem(ANT_CHIAVE) !== '0'; } catch (e) { return true; } }
function ritardoAnteprima() { try { var v = parseInt(localStorage.getItem(ANT_RITARDO), 10); return v >= 300 && v <= 4000 ? v : 900; } catch (e) { return 900; } }
var ANT_TESSERE = [[/^Abbonamenti scaduti$/, 'scadute'], [/^Abbonamenti in scadenza$/, 'inScadenza'], [/^Certificati da rinnovare/, 'certRinnovare'], [/^Certificati mancanti/, 'certMancanti'], [/^Certificati da consegnare/, 'certAttesa'], [/^Promemoria da contattare/, 'promemoria'],
  [/^Da incassare/, 'daIncassare'], [/^Bonifici da verificare/, 'bonifici'], [/^Allieve$/, 'allieve'], [/^Iscrizioni aperte/, 'iscrizioniAperte'], [/^Incassi del mese/, 'incassi'], [/^Certificati registrati/, 'certificati']];
function chiaveTessera(label) { for (var i = 0; i < ANT_TESSERE.length; i++) if (ANT_TESSERE[i][0].test(label)) return ANT_TESSERE[i][1]; return null; }
function antRiga(testo, forte) { return el('div', { class: 'ant-riga' + (forte ? '' : ' small') }, testo); }
function antElenco(titolo, righe, hash, quante) {
  var tot = quante === undefined ? righe.length : quante;
  return el('div', { class: 'ant' }, el('div', { class: 'ant-testa' }, el('b', { text: titolo })),
    righe.length ? el('div', { class: 'ant-lista' }, righe.slice(0, 6).map(function (r) { return antRiga(r); })) : el('p', { class: 'muted small', text: 'Niente da mostrare.' }),
    tot > 6 ? el('p', { class: 'muted small', text: '… e altre ' + (tot - 6) }) : null,
    hash ? el('div', { class: 'ant-azioni' }, link('Vedi tutto', hash, 'btn btn-small btn-primary')) : null);
}
function antAllieva(id) {
  var a = L.byId(S.db.allieve, id); if (!a) return null;
  var t = today(), st = L.statoCertificato(S.db, a, t), isc = L.iscrizioniDi(S.db, id), ct = L.contoAllieva(S.db, id), av = L.elencoPromemoria(S.db, t, { contatto: 'tutte' }).righe.filter(function (r) { return r.allieva.id === id; })[0];
  return el('div', { class: 'ant' },
    el('div', { class: 'ant-testa' }, el('b', { text: a.name }), eta(a) ? chip(eta(a)) : null, a.archiviata ? chip('Archiviata', 'warn') : null),
    el('div', { class: 'muted small', text: [a.tel ? 'tel. ' + a.tel : 'senza telefono', a.genitore ? 'genitore: ' + a.genitore : ''].filter(Boolean).join(' · ') }),
    el('div', { class: 'ant-riga' }, el('span', { class: 'muted small', text: 'Certificato' }), certBreve(a, st), st.scadenza ? el('span', { class: 'small', text: (st.giorni < 0 ? 'scaduto il ' : 'scade il ') + C.isoToIt(st.scadenza) }) : null),
    isc.length ? el('div', { class: 'ant-lista' }, isc.slice(0, 3).map(function (x) { var s = L.statoIscrizione(S.db, x, t); return el('div', { class: 'ant-riga small' }, [x.corso, x.tipo].filter(Boolean).join(' · '), chipStato(s.stato), s.scadenza ? 'scade il ' + C.isoToIt(s.scadenza) : ''); })) : el('p', { class: 'muted small', text: 'Nessuna iscrizione.' }),
    el('div', { class: 'ant-riga' }, ct.residuo > 0.005 ? el('b', { text: 'Da pagare: ' + C.fmtMoney(ct.residuo) }) : el('span', { class: 'small', text: ct.pagato > 0 ? 'Tutto saldato · ' + C.fmtMoney(ct.pagato) + ' pagati' : 'Nessun pagamento' })),
    el('div', { class: 'ant-azioni' }, link('Apri la scheda', 'allieva/' + id, 'btn btn-small btn-primary'), link('Iscrivi a un corso', 'iscrizione/nuova/' + id, 'btn btn-small'),
      av ? button('Avvisa', function () { anteprima.chiudi(); avvisa(av); }, 'btn-small', 'Avvisa ' + a.name) : null));
}
function antIscrizione(id) {
  var e = L.byId(S.db.iscrizioni, id); if (!e) return null;
  var a = L.byId(S.db.allieve, e.allievaId), t = today(), s = L.statoIscrizione(S.db, e, t), cn = L.conto(S.db, e), np = L.pagamentiDi(S.db, e.id).length, av = a ? L.elencoPromemoria(S.db, t, { contatto: 'tutte' }).righe.filter(function (r) { return r.tipo === 'abbonamento' && r.rif === id; })[0] : null;
  return el('div', { class: 'ant' },
    el('div', { class: 'ant-testa' }, el('b', { text: a ? a.name : '(allieva mancante)' }), chipStato(s.stato)),
    el('div', { class: 'muted small', text: [e.corso, e.tipo, e.giorni.join(' '), e.fascia].filter(Boolean).join(' · ') }),
    antRiga('Dal ' + C.isoToIt(e.inizio) + (s.scadenza ? ' al ' + C.isoToIt(s.scadenza) + ' (' + giorniTesto(s.giorni) + ')' : '')),
    el('div', { class: 'ant-riga small' }, cn.dovuto === null ? 'Quota da definire' : 'Dovuto ' + C.fmtMoney(cn.dovuto) + ' · pagato ' + C.fmtMoney(cn.pagato) + (cn.residuo > 0.005 ? ' · resta ' : ''), cn.residuo > 0.005 ? el('b', { text: C.fmtMoney(cn.residuo) }) : null),
    antRiga(np ? plurale(np, 'pagamento', 'pagamenti') + ' registrati' : 'Nessun pagamento registrato'),
    el('div', { class: 'ant-azioni' }, link('Apri l\'iscrizione', 'iscrizione/' + id, 'btn btn-small btn-primary'),
      L.corrente(e) && L.scadenza(e) ? button('Rinnova', function () { anteprima.chiudi(); rinnova(id, location.hash.replace(/^#/, '') || 'iscrizioni'); }, 'btn-small', 'Rinnova ' + (e.corso || 'l\'iscrizione')) : null,
      av ? button('Avvisa', function () { anteprima.chiudi(); avvisa(av); }, 'btn-small', 'Avvisa' + (a ? ' ' + a.name : '')) : null));
}
function antTessera(k) {
  var t = today(), sc, ce, f;
  if (k === 'scadute' || k === 'inScadenza') { sc = L.scadenze(S.db, t)[k === 'scadute' ? 'scadute' : 'inScadenza']; return antElenco(k === 'scadute' ? 'Abbonamenti scaduti' : 'Abbonamenti in scadenza', sc.map(function (x) { return (x.allieva ? x.allieva.name : '?') + ' · ' + x.iscrizione.corso + ' · ' + giorniTesto(x.giorni); }), 'scadenze/' + (k === 'scadute' ? 'abb-scaduti' : 'abb-in-scadenza')); }
  if (k === 'certRinnovare') { ce = L.scadenzeCertificati(S.db, t); return antElenco('Certificati da rinnovare', ce.scaduti.concat(ce.inScadenza).map(function (x) { return x.allieva.name + ' · ' + CERT_TIPO_NOME[x.allieva.certTipo || ''] + ' · ' + giorniTesto(x.stato.giorni); }), 'certificati/da-rinnovare'); }
  if (k === 'certMancanti') { ce = L.scadenzeCertificati(S.db, t); return antElenco('Certificati mancanti', ce.mancanti.map(function (x) { return x.allieva.name + ' · ' + (x.stato.ritardo ? 'in ritardo di ' + plurale(x.stato.ritardo, 'giorno', 'giorni') : 'senza iscrizione recente'); }), 'scadenze/cert-mancanti'); }
  if (k === 'certAttesa') { ce = L.scadenzeCertificati(S.db, t); return antElenco('Certificati da consegnare', ce.inAttesa.map(function (x) { return x.allieva.name + ' · entro il ' + C.isoToIt(x.stato.consegna).slice(0, 5) + ' (' + giorniTesto(x.stato.giorni) + ')'; }), 'scadenze/cert-attesa'); }
  if (k === 'promemoria') { f = L.elencoPromemoria(S.db, t, {}).righe; return antElenco('Da contattare', f.map(function (r) { return r.allieva.name + ' · ' + (r.tipo === 'abbonamento' ? 'abbonamento' : 'certificato') + ' ' + (r.stato === 'SCADUTO' ? 'scaduto' : r.stato === 'MANCANTE' ? 'mancante' : 'in scadenza'); }), 'promemoria'); }
  if (k === 'daIncassare') { f = L.daIncassare(S.db).righe.sort(function (x, y) { return y.conto.residuo - x.conto.residuo; }); return antElenco('Da incassare: i residui più alti', f.map(function (x) { return x.allieva.name + ' · ' + C.fmtMoney(x.conto.residuo); }), 'pagamenti/da-incassare'); }
  if (k === 'bonifici') { f = L.daVerificare(S.db).righe; return antElenco('Bonifici da verificare', f.map(function (x) { return (x.allieva ? x.allieva.name : '?') + ' · ' + C.fmtMoney(x.pagamento.importo) + ' · ' + C.isoToIt(x.pagamento.data); }), 'pagamenti/verifica'); }
  if (k === 'iscrizioniAperte') { f = L.corsiRiepilogo(S.db); return antElenco('Iscrizioni aperte per corso', f.map(function (x) { return (x.corso || 'Da definire') + ' · ' + x.iscritte; }), 'corsi'); }
  if (k === 'allieve') { var r = L.riepilogo(S.db, t); return antElenco('Allieve', [plurale(r.allieve - r.archiviate, 'allieva attiva', 'allieve attive'), plurale(r.archiviate, 'archiviata', 'archiviate'), plurale(r.senzaIscrizione, 'senza iscrizione aperta', 'senza iscrizione aperta')], 'allieve'); }
  if (k === 'incassi') { var an = L.analisi(S.db, t, '12mesi'), mm = an.incassiMese[11]; return antElenco('Incassi del mese', ['Questo mese: ' + C.fmtMoney(mm), 'Mese scorso: ' + C.fmtMoney(an.incassiMese[10]), 'Media dei mesi con incassi: ' + C.fmtMoney(an.mediaMensile || 0)], 'analisi'); }
  if (k === 'certificati') { var cz = L.elencoCertificati(S.db, t, {}).conteggi; return antElenco('Certificati registrati', [cz.agonistico + ' agonistici', cz.nonAgonistico + ' non agonistici', cz.ludico + ' ludico-motoria', cz.daRinnovare + ' da rinnovare', cz.mancanti + ' mancanti', cz.senzaDocumento + ' senza documento salvato'], 'certificati'); }
  return null;
}
function antMenu(id) {
  var t = today(), r = L.riepilogo(S.db, t);
  if (id === 'scadenze') return antElenco('Scadenze', [plurale(r.scadute, 'abbonamento scaduto', 'abbonamenti scaduti'), plurale(r.inScadenza, 'abbonamento in scadenza', 'abbonamenti in scadenza'), plurale(r.certScaduti + r.certInScadenza, 'certificato da rinnovare', 'certificati da rinnovare'), plurale(r.certMancanti, 'certificato mancante', 'certificati mancanti'), plurale(r.certInAttesa, 'certificato da consegnare', 'certificati da consegnare')], 'scadenze');
  if (id === 'pagamenti') return antElenco('Pagamenti', [r.daIncassare + ' da incassare · ' + C.fmtMoney(r.totaleDaIncassare), plurale(r.bonificiDaVerificare, 'bonifico da verificare', 'bonifici da verificare')], 'pagamenti');
  if (id === 'certificati') { var cz = L.elencoCertificati(S.db, t, {}).conteggi; return antElenco('Certificati', [cz.agonistico + ' agonistici · ' + cz.nonAgonistico + ' non agonistici', cz.daRinnovare + ' da rinnovare · ' + cz.inAttesa + ' in attesa · ' + cz.mancanti + ' mancanti', cz.senzaDocumento + ' senza documento'], 'certificati'); }
  if (id === 'allieve') return antElenco('Allieve', [plurale(r.allieve - r.archiviate, 'allieva attiva', 'allieve attive'), plurale(r.archiviate, 'archiviata', 'archiviate')], 'allieve');
  if (id === 'iscrizioni') return antElenco('Iscrizioni', [plurale(r.correnti, 'iscrizione aperta', 'iscrizioni aperte'), r.attive + ' attive · ' + r.inScadenza + ' in scadenza · ' + r.scadute + ' scadute', plurale(r.daCompletare, 'da completare', 'da completare')], 'iscrizioni');
  if (id === 'analisi') { var rn = L.previsioneRinnovi(S.db, t, 6).mesi.filter(function (m) { return m.n > 0; }).slice(0, 3); return antElenco('Grafici', rn.length ? rn.map(function (m) { return 'Rinnovi ' + m.l + ': ' + plurale(m.n, 'abbonamento', 'abbonamenti') + ' · ' + C.fmtMoney(m.euro); }) : ['Nessun rinnovo nei prossimi mesi'], 'analisi'); }
  return null;
}
function antMese(chiave) {
  var p = L.previsioneRinnovi(S.db, today(), 12), m = p.mesi.filter(function (x) { return x.chiave === chiave; })[0]; if (!m) return null;
  return antElenco('Rinnovi di ' + m.l + ': ' + plurale(m.n, 'abbonamento', 'abbonamenti') + ' · ' + C.fmtMoney(m.euro), m.righe.map(function (r) { return r.allieva.name + ' · ' + r.iscrizione.corso + ' · ' + r.iscrizione.tipo + ' · ' + C.isoToIt(r.scadenza).slice(0, 5) + ' · ' + C.fmtMoney(r.euro); }), 'analisi', m.n);
}
function costruisciAnteprima(tipo, id) {
  try {
    return tipo === 'allieva' ? antAllieva(id) : tipo === 'iscrizione' ? antIscrizione(id) : tipo === 'tessera' ? antTessera(id) : tipo === 'menu' ? antMenu(id) : tipo === 'mese' ? antMese(id) : null;
  } catch (e) { return null; }
}
var anteprima = (function () {
  var box = null, corrente = null, timer = 0, chiusura = 0, ultimo = { x: 0, y: 0 };
  var fine = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  function attiva() { return anteprimeAttive() && !!fine && fine.matches && !S.bloccato && !!S.db && !document.querySelector('dialog[open]'); }
  /** dolce = the pointer simply left: the preview fades out (CSS .esce). Every other way of closing (a click, the scroll, Esc, a new preview) removes it at once. */
  function chiudi(dolce) {
    clearTimeout(timer); clearTimeout(chiusura);
    if (box) {
      var b = box; box = null;
      if (dolce === true && parseFloat(getComputedStyle(b).transitionDuration) > 0.01) { b.classList.add('esce'); b.setAttribute('aria-hidden', 'true'); setTimeout(function () { b.remove(); }, 120); } else b.remove();
    }
    corrente = null;
  }
  function posiziona() {
    var w = box.offsetWidth, h = box.offsetHeight, x = Math.min(Math.max(8, ultimo.x + 14), window.innerWidth - w - 8), y = ultimo.y + 18, sopra = false; // (offset sizes: the scale of the opening does not count)
    if (y + h > window.innerHeight - 8) { y = Math.max(8, ultimo.y - h - 14); sopra = true; }
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.style.transformOrigin = Math.max(0, Math.min(100, (ultimo.x - x) / w * 100)) + '% ' + (sopra ? '100%' : '0%'); // it opens out of the corner nearest the pointer
  }
  function mostra(t) {
    var k = t.getAttribute('data-ant') || '', i = k.indexOf(':'), nodo = i < 0 ? null : costruisciAnteprima(k.slice(0, i), k.slice(i + 1));
    if (!nodo) return;
    chiudi();
    box = el('div', { class: 'anteprima', role: 'region', 'aria-label': 'Anteprima' }, nodo);
    box.addEventListener('pointerenter', function () { clearTimeout(chiusura); });
    box.addEventListener('pointerleave', pianifica);
    document.body.appendChild(box); corrente = t; posiziona();
  }
  function pianifica() { clearTimeout(chiusura); chiusura = setTimeout(function () { chiudi(true); }, 250); }
  document.addEventListener('pointermove', function (e) {
    ultimo.x = e.clientX; ultimo.y = e.clientY;
    if (!box && !attiva()) return;
    if (box && box.contains(e.target)) { clearTimeout(chiusura); return; }
    var t = e.target && e.target.closest ? e.target.closest('[data-ant]') : null;
    if (box && t === corrente) { clearTimeout(chiusura); return; }
    if (box) pianifica();
    clearTimeout(timer);
    if (t && attiva()) timer = setTimeout(function () { mostra(t); }, ritardoAnteprima()); // the timer starts again at every movement: it opens when the mouse has stopped
  }, { passive: true });
  document.addEventListener('pointerdown', function (e) { if (box && box.contains(e.target)) return; chiudi(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') chiudi(); }, true);
  window.addEventListener('scroll', chiudi, true);
  window.addEventListener('hashchange', chiudi);
  return { chiudi: chiudi };
})();

/* ---------- Scadenze ---------- */
/** A line of small details: the pieces are separated by a dot and each one stays whole when the line wraps. */
function meta(pezzi) { var p = pezzi.filter(Boolean), figli = []; p.forEach(function (t, i) { if (i) figli.push(' '); figli.push(el('span', { class: 'pezzo', text: t + (i < p.length - 1 ? ' ·' : '') })); }); return el('div', { class: 'muted small' }, figli); }
function rigaScadenza(x, conRinnovo) {
  var e = x.iscrizione, a = x.allieva || { name: '(allieva mancante)', id: '', tel: '' }, scaduto = x.giorni < 0;
  var quando = 'scad. ' + C.isoToIt(x.scadenza);
  return el('div', { class: 'list-item riga-scad', 'data-ant': 'iscrizione:' + e.id },
    el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', chip((scaduto ? 'Scaduto ' : 'Scade ') + giorniTesto(x.giorni), scaduto ? 'bad' : 'warn'), ' ', chipAvvisato(AVVISI['abbonamento|' + e.id])),
      meta([e.corso, e.tipo, quando, a.tel ? 'tel. ' + a.tel : ''])),
    el('div', { class: 'row' }, conRinnovo && AVVISI['abbonamento|' + e.id] ? button('Avvisa', function () { avvisa(AVVISI['abbonamento|' + e.id]); }, 'btn-small', 'Avvisa ' + a.name) : null, conRinnovo ? button('Rinnova', function () { rinnova(e.id, location.hash.replace(/^#/, '') || 'scadenze'); }, 'btn-small btn-primary', 'Rinnova l\'iscrizione di ' + a.name) : null));
}
function rigaCertificato(x) {
  var a = x.allieva, s = x.stato;
  var quando = s.stato === 'IN ATTESA' ? 'da consegnare entro il ' + C.isoToIt(s.consegna) + ' (' + giorniTesto(s.giorni) + ')'
    : s.stato === 'MANCANTE' ? 'nessun certificato registrato' + (s.consegna ? ' · era da consegnare entro il ' + C.isoToIt(s.consegna) : '') : 'scad. ' + C.isoToIt(s.scadenza);
  return el('div', { class: 'list-item riga-scad', 'data-ant': 'allieva:' + a.id },
    el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', certBreve(a, s), ' ', chipAvvisato(AVVISI['certificato|' + a.id])),
      meta([quando, a.genitore, a.tel ? 'tel. ' + a.tel : ''])),
    el('div', { class: 'row' }, AVVISI['certificato|' + a.id] ? button('Avvisa', function () { avvisa(AVVISI['certificato|' + a.id]); }, 'btn-small', 'Avvisa ' + a.name) : null,
      button('Registra certificato', function () { finestraCertificato(a, null, render); }, 'btn-small' + (s.stato === 'IN ATTESA' || s.stato === 'MANCANTE' ? ' btn-primary' : ''))));
}
/** Scadenze: i cinque elenchi sono raccolti in schede (una alla volta, con il numero accanto); di ogni elenco si vedono le prime SCAD_MAX righe. */
var SCAD_TABS = [['abb-scaduti', 'Abbonamenti', 'Scaduti', 'bad'], ['abb-in-scadenza', 'Abbonamenti', 'In scadenza', 'warn'], ['cert-scaduti', 'Certificati', 'Scaduti', 'bad'], ['cert-in-scadenza', 'Certificati', 'In scadenza', 'warn'], ['cert-mancanti', 'Certificati', 'Mancanti', 'mute'], ['cert-attesa', 'Certificati', 'In attesa', 'info']];
var SCAD_MAX = 10, SCAD_MAX_TEL = 6; // how many rows are shown at first (fewer on a phone)
function scadMax() { return window.matchMedia && window.matchMedia('(max-width: 700px)').matches ? SCAD_MAX_TEL : SCAD_MAX; }
function vScadenze(v, args, nav) {
  var sc = L.scadenze(S.db, today()), ce = L.scadenzeCertificati(S.db, today()), n = S.db.impostazioni.preavvisoAbb, nc = S.db.impostazioni.preavvisoCert;
  var abb = function (x) { return rigaScadenza(x, true); };
  var liste = { 'abb-scaduti': [sc.scadute, abb, 'Abbonamenti già scaduti: i più vecchi per primi.'], 'abb-in-scadenza': [sc.inScadenza, abb, 'Abbonamenti che scadono entro ' + n + ' giorni.'],
    'cert-scaduti': [ce.scaduti, rigaCertificato, 'Certificati medici già scaduti.'], 'cert-in-scadenza': [ce.inScadenza, rigaCertificato, 'Certificati medici che scadono entro ' + nc + ' giorni.'],
    'cert-mancanti': [ce.mancanti, rigaCertificato, 'Allieve con un\'iscrizione aperta, nessun certificato registrato e il tempo per consegnarlo già finito.'],
    'cert-attesa': [ce.inAttesa, rigaCertificato, 'Iscritte da poco: il certificato si può consegnare entro ' + L.giorniAttesaCert(S.db) + ' giorni dall\'inizio. Quando arriva, "Registra certificato"; passato il termine, finiscono tra i mancanti.'] };
  var presenti = SCAD_TABS.filter(function (t) { return liste[t[0]][0].length > 0; }); // a tab with nothing inside is not shown
  preparaAvvisi();
  if (nav) { S.sc.tab = args[0] || ''; S.sc.tutte = false; }
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Scadenze' }), link('Promemoria in blocco', 'promemoria', 'btn btn-primary')));
  var box = el('div', { class: 'card', id: 'scadenze-lista' });
  add(v, box);
  function disegna(focus) {
    clear(box);
    if (!presenti.length) { add(box, el('p', { class: 'empty', text: 'Nessuna scadenza: è tutto in regola.' })); return; }
    if (!presenti.some(function (t) { return t[0] === S.sc.tab; })) S.sc.tab = presenti[0][0]; // the open tab is empty (or unknown): the first one with something
    var cur = S.sc.tab, righe = liste[cur][0], max = scadMax(), mostra = S.sc.tutte ? righe : righe.slice(0, max);
    var barra = el('div', { class: 'tab-bar', role: 'tablist', 'aria-label': 'Che cosa vuoi vedere' }), gruppi = {};
    presenti.forEach(function (t) {
      var g = gruppi[t[1]] || (gruppi[t[1]] = barra.appendChild(el('div', { class: 'tab-gruppo' }, el('span', { class: 'tab-etichetta', 'aria-hidden': 'true', text: t[1] }))));
      g.appendChild(el('button', { type: 'button', role: 'tab', id: 'scad-' + t[0], 'aria-selected': t[0] === cur ? 'true' : 'false', 'aria-controls': 'scad-pannello', tabindex: t[0] === cur ? null : '-1',
        'aria-label': t[1] + ' ' + t[2].toLowerCase() + ', ' + liste[t[0]][0].length, onclick: function () { S.sc.tab = t[0]; S.sc.tutte = false; disegna(true); } }, t[2], ' ', el('span', { class: 'n n-' + t[3], 'aria-hidden': 'true', text: String(liste[t[0]][0].length) })));
    });
    barra.addEventListener('keydown', function (ev) { // arrows move between the tabs, like in any program
      var i = presenti.findIndex(function (t) { return t[0] === cur; }), d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return; ev.preventDefault(); S.sc.tab = presenti[(i + d + presenti.length) % presenti.length][0]; S.sc.tutte = false; disegna(true);
    });
    add(box, barra);
    add(box, el('p', { class: 'muted small', text: liste[cur][2] }));
    add(box, el('div', { class: 'list', id: 'scad-pannello', role: 'tabpanel', 'aria-labelledby': 'scad-' + cur }, mostra.map(liste[cur][1])));
    if (righe.length > max) add(box, el('div', { class: 'row' }, button(S.sc.tutte ? 'Mostra solo le prime ' + max : 'Mostra tutte (' + righe.length + ')', function () { S.sc.tutte = !S.sc.tutte; disegna(); }, 'btn-small')));
    if (focus) { var sel = box.querySelector('[role="tab"][aria-selected="true"]'); if (sel) sel.focus(); }
  }
  disegna();
  add(v, altri('Come funziona', [el('p', { class: 'muted small', text: '"Rinnova" apre un nuovo periodo con gli stessi dati, a partire dalla scadenza; quello vecchio resta nello storico. "Avvisa" apre una finestra con il numero del genitore e il messaggio già scritto per quella situazione (abbonamento in scadenza o scaduto, certificato in scadenza, scaduto o mancante): lo puoi cambiare, poi "Apri WhatsApp" apre la chat e l\'allieva risulta avvisata; lo invii tu (serve internet). I certificati sono elencati solo per le allieve non archiviate che hanno un\'iscrizione aperta. Preavvisi e testi si cambiano in Impostazioni.' })]));
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
      conferma('- ' + righe.join('\n- ') + '\nPrima di scrivere il programma salva una copia dell\'archivio. Ogni cambio finisce nel Registro.', { titolo: 'Confermi la nuova stagione?', si: 'Conferma la nuova stagione', no: 'Non ancora' }).then(function (si) {
        if (!si) return;
        var res = attempt(function () { return L.nuovaStagione(S.db, opz(), nowIso(), today()); });
        if (res) commit(res, 'Nuova stagione ' + o.stagione + ' pronta.', true).then(function (fatto) { if (fatto) go('iscrizioni'); });
      });
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
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(testo).then(ok, function () { mostraDaCopiare(testo, 'Copia il messaggio'); });
  else mostraDaCopiare(testo, 'Copia il messaggio');
}
function vPromemoria(v) {
  S.fpm = S.fpm || { tipo: '', contatto: 'fare', corso: '', q: '' };
  var f = S.fpm, box = el('div', { class: 'list' }), more = el('div'), count = el('span', { class: 'count' }), tiles = el('div', { class: 'grid' }), ultimo = [];
  var avvia = button('Avvisa uno alla volta', function () { var q = ultimo.filter(function (r) { return r.tel && r.contatto.stato !== 'contattata'; }); if (q.length) avvisa(q[0], q.slice(1)); }, 'btn-primary');
  function riga(r) {
    var a = r.allieva, c = r.contatto, quando = c.quando ? C.isoToIt(c.quando).slice(0, 5) : '';
    var stato = r.stato === 'MANCANTE' ? chip('Certificato mancante', 'mute') : r.tipo === 'certificato' ? chipCert(L.statoCertificato(S.db, a, today())) : chipStato(r.stato === 'SCADUTO' ? 'SCADUTO' : 'IN SCADENZA');
    var quando2 = r.stato === 'MANCANTE' ? 'Nessun certificato registrato' : r.stato === 'IN ATTESA' ? 'Da consegnare entro il ' + C.isoToIt(r.scadenza) + ' (' + giorniTesto(r.giorni) + ')' : (r.giorni < 0 ? 'Scaduto il ' : 'Scade il ') + C.isoToIt(r.scadenza) + ' (' + giorniTesto(r.giorni) + ')';
    return el('div', { class: 'list-item' },
      el('div', { class: 'grow' }, el('div', null, link(a.name, 'allieva/' + a.id, 'name'), ' ', chip(r.tipo === 'abbonamento' ? 'Abbonamento' : 'Certificato', 'mute'), ' ', stato, ' ',
        chip(c.stato === 'da contattare' ? 'Da contattare' : c.stato === 'da ricontattare' ? 'Da ricontattare · ultimo ' + quando : 'Contattata il ' + quando, CONTATTO_KIND[c.stato]), r.tel ? null : ' ', r.tel ? null : chip('Senza telefono', 'bad')),
        el('div', { class: 'muted small', text: [r.corso, a.genitore, r.tel ? 'tel. ' + r.tel : ''].filter(Boolean).join(' · ') }),
        el('div', { class: 'muted small solo-det', text: r.testo })),
      el('div', { class: 'when small' }, quando2),
      el('div', { class: 'row' }, button('Avvisa', function () { avvisa(r); }, 'btn-small' + (c.stato === 'contattata' ? '' : ' btn-primary'), 'Avvisa ' + a.name),
        c.stato === 'contattata' ? button('Annulla', function () { segnaContatto(r, false).then(function (ok) { if (ok) draw(); }); }, 'btn-small')
          : button('Fatto', function () { segnaContatto(r, true).then(function (ok) { if (ok) draw(); }); }, 'btn-small')));
  }
  function draw() {
    var res = L.elencoPromemoria(S.db, today(), f), cn = res.conteggi, righe = res.righe;
    ultimo = righe;
    var coda = righe.filter(function (r) { return r.tel && r.contatto.stato !== 'contattata'; }).length;
    avvia.textContent = 'Avvisa uno alla volta (' + coda + ')'; avvia.disabled = !coda;
    clear(tiles);
    add(tiles, tile(cn.daFare, 'Da contattare', cn.daFare ? 'warn' : 'ok', null, 'abbonamenti e certificati'), cn.contattate ? tile(cn.contattate, 'Contattate di recente', 'ok', null, 'meno di ' + L.GIORNI_RICONTATTO + ' giorni fa') : null,
      cn.senzaTelefono ? tile(cn.senzaTelefono, 'Senza telefono valido', 'bad', null, 'da chiamare o da correggere') : null);
    count.textContent = righe.length === 1 ? '1 promemoria' : righe.length + ' promemoria';
    clear(box); clear(more);
    if (!righe.length) { add(box, el('p', { class: 'empty', text: cn.totale ? (f.contatto === 'fare' ? 'Hai contattato tutti: niente da fare per ora.' : 'Nessun promemoria corrisponde ai filtri.') : 'Nessun abbonamento o certificato da sollecitare.' })); return; }
    righe.slice(0, MAX_ROWS).forEach(function (r) { add(box, riga(r)); });
    if (righe.length > MAX_ROWS) add(more, el('p', { class: 'muted small', text: 'Mostro i primi ' + MAX_ROWS + ' promemoria su ' + righe.length + ': usa i filtri per restringere.' }));
  }
  var later = debounce(draw, 120);
  var search = el('input', { type: 'search', value: f.q, placeholder: 'Nome, genitore o corso…', oninput: function () { f.q = search.value; later(); } });
  var corsi = [['', 'Tutti i corsi']].concat(S.db.liste.corsi);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Promemoria' }), el('div', { class: 'row' }, avvia, link('Torna alle scadenze', 'scadenze', 'btn'))));
  add(v, altri('Come funziona', [note('', '', ['Qui trovi in un elenco solo chi ha un abbonamento scaduto o in scadenza e chi ha il certificato medico scaduto, in scadenza o mancante.',
    '"Avvisa" apre il messaggio già scritto per quella persona (lo puoi cambiare); "Avvisa uno alla volta" li propone in sequenza, con "Salta" per passare oltre. Il programma segna "contattata" quando apri la chat, ma non può sapere se hai davvero inviato: se non l\'hai fatto, premi "Annulla".',
    'Chi hai contattato sparisce dall\'elenco "Da contattare". Se dopo ' + L.GIORNI_RICONTATTO + ' giorni è ancora da sollecitare, ricompare come "Da ricontattare". Con "Fatto" segni chi hai chiamato al telefono.'])]));
  add(v, tiles);
  add(v, el('div', { class: 'card' }, el('div', { class: 'toolbar' },
    field('Cerca', search),
    field('Stato', select([['fare', 'Da contattare'], ['contattate', 'Già contattate'], ['tutte', 'Tutte']], f.contatto, function (x) { f.contatto = x; draw(); })),
    el('div', { class: 'row' }, button('Stampa l\'elenco', function () {
      if (!ultimo.length) { avviso('Non c\'è niente da stampare con questi filtri.'); return; }
      stampa('Promemoria da fare', 'A.S.D. Gym Art Avezzano · ' + C.isoToIt(today()) + ' · ' + ultimo.length + (ultimo.length === 1 ? ' persona' : ' persone'),
        [{ h: 'Allieva', cell: function (r) { return r.allieva.name; } }, { h: 'Telefono', cls: 'nowrap', cell: function (r) { return r.tel || r.allieva.tel || r.allieva.tel2 || ''; } },
          { h: 'Genitore', cell: function (r) { return r.allieva.genitore || ''; } }, { h: 'Cosa', cell: function (r) { return (r.tipo === 'abbonamento' ? 'Abbonamento' : 'Certificato') + (r.corso && r.tipo === 'abbonamento' ? ' ' + r.corso : ''); } },
          { h: 'Scadenza', cls: 'nowrap', cell: function (r) { return r.stato === 'MANCANTE' ? 'manca' : r.stato === 'IN ATTESA' ? 'entro ' + C.isoToIt(r.scadenza) : C.isoToIt(r.scadenza); } }, { h: 'Fatto', cls: 'nowrap', cell: function () { return '☐'; } }], ultimo);
    }, 'btn-small'))),
    altri('Altri filtri', [el('div', { class: 'toolbar' }, field('Mostra', select([['abbonamento', 'Abbonamenti'], ['certificato', 'Certificati'], ['', 'Abbonamenti e certificati']], f.tipo, function (x) { f.tipo = x; draw(); })),
      field('Corso', select(corsi, f.corso, function (x) { f.corso = x; draw(); })))]),
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
          api('GET', '/api/giornaliere/archivio?nome=' + encodeURIComponent(b.nome)).then(function (r) { leggiCopia(r.testo, '', 'copia del ' + C.isoToIt(b.nome.slice(0, 10)) + ' ' + quando(b.creato).slice(-5)); }, function (e) { avviso(e.message); });
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
  { k: 'sobrio', nome: 'Gestionale', testo: 'Sobrio e chiaro, come un programma di gestione: bordi netti e poche decorazioni. Lo stile predefinito.', p: { side: '#FFFFFF', bg: '#F4F5F7', r: '2px', rb: '2px', pri: '#1B2F6A' } },
  { k: 'club', nome: 'Gym Art', testo: 'I colori della società: barra blu e riga a quattro colori.', p: { side: '#1B2F6A', bg: '#F3F1EC', r: '5px', rb: '4px', pri: '#1B2F6A' } },
  { k: 'squadra', nome: 'Squadra', testo: 'Barra blu a sfumatura, schede bianche su fondo azzurrino, numeri in evidenza.', p: { side: 'linear-gradient(180deg,#2A4DAA,#112B6C)', bg: '#F3F5FA', r: '8px', rb: '5px', pri: '#2B54B8' } },
  { k: 'minimale', nome: 'Minimale', testo: 'Tutto bianco con righe sottili, etichette a pillola e un solo colore viola.', p: { side: '#FFFFFF', bg: '#FAFAFA', r: '6px', rb: '5px', pri: '#7F56D9' } },
  { k: 'morbido', nome: 'Morbido', testo: 'Angoli grandi e ombre leggere, blu brillante.', p: { side: '#F5F5F7', bg: '#F5F5F7', r: '10px', rb: '999px', pri: '#0071E3' } },
  { k: 'vetro', nome: 'Liquid Glass', testo: 'Vetro sfocato con macchie di colore: molto moderno.', p: { side: '#E3EEFF', bg: '#F8DDD0', r: '13px', rb: '999px', pri: '#1C1411' } },
  { k: 'sole', nome: 'Sole', testo: 'Sfondo arancio sfumato, pannelli di vetro, schede color pastello e accenti dorati.', p: { side: 'rgba(255,255,255,.72)', bg: 'linear-gradient(135deg,#FFCB90,#EE8042)', r: '12px', rb: '999px', pri: '#17110C' } }
];
var TEMI_INFO = [['auto', 'Automatico'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']];
var MOVIMENTI_INFO = [['auto', 'Automatico'], ['pieno', 'Pieno'], ['ridotto', 'Ridotto'], ['spento', 'Spento']];
var MOVIMENTO_NOME = { pieno: 'pieno', ridotto: 'ridotto', spento: 'spento' };
/** Il logo della palestra: il file si sceglie dal computer (resta nella cartella dei dati); su ogni dispositivo si decide se mostrarlo nel menu e come sfondo sfocato. */
function riduciLogo(file) {
  if (file.size <= 1500000 && /^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.resolve(file);
  return new Promise(function (ok, no) {
    var rd = new FileReader();
    rd.onerror = function () { no(new Error('Non riesco a leggere l\'immagine.')); };
    rd.onload = function () {
      var img = new Image();
      img.onerror = function () { no(new Error('Questa immagine non si può aprire: scegli un file PNG, JPEG o WebP.')); };
      img.onload = function () {
        var k = Math.min(1, 1400 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { if (b) ok(b); else no(new Error('Non riesco a preparare il logo.')); }, 'image/png');
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(file);
  });
}
function apriAspetto() { var g = document.querySelector('details.gruppo[data-sez="aspetto"]'); if (g) g.open = true; } // the page was drawn again: the group where the person was is opened again
function sezioneLogo() {
  var box = el('div', { class: 'stack' }), file = el('input', { id: 'logo-file', type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: scegli });
  function scegli() {
    var f = file.files[0]; file.value = '';
    if (!f) return;
    riduciLogo(f).then(function (b) { return fetch('/api/logo', { method: 'POST', headers: { 'X-Gymart-Token': TOKEN, 'Content-Type': b.type }, body: b }); }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { if (!r.ok) throw new Error((j && j.errore) || 'Il logo non è stato salvato.'); });
    }).then(function () { return load(); }).then(function () { toast('Logo salvato.'); apriAspetto(); }, function (e) { avviso(e.message); });
  }
  function togli() {
    conferma('L\'immagine che hai scelto viene tolta dal computer.', { titolo: 'Tornare al logo della palestra?', si: 'Torna al logo della palestra', no: 'Tieni la mia immagine' }).then(function (si) { if (si) togliLogo(); });
  }
  function togliLogo() {
    api('DELETE', '/api/logo').then(function () { return load(); }).then(function () { toast('Logo tolto.'); apriAspetto(); }, function (e) { avviso(e.message); });
  }
  function interruttore(k, testo) { var c = el('input', { type: 'checkbox', checked: Aspetto.logo()[k], onchange: function () { var o = {}; o[k] = c.checked; Aspetto.impostaLogo(o); } }); return el('label', { class: 'check' }, c, el('span', { text: testo })); }
  function cursore(k, testo, min, max, unita) {
    var val = el('b', { text: Aspetto.logo()[k] + unita }), r = el('input', { type: 'range', min: String(min), max: String(max), value: String(Aspetto.logo()[k]), 'aria-label': testo, oninput: function () { var o = {}; o[k] = +r.value; Aspetto.impostaLogo(o); val.textContent = r.value + unita; } });
    return el('div', { class: 'field' }, el('span', { class: 'lab' }, testo + ': ', val), r);
  }
  var scuroOra = document.documentElement.getAttribute('data-scheme') === 'dark';
  add(box, el('h3', { text: 'Logo della palestra' }));
  add(box, el('img', { class: 'logo-prova', src: S.logo ? '/api/logo?t=' + encodeURIComponent(TOKEN) + '&v=' + S.logo.v : (scuroOra ? 'logo-scuro.svg' : 'logo-chiaro.svg'), alt: 'Il logo della palestra' }));
  add(box, el('p', { class: 'muted small', text: S.logo ? 'Stai usando un\'immagine tua al posto del logo dell\'associazione.' : 'È il logo dell\'A.S.D. Gym Art Avezzano, ridisegnato in vettoriale: resta nitido a ogni misura. Lo vedi nel menu, nella schermata di avvio, quando salvi, quando chiudi e nelle stampe; si muove al passaggio del mouse (il movimento si sceglie qui sopra).' }));
  add(box, el('div', { class: 'row' }, S.remoto ? null : button(S.logo ? 'Cambia l\'immagine…' : 'Usa un\'immagine mia…', function () { file.click(); }), S.logo && !S.remoto ? button('Torna al logo della palestra', togli) : null, file));
  add(box, S.logo ? interruttore('marchio', 'Mostra la mia immagine nel menu, al posto del logo') : null, interruttore('sfondo', 'Mostra il logo come sfondo, al centro, sfocato'),
    el('div', { class: 'fields' }, cursore('sfocatura', 'Sfocatura dello sfondo', 0, 24, ' px'), cursore('visibilita', 'Visibilità dello sfondo', 3, 30, ' %')),
    el('p', { class: 'muted small', text: 'Un\'immagine tua resta sul computer, nella cartella dei dati, e non viene mandata da nessuna parte. Le scelte di visualizzazione valgono per questo dispositivo.' }));
  return box;
}
function sezioneAnteprime() {
  var on = el('input', { type: 'checkbox', checked: anteprimeAttive(), onchange: function () { try { localStorage.setItem(ANT_CHIAVE, on.checked ? '1' : '0'); } catch (e) {} anteprima.chiudi(); } });
  var sel = select([['600', 'Veloce (0,6 secondi)'], ['900', 'Normale (0,9 secondi)'], ['1500', 'Calmo (1,5 secondi)'], ['2500', 'Lento (2,5 secondi)']], String(ritardoAnteprima()), function (x) { try { localStorage.setItem(ANT_RITARDO, x); } catch (e) {} });
  return el('div', { class: 'stack' }, el('h3', { text: 'Anteprime al passaggio del mouse' }),
    el('p', { class: 'muted small', text: 'Se fermi il mouse per un attimo su una riga, una tessera, una voce del menu o un mese dei rinnovi, compaiono più dettagli e le azioni rapide. Sul telefono e sul tablet non ci sono. Vale per questo dispositivo.' }),
    el('label', { class: 'check' }, on, el('span', { text: 'Mostra le anteprime' })), field('Dopo quanto compaiono', sel));
}
/** I piccoli suoni all'avvio e alla chiusura: li suona il programma dalle casse del computer, quindi la scelta vale per il computer (dal telefono non c'è). */
var SUONI_SCELTE = [['spento', 'Spenti'], ['piano', 'Piano'], ['normale', 'Normale']];
function sezioneSuoni() {
  if (S.remoto) return null;
  var seg = el('div', { class: 'segmenti', role: 'group', 'aria-label': 'Suoni all\'avvio e alla chiusura' }), nota = el('p', { class: 'muted small' }), prova;
  prova = button('Prova i suoni', function () { api('POST', '/api/suoni', { suona: 'prova' }).catch(function () { /* niente */ }); }, 'btn-small');
  var corpo = el('div', { id: 'suoni' }, el('h3', { text: 'Suoni' }),
    el('p', { class: 'muted small', text: 'Un piccolo suono quando il programma si apre e uno quando si chiude. Escono dalle casse di questo computer, con il volume di Windows.' }),
    el('div', { class: 'row' }, seg, prova), nota);
  function disegna(st) {
    clear(seg);
    SUONI_SCELTE.forEach(function (x) {
      add(seg, el('button', { type: 'button', 'aria-pressed': st.livello === x[0] ? 'true' : 'false', text: x[1], onclick: function () {
        api('POST', '/api/suoni', { livello: x[0] }).then(function (nuovo) { disegna(nuovo); }, function (e) { avviso(e.message); });
      } }));
    });
    prova.disabled = st.livello === 'spento';
    nota.textContent = !st.disponibile ? 'Su questo sistema non si sente niente: i suoni funzionano su Windows.' : st.livello === 'spento' ? 'Adesso: spenti.' : st.livello === 'piano' ? 'Adesso: piano.' : 'Adesso: normale.';
  }
  corpo.hidden = true; // si mostra solo se il programma risponde
  api('GET', '/api/suoni').then(function (st) { disegna(st); corpo.hidden = false; }, function () { /* niente da scegliere */ });
  return corpo;
}
function cardAspetto() {
  var box = el('div', { class: 'stili' }), tema = el('div', { class: 'segmenti', role: 'group', 'aria-label': 'Chiaro o scuro' }), mov = el('div', { class: 'segmenti', role: 'group', 'aria-label': 'Movimento' }), movNota = el('p', { class: 'muted small' });
  function disegna() {
    clear(box); clear(tema); clear(mov);
    STILI_INFO.forEach(function (x) {
      var an = el('div', { class: 'anteprima-stile', 'aria-hidden': 'true' }, el('i', { class: 'a-side' }), el('div', { class: 'a-main' }, el('i', { class: 'a-card' }), el('i', { class: 'a-btn' })));
      an.style.setProperty('--p-side', x.p.side); an.style.setProperty('--p-bg', x.p.bg); an.style.setProperty('--p-r', x.p.r); an.style.setProperty('--p-rb', x.p.rb); an.style.setProperty('--p-pri', x.p.pri);
      add(box, el('button', { type: 'button', class: 'stile-scelta', 'aria-pressed': Aspetto.stile() === x.k ? 'true' : 'false', onclick: function () { Aspetto.imposta({ stile: x.k }); disegna(); toast('Stile "' + x.nome + '" attivo su questo dispositivo.'); } },
        an, el('b', { text: x.nome }), el('span', { text: x.testo })));
    });
    TEMI_INFO.forEach(function (t) {
      add(tema, el('button', { type: 'button', 'aria-pressed': Aspetto.tema() === t[0] ? 'true' : 'false', text: t[1], onclick: function () { Aspetto.imposta({ tema: t[0] }); disegna(); } }));
    });
    MOVIMENTI_INFO.forEach(function (m) {
      add(mov, el('button', { type: 'button', 'aria-pressed': Aspetto.movimento() === m[0] ? 'true' : 'false', text: m[1], onclick: function () { Aspetto.imposta({ movimento: m[0] }); disegna(); } }));
    });
    movNota.textContent = 'Adesso: ' + MOVIMENTO_NOME[Aspetto.movimentoEffettivo()] + (Aspetto.movimento() === 'auto' ? ' (segue il sistema).' : '.');
  }
  disegna();
  return el('div', { class: 'card' }, el('h2', { text: 'Aspetto' }),
    el('p', { class: 'muted small', text: 'Scegli lo stile (sette, dal più sobrio al più colorato) e se usare il tema chiaro o scuro. Cambia solo l\'aspetto: i dati e le funzioni sono gli stessi. La scelta vale per questo dispositivo.' }),
    box, el('div', { class: 'row' }, el('span', { class: 'small muted', text: 'Tema:' }), tema),
    sezioneSuoni(),
    sezioneLogo(),
    sezioneAnteprime(),
    altri('Movimento', [
      el('h3', { text: 'Movimento' }),
      el('p', { class: 'muted small', text: 'Pieno: finestre, avvisi e pagine entrano con un piccolo movimento, le cifre scorrono la prima volta, scorrimento morbido con il mouse. Ridotto: solo dissolvenze (predefinito). Spento: niente animazioni. Cambia solo l\'effetto: nulla viene nascosto o tolto.' }),
      el('div', { class: 'row' }, mov), movNota]));
}
/** Assistenza: il file da mandare a chi cura il programma, e il diario tecnico (che cosa è successo al programma, errori compresi). Solo dal computer della segreteria. */
var DIARIO_TIPO = { ERRORE: ['Errore', 'bad'], AVVISO: ['Avviso', 'warn'], INFO: ['Info', 'mute'] };
var ESITO_TIPO = { ok: ['A posto', 'ok'], avviso: ['Da guardare', 'warn'], errore: ['Problema', 'bad'], info: ['Info', 'mute'] };
function cardAssistenza() {
  if (S.remoto) return null; // il file e il diario si leggono solo dal computer della segreteria
  var esito = el('div', { class: 'notes' }), controllo = el('div', { class: 'notes', 'aria-live': 'polite' }), elenco = el('div'), riassunto = el('p', { class: 'small', text: 'Leggo il diario…' }), caricato = false, crea, verifica;
  function mostraDiario() {
    api('GET', '/api/diario?n=40').then(function (j) {
      clear(elenco);
      riassunto.textContent = 'Nelle ultime 24 ore: ' + plurale(j.errori24h, 'errore', 'errori') + ', ' + plurale(j.avvisi24h, 'avviso', 'avvisi') + '.';
      var righe = j.voci || [];
      if (!righe.length) { add(elenco, el('p', { class: 'empty', text: 'Il diario è ancora vuoto.' })); return; }
      add(elenco, el('div', { class: 'scroll-x' }, tabella([
        { h: 'Quando', cls: 'nowrap', cell: function (v) { return C.isoToIt(v.quando.slice(0, 10)) + ' ' + v.quando.slice(11, 19); } },
        { h: 'Tipo', cell: function (v) { var k = DIARIO_TIPO[v.livello] || [v.livello, 'mute']; return chip(k[0], k[1]); } },
        { h: 'Dove', cls: 'nowrap', cell: function (v) { return v.dove; } },
        { h: 'Che cosa', cls: 'diario-testo', cell: function (v) { return v.testo; } }
      ], righe, { col: 99, desc: false }, function () {})));
      add(elenco, el('p', { class: 'muted small', text: 'Le ultime ' + righe.length + ' annotazioni, dalla più recente. Il diario completo è il file ' + j.file + ' nella cartella dei dati: si apre con il Blocco note.' }));
    }, function (e) { riassunto.textContent = ''; clear(elenco); add(elenco, note('bad', e.message)); });
  }
  verifica = button('Controlla questo computer', function () {
    verifica.disabled = true; verifica.textContent = 'Controllo…'; clear(controllo);
    function finito() { verifica.disabled = false; verifica.textContent = 'Controlla questo computer'; }
    api('POST', '/api/controllo').then(function (j) {
      finito();
      add(controllo, j.errori ? note('bad', plurale(j.errori, 'problema', 'problemi') + (j.avvisi ? ' e ' + plurale(j.avvisi, 'cosa da guardare', 'cose da guardare') : '') + '.') : j.avvisi ? note('warn', plurale(j.avvisi, 'cosa da guardare', 'cose da guardare') + '.') : note('ok', 'Tutto a posto.'),
        el('div', { class: 'scroll-x' }, tabella([
          { h: 'Prova', cls: 'nowrap', cell: function (e) { return e.cosa; } },
          { h: 'Esito', cls: 'nowrap', cell: function (e) { var k = ESITO_TIPO[e.stato] || [e.stato, 'mute']; return chip(k[0], k[1]); } },
          { h: 'Che cosa si vede', cls: 'diario-testo', cell: function (e) { return el('div', null, el('span', { text: e.testo }), e.consiglio ? el('div', { class: 'muted small', text: 'Che fare: ' + e.consiglio }) : null); } }
        ], j.esiti, { col: 99, desc: false }, function () {})));
      if (caricato) mostraDiario(); // le cose da guardare finiscono anche nel diario
    }, function (e) { finito(); add(controllo, note('bad', e.message)); });
  }, 'btn-primary');
  crea = button('Crea il file per l\'assistenza', function () {
    crea.disabled = true; crea.textContent = 'Preparo il file…'; clear(esito);
    api('POST', '/api/assistenza').then(function (j) {
      crea.disabled = false; crea.textContent = 'Crea il file per l\'assistenza';
      add(esito, note('ok', 'File pronto: ' + j.file, ['Si trova nella cartella «assistenza» dentro la cartella dei dati. Mandalo a chi cura il programma, con due righe su che cosa stavi facendo.']),
        el('div', { class: 'row' }, button('Scarica il file', function () { download(j.file, j.testo.replace(/\n/g, '\r\n'), 'text/plain'); }, 'btn-primary'),
          button('Apri la cartella', function () { api('POST', '/api/apri-cartella', { sotto: 'assistenza' }).catch(function (e) { avviso(e.message); }); })),
        el('details', null, el('summary', { text: 'Leggi che cosa contiene' }),
          el('pre', { class: 'assistenza-testo', text: j.testo, tabindex: '0', role: 'region', 'aria-label': 'Contenuto del file per l\'assistenza' })));
      if (caricato) mostraDiario(); // la creazione del file è annotata nel diario
    }, function (e) { crea.disabled = false; crea.textContent = 'Crea il file per l\'assistenza'; add(esito, note('bad', e.message)); });
  });
  var det = el('details', { ontoggle: function () { if (det.open && !caricato) { caricato = true; mostraDiario(); } } }, el('summary', { text: 'Diario tecnico: che cosa è successo al programma' }),
    el('p', { class: 'muted small', text: 'Il programma annota da solo quando si apre e si chiude, le copie, gli aggiornamenti e ogni errore, con l\'ora. Non scrive mai nomi, telefoni, importi o note.' }), riassunto, elenco);
  return el('div', { class: 'card' }, el('h2', { text: 'Assistenza' }),
    el('p', { class: 'muted small', text: 'Se qualcosa non funziona, premi prima «Controlla questo computer»: in pochi secondi prova l\'orologio, lo spazio sul disco, le copie, lo scanner, i suoni e gli aggiornamenti, e dice che cosa non va e che cosa fare. Se non basta, crea il file per l\'assistenza e mandalo a chi cura il programma. Il file contiene solo informazioni tecniche e numeri: la versione, quante allieve ci sono, come vanno le copie e gli aggiornamenti, gli ultimi errori. Niente nomi, codici fiscali, telefoni, importi, note, documenti o password: puoi leggerlo qui sotto prima di mandarlo.' }),
    el('div', { class: 'row' }, verifica, crea), controllo, esito, det);
}
function download(name, text, type) {
  var a = el('a', { href: URL.createObjectURL(new Blob([text], { type: type })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
}
function stamp() { return nowIso().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'); }
/** Il file Excel con tutto: si prepara nel browser (xlsxout.js) e si scarica come gli elenchi CSV. */
function scaricaExcel(btn) {
  if (!window.XlsxOut) { avviso('Il programma non sa preparare il file Excel: riprova con Edge o Chrome aggiornati.'); return; }
  var testo = btn.textContent; btn.disabled = true; btn.textContent = 'Preparo il file…';
  XlsxOut.crea(L.tabelleExcel(S.db, today())).then(function (bytes) {
    download('gym-art-' + stamp() + '.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('File Excel pronto: lo trovi nella cartella Download.');
  }, function (e) { avviso('Non riesco a preparare il file Excel: ' + e.message); }).then(function () { btn.disabled = false; btn.textContent = testo; });
}
/** Preferenze (1.25.0): how this person works. The first ones hold for this device (they act at once), the values proposed in the forms for every device (they are saved in the archive). */
function cardPreferenze() {
  var imp = S.db.impostazioni, notes = el('div', { class: 'notes' });
  function segmenti(etichetta, scelte, attuale, fn) {
    var g = el('div', { class: 'segmenti', role: 'group', 'aria-label': etichetta });
    function disegna(sel) { clear(g); scelte.forEach(function (x) { add(g, el('button', { type: 'button', 'aria-pressed': x[0] === sel ? 'true' : 'false', text: x[1], onclick: function () { fn(x[0]); disegna(x[0]); } })); }); }
    disegna(attuale);
    return el('div', { class: 'field' }, el('span', { class: 'lab', text: etichetta }), g);
  }
  var tutto = el('input', { type: 'checkbox', checked: S.det, onchange: function () { impostaDettaglio(tutto.checked); toast(tutto.checked ? 'Mostro tutto: colonne in più e dati facoltativi aperti.' : 'Mostro solo l\'essenziale.'); } });
  var f = { corsoProposto: imp.corsoProposto || '', tipoProposto: imp.tipoProposto || '', metodoProposto: imp.metodoProposto || '', giorniCopia: String(L.giorniCopia(S.db)), orariCorsi: {} };
  S.db.liste.corsi.forEach(function (c) { var o = L.orarioCorso(S.db, c); f.orariCorsi[c] = { giorni: o ? o.giorni.slice() : [], fascia: o ? o.fascia : '' }; });
  var righe = S.db.liste.corsi.map(function (c) {
    var o = f.orariCorsi[c];
    return el('tr', null, el('th', { scope: 'row', text: c }),
      el('td', null, el('div', { class: 'days days-piccoli' }, L.GIORNI.map(function (d) {
        var k = el('input', { type: 'checkbox', checked: o.giorni.indexOf(d) >= 0, 'aria-label': c + ': ' + d, onchange: function () { o.giorni = L.GIORNI.filter(function (x) { return x === d ? k.checked : o.giorni.indexOf(x) >= 0; }); touch(); } });
        return el('label', null, k, d);
      }))),
      el('td', null, input(o, 'fascia', 'text', touch, { placeholder: 'es. 17:00-18:30', maxlength: 30, 'aria-label': c + ': orario', list: 'pref-fasce' })));
  });
  function salva() {
    var err = L.controllaPreferenze(S.db, f);
    clear(notes);
    if (err.length) { add(notes, note('bad', 'Da correggere prima di salvare', err)); portaAlErrore(notes, notes); return; }
    commit(L.salvaPreferenze(S.db, f), 'Preferenze salvate.').then(function (ok) { if (ok) { S.dirty = false; render(); } });
  }
  return el('div', { class: 'card' }, el('h2', { text: 'Preferenze' }),
    el('h3', { text: 'Su questo dispositivo' }),
    el('p', { class: 'muted small', text: 'Valgono subito, solo qui: sul telefono o su un altro computer puoi scegliere diversamente.' }),
    el('div', { class: 'fields' },
      field('Pagina all\'apertura', select(APERTURE, paginaApertura(), function (x) { try { localStorage.setItem('gymart-apertura', x); } catch (e) {} toast('All\'apertura vedrai: ' + APERTURE.filter(function (a) { return a[0] === x; })[0][1] + '.'); }), 'Quella che vedi quando apri il programma.'),
      segmenti('Grandezza del testo', [['normale', 'Normale'], ['grande', 'Grande']], Aspetto.testo(), function (x) { Aspetto.imposta({ testo: x }); }),
      segmenti('Spazio negli elenchi', [['comoda', 'Comodo'], ['compatta', 'Compatto']], Aspetto.densita(), function (x) { Aspetto.imposta({ densita: x }); })),
    el('label', { class: 'check' }, tutto, el('span', { text: 'Mostra tutto: colonne in più negli elenchi, dati facoltativi già aperti, valori scritti sui grafici' })),
    el('h3', { text: 'Valori proposti (su tutti i dispositivi)' }),
    el('p', { class: 'muted small', text: 'Il programma li mette già nei moduli: si possono sempre cambiare.' }),
    el('div', { class: 'fields' },
      field('Corso nella nuova iscrizione', select([['', '(nessuno)']].concat(S.db.liste.corsi), f.corsoProposto, function (x) { f.corsoProposto = x; touch(); })),
      field('Tipo di abbonamento', select([['', '(nessuno)']].concat(L.TIPI.map(function (t) { return t.nome; })), f.tipoProposto, function (x) { f.tipoProposto = x; touch(); })),
      field('Metodo di pagamento', select([['', '(nessuno)']].concat(S.db.liste.metodi), f.metodoProposto, function (x) { f.metodoProposto = x; touch(); })),
      field('Ricordami di scaricare una copia', select([['7', 'Ogni settimana'], ['14', 'Ogni due settimane'], ['30', 'Ogni mese'], ['60', 'Ogni due mesi'], ['0', 'Mai']], f.giorniCopia, function (x) { f.giorniCopia = x; touch(); }), 'In Inizio, se l\'ultima copia scaricata è più vecchia.')),
    el('h3', { text: 'Giorni e orario abituali dei corsi' }),
    el('p', { class: 'muted small', text: 'Nella nuova iscrizione, scelto il corso, il programma mette questi giorni e questo orario (se non li hai già scelti tu).' }),
    el('div', { class: 'scroll-x' }, el('table', { class: 'orari' }, el('thead', null, el('tr', null, el('th', { text: 'Corso' }), el('th', { text: 'Giorni' }), el('th', { text: 'Orario' }))), el('tbody', null, righe))),
    el('datalist', { id: 'pref-fasce' }, S.db.liste.fasce.map(function (x) { return el('option', { value: x }); })),
    notes, el('div', { class: 'actions' }, button('Salva le preferenze', salva, 'btn-primary')));
}
function vImpostazioni(v) {
  var db = S.db, f = { stagione: db.impostazioni.stagione, preavvisoAbb: String(db.impostazioni.preavvisoAbb), corsi: db.liste.corsi.join('\n'), fasce: db.liste.fasce.join('\n'), messaggioScadenza: L.modelloMessaggio(db, 'messaggioScadenza'), messaggioAbbScaduto: L.modelloMessaggio(db, 'messaggioAbbScaduto'),
    preavvisoCert: String(db.impostazioni.preavvisoCert), messaggioCertificato: L.modelloMessaggio(db, 'messaggioCertificato'), messaggioCertScaduto: L.modelloMessaggio(db, 'messaggioCertScaduto'), messaggioCertMancante: L.modelloMessaggio(db, 'messaggioCertMancante'), messaggioCertAttesa: L.modelloMessaggio(db, 'messaggioCertAttesa'), giorniCertificato: String(L.giorniAttesaCert(db)), metodi: db.liste.metodi.join('\n'),
    legale: db.impostazioni.legale, ente: db.impostazioni.ente, codice: db.impostazioni.codice, cfAssociazione: db.impostazioni.cfAssociazione,
    tariffario: db.tariffario.map(function (p) { var o = { pacchetto: p.pacchetto, frequenza: p.frequenza, iscrizione: p.iscrizione ? String(p.iscrizione).replace('.', ',') : '' }; L.TIPI.forEach(function (t) { o[t.nome] = typeof p[t.nome] === 'number' ? String(p[t.nome]).replace('.', ',') : ''; }); return o; }) };
  var notes = el('div', { class: 'notes' }), tbody = el('tbody');
  function area(k) { var a = el('textarea', { rows: 7, value: f[k], oninput: function () { f[k] = a.value; touch(); } }); return a; }
  function drawTariff() {
    clear(tbody);
    f.tariffario.forEach(function (p, i) {
      tbody.appendChild(el('tr', null, ['pacchetto', 'frequenza', 'Mensile', 'Trimestrale', 'Annuale', 'iscrizione'].map(function (k) { return el('td', null, input(p, k, 'text', touch, { 'aria-label': k + ' riga ' + (i + 1), inputmode: k === 'pacchetto' || k === 'frequenza' ? null : 'decimal' })); }),
        el('td', null, button('Togli', function () { f.tariffario.splice(i, 1); touch(); drawTariff(); }, 'btn-small', 'Togli la riga ' + (i + 1) + (p.pacchetto ? ': ' + p.pacchetto : '')))));
    });
  }
  function salva() {
    var err = L.controllaImpostazioni(f);
    clear(notes); if (notes2) clear(notes2);
    if (err.length) { add(notes, note('bad', 'Da correggere prima di salvare', err)); if (notes2) add(notes2, note('bad', 'Da correggere prima di salvare', err)); portaAlErrore(notes2 || notes, notes2 || notes); return; }
    commit(L.salvaImpostazioni(S.db, f), 'Impostazioni salvate.').then(function (ok) { if (ok) go('impostazioni'); });
  }
  drawTariff();
  add(v, el('h1', { text: 'Impostazioni' }));
  add(v, cardPreferenze());
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Aiuto e visita guidata' }),
    el('p', { class: 'muted small', text: 'La visita guidata ti porta nelle pagine principali e dice che cosa fare, passo passo: si mostra da sola la prima volta su ogni dispositivo. Il manuale spiega ogni compito con i passi numerati.' }),
    el('div', { class: 'row' }, button('Ricomincia il tutorial', function () { if (window.Tutorial) Tutorial.avvia(); }, 'btn-primary'), link('Apri il manuale', 'guida', 'btn'))));
  if (!S.remoto) add(v, cardSicurezza());
  add(v, cardAspetto());
  add(v, el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Nuova stagione' }), link('Avvia la procedura', 'stagione', 'btn btn-primary')),
    el('p', { class: 'muted small', text: 'Stagione attuale: ' + S.db.impostazioni.stagione + '. Procedura guidata per rinnovare o chiudere le iscrizioni aperte all\'inizio dell\'anno, senza cancellare nulla.' })));
  var notes2;
  /* the texts of WhatsApp for the parents: one for each situation, with an example under each */
  var esempi = {};
  function esempio(k) {
    var st = k === 'messaggioAbbScaduto' || k === 'messaggioCertScaduto' ? 'SCADUTO' : k === 'messaggioCertMancante' ? 'MANCANTE' : k === 'messaggioCertAttesa' ? 'IN ATTESA' : 'IN SCADENZA', giorni = st === 'SCADUTO' ? -5 : st === 'MANCANTE' ? null : st === 'IN ATTESA' ? 5 : 10;
    var finto = { impostazioni: Object.assign({}, db.impostazioni), iscrizioni: [], pagamenti: [], tariffario: [], allieve: [], liste: db.liste }; finto.impostazioni[k] = f[k];
    var iscr = k.indexOf('Abb') >= 0 || k === 'messaggioScadenza' ? { id: 'x', tipo: 'Trimestrale', corso: 'Base' } : null;
    return L.testoAvviso(finto, { tipo: iscr ? 'abbonamento' : 'certificato', stato: st, allieva: { name: 'Rossi Maria', genitore: 'Rossi Paolo' }, iscrizione: iscr, corso: iscr ? 'Base' : '', scadenza: giorni === null ? '' : piuGiorni(today(), giorni), giorni: giorni });
  }
  function aggiornaEsempio(k) { esempi[k].textContent = 'Esempio: ' + esempio(k); }
  var campiMsg = Object.keys(L.MODELLI).map(function (k) {
    var a = el('textarea', { rows: 4, value: f[k], oninput: function () { f[k] = a.value; touch(); aggiornaEsempio(k); } });
    a.setAttribute('data-msg', k); a.setAttribute('aria-label', L.MODELLI[k].nome); esempi[k] = el('p', { class: 'muted small' }); aggiornaEsempio(k);
    return el('div', { class: 'field wide' }, el('label', { text: L.MODELLI[k].nome }), a, esempi[k]);
  });
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Messaggi per i genitori' }),
    el('p', { class: 'muted small', text: 'I testi di WhatsApp per avvisare di una scadenza, uno per ogni situazione. Il programma sostituisce: ' + L.SEGNAPOSTO.map(function (x) { return '{' + x + '}'; }).join(' ') + '. Prima di inviare si può sempre cambiare il testo di quella persona.' }),
    el('div', { class: 'fields' }, campiMsg),
    notes2 = el('div', { class: 'notes' }),
    el('div', { class: 'actions' }, button('Salva i messaggi', salva, 'btn-primary'), button('Ripristina i testi di partenza', function () {
      Object.keys(L.MODELLI).forEach(function (k) { f[k] = L.MODELLI[k].testo; }); touch();
      campiMsg.forEach(function (box) { var ta = box.querySelector('textarea'); ta.value = f[ta.getAttribute('data-msg')]; aggiornaEsempio(ta.getAttribute('data-msg')); });
    }))));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Stagione, corsi e tariffe' }),
    el('div', { class: 'fields' }, field('Stagione sportiva', input(f, 'stagione', 'text', touch), 'Per esempio 2026/2027.'), field('Giorni di preavviso per gli abbonamenti', input(f, 'preavvisoAbb', 'text', touch, { inputmode: 'numeric' }), 'Quanti giorni prima un abbonamento risulta "in scadenza".'),
      field('Giorni di preavviso per i certificati', input(f, 'preavvisoCert', 'text', touch, { inputmode: 'numeric' }), 'Quanti giorni prima un certificato medico risulta "in scadenza".'),
      field('Giorni per consegnare il certificato', input(f, 'giorniCertificato', 'text', touch, { inputmode: 'numeric' }), 'Chi si iscrive senza certificato risulta "in attesa" per questi giorni dall\'inizio; poi "mancante". Da 0 a 90.'),
      field('Corsi', area('corsi'), 'Uno per riga.'), field('Fasce orarie', area('fasce'), 'Una per riga, per esempio 17:00-18:30.'), field('Metodi di pagamento', area('metodi'), 'Uno per riga.')),
    el('h3', { text: 'Dati dell\'associazione' }),
    el('p', { class: 'muted small', text: 'Compaiono nella richiesta di certificato medico e nelle ricevute. Si possono lasciare vuoti.' }),
    el('div', { class: 'fields' }, field('Legale rappresentante', input(f, 'legale', 'text', touch)), field('Ente di affiliazione', input(f, 'ente', 'text', touch)),
      field('Codice di affiliazione', input(f, 'codice', 'text', touch)), field('Codice fiscale dell\'associazione', input(f, 'cfAssociazione', 'text', touch), 'Stampato in fondo alle ricevute.')),
    el('h3', { text: 'Tariffario' }),
    el('p', { class: 'muted small', text: 'Prezzi in euro per tipo di abbonamento. Lascia vuoto un prezzo se quell\'abbonamento non è previsto per la tariffa.' }),
    el('div', { class: 'scroll-x' }, el('table', { class: 'tariff' }, el('thead', null, el('tr', null, ['Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Annuale', 'Iscrizione', ''].map(function (h) { return h ? el('th', { text: h }) : el('th', null, el('span', { class: 'sr-only', text: 'Togli la riga' })); }))), tbody)),
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
          S.sceltaCartella ? button('Scegli…', function () { api('POST', '/api/scegli-cartella').then(function (j) { if (j.cartella) { fld.cartella = j.cartella; campo.value = j.cartella; } }, function (e) { avviso(e.message); }); }) : null,
          button('Salva la cartella', function () {
            api('POST', '/api/copie2', { cartella: fld.cartella }).then(function (j) {
              S.copie2 = j.copie2; drawC2();
              toast(!j.copie2.cartella ? 'Seconda copia disattivata.' : j.copie2.errore ? 'Cartella salvata, ma la copia non è riuscita.' : 'Seconda cartella salvata.');
            }, function (e) { avviso(e.message); });
          }),
          c.cartella ? button('Copia adesso', function () { api('POST', '/api/copie2/adesso').then(function (j) { S.copie2 = j.copie2; drawC2(); toast('Copia fatta nella seconda cartella.'); }, function (e) { aggiornaCopie2().then(drawC2); avviso(e.message); }); }) : null)),
      !c.cartella ? null : c.errore ? note('bad', c.errore) : el('p', { class: 'small', text: c.ultima ? 'Ultima copia nella seconda cartella: ' + quando(c.ultima) + '.' : 'Nessuna copia ancora fatta nella seconda cartella.' }));
  }
  drawC2();
  var restore = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Scegli la copia di sicurezza da ripristinare', onchange: function () { if (restore.files[0]) ripristina(restore.files[0]); restore.value = ''; } });
  add(v, S.remoto ? null : el('div', { class: 'card' }, el('h2', { text: 'Dati su questo computer' }),
    el('p', { text: 'L\'archivio, il registro e le copie automatiche sono in questa cartella:' }), el('div', { class: 'path', text: S.cartella }),
    el('div', { class: 'row' }, button('Apri la cartella', function () { api('POST', '/api/apri-cartella').catch(function (e) { avviso(e.message); }); }),
      button('Scarica una copia di sicurezza', function () { scaricaCopiaSicurezza().then(drawUltima); }),
      button('Ripristina da una copia…', function () { restore.click(); }), restore),
    ultima, c2box,
    el('p', { class: 'muted small', text: 'Il programma fa da solo una copia dell\'archivio prima di modificarlo (al massimo una ogni 10 minuti, e sempre prima di un\'importazione, di un ripristino o di un\'eliminazione; conserva le ultime 200) nella sottocartella "copie". Tieni anche una copia fuori dal computer, per esempio su una chiavetta.' })));

  var cp = S.remoto ? null : cardPassword(); if (cp) add(v, cp);
  if (!S.remoto) add(v, cardRete());

  /* import */
  var imp = el('div'), files = el('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: true, 'aria-label': 'Scegli il file Excel o i file CSV da importare', onchange: function () { if (files.files.length) leggiFogli(files.files, function () { drawImport(); }); } });
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
  add(v, S.remoto ? null : el('div', { class: 'card' }, el('h2', { text: 'Importa dal file Excel o dal foglio Google' }),
    note('ok', 'Il file resta su questo computer', ['Viene letto dal programma, qui, senza internet: non viene caricato da nessuna parte e non se ne conserva una copia.']),
    el('ol', { class: 'steps' }, el('li', { text: 'Con Excel: scegli qui sotto il file .xlsx. Il programma legge i fogli ANAGRAFICA, ISCRIZIONI e PAGAMENTI e salta gli altri.' }), el('li', { text: 'Con Google Sheets: menu File, Scarica, "Microsoft Excel (.xlsx)" (oppure ogni foglio come .csv) e scegli il file.' }), el('li', { text: 'Prima di scrivere vedi un riepilogo e puoi annullare.' })),
    files,
    el('p', { class: 'muted small', text: 'Prima di scrivere vedi un riepilogo. Un\'allieva già presente non viene sovrascritta: si completano solo i campi vuoti. Dall\'anagrafica arrivano anche i certificati medici; i pagamenti si agganciano alle iscrizioni già importate. Finita l\'importazione cancella il file scaricato dalla cartella Download (contiene dati personali), ma non l\'originale: tienilo come archivio.' }),
    imp));
  drawImport();

  /* export */
  var excel = el('button', { type: 'button', class: 'btn btn-primary', text: 'Scarica un file Excel (.xlsx)', onclick: function () { scaricaExcel(excel); } });
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Esporta per Excel' }),
    el('p', { class: 'muted small', text: 'Un solo file con cinque fogli: Allieve, Iscrizioni, Pagamenti, Certificati e Note. Date e importi sono veri, così in Excel si ordina, si filtra e si somma. Serve per guardare, filtrare e stampare: per cambiare i dati si usa il programma.' }),
    el('div', { class: 'row' }, excel),
    el('p', { class: 'muted small', text: 'Oppure un elenco alla volta, in formato CSV:' }),
    el('div', { class: 'row' }, button('Elenco allieve (.csv)', function () { download('allieve-' + stamp() + '.csv', '\uFEFF' + L.csvAllieve(S.db), 'text/csv'); }, 'btn-small'), button('Elenco iscrizioni (.csv)', function () { download('iscrizioni-' + stamp() + '.csv', '\uFEFF' + L.csvIscrizioni(S.db, today()), 'text/csv'); }, 'btn-small'),
      button('Elenco pagamenti (.csv)', function () { download('pagamenti-' + stamp() + '.csv', '\uFEFF' + L.csvPagamenti(S.db), 'text/csv'); }, 'btn-small')),
    el('p', { class: 'muted small', text: 'I file esportati contengono dati personali e non sono cifrati, nemmeno quando l\'archivio ha una password: conservali con attenzione. Versione del programma: ' + S.versione + '.' })));
  var ca = cardAssistenza(); if (ca) add(v, ca);
  // one closed line for each group: the page is calm, the person opens only what she needs
  [].slice.call(v.children).forEach(function (n) {
    var h = n.classList && n.classList.contains('card') ? n.querySelector('h2') : null;
    if (h) { var segno = document.createComment(''); v.replaceChild(segno, n); v.replaceChild(sezione(h.textContent, SEZIONI_DESCR[h.textContent] || '', n), segno); } // the card moves inside the section: a mark keeps its place
  });
}
/** Downloads a safety copy of the archive and writes down the day (Inizio stops reminding it). */
function scaricaCopiaSicurezza() {
  return api('GET', '/api/copia').then(function (j) {
    download('gymart-copia-' + stamp() + '.json', j.testo, 'application/json');
    return commit(L.segnaCopia(S.db, today()), j.protetto ? 'Copia scaricata: è cifrata, si apre con la password di oggi.' : 'Copia scaricata: conservala fuori dal computer.').then(function (ok) { if (ok && parseHash().view === 'inizio') render(); });
  }, function (e) { avviso(e.message); });
}
function plurale(n, uno, molti) { return n + ' ' + (n === 1 ? uno : molti); }
/** Reads the files chosen for the import: CSV files, or an Excel workbook (.xlsx, every sheet). Everything happens in this window: nothing is sent anywhere. */
function leggiFile(f) {
  if (/\.xls$/i.test(f.name)) return Promise.reject(new Error('"' + f.name + '" è un file Excel vecchio (.xls). Aprilo in Excel e salvalo come cartella di lavoro (.xlsx), poi scegli quello.'));
  if (/\.xls[xm]$/i.test(f.name)) return f.arrayBuffer().then(function (b) { return Xlsx.leggiXlsx(new Uint8Array(b)); }).then(function (fogli) { return fogli.map(function (x) { return { name: f.name + ' · foglio ' + x.nome, rows: x.rows, foglio: true }; }); });
  return f.text().then(function (t) { return [{ name: f.name, rows: L.leggiCsv(t) }]; });
}
function leggiFogli(fileList, poi) {
  Promise.all(Array.prototype.map.call(fileList, leggiFile)).then(function (nested) {
    var list = [].concat.apply([], nested);
    var fogli = list.map(function (x) { var r = L.riconosciFoglio(x.rows); r.name = x.name; r.foglio = x.foglio; return r; }), db = S.db, reg = [], parti = [], adesso = nowIso();
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
    fogli.filter(function (x) { return !x.tipo; }).forEach(function (x) { parti.push(x.foglio ? { kind: '', titolo: x.name, righe: ['Non è ANAGRAFICA, ISCRIZIONI o PAGAMENTI: questo foglio non viene importato.'] } : { kind: 'bad', titolo: x.name, righe: ['Non riconosco questo file: deve essere il foglio ANAGRAFICA, ISCRIZIONI o PAGAMENTI, come file Excel (.xlsx) o scaricato come CSV.'] }); });
    if (!fogli.some(function (x) { return x.tipo; })) parti.unshift({ kind: 'bad', titolo: 'Nessun foglio da importare', righe: ['Cerco i fogli con le colonne "Cognome e Nome" (anagrafica), "Allieva", "Corso", "Tipo abbonamento" (iscrizioni) e "Data pagamento", "Importo" (pagamenti), nelle prime righe.'] });
    S.imp = { parti: parti, db: db, registro: reg, rev: S.rev };
    poi();
  }, function (e) { avviso((e && e.message) || 'Non riesco a leggere i file scelti.'); });
}
/** Password is switched off in the interface for now. An archive that is already protected can still be opened (lock page) and unprotected here. */
/** Access from phones: switched on from this computer only. The state is read from the program every time the card is drawn. */
function cardRete() {
  var card = el('div', { class: 'card', id: 'rete' }, el('div', { class: 'card-head' }, el('h2', { text: 'Accesso dal telefono' })), el('div', { class: 'row' }, el('span', { class: 'spin' }), 'Controllo lo stato…'));
  function ridisegna(j) {
    var st = j.stato, f = { nuova: '', ripeti: '', attuale: '' }, notes = el('div', { class: 'notes' });
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
          button('Spegni l\'accesso dal telefono', function () { conferma('I telefoni non potranno più aprire il programma finché non lo riaccendi.', { titolo: 'Spegnere l\'accesso dal telefono?', si: 'Spegni l\'accesso', no: 'Lascialo acceso', pericolo: true }).then(function (si) { if (si) invia('/api/rete', { attiva: false }, 'Accesso dal telefono spento.'); }); }, 'btn-danger')));
    }
    if (j.avvioDisponibile) {
      var cb = el('input', { type: 'checkbox', checked: j.avvioWindows, onchange: function () { api('POST', '/api/rete/avvio', { attiva: cb.checked }).then(function (r) { toast(cb.checked ? 'Il programma partirà con Windows.' : 'Avvio con Windows tolto.'); }, function (e) { cb.checked = !cb.checked; avviso(e.message); }); } });
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
      if (S.dirty) { avviso('Salva (o annulla) prima le modifiche alle impostazioni qui sopra.'); return; }
      if (!f.attuale) { errore('Scrivi la password attuale.'); return; }
      conferma('I dati torneranno leggibili da chiunque apra i file su questo computer.', { titolo: 'Togliere la protezione?', si: 'Togli la protezione', no: 'Lasciala', pericolo: true }).then(function (si) {
        if (!si) return;
        api('POST', '/api/password', { attuale: f.attuale, nuova: '' }).then(function (j) { S.protetto = j.protetto; toast(j.avviso || 'Protezione tolta.'); go('impostazioni'); },
          function (e) { errore(e.status === 401 ? 'La password attuale non è giusta.' : e.message); });
      });
    }, 'btn-danger')));
}
function ripristina(file) { file.text().then(function (t) { leggiCopia(t, '', file.name); }); }
/** Reads a copy through the program (it may be encrypted), shows what it holds and, on confirmation, puts it in place of the archive. */
function leggiCopia(testo, password, nome) {
  var file = { name: nome };
  api('POST', '/api/decifra', { testo: testo, password: password }).then(function (j) {
    var db = j.db, bad = L.validaArchivio(db);
    if (bad) { avviso(bad); return; }
    conferma('L\'archivio di adesso (' + plurale(S.db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(S.db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ') con la copia "' + file.name + '" (' + plurale(db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ')?\n\nPrima della sostituzione il programma conserva una copia dell\'archivio attuale.', { titolo: 'Sostituire l\'archivio con questa copia?', si: 'Sostituisci l\'archivio', no: 'Annulla', pericolo: true }).then(function (si) {
      if (!si) return;
      commit({ db: L.completa(db, today()), registro: [{ allieva: '', operazione: 'Ripristino da copia', campo: '', prima: '', dopo: '', nota: file.name }] }, 'Archivio ripristinato.', true).then(function (ok) { if (ok) go('inizio'); });
    });
  }, function (e) {
    if (e.servePassword || (e.status === 401 && password)) {
      chiediPassword(e.servePassword ? 'Questa copia è protetta da una password diversa da quella in uso. Scrivi la password che c\'era quando la copia è stata fatta.' : 'La password non è giusta. Riprova.', 'Copia protetta').then(function (pw) { if (pw) leggiCopia(testo, pw, nome); });
      return;
    }
    avviso(e.message);
  });
}

/* ---------- Guida ---------- */
/** Il manuale: ogni compito di tutti i giorni in pochi passi numerati, scritti con i nomi esatti dei pulsanti. */
var COMPITI = [
  { t: 'Iscrivere una persona nuova', passi: [
    'Premi «Nuova iscrizione» in alto a destra.',
    'Scrivi cognome e nome, data di nascita, telefono e il genitore.',
    'Scegli il corso, spunta i giorni e scegli il tipo di abbonamento (mensile, trimestrale o annuale). Tariffa e scadenza le propone il programma.',
    'Certificato medico: se la persona lo porta dopo (succede spesso) lascia «Lo porta dopo»; se ce l\'ha già con sé scegli «Lo ha portato adesso» e scrivi il tipo e la data di rilascio.',
    'Premi «Salva allieva e iscrizione»: si apre la pagina dell\'iscrizione.',
    'Se la persona paga subito, nella stessa pagina scrivi importo, metodo e data e premi «Registra il pagamento».'],
    consiglio: 'Se la persona è già in elenco (per esempio si iscrive a un altro corso) scegli il suo nome nel campo «Allieva»: i campi dell\'allieva spariscono e si salva solo la nuova iscrizione.' },
  { t: 'Registrare il certificato medico arrivato dopo', passi: [
    'Apri «Scadenze» e la scheda «In attesa» (oppure la pagina «Certificati»).',
    'Trova la persona e premi «Registra certificato».',
    'Scegli il tipo (agonistico, non agonistico o ludico-motoria) e scrivi la data di rilascio. La scadenza, un anno dopo, la propone il programma: cambiala solo se sul certificato ce n\'è un\'altra.',
    'Premi «Salva il certificato»: la persona esce dall\'elenco.',
    'Se vuoi conservare anche il documento, apri la scheda dell\'allieva e nel riquadro «Certificato medico» usa «Scansiona», «Allega un file» o «Fotografa».'],
    consiglio: 'Per ogni iscrizione ci deve essere il certificato. Chi si iscrive senza risulta «In attesa» per i giorni scelti in Impostazioni (15 all\'inizio); passato il termine risulta «Manca». Il certificato per attività ludico-motoria non vale per lo sport: resta segnalato finché non viene sostituito.' },
  { t: 'Scansionare il certificato con lo scanner', passi: [
    'Apri la scheda dell\'allieva (cerca il nome in alto a sinistra).',
    'Nel riquadro «Certificato medico» premi «Scansiona»: si apre la finestra dello scanner.',
    'Metti il foglio nello scanner, scansiona e conferma.',
    'Il programma salva il file e chiede tipo e date: scrivile e premi «Salva il certificato».'],
    consiglio: 'Se non vedi «Scansiona» (nessuno scanner collegato, o sei dal telefono) usa «Allega un file» per un PDF o un\'immagine già pronta, oppure «Fotografa» dal telefono.' },
  { t: 'Registrare un pagamento', passi: [
    'Apri l\'iscrizione: da «Iscrizioni» oppure dalla scheda dell\'allieva.',
    'Nella parte «Pagamenti» scrivi importo, metodo (contanti, bonifico, POS) e data.',
    'Premi «Registra il pagamento».',
    'La ricevuta in PDF si scarica con «Ricevuta (PDF)».'],
    consiglio: 'Un bonifico resta «da verificare» finché non lo confermi con «Segna verificato», dopo aver controllato l\'estratto conto. Contanti e POS non hanno bisogno di verifica.' },
  { t: 'Rinnovare un abbonamento', passi: [
    'Apri «Scadenze» e la scheda «Scaduti» o «In scadenza» degli abbonamenti.',
    'Premi «Rinnova» sulla riga della persona.',
    'Il programma apre il nuovo periodo con gli stessi dati, a partire dalla scadenza del vecchio, che passa nello storico.',
    'Controlla corso, giorni e quota; poi registra il pagamento.']},
  { t: 'Avvisare un genitore su WhatsApp', passi: [
    'In «Scadenze» o «Certificati» premi «Avvisa» sulla riga della persona.',
    'Controlla il numero di telefono e il testo: lo puoi cambiare.',
    'Premi «Apri WhatsApp»: si apre la chat con il messaggio già scritto. Lo invii tu.',
    'Tornando al programma la persona risulta «Avvisata». Se alla fine non hai inviato, premi «Annulla».'],
    consiglio: 'Per avvisare più persone di seguito: «Scadenze» → «Promemoria in blocco» → «Avvisa uno alla volta». I testi dei messaggi si cambiano in Altro → Impostazioni → «Messaggi per i genitori».' },
  { t: 'Scrivere una nota o un promemoria', passi: [
    'Apri «Calendario» e premi «Nuova nota» (oppure «Aggiungi una nota» nella scheda di un\'allieva).',
    'Scrivi il testo. Se vuoi ricordartelo in un giorno preciso scegli la data; per una chiusura o un periodo scrivi anche «Fino al».',
    'Se riguarda una persona scegli l\'allieva: la nota compare anche nella sua scheda.',
    'Premi «Salva la nota». Quando arriva il giorno la nota compare in «Inizio»; quando l\'hai fatta spunta la casella.'],
    consiglio: 'Le note non sono cifrate: niente dati sanitari. «Note» in «Calendario» le mostra tutte, con la ricerca.' },
  { t: 'Guardare le scadenze nel calendario', passi: [
    'Apri «Calendario»: ogni giorno ha i segni di quello che succede (note, abbonamenti che scadono, certificati, compleanni).',
    'Premi un giorno per vedere i dettagli qui sotto; con le frecce della tastiera ti sposti tra i giorni.',
    'In alto scegli che cosa mostrare e cambi mese con le frecce.'],
    consiglio: 'A dicembre e a marzo il calendario dice anche quanti abbonamenti trimestrali scadono nel mese.' },
  { t: 'Prepararsi ai rinnovi di dicembre e di marzo', passi: [
    'Apri «Grafici»: la tabella «Rinnovi dei prossimi mesi» dice quanti abbonamenti scadono ogni mese e quanto incasserai.',
    'Nella pagina «Inizio» la riga «Rinnovi in arrivo» ricorda i mesi prossimi.',
    'A inizio mese apri «Scadenze» e avvisa chi deve rinnovare; «Rinnova» apre il nuovo periodo.'],
    consiglio: 'I trimestrali partiti a settembre scadono a dicembre, quelli partiti a dicembre scadono a marzo: sono i due mesi dei rinnovi.' },
  { t: 'Aprire la nuova stagione (settembre)', passi: [
    'A settembre apri «Altro» → «Nuova stagione».',
    'Controlla la nuova stagione e la data da cui partono i nuovi periodi.',
    'Per ogni iscrizione aperta scegli «Rinnova» (stessi dati dalla nuova data), «Chiudi» (non torna) o «Lascia com\'è».',
    'Premi «Conferma la nuova stagione»: prima il programma fa una copia dei dati.']},
  { t: 'Cercare una persona o una pagina', passi: [
    'Scrivi nella casella «Cerca o vai a…», in alto a sinistra (da tastiera: Ctrl + K).',
    'Scrivi un pezzo del nome o del telefono, oppure il nome di una pagina (per esempio «verifica» o «copie»).',
    'Premi Invio o scegli dall\'elenco.']},
  { t: 'Correggere un errore', passi: [
    'Dati sbagliati di una persona: apri la sua scheda, correggi e premi «Salva».',
    'Iscrizione fatta per errore: aprila e spunta «Annullata» (resta nel registro); con «Elimina» la togli del tutto.',
    'Ogni modifica è scritta nel «Registro» (Altro → Registro): si vede che cosa è cambiato e quando.'],
    consiglio: 'Prima di una modifica grossa il programma fa da solo una copia dei dati.' },
  { t: 'Fare una copia di sicurezza', passi: [
    'Apri Altro → Impostazioni → «Sicurezza dei dati».',
    'Premi «Fai una copia ora».',
    'In «Dati su questo computer» controlla che la «Seconda copia» (per esempio una chiavetta) sia attiva.'],
    consiglio: 'Il programma salva da solo una copia ogni giorno. La regola: almeno tre copie, su due supporti diversi, una fuori sede.' },
  { t: 'Portare i dati in Excel', passi: [
    'Apri Altro → Impostazioni → «Esporta per Excel».',
    'Premi «Scarica un file Excel (.xlsx)»: il file si salva nella cartella Download.',
    'Aprilo con Excel: ci sono cinque fogli (Allieve, Iscrizioni, Pagamenti, Certificati, Note), con date e importi veri che si ordinano, si filtrano e si sommano.'],
    consiglio: 'Il file serve per guardare e stampare: se correggi un dato lì, nel programma non cambia. Contiene dati personali e non è cifrato: conservalo con cura.' },
  { t: 'Usare il programma dal telefono', passi: [
    'Sul computer: Altro → Impostazioni → «Accesso dal telefono»: scegli una password e attiva.',
    'Sul telefono apri l\'indirizzo che il programma mostra (stessa rete Wi-Fi) e accedi con la password.',
    'Da telefono si lavora come qui; restano solo sul computer importazione, ripristino e copie.'],
    consiglio: 'I passi completi sono nel file GUIDA_TELEFONO.txt accanto al programma. Il computer deve restare acceso.' },
  { t: 'Se il programma dà un errore o non funziona', passi: [
    'Apri Altro → Impostazioni → «Assistenza».',
    'Premi «Controlla questo computer»: in pochi secondi il programma prova l\'orologio, lo spazio sul disco, le copie, lo scanner, i suoni e gli aggiornamenti, e per ogni cosa dice se è a posto o che cosa fare.',
    'Se il problema resta, premi «Crea il file per l\'assistenza»: il programma prepara un file di testo.',
    'Se vuoi vedere che cosa c\'è dentro, apri «Leggi che cosa contiene»: solo informazioni tecniche e numeri, niente nomi, telefoni o importi.',
    'Premi «Scarica il file» (oppure «Apri la cartella») e mandalo a chi cura il programma, con due righe su che cosa stavi facendo quando è successo.'],
    consiglio: 'Il programma annota da solo, nel «Diario tecnico» della stessa sezione, quando si apre e si chiude, le copie, gli aggiornamenti e ogni errore: non serve ricordarsi che cosa è successo.' },
  { t: 'Se qualcosa non torna', passi: [
    'Il certificato è arrivato ma la persona risulta «Manca»: registralo (vedi «Registrare il certificato medico arrivato dopo»).',
    'Una persona risulta «In attesa» da troppo tempo, o troppo poco: i giorni si cambiano in Altro → Impostazioni → «Stagione, corsi e tariffe» → «Giorni per consegnare il certificato».',
    'Il programma dice che esiste già un\'allieva con lo stesso nome: guarda la data di nascita; se è un\'altra persona salva lo stesso, altrimenti scegli quella già presente.',
    'Non trovo una persona: nella pagina «Allieve» scegli «Tutte» (le archiviate non compaiono nell\'elenco di tutti i giorni).',
    'Ho chiuso la finestra: non c\'è niente da salvare a mano, ogni modifica è già salvata. Se il programma chiede «modifiche non salvate» e rispondi di uscire, quello che stavi scrivendo si perde.',
    'Il programma sembra lento: Altro → Impostazioni → «Aspetto» → Movimento: «Spento».']}
];
/** Il manuale su carta: i compiti con i loro passi (si stampa la parte "Come faccio a…"). */
function stampaManuale() {
  var p = clear($('print'));
  add(p, testaStampa(), el('h1', { text: 'Manuale d\'uso' }), el('p', { class: 'print-sub', text: 'Gym Art Segreteria · versione ' + S.versione + ' · stampato il ' + C.isoToIt(today()) }));
  COMPITI.forEach(function (x) { add(p, el('h2', { text: x.t }), el('ol', null, x.passi.map(function (t) { return el('li', { text: t }); })), x.consiglio ? el('p', { class: 'print-nota', text: x.consiglio }) : null); });
  document.body.classList.add('stampa');
  window.print();
}
function vGuida(v) {
  function sec(title, items, open) {
    return el('details', { open: open || null, 'data-gruppo': 'riferimento', 'data-aperto': open ? '' : null, 'data-cerca': C.norm(title + ' ' + items.join(' ')) }, el('summary', { text: title }), el('div', { class: 'guide' }, items.map(function (t) { return el('p', { text: t }); })));
  }
  function compito(x) {
    return el('details', { class: 'compito', 'data-cerca': C.norm(x.t + ' ' + x.passi.join(' ') + ' ' + (x.consiglio || '')) }, el('summary', { text: x.t }),
      el('div', { class: 'guide' }, el('ol', { class: 'passi' }, x.passi.map(function (t) { return el('li', { text: t }); })), x.consiglio ? el('p', { class: 'consiglio', text: x.consiglio }) : null));
  }
  var vuota = el('p', { class: 'empty', text: 'Nessun risultato: prova con una parola sola, per esempio «certificato» o «pagamento».', hidden: true });
  var cerca = el('input', { type: 'search', placeholder: 'Cerca nel manuale (per esempio: certificato, pagamento, copia)…', 'aria-label': 'Cerca nel manuale', autocomplete: 'off', spellcheck: 'false' });
  function filtra() {
    var parole = C.norm(cerca.value).split(' ').filter(Boolean), trovati = 0, tutti = v.querySelectorAll('details[data-cerca]');
    [].forEach.call(tutti, function (d) {
      var ok = parole.every(function (w) { return d.getAttribute('data-cerca').indexOf(w) >= 0; });
      d.hidden = !ok; if (ok) trovati++;
      if (parole.length && ok) d.open = true; else if (!parole.length) d.open = d.hasAttribute('data-aperto');
    });
    [].forEach.call(v.querySelectorAll('.manuale-gruppo'), function (g) { g.hidden = !!parole.length && !v.querySelector('details[data-gruppo="' + g.getAttribute('data-gruppo') + '"]:not([hidden])'); });
    vuota.hidden = !parole.length || trovati > 0;
  }
  cerca.addEventListener('input', debounce(filtra, 120));
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Manuale' }), el('p', { class: 'muted', text: 'Come si fa ogni cosa, passo passo. Se ti blocchi, cerca qui la parola che ti serve.' })),
    el('div', { class: 'row' }, button('Ricomincia la visita guidata', function () { if (window.Tutorial) Tutorial.avvia(); }, 'btn-primary'), button('Stampa il manuale', stampaManuale))));
  add(v, el('div', { class: 'manuale-ricerca' }, cerca));
  add(v, el('h2', { class: 'manuale-gruppo', 'data-gruppo': 'compiti', text: 'Come faccio a…' }));
  COMPITI.forEach(function (x) { var d = compito(x); d.setAttribute('data-gruppo', 'compiti'); add(v, d); });
  add(v, el('h2', { class: 'manuale-gruppo', 'data-gruppo': 'riferimento', text: 'Per saperne di più' }));
  add(v, sec('Cosa fa questo programma', [
    'Tiene l\'anagrafica delle allieve, le iscrizioni ai corsi con abbonamenti e scadenze, i certificati medici e i pagamenti con le ricevute. Funziona senza internet: i dati stanno solo su questo computer.',
    'Il menu a sinistra ha le cose di ogni giorno: Inizio, Allieve, Iscrizioni, Pagamenti, Scadenze, Certificati e Grafici. Tutto il resto sta sotto "Altro": Corsi, Promemoria, Registro, Nuova stagione, Impostazioni e questo Manuale.'], true));
  add(v, sec('Allieve e iscrizioni', [
    'Da "Allieve" cerchi una persona per nome, telefono, genitore o codice fiscale e apri la sua scheda.',
    'Il pulsante "Nuova iscrizione", sempre in alto, è l\'unico modo per aggiungere una persona: apre un solo modulo con l\'allieva (nuova, oppure una già presente da scegliere) e la sua iscrizione, e salva tutto insieme. Del bambino bastano cognome e nome, data di nascita, telefono e genitore; codice fiscale, indirizzo, email, certificato e consensi si aggiungono dopo dalla scheda. Se non scegli il corso si salva solo l\'allieva. Il programma avvisa se esiste già un nome uguale o molto simile.',
    'Dalla scheda di un\'allieva, "Iscrivi a un corso" registra un\'altra iscrizione: il corso, i giorni, la fascia oraria e l\'abbonamento. La scadenza si calcola da sola dalla data di inizio e dal tipo (mensile, trimestrale, annuale). La quota viene dal tariffario; scrivi la quota concordata solo se è diversa.',
    'Un\'allieva che non frequenta più si può archiviare: sparisce dagli elenchi ma i suoi dati restano.']));
  add(v, sec('Corsi, elenchi e fogli presenze', [
    'La pagina "Corsi" mostra quante iscritte ha ogni corso e l\'elenco delle allieve, anche per un solo giorno della settimana.',
    '"Stampa l\'elenco" stampa nomi, giorni, fascia e contatti; "Stampa il foglio presenze" stampa i nomi con dodici caselle vuote da riempire a penna.',
    'Le tabelle si ordinano con un clic sul titolo di una colonna; un secondo clic inverte l\'ordine.']));
  add(v, sec('Scadenze e rinnovi', [
    'La pagina "Scadenze" elenca gli abbonamenti scaduti e quelli che scadono entro i giorni di preavviso scelti in Impostazioni.',
    '"Rinnova" apre un nuovo periodo con gli stessi dati a partire dalla scadenza, e sposta il periodo vecchio nello storico.',
    '"Avvisa" apre una finestra con il genitore, il numero (anche il secondo, se c\'è) e il messaggio già scritto: puoi cambiare il testo, copiarlo o aprire WhatsApp. Il messaggio parte solo quando lo invii tu. Serve internet e WhatsApp sul computer o nel browser. Ci sono cinque testi (abbonamento in scadenza e scaduto, certificato in scadenza, scaduto e mancante) e si cambiano in Impostazioni > Messaggi per i genitori, con segnaposto come {saluto}, {nome}, {corso}, {scadenza} e {giorni}.',
    'Per un numero di telefono estero scrivi anche il prefisso, per esempio +355.']));
  add(v, sec('Nuova stagione', [
    'A settembre apri Altro, "Nuova stagione" (o il richiamo nella pagina Inizio). Scegli la nuova stagione e la data da cui partono i nuovi periodi, poi per ogni iscrizione aperta: "Rinnova" (stessi dati dalla nuova data), "Chiudi" (non torna) o "Lascia com\'è".',
    'Il programma propone una scelta ma non decide da solo: controlla chi non torna. Nulla si cancella: i periodi vecchi restano nello storico con i loro pagamenti e con quanto resta da incassare. Prima di scrivere fa una copia dell\'archivio e ogni cambio va nel Registro.',
    'Puoi mantenere le quote concordate a mano oppure ripartire dal tariffario, e addebitare di nuovo la quota di iscrizione dove il tariffario la prevede.']));
  add(v, sec('Promemoria in blocco', [
    'Da "Scadenze" → "Promemoria in blocco": un elenco solo di chi ha un abbonamento scaduto o in scadenza e di chi ha il certificato medico scaduto, in scadenza o mancante. Si filtra per tipo, stato e corso.',
    '"Avvisa" apre il messaggio già scritto: lo invii tu, uno alla volta, oppure "Avvisa uno alla volta" li propone in sequenza. Il programma segna "contattata" quando apri la chat, ma non può sapere se hai davvero inviato: se non l\'hai fatto premi "Annulla". Con "Fatto" segni chi hai chiamato al telefono.',
    'Chi hai contattato esce dall\'elenco "Da contattare"; se dopo 7 giorni è ancora da sollecitare ricompare come "Da ricontattare". Chi non ha un telefono valido è segnalato: "Stampa l\'elenco" ti dà un foglio con i numeri e una casella da spuntare.']));
  add(v, sec('Certificati medici', [
    'Il tipo del certificato (agonistico, non agonistico, ludico-motoria) è sempre in vista: nelle liste, nella scheda e nella pagina Certificati, che mostra tipo, date, stato e documento di tutte le allieve con un\'iscrizione aperta, con i filtri per tipo, da rinnovare, mancanti e senza documento.',
    'Nella scheda dell\'allieva trovi "Certificato medico": "Scansiona" apre la finestra dello scanner (solo su Windows, con uno scanner collegato o in rete), "Allega un file" sceglie un PDF o un\'immagine già scansionata, "Fotografa" (sul telefono) usa la fotocamera. Poi scrivi tipo e date: il documento resta sul computer, nella cartella dei dati, e si può riaprire quando serve. Si può anche scrivere il certificato a mano, senza documento.',
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
  add(v, sec('Aspetto, movimento e ricerca veloce', [
    'In Altro → Impostazioni → Aspetto puoi anche scegliere il logo della palestra (un\'immagine PNG, JPEG o WebP): resta sul computer e si può mostrare nel menu, al posto del cerchio colorato, e come sfondo al centro, sfocato (sfocatura e visibilità si regolano). Queste scelte valgono per il dispositivo che stai usando.',
    'In Altro → Impostazioni → Aspetto scegli lo stile tra i sette (Gestionale, Gym Art, Squadra, Minimale, Morbido, Liquid Glass e Sole: ognuno ha l\'anteprima) e il tema chiaro o scuro. La scelta vale per il dispositivo che stai usando: il telefono può avere uno stile diverso dal computer. Cambia solo l\'aspetto, i dati sono gli stessi.',
    'Lo stesso posto regola il movimento: Ridotto (solo una dissolvenza leggera, è la scelta di partenza), Pieno (finestre e avvisi con un piccolo movimento, cifre che scorrono la prima volta, scorrimento morbido con il mouse) o Spento. "Automatico" è Ridotto, e resta fermo se hai tolto le animazioni nelle impostazioni di accessibilità del sistema. Se il computer è lento, scegli Spento.',
    'Sempre in Aspetto, «Suoni»: un piccolo suono quando il programma si apre e uno quando si chiude (anche se chiudi la finestra con la X). Scegli Spenti, Piano o Normale e premi «Prova i suoni» per sentirli. Escono dalle casse del computer, con il volume di Windows; dal telefono non si sentono.',
    'Nei moduli vedi solo i dati essenziali: gli altri sono sotto "Altri dati (facoltativi)". Anche le liste mostrano le colonne principali. Per vedere sempre tutto: Altro → Impostazioni → "Preferenze" → "Mostra tutto".',
    'Nel menu a sinistra c\'è la ricerca veloce: scrivi un nome e premi Invio per aprire la scheda; da tastiera la raggiungi con Ctrl + K da qualunque pagina. Trova anche le sezioni e le loro parti: "verifica" porta ai bonifici da verificare, "backup" alle copie di sicurezza, "certificati" alle scadenze dei certificati. Se la casella è vuota, un clic apre l\'elenco delle sezioni essenziali con i numeri che chiedono attenzione; le frecce scelgono, Invio apre. La freccia accanto al nome riduce il menu alle sole icone.']));
  add(v, sec('Accesso dal telefono', [
    'In Altro → Impostazioni, "Accesso dal telefono", si sceglie una password e si attiva: il programma si apre allora da iPhone, iPad o altri computer collegati alla stessa rete, senza Claude. I dati restano su questo computer, che deve restare acceso.',
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


/* ---------- calendario e note ---------- */
/** I gruppi del calendario (sono anche i filtri): chiave, nome, tipi di evento che comprende, colore dei segni, icona. */
var CAL_GRUPPI = [
  { k: 'nota', nome: 'Note', tipi: ['nota'], kind: 'info', icona: 'nota', uno: 'nota', molti: 'note' },
  { k: 'abbonamento', nome: 'Abbonamenti', tipi: ['abbonamento'], kind: 'warn', icona: 'iscrizioni', uno: 'abbonamento', molti: 'abbonamenti' },
  { k: 'certificato', nome: 'Certificati', tipi: ['certificato', 'attesa'], kind: 'bad', icona: 'certificato', uno: 'certificato', molti: 'certificati' },
  { k: 'compleanno', nome: 'Compleanni', tipi: ['compleanno'], kind: 'ok', icona: 'compleanno', uno: 'compleanno', molti: 'compleanni' }
];
var CAL_ETICHETTA = { nota: ['Nota', 'info'], abbonamento: ['Abbonamento', 'warn'], certificato: ['Certificato', 'bad'], attesa: ['Certificato atteso', 'mute'], compleanno: ['Compleanno', 'ok'] };
function gruppoDi(tipo) { for (var i = 0; i < CAL_GRUPPI.length; i++) if (CAL_GRUPPI[i].tipi.indexOf(tipo) >= 0) return CAL_GRUPPI[i]; return CAL_GRUPPI[0]; }
/** Che cosa si è scelto di guardare nel calendario (si ricorda su questo dispositivo). */
function statoCal() {
  if (!S.cal) {
    var f = null;
    try { f = JSON.parse(localStorage.getItem('gymart-calendario') || 'null'); } catch (e) { f = null; }
    f = Array.isArray(f) ? f.filter(function (k) { return CAL_GRUPPI.some(function (g) { return g.k === k; }); }) : [];
    S.cal = { mese: '', giorno: '', tab: 'mese', filtri: f.length ? f : CAL_GRUPPI.map(function (g) { return g.k; }), stato: 'da-fare', q: '' };
  }
  return S.cal;
}
function tipiCal() { var out = []; CAL_GRUPPI.forEach(function (g) { if (statoCal().filtri.indexOf(g.k) >= 0) out = out.concat(g.tipi); }); return out; }
function nomeGiornoCompleto(data) { return GIORNI_LUNGHI[giornoSettimana(data)] + ' ' + (+data.slice(8, 10)) + ' ' + MESI_LUNGHI[+data.slice(5, 7) - 1] + ' ' + data.slice(0, 4); }
/** Quando è una nota, a parole: la data (o il periodo) e se è in ritardo. */
function dataNota(n) { return n.data ? (n.dataFine ? C.isoToIt(n.data) + ' - ' + C.isoToIt(n.dataFine) : C.isoToIt(n.data)) : ''; }
function chipNota(r) {
  if (r.stato === 'SCADUTA') return chip('In ritardo di ' + plurale(r.giorni, 'giorno', 'giorni'), 'bad');
  if (r.stato === 'OGGI') return chip('Oggi', 'warn');
  if (r.stato === 'PROSSIMA') return chip(r.giorni === 1 ? 'Domani' : 'Tra ' + r.giorni + ' giorni', 'info');
  if (r.stato === 'FATTA') return chip('Fatta', 'mute');
  return null;
}
/** Disegna di nuovo la pagina restando dove si è: il calendario e le note si usano scorrendo, non si torna in cima a ogni clic. */
/** Il mese si ridisegna da solo, senza ridisegnare la pagina (niente salto in cima, niente animazione di ingresso). */
function ridisegnaMese() { var box = $('cal-corpo'); if (!box) { render(); return; } clear(box); disegnaMese(box); }
function cambiaFatta(id, fatta) {
  var res = attempt(function () { return L.segnaNota(S.db, id, fatta, nowIso()); });
  if (res) commit(res, fatta ? 'Nota segnata come fatta.' : 'Nota di nuovo da fare.').then(function (ok) { if (ok) render(); });
}
/** Una nota: il testo, quando, di chi; la casella «Fatta» e «Modifica». */
function rigaNota(r, senzaAllieva) {
  var n = r.nota, fatta = r.stato === 'FATTA';
  var chk = el('input', { type: 'checkbox', checked: fatta, 'aria-label': 'Fatta: ' + L.anteprimaNota(n.testo, 40), onchange: function () { cambiaFatta(n.id, chk.checked); } });
  return el('div', { class: 'list-item riga-nota' + (fatta ? ' fatta' : ''), 'data-nota': n.id },
    el('label', { class: 'nota-chk' }, chk),
    el('div', { class: 'grow' }, el('p', { class: 'nota-testo', text: n.testo }),
      el('div', { class: 'row nota-meta' }, chipNota(r), n.data ? el('span', { class: 'muted small', text: dataNota(n) }) : null, !senzaAllieva && r.allieva ? link(r.allieva.name, 'allieva/' + r.allieva.id) : null)),
    button('Modifica', function () { finestraNota(n); }, 'btn-small'));
}
/** La finestra per scrivere o cambiare una nota. prefill = { data, allievaId } per una nuova. */
function finestraNota(nota, prefill) {
  prefill = prefill || {};
  var f = nota ? { testo: nota.testo, data: nota.data || '', dataFine: nota.dataFine || '', allievaId: nota.allievaId || '' } : { testo: '', data: prefill.data || '', dataFine: '', allievaId: prefill.allievaId || '' };
  var d, shown = false, notes = el('div', { class: 'notes' });
  var testo = el('textarea', { rows: 4, maxlength: String(L.NOTA_MAX), value: f.testo, placeholder: 'Per esempio: chiamare il comune per la palestra' });
  testo.addEventListener('input', function () { f.testo = testo.value; ch(); });
  var data = input(f, 'data', 'date', ch), fine = input(f, 'dataFine', 'date', ch);
  var elenco = S.db.allieve.filter(function (a) { return !a.archiviata || a.id === f.allievaId; }).sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  var chi = select([['', '(nessuna)']].concat(elenco.map(function (a) { return [a.id, a.name]; })), f.allievaId, function (x) { f.allievaId = x; ch(); });
  var salva = button(nota ? 'Salva le modifiche' : 'Salva la nota', invia, 'btn-primary');
  function refresh() {
    var chk = L.controllaNota(S.db, f, today());
    clear(notes);
    if (shown && chk.errors.length) add(notes, note('bad', 'Da correggere', chk.errors));
    else if (chk.warnings.length) add(notes, note('warn', 'Da controllare', chk.warnings));
    salva.disabled = shown && chk.errors.length > 0;
  }
  function ch() { shown = true; refresh(); }
  function invia() {
    shown = true; refresh();
    var res = attempt(function () { return L.salvaNota(S.db, nota ? nota.id : '', f, nowIso(), today()); });
    if (!res) return;
    salva.disabled = true;
    commit(res, nota ? 'Nota salvata.' : 'Nota aggiunta.').then(function (ok) { if (ok) { d.close(); render(); } else salva.disabled = false; });
  }
  function elimina() {
    conferma('', { titolo: 'Eliminare questa nota?', si: 'Elimina la nota', no: 'Lascia com\'è', pericolo: true }).then(function (si) {
      if (!si) return;
      var res = attempt(function () { return L.eliminaNota(S.db, nota.id); });
      if (res) commit(res, 'Nota eliminata.').then(function (ok) { if (ok) { d.close(); render(); } });
    });
  }
  refresh();
  d = modale(nota ? 'Modifica la nota' : 'Nuova nota', el('div', { class: 'stack' },
    field('Nota', testo, 'Un promemoria o un appunto. Niente dati sanitari: l\'archivio non è cifrato.', 'wide'),
    el('div', { class: 'fields' },
      field('Data', data, 'Facoltativa. Con una data la nota compare nel calendario e, quando è il momento, in Inizio.'),
      field('Fino al', fine, 'Solo se dura più giorni, per esempio una chiusura.'),
      field('Allieva', chi, 'Facoltativa. La nota compare anche nella scheda dell\'allieva.')),
    notes, el('div', { class: 'actions' }, salva, button('Annulla', function () { d.close(); }), nota ? button('Elimina', elimina, 'btn-danger') : null)));
  testo.focus();
}
function spostaMeseCal(k) {
  var c = statoCal(), nuovo = C.addMonths(c.mese + '-01', k).slice(0, 7);
  c.mese = nuovo; c.giorno = nuovo === today().slice(0, 7) ? today() : nuovo + '-01';
  ridisegnaMese();
  var b = document.querySelector('.cal-freccia[aria-label="' + (k < 0 ? 'Mese precedente' : 'Mese successivo') + '"]'); if (b) b.focus();
}
function scegliGiornoCal(data, fuoco) {
  var c = statoCal();
  if (data.slice(0, 7) !== c.mese) c.mese = data.slice(0, 7);
  c.giorno = data;
  ridisegnaMese();
  if (fuoco) { var b = document.querySelector('.cal-g[data-data="' + data + '"]'); if (b) b.focus(); }
}
/** Il mese: i giorni con i segni di quello che succede, e sotto il giorno scelto. */
function disegnaMese(box) {
  var c = statoCal(), oggi = today(), a = +c.mese.slice(0, 4), m = +c.mese.slice(5, 7);
  var mm = L.calendarioMese(S.db, oggi, a, m, tipiCal());
  if (!c.giorno || c.giorno.slice(0, 7) !== c.mese) c.giorno = c.mese === oggi.slice(0, 7) ? oggi : c.mese + '-01';
  var barra = el('div', { class: 'cal-barra' },
    el('button', { type: 'button', class: 'btn btn-small cal-freccia', 'aria-label': 'Mese precedente', onclick: function () { spostaMeseCal(-1); } }, icona('sinistra')),
    el('h2', { class: 'cal-titolo', text: mm.nome }),
    el('button', { type: 'button', class: 'btn btn-small cal-freccia', 'aria-label': 'Mese successivo', onclick: function () { spostaMeseCal(1); } }, icona('destra')),
    c.mese !== oggi.slice(0, 7) ? button('Oggi', function () { c.mese = oggi.slice(0, 7); c.giorno = oggi; ridisegnaMese(); }, 'btn-small') : null);
  var filtri = el('div', { class: 'cal-filtri', role: 'group', 'aria-label': 'Che cosa mostrare' }, CAL_GRUPPI.map(function (g) {
    var acceso = c.filtri.indexOf(g.k) >= 0;
    return el('button', { type: 'button', class: 'cal-filtro cal-p-' + g.k, 'aria-pressed': acceso ? 'true' : 'false', onclick: function () {
      c.filtri = acceso ? c.filtri.filter(function (k) { return k !== g.k; }) : c.filtri.concat([g.k]);
      if (!c.filtri.length) c.filtri = CAL_GRUPPI.map(function (x) { return x.k; }); // all switched off would be an empty page
      try { localStorage.setItem('gymart-calendario', JSON.stringify(c.filtri)); } catch (e) { /* niente */ }
      ridisegnaMese();
      var f = document.querySelector('.cal-filtro.cal-p-' + g.k); if (f) f.focus();
    } }, icona(g.icona), g.nome);
  }));
  var griglia = el('div', { class: 'cal-griglia', role: 'grid', 'aria-label': mm.nome });
  add(griglia, el('div', { class: 'cal-riga cal-testa', role: 'row' }, ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(function (g) { return el('div', { class: 'cal-gs', role: 'columnheader', text: g }); })));
  var riga = null;
  mm.celle.forEach(function (cella, i) {
    if (i % 7 === 0) { riga = el('div', { class: 'cal-riga', role: 'row' }); griglia.appendChild(riga); }
    var conti = {}, parti = [], segni = [];
    cella.eventi.forEach(function (ev) { var g = gruppoDi(ev.tipo); conti[g.k] = (conti[g.k] || 0) + 1; });
    CAL_GRUPPI.forEach(function (g) {
      if (!conti[g.k]) return;
      parti.push(plurale(conti[g.k], g.uno, g.molti));
      segni.push(el('span', { class: 'cal-p cal-p-' + g.k, 'aria-hidden': 'true', 'data-n': String(conti[g.k]) }, icona(g.icona))); // the number is drawn by the style (::after): the text of the button is only the day, which the spoken name contains
    });
    var sel = cella.data === c.giorno;
    riga.appendChild(el('div', { role: 'gridcell', class: 'cal-c' + (cella.delMese ? '' : ' fuori') + (cella.oggi ? ' oggi' : '') + (sel ? ' sel' : '') },
      el('button', { type: 'button', class: 'cal-g', 'data-data': cella.data, 'aria-pressed': sel ? 'true' : 'false', tabindex: sel ? null : '-1',
        'aria-label': nomeGiornoCompleto(cella.data) + (cella.oggi ? ' (oggi)' : '') + ': ' + (parti.length ? parti.join(', ') : 'niente'),
        onclick: function () { scegliGiornoCal(cella.data, true); } }, el('span', { class: 'cal-n', text: String(cella.giorno) }), el('span', { class: 'cal-segni' }, segni))));
  });
  griglia.addEventListener('keydown', function (e) { // le frecce muovono tra i giorni, come in ogni calendario
    var passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!passo || !e.target.classList || !e.target.classList.contains('cal-g')) return;
    e.preventDefault();
    var nuovo = new Date(Date.UTC(+c.giorno.slice(0, 4), +c.giorno.slice(5, 7) - 1, +c.giorno.slice(8, 10) + passo)).toISOString().slice(0, 10);
    scegliGiornoCal(nuovo, true);
  });
  var tri = mm.trimestrali ? el('p', { class: 'home-nota cal-riepilogo' }, el('b', { text: plurale(mm.trimestrali, 'abbonamento trimestrale scade', 'abbonamenti trimestrali scadono') }), ' in questo mese: sono i rinnovi da proporre.') : null;
  add(box, barra, filtri, tri, griglia, pannelloGiorno(mm.celle.filter(function (x) { return x.data === c.giorno; })[0]));
}
/** Il giorno scelto: tutto quello che succede, con i modi per agire. */
function pannelloGiorno(cella) {
  var c = statoCal(), oggi = today(), p = el('div', { class: 'card cal-giorno', 'aria-live': 'polite' });
  add(p, el('div', { class: 'head-row' }, el('h3', { text: nomeGiornoCompleto(c.giorno) }), c.giorno === oggi ? chip('Oggi', 'info') : null));
  if (!cella || !cella.eventi.length) { add(p, el('p', { class: 'muted', text: 'Niente in programma. Con «Nuova nota» in alto ne scrivi una per questo giorno.' })); return p; }
  add(p, el('div', { class: 'list' }, cella.eventi.map(function (ev) {
    var et = CAL_ETICHETTA[ev.tipo];
    if (ev.tipo === 'nota') {
      var n = S.db.note.filter(function (x) { return x.id === ev.notaId; })[0];
      if (!n) return null;
      var r = L.elencoNote(S.db, oggi, { stato: 'tutte' }).righe.filter(function (x) { return x.nota.id === n.id; })[0];
      return r ? rigaNota(r) : null;
    }
    return el('div', { class: 'list-item cal-ev', 'data-tipo': ev.tipo }, chip(et[0], et[1]), el('div', { class: 'grow' }, ev.vai ? link(ev.titolo, ev.vai) : el('b', { text: ev.titolo }), el('span', { class: 'muted small', text: ev.sotto })));
  })));
  return p;
}
/** L'elenco delle note: da fare, fatte, tutte; si cerca per parola o per nome. */
function disegnaNote(box) {
  var c = statoCal(), oggi = today(), tutte = L.elencoNote(S.db, oggi, { stato: 'tutte' }).conteggi;
  var cerca = el('input', { type: 'search', value: c.q, placeholder: 'Cerca nelle note', 'aria-label': 'Cerca nelle note', autocomplete: 'off', spellcheck: 'false' });
  var lista = el('div', { class: 'list', id: 'note-lista' });
  var sc = [['da-fare', 'Da fare', tutte.daFare, tutte.scadute ? 'bad' : 'info'], ['fatte', 'Fatte', tutte.fatte, 'mute'], ['tutte', 'Tutte', tutte.daFare + tutte.fatte, 'mute']];
  var barra = el('div', { class: 'tab-bar', role: 'group', 'aria-label': 'Quali note' }, el('div', { class: 'tab-gruppo' }, sc.map(function (t) {
    return el('button', { type: 'button', 'aria-pressed': c.stato === t[0] ? 'true' : 'false', class: 'nota-filtro', onclick: function () { c.stato = t[0]; render(); } }, t[1], ' ', el('span', { class: 'n n-' + t[3], 'aria-hidden': 'true', text: String(t[2]) }));
  })));
  function disegna() {
    clear(lista);
    var righe = L.elencoNote(S.db, oggi, { stato: c.stato, q: c.q }).righe;
    if (!righe.length) { add(lista, el('p', { class: 'empty', text: c.q ? 'Nessuna nota trovata.' : c.stato === 'fatte' ? 'Nessuna nota fatta.' : c.stato === 'da-fare' ? 'Niente da fare: nessuna nota in sospeso.' : 'Non c\'è ancora nessuna nota.' })); return; }
    add(lista, righe.map(function (r) { return rigaNota(r); }));
  }
  cerca.addEventListener('input', function () { c.q = cerca.value; disegna(); });
  add(box, el('div', { class: 'card' }, el('h2', { text: 'Note e promemoria' }),
    el('p', { class: 'muted small', text: 'Appunti per la segreteria. Con una data compaiono nel calendario e, quando è il momento, in Inizio.' }), barra, el('div', { class: 'toolbar' }, field('Cerca', cerca)), lista));
  disegna();
}
function vCalendario(v, args, nav) {
  var c = statoCal(), oggi = today();
  if (nav) { // si arriva da un link o dal menu: l'indirizzo dice dove
    c.tab = args[0] === 'note' ? 'note' : 'mese';
    var m = /^\d{4}-(0[1-9]|1[0-2])$/.test(args[0] || '') ? args[0] : oggi.slice(0, 7);
    c.mese = m; c.giorno = m === oggi.slice(0, 7) ? oggi : m + '-01';
    c.q = ''; c.stato = 'da-fare';
  }
  var n = L.elencoNote(S.db, oggi, { stato: 'tutte' }).conteggi;
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Calendario' }), el('p', { class: 'muted', text: 'Scadenze, compleanni e le tue note, giorno per giorno.' })),
    el('button', { type: 'button', class: 'btn btn-primary', text: 'Nuova nota', title: c.tab === 'mese' ? 'Scrivi una nota per il giorno scelto' : 'Scrivi una nota', onclick: function () { finestraNota(null, { data: c.tab === 'mese' ? c.giorno : '' }); } })));
  var box = el('div', { class: 'stack', id: 'cal-corpo' });
  var barra = el('div', { class: 'tab-bar', role: 'tablist', 'aria-label': 'Calendario o note' }, el('div', { class: 'tab-gruppo' },
    [['mese', 'Mese', null], ['note', 'Note', n.daFare]].map(function (t) {
      return el('button', { type: 'button', role: 'tab', id: 'cal-tab-' + t[0], 'aria-selected': c.tab === t[0] ? 'true' : 'false', 'aria-controls': 'cal-corpo', tabindex: c.tab === t[0] ? null : '-1',
        onclick: function () { c.tab = t[0]; render(); } }, t[1], t[2] ? [' ', el('span', { class: 'n n-' + (n.scadute ? 'bad' : 'info'), 'aria-hidden': 'true', text: String(t[2]) })] : null);
    })));
  barra.addEventListener('keydown', function (ev) {
    var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return; ev.preventDefault(); c.tab = c.tab === 'mese' ? 'note' : 'mese'; render(); var s = document.querySelector('#cal-tab-' + c.tab); if (s) s.focus();
  });
  box.setAttribute('role', 'tabpanel'); box.setAttribute('aria-labelledby', 'cal-tab-' + c.tab);
  add(v, barra, box);
  if (c.tab === 'note') disegnaNote(box); else disegnaMese(box);
}
/** Nella scheda dell'allieva: le sue note, e il modo di aggiungerne una. */
function cardNote(a) {
  var righe = L.noteDi(S.db, a.id, today());
  return el('div', { class: 'card', id: 'note-allieva' }, el('div', { class: 'head-row' }, el('h2', { text: 'Promemoria e note' }), button('Aggiungi una nota', function () { finestraNota(null, { allievaId: a.id }); }, 'btn-small')),
    righe.length ? el('div', { class: 'list' }, righe.map(function (r) { return rigaNota(r, true); })) : el('p', { class: 'muted small', text: 'Nessuna nota per ' + a.name + '. Per esempio: «preferisce essere chiamata la sera», «porta il certificato dopo le feste».' }));
}

/* ---------- aggiornamenti e novità ---------- */
var AGG = { st: null };
/** Lo stato degli aggiornamenti, dal programma sul computer (che controlla il canale da solo, una volta al giorno). */
function caricaAgg() {
  return api('GET', '/api/aggiornamenti').then(function (st) {
    var prima = aggDaDire(); AGG.st = st; aggiornaChipAgg();
    // the notice in the Home appears (or goes) as soon as the program knows
    if (prima !== aggDaDire() && S.db && parseHash().view === 'inizio' && !S.dirty && !S.busy && !document.querySelector('dialog[open]')) render();
    return st;
  }, function () { return null; });
}
/** C'è una versione nuova che la persona non ha rimandato né saltato (e siamo sul computer: l'aggiornamento si fa da qui). */
function aggDaDire() { var st = AGG.st; return !!(st && st.disponibile && !st.rimandata && !st.ignorata && !S.remoto && st.fase !== 'installo'); }
function aggiornaChipAgg() {
  var c = $('agg'); if (!c) return;
  c.hidden = !aggDaDire();
  if (!c.hidden) c.textContent = 'Aggiornamento disponibile · ' + AGG.st.disponibile.versione;
}
/** Un riquadro nella pagina Inizio: la versione nuova, che cosa porta, e la scelta. */
function bannerAgg() {
  if (!aggDaDire()) return null;
  var m = AGG.st.disponibile;
  return el('div', { class: 'note note-info', id: 'avviso-agg' }, el('b', { text: 'È disponibile la versione ' + m.versione + (m.titolo ? ': ' + m.titolo : '') }),
    el('span', null, 'Scegli tu se aggiornare: i dati non si toccano e prima si fa una copia.'),
    el('div', { class: 'row' }, button('Vedi le novità e aggiorna', finestraAggiornamento, 'btn-small btn-primary'),
      button('Più tardi', function () { api('POST', '/api/aggiornamenti/impostazioni', { rimanda: true }).then(caricaAgg).then(function () { render(); }); }, 'btn-small')));
}
function elencoNovita(voci, chiudi) {
  return el('div', { class: 'novita-lista' }, voci.map(function (x) {
    return el('div', { class: 'novita-voce' }, el('div', { class: 'grow' }, el('b', { text: x.t || x.titolo }), el('p', { class: 'muted small', text: x.d || x.testo })),
      x.vai ? el('a', { class: 'btn btn-small', href: '#' + x.vai, 'aria-label': 'Provalo: ' + (x.t || x.titolo), onclick: function () { if (chiudi) chiudi(); } }, 'Provalo') : null);
  }));
}
/** Ogni tanto si chiede al programma come va il download: finché la condizione è vera. */
function aspettaAgg(finita, passo) {
  return new Promise(function (ok, no) {
    (function giro() {
      api('GET', '/api/aggiornamenti').then(function (st) {
        AGG.st = st; if (passo) passo(st);
        if (finita(st)) ok(st); else setTimeout(giro, 400);
      }, no);
    })();
  });
}
/** La finestra della versione nuova: che cosa porta, e la scelta (aggiornare adesso, più tardi, saltarla). */
function finestraAggiornamento() {
  var st = AGG.st, m = st && st.disponibile;
  if (!m) return;
  var stato = el('div', { class: 'stack', role: 'status' }), barra = el('progress', { max: '100', value: '0', hidden: true, 'aria-label': 'Avanzamento del download' });
  var corpo = el('div', { class: 'stack' }), d, ora, dopo, salta;
  ora = button('Aggiorna adesso', avvia, 'btn-primary');
  dopo = button('Più tardi', function () { api('POST', '/api/aggiornamenti/impostazioni', { rimanda: true }).then(caricaAgg).then(function () { d.close(); render(); }); });
  salta = button('Salta questa versione', function () {
    conferma('Non ti avviso più per la versione ' + m.versione + ': ti avviserò per la prossima.', { titolo: 'Saltare questa versione?', si: 'Salta la versione', no: 'Annulla' }).then(function (si) { if (si) api('POST', '/api/aggiornamenti/impostazioni', { ignora: m.versione }).then(caricaAgg).then(function () { d.close(); render(); }); });
  });
  add(corpo, el('p', { class: 'muted', text: 'Versione ' + m.versione + (m.data ? ' · ' + C.isoToIt(m.data) : '') + ' (adesso hai la ' + st.versione + ')' }));
  if (m.titolo) add(corpo, el('h3', { text: m.titolo }));
  if (m.novita && m.novita.length) add(corpo, el('h3', { text: 'Che cosa cambia' }), elencoNovita(m.novita, function () { d.close(); }));
  if (m.correzioni && m.correzioni.length) add(corpo, el('h3', { text: 'Correzioni' }), el('ul', { class: 'muted small' }, m.correzioni.map(function (t) { return el('li', { text: t }); })));
  add(corpo, el('p', { class: 'muted small', text: 'I tuoi dati non si toccano. Prima di aggiornare il programma fa una copia di sicurezza; il programma di prima resta accanto a quello nuovo (GymArtSegreteria.exe.precedente). Dopo l\'aggiornamento il programma si riapre da solo.' }),
    barra, stato, el('div', { class: 'actions' }, ora, dopo, salta));
  d = modale('Aggiornamento disponibile', corpo);
  function blocca(si) { ora.disabled = dopo.disabled = salta.disabled = si; }
  function dici(t) { clear(stato); add(stato, el('p', { class: 'muted', text: t })); }
  function avvia() {
    (S.dirty ? conferma('L\'aggiornamento riapre il programma: le modifiche non salvate si perdono.', { titolo: 'Aggiornare senza salvare?', si: 'Aggiorna lo stesso', no: 'Annulla', pericolo: true }) : Promise.resolve(true)).then(function (si) { if (si) avviaDavvero(); });
  }
  function avviaDavvero() {
    S.dirty = false; blocca(true); barra.hidden = false; barra.removeAttribute('value');
    dici('Faccio una copia di sicurezza dei dati…');
    api('POST', '/api/sicurezza/adesso').catch(function () { /* the copy of the day exists anyway */ }).then(function () {
      dici('Scarico la versione ' + m.versione + '…');
      return api('POST', '/api/aggiornamenti/scarica');
    }).then(function () {
      return aspettaAgg(function (s) { return s.fase === 'pronto' || s.fase === 'errore'; }, function (s) {
        if (s.totale > 0 && s.fase === 'scarico') { barra.max = 100; barra.value = Math.round(s.scaricati * 100 / s.totale); dici('Scarico la versione ' + m.versione + '… ' + barra.value + ' %'); }
      });
    }).then(function (s) {
      if (s.fase === 'errore') throw new Error(s.errore || 'Il download non è riuscito.');
      barra.value = 100; dici('File verificato. Installo…');
      return api('POST', '/api/aggiornamenti/installa');
    }).then(function () {
      d.close();
      var saluto = GymLogo.chiusura();
      saluto.scrivi('Aggiornamento installato', 'Il programma si riapre da solo tra pochi secondi. Puoi chiudere questa finestra.'); saluto.fine();
      setTimeout(function () { try { window.close(); } catch (e) { /* the message says what to do */ } }, 1500);
    }, function (e) {
      blocca(false); barra.hidden = true; clear(stato);
      add(stato, note('bad', 'L\'aggiornamento non è stato installato', [e.message, 'Il programma di prima è intatto e i dati non sono stati toccati.'])); caricaAgg();
    });
  }
}
/** Dopo un aggiornamento: che cosa c'è di nuovo, da provare subito. Si segna per questo dispositivo. */
function mostraNovita(elenco) {
  if (!elenco.length) return;
  var d, corpo = el('div', { class: 'stack' });
  elenco.forEach(function (n) {
    add(corpo, el('h3', { text: 'Versione ' + n.v + (n.titolo ? ': ' + n.titolo : '') }), elencoNovita(n.voci, function () { d.close(); }));
    if (n.correzioni && n.correzioni.length) add(corpo, el('ul', { class: 'muted small' }, n.correzioni.map(function (t) { return el('li', { text: t }); })));
  });
  add(corpo, el('div', { class: 'actions' }, button('Ho capito', function () { d.close(); }, 'btn-primary'), link('Tutte le novità', 'aggiornamenti', 'btn')));
  d = modale('Novità del programma', corpo, function () { segnaNovitaViste(); });
}
function segnaNovitaViste() { try { localStorage.setItem('gymart-novita', S.versione); } catch (e) { /* niente */ } }
/** Al primo avvio dopo un aggiornamento: la finestra con le novità non ancora viste. Su un dispositivo nuovo si segna soltanto (c'è la visita guidata). */
function mostraNovitaSeServe() {
  var visto = '';
  try { visto = localStorage.getItem('gymart-novita') || ''; } catch (e) { return; }
  if (!visto) { segnaNovitaViste(); return; }
  var nuove = L.novitaDaMostrare(window.NOVITA || [], visto, S.versione);
  if (nuove.length) mostraNovita(nuove); else if (visto !== S.versione) segnaNovitaViste();
}
/** La pagina "Aggiornamenti e novità": come si sta messi, il controllo a mano, la cronologia delle novità e le informazioni sul programma. */
function vAggiornamenti(v) {
  var stato = el('div', { class: 'stack' }), cron = el('div', { class: 'stack' });
  function quando(iso) { return iso ? C.isoToIt(iso.slice(0, 10)) + ' alle ' + iso.slice(11, 16) : 'mai'; }
  function disegna() {
    var st = AGG.st; clear(stato);
    if (!st) { add(stato, el('p', { class: 'muted', text: 'Non riesco a leggere lo stato degli aggiornamenti.' })); return; }
    add(stato, el('p', null, 'Versione installata: ', el('b', { text: st.versione })));
    if (st.disponibile && !st.ignorata) {
      add(stato, el('div', { class: 'note note-info' }, el('b', { text: 'È disponibile la versione ' + st.disponibile.versione + (st.disponibile.titolo ? ': ' + st.disponibile.titolo : '') }),
        S.remoto ? el('span', null, 'Si aggiorna dal computer della segreteria.') : el('div', { class: 'row' }, button('Vedi le novità e aggiorna', finestraAggiornamento, 'btn-small btn-primary'))));
    } else if (st.disponibile && st.ignorata) {
      add(stato, note('', 'Hai scelto di saltare la versione ' + st.disponibile.versione + '.', ['Ti avviserò per la prossima.']));
      if (!S.remoto) add(stato, el('div', { class: 'row' }, button('Non saltarla più', function () { api('POST', '/api/aggiornamenti/impostazioni', { ignora: '0.0.0' }).then(caricaAgg).then(disegna); }, 'btn-small')));
    } else if (!st.errore) add(stato, st.canaleVuoto ? note('', 'Nessuna versione nuova.', ['Nel canale degli aggiornamenti non c\'è ancora niente di pubblicato: la versione che hai è l\'ultima.']) : note('ok', 'Il programma è aggiornato.'));
    if (st.errore) add(stato, note('warn', 'Il controllo non è riuscito', [st.errore]));
    add(stato, el('p', { class: 'muted small', text: 'Ultimo controllo: ' + quando(st.ultimoControllo) + '.' }));
    if (!S.remoto) {
      var auto = el('input', { type: 'checkbox', checked: st.automatico, onchange: function () { api('POST', '/api/aggiornamenti/impostazioni', { automatico: auto.checked }).then(caricaAgg).then(disegna, function (e) { avviso(e.message); }); } });
      var ora = button(st.controllo ? 'Controllo…' : 'Controlla adesso', function () {
        ora.disabled = true; ora.textContent = 'Controllo…';
        api('POST', '/api/aggiornamenti/controlla').then(function () { return aspettaAgg(function (s) { return !s.controllo; }); }).then(function () { aggiornaChipAgg(); disegna(); }, function (e) { avviso(e.message); disegna(); });
      }, 'btn-primary'); ora.disabled = !!st.controllo;
      add(stato, el('div', { class: 'row' }, ora), el('label', { class: 'check' }, auto, el('span', { text: 'Controlla da solo ogni giorno (consigliato)' })),
        el('p', { class: 'muted small', text: 'Il programma legge un piccolo file dal sito GitHub, dove sono pubblicate le versioni, per sapere qual è l\'ultima. Non manda nessun dato di nessuno. Scarica e installa solo se lo chiedi tu.' }));
      var canale = { v: st.canalePredefinito ? '' : st.canale };
      add(stato, altri('Impostazioni avanzate', [
        el('div', { class: 'fields' }, field('Indirizzo del canale degli aggiornamenti', input(canale, 'v', 'text', function () {}, { placeholder: st.canale, spellcheck: 'false' }), 'Lascia vuoto per usare quello della palestra. Sono ammessi solo indirizzi https di GitHub.')),
        el('div', { class: 'actions' }, button('Salva il canale', function () { api('POST', '/api/aggiornamenti/impostazioni', { canale: canale.v }).then(caricaAgg).then(function () { toast('Canale salvato.'); disegna(); }, function (e) { avviso(e.message); }); }, 'btn-small')),
        el('p', { class: 'muted small', text: 'Se una versione nuova dà problemi: nella cartella del programma c\'è «GymArtSegreteria.exe.precedente», la versione di prima. Chiudi il programma, metti da parte l\'altro file e togli «.precedente» dal nome di questo, poi riaprilo. I dati restano gli stessi.' })]));
    }
  }
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Aggiornamenti e novità' }), el('p', { class: 'muted', text: 'Che cosa è cambiato nel programma e se ce n\'è una versione nuova.' }))));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Il programma' }), stato));
  add(cron, el('h2', { text: 'Le novità' }));
  (window.NOVITA || []).forEach(function (n) {
    add(cron, el('h3', { text: 'Versione ' + n.v + (n.data ? ' · ' + C.isoToIt(n.data) : '') + ': ' + n.titolo }), elencoNovita(n.voci));
    if (n.correzioni && n.correzioni.length) add(cron, el('ul', { class: 'muted small' }, n.correzioni.map(function (t) { return el('li', { text: t }); })));
  });
  add(v, el('div', { class: 'card' }, cron));
  add(v, el('div', { class: 'card info-programma' }, window.GymLogo ? el('div', { class: 'info-logo' }, GymLogo.crea({ completo: true })) : null,
    el('p', { class: 'muted small', text: 'A.S.D. Gym Art Avezzano · Gym Art Segreteria, versione ' + S.versione + '. I dati sono nella cartella: ' + S.cartella })));
  caricaAgg().then(disegna);
}


/* ---------- l'assistente ---------- */
var ASS_KIND = { 1: 'bad', 2: 'warn', 3: 'info', 4: 'mute' };
/** Che cosa serve all'assistente dal resto del programma: le copie, gli aggiornamenti, il manuale. */
function opzAss() { return { copie2: S.copie2, aggiornamento: aggDaDire() ? { versione: AGG.st.disponibile.versione } : null, manuale: COMPITI, ora: new Date().getHours() }; }
/** "Avvisa uno alla volta" per un tipo (abbonamento o certificato): come nella pagina Promemoria. */
function avvisaTutti(tipo) {
  preparaAvvisi();
  var coda = L.elencoPromemoria(S.db, today(), { tipo: tipo, contatto: 'fare' }).righe.filter(function (r) { return r.tel; });
  if (!coda.length) { toast('Nessuno da avvisare con un telefono valido.'); return; }
  avvisa(coda[0], coda.slice(1));
}
/** Un'azione consigliata: va in una pagina del programma, o fa partire gli avvisi. */
function azioneAss(a, primaria) {
  if (a.avvisa) return button(a.etichetta, function () { avvisaTutti(a.avvisa); }, 'btn-small' + (primaria ? ' btn-primary' : ''));
  return link(a.etichetta, a.vai, 'btn btn-small' + (primaria ? ' btn-primary' : ''));
}
/** Un messaggio pronto: chi, che cosa dice, e il tasto che apre WhatsApp (per gli avvisi passa dalla finestra "Avvisa", che il testo si può cambiare e segna chi è stato avvisato). */
function messaggioAss(m) {
  var invia = m.tipo === 'abbonamento' || m.tipo === 'certificato'
    ? button('Avvisa', function () { preparaAvvisi(); var r = AVVISI[m.tipo + '|' + m.rif]; if (r) avvisa(r); else toast('Non c\'è più niente da ricordare a questa persona.'); }, 'btn-small btn-primary', 'Avvisa ' + m.chi)
    : button('Apri WhatsApp', function () { var u = C.waLink(m.tel, m.testo); if (u) window.open(u, '_blank', 'noopener'); }, 'btn-small btn-primary');
  return el('div', { class: 'ass-msg' }, el('div', { class: 'grow' }, el('b', { text: m.chi }), el('p', { class: 'muted small', text: m.testo })), invia);
}
function cardConsiglio(c, compatto) {
  var azioni = c.azioni.map(function (a, i) { return azioneAss(a, i === 0); });
  return el('div', { class: 'ass-consiglio ass-u' + c.urgenza, 'data-ass': c.id },
    el('div', { class: 'ass-testa' }, chip(c.etichetta, ASS_KIND[c.urgenza]), el('h3', { text: c.titolo })),
    compatto ? null : el('p', { class: 'muted', text: c.perche }),
    azioni.length ? el('div', { class: 'row' }, azioni) : null,
    compatto || !c.messaggi.length ? null : el('details', { class: 'ass-messaggi' }, el('summary', { text: 'Messaggi pronti (' + c.messaggi.length + ')' }), el('div', { class: 'stack' }, c.messaggi.map(messaggioAss))));
}
/** La risposta a una domanda: titolo, righe (con link), azioni, messaggi pronti. */
function disegnaRisposta(box, r, chiedi) {
  clear(box);
  var out = el('div', { class: 'ass-risposta' + (r.tipo === 'non-capito' ? ' ass-dubbio' : '') }, el('h3', { text: r.titolo }));
  if (r.righe.length) add(out, el('ul', { class: 'ass-righe' }, r.righe.map(function (x) { return el('li', null, x.vai ? link(x.t, x.vai) : x.t); })));
  if (r.azioni.length) add(out, el('div', { class: 'row' }, r.azioni.map(function (a, i) { return azioneAss(a, i === 0); })));
  if (r.messaggi && r.messaggi.length) add(out, el('h4', { text: 'Messaggi pronti' }), el('div', { class: 'stack' }, r.messaggi.map(messaggioAss)));
  if (r.suggerimenti && r.suggerimenti.length) add(out, el('div', { class: 'row ass-esempi' }, r.suggerimenti.map(function (t) { return button(t, function () { chiedi(t); }, 'btn-small'); })));
  add(box, out);
}
function vAssistente(v) {
  var cons = Assistente.consigli(S.db, today(), opzAss()), risposta = el('div', { role: 'status', 'aria-live': 'polite', class: 'ass-uscita' });
  var campo = el('input', { type: 'text', id: 'ass-domanda', placeholder: 'Scrivi una domanda, per esempio: chi deve portare il certificato?', 'aria-label': 'Domanda per l\'assistente', autocomplete: 'off', spellcheck: 'false', maxlength: '200' });
  function chiedi(t) {
    campo.value = t; if (!t.trim()) { clear(risposta); return; }
    disegnaRisposta(risposta, Assistente.rispondi(S.db, t, today(), opzAss()), chiedi);
  }
  campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); chiedi(campo.value); } });
  add(v, el('div', { class: 'head-row' }, el('div', null, el('h1', { text: 'Assistente' }), el('p', { class: 'muted', text: 'Ti dice che cosa fare adesso, che cosa controllare e quali messaggi mandare.' }))));
  add(v, note('', 'Lavora sul computer, senza internet.', ['Legge i dati che hai già qui e non manda niente a nessuno. Non è un servizio online e non inventa: risponde a quello che sa fare, e quando non capisce lo dice.']));
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Chiedi all\'assistente' }),
    el('div', { class: 'ass-chiedi' }, campo, button('Chiedi', function () { chiedi(campo.value); }, 'btn-primary')),
    el('div', { class: 'row ass-esempi' }, Assistente.ESEMPI.map(function (t) { return button(t, function () { chiedi(t); }, 'btn-small'); })), risposta));
  add(v, el('h2', { class: 'sezione', text: 'Che cosa fare adesso' }));
  add(v, el('div', { class: 'stack' }, cons.map(function (c) { return cardConsiglio(c, false); })));
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
function applicaDettaglio() { document.body.classList.toggle('det', S.det); }
/** «Mostra tutto» (Impostazioni › Preferenze, per questo dispositivo): the other columns in the lists, the optional data open, the values on the charts. */
function impostaDettaglio(on) { S.det = !!on; applicaDettaglio(); try { localStorage.setItem('gymart-dettaglio', S.det ? '1' : '0'); } catch (e) {} }
try { S.det = localStorage.getItem('gymart-dettaglio') === '1'; } catch (e) {}
/* the page shown when the program opens (Impostazioni › Preferenze, per questo dispositivo): only when no page is asked for */
var APERTURE = [['inizio', 'Inizio'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['scadenze', 'Scadenze'], ['calendario', 'Calendario'], ['pagamenti', 'Pagamenti']];
function paginaApertura() { try { var k = localStorage.getItem('gymart-apertura'); return APERTURE.some(function (x) { return x[0] === k; }) ? k : 'inizio'; } catch (e) { return 'inizio'; } }
if (!location.hash && paginaApertura() !== 'inizio') { history.replaceState(null, '', '#' + paginaApertura()); lastHash = location.hash; }
applicaDettaglio();
var larghezzaPrima = larghezzaGrafico();
window.addEventListener('resize', debounce(function () { var w = larghezzaGrafico(); if (Math.abs(w - larghezzaPrima) > 60 && S.db && !S.dirty && !S.busy) { larghezzaPrima = w; render(); } }, 250));
$('esci').addEventListener('click', esci);
(function () { var b = $('indietro'); if (b) { b.appendChild(icona('sinistra')); b.addEventListener('click', indietro); } var h = $('home'); if (h) h.insertBefore(icona('inizio'), h.firstChild); var pg = $('paga'); if (pg) { pg.insertBefore(icona('euro'), pg.firstChild); pg.addEventListener('click', function () { finestraPagamento(); }); } })();
/* ---------- un programma, non un sito (1.25.0): niente menu del tasto destro del browser, le scorciatoie fanno cose del programma ---------- */
document.addEventListener('contextmenu', function (e) {
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return; // in a field: cut, copy, paste
  if (String(window.getSelection ? window.getSelection() : '').trim()) return; // some text is selected: copy
  e.preventDefault();
});
document.addEventListener('dragstart', function (e) { if (e.target.closest && e.target.closest('a, img')) e.preventDefault(); }); // links and images do not fly away with the mouse
document.addEventListener('keydown', function (e) {
  if (S.bloccato || e.defaultPrevented) return;
  var k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (k === 'F5' || (ctrl && !e.shiftKey && (k === 'r' || k === 'R'))) { // the data again from the computer, not a reload of the page
    e.preventDefault();
    if (S.dirty) toast('Prima salva o annulla le modifiche.'); else load().then(function () { toast('Dati aggiornati.'); });
    return;
  }
  if (ctrl && !e.shiftKey && (k === 's' || k === 'S')) { e.preventDefault(); toast(S.dirty ? 'Premi il pulsante «Salva» del modulo.' : 'I dati sono già salvati: il programma salva da solo a ogni conferma.'); return; }
  if (ctrl && !e.shiftKey && (k === 'f' || k === 'F')) { e.preventDefault(); var c = $('cerca'); if (c && c.offsetParent !== null) { c.focus(); c.select(); } return; } // the search of the program, not the browser's
  if (ctrl && (k === 'u' || k === 'U' || k === 'p' || k === 'P' || k === 'o' || k === 'O' || k === 'd' || k === 'D' || k === 'j' || k === 'J' || k === 'h' || k === 'H')) { e.preventDefault(); return; } // source, print of the window, open file, favourites, downloads, history: things of a browser
  if (ctrl && (k === '+' || k === '=' || k === '-' || k === '0')) { e.preventDefault(); Aspetto.imposta({ testo: k === '+' || k === '=' ? 'grande' : 'normale' }); toast(k === '+' || k === '=' ? 'Testo grande.' : 'Testo normale.'); return; } // the zoom is the size of the text (Preferenze)
  // (Alt + freccia e Alt + Home sono tasti di Edge: Alt + Home aprirebbe la sua pagina iniziale. Indietro e Home sono i pulsanti in alto.)
  // Alt + a letter writes nothing in a field on Windows (AltGr comes with Ctrl and is left alone): the two shortcuts work everywhere
  if (e.altKey && !ctrl && (k === 'n' || k === 'N')) { e.preventDefault(); location.hash = 'iscrizione/nuova'; return; }
  if (e.altKey && !ctrl && (k === 'p' || k === 'P')) { e.preventDefault(); finestraPagamento(); return; }
});
document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false }); // no zoom with Ctrl and the wheel: the text size is a choice in Preferenze
/** "Chiudi il programma": la copia dei dati, il saluto con il logo, poi il programma si ferma (la X della finestra chiude e basta, senza saluto). */
function chiudiProgramma() {
  if (S.remoto || !S.db) return;
  (S.dirty ? conferma('Le modifiche non salvate si perdono.', { titolo: 'Chiudere il programma senza salvare?', si: 'Chiudi senza salvare', no: 'Resta qui', pericolo: true }) : Promise.resolve(true)).then(function (si) {
    if (!si) return null;
    return api('GET', '/api/rete').catch(function () { return null; }).then(function (r) { return r && r.inAscolto ? conferma('Chiudendo il programma, i telefoni non lo raggiungono più.', { titolo: 'L\'accesso dal telefono è attivo', si: 'Chiudi il programma', no: 'Resta aperto' }) : true; });
  }).then(function (si) {
    if (!si) return;
    S.dirty = false;
    var saluto = GymLogo.chiusura(), inizio = Date.now();
    saluto.scrivi('Salvo l\'ultima copia…', 'Un attimo: non spegnere il computer.');
    api('POST', '/api/sicurezza/adesso').catch(function () { /* the copy of the day is made anyway */ }).then(function () {
      saluto.scrivi('A presto!', 'Tutti i dati sono salvati. Il programma si chiude.');
      GymLogo.suono('chiusura'); // il piccolo suono del saluto: il programma lo aspetta prima di fermarsi
      return new Promise(function (ok) { setTimeout(ok, Math.max(0, 1700 - (Date.now() - inizio))); }); // the farewell is seen
    }).then(function () { return api('POST', '/api/esci-programma'); }).then(function () {
      saluto.scrivi('Programma chiuso', 'Puoi chiudere questa finestra. A presto!'); saluto.fine();
      try { window.close(); } catch (e) { /* the window stays: the message says what to do */ }
    }, function (e) { saluto.togli(); avviso('Non riesco a chiudere il programma: ' + e.message); });
  });
}
(function () { var a = $('agg'); if (a) a.addEventListener('click', finestraAggiornamento); })();
(function () { var b = $('chiudi'); if (b) { b.insertBefore(icona('spegni'), b.firstChild); b.addEventListener('click', chiudiProgramma); } })();
/* ---------- menu a sinistra: bottone per ridurlo, ricerca veloce (Ctrl o Cmd + K) ---------- */
function ridisegnaMenu() {
  var r = parseHash(), nav = $('tabs');
  if (!nav || S.bloccato || !S.db) return;
  clear(nav); disegnaMenu(nav, TAB_OF[r.view] || r.view);
  if (window.Movimento) Movimento.menu(nav);
}
/** Ricerca veloce: i posti dove si può andare. t = nome, h = indirizzo, p = a che cosa appartiene (si mostra sotto il nome), k = altre parole con cui si trova (sinonimi),
 *  q = compare nell'elenco che si apre cliccando nella casella vuota, n = numero del riepilogo da mostrare accanto (se non è zero). */
var VAI_A = [
  { t: 'Inizio', h: 'inizio', k: 'home riepilogo da fare oggi' },
  { t: 'Allieve', h: 'allieve', k: 'anagrafica elenco persone cerca', q: 1 },
  { t: 'Iscrizioni', h: 'iscrizioni', k: 'abbonamenti corsi elenco', q: 1 },
  { t: 'Nuova iscrizione', h: 'iscrizione/nuova', p: 'Iscrizioni', k: 'nuova allieva aggiungi inserisci registra persona iscrivere abbonamento corso modulo', q: 1 },
  { t: 'Pagamenti', h: 'pagamenti', k: 'incassi soldi', q: 1 },
  { t: 'Incassi e ricevute', h: 'pagamenti/incassi', p: 'Pagamenti', k: 'pagato contanti pos ricevuta stampa registrare', q: 1 },
  { t: 'Da incassare', h: 'pagamenti/da-incassare', p: 'Pagamenti', k: 'debiti residuo non pagato morosi quota', q: 1, n: 'daIncassare' },
  { t: 'Bonifici da verificare', h: 'pagamenti/verifica', p: 'Pagamenti', k: 'verifica pagamenti bonifico conferma estratto conto', q: 1, n: 'bonificiDaVerificare' },
  { t: 'Scadenze', h: 'scadenze', k: 'rinnovi', q: 1 },
  { t: 'Abbonamenti scaduti', h: 'scadenze/abb-scaduti', p: 'Scadenze', k: 'rinnovo rinnovare scadute', q: 1, n: 'scadute' },
  { t: 'Abbonamenti in scadenza', h: 'scadenze/abb-in-scadenza', p: 'Scadenze', k: 'rinnovo prossime', q: 1, n: 'inScadenza' },
  { t: 'Certificati scaduti', h: 'scadenze/cert-scaduti', p: 'Scadenze', k: 'certificato medico', q: 1, n: 'certScaduti' },
  { t: 'Certificati in scadenza', h: 'scadenze/cert-in-scadenza', p: 'Scadenze', k: 'certificato medico', q: 1, n: 'certInScadenza' },
  { t: 'Certificati mancanti', h: 'scadenze/cert-mancanti', p: 'Scadenze', k: 'certificato medico senza', q: 1, n: 'certMancanti' },
  { t: 'Certificati in attesa', h: 'scadenze/cert-attesa', p: 'Scadenze', k: 'certificato medico da consegnare iscritte da poco porta dopo', q: 1, n: 'certInAttesa' },
  { t: 'Promemoria in blocco', h: 'promemoria', p: 'Scadenze', k: 'whatsapp messaggi contattare avvisi', q: 1, n: 'promemoria' },
  { t: 'Preferenze', h: 'impostazioni/preferenze', p: 'Altro › Impostazioni', k: 'pagina apertura testo grande elenchi compatti dettaglio mostra tutto colonne corso proposto metodo orari corsi giorni copia' },
  { t: 'Calendario', h: 'calendario', k: 'giorni mese agenda scadenze compleanni appuntamenti', q: 1 },
  { t: 'Note e promemoria', h: 'calendario/note', p: 'Calendario', k: 'nota appunti promemoria da fare ricordare', q: 1, n: 'noteDaFare' },
  { t: 'Certificati', h: 'certificati', k: 'certificato medico idoneità scansione scanner documento', q: 1 },
  { t: 'Agonistici', h: 'certificati/agonistico', p: 'Certificati', k: 'certificato agonistico tipo', q: 1, n: 'czAgon' },
  { t: 'Non agonistici', h: 'certificati/non-agonistico', p: 'Certificati', k: 'certificato non agonistico tipo', q: 1, n: 'czNonAgon' },
  { t: 'Da rinnovare', h: 'certificati/da-rinnovare', p: 'Certificati', k: 'certificato scaduti in scadenza rinnovo', q: 1, n: 'czRinnovare' },
  { t: 'In attesa', h: 'certificati/in-attesa', p: 'Certificati', k: 'certificato da consegnare iscritte da poco porta dopo', q: 1, n: 'czAttesa' },
  { t: 'Senza documento', h: 'certificati/senza-documento', p: 'Certificati', k: 'certificato scansione scanner file foto documento da salvare', q: 1, n: 'czSenzaDoc' },
  { t: 'Grafici', h: 'analisi', k: 'analisi grafico statistiche incassi andamento rinnovi previsione', q: 1 },
  { t: 'Altro', h: 'altro', q: 1 },
  { t: 'Corsi', h: 'corsi', p: 'Altro', k: 'elenchi presenze fogli classi', q: 1 },
  { t: 'Registro', h: 'registro', p: 'Altro', k: 'modifiche storico cronologia', q: 1 },
  { t: 'Nuova stagione', h: 'stagione', p: 'Altro', k: 'settembre rinnovo anno', q: 1 },
  { t: 'Impostazioni', h: 'impostazioni', p: 'Altro', k: 'opzioni', q: 1 },
  { t: 'Manuale', h: 'guida', p: 'Altro', k: 'guida aiuto istruzioni come si fa come si usa domande', q: 1 },
  { t: 'Assistente', h: 'assistente', k: 'consigli cosa fare oggi aiuto domande ia intelligenza artificiale suggerimenti messaggi da mandare', q: 1 },
  { t: 'Aggiornamenti e novità', h: 'aggiornamenti', p: 'Altro', k: 'aggiornare versione nuova novità cosa cambia update patch', q: 1 },
  { t: 'Visita guidata (tutorial)', h: 'tutorial', p: 'Altro', k: 'tutorial guida interattiva passo passo imparare ricomincia aiuto', q: 1 },
  { t: 'Copie di sicurezza', h: 'impostazioni/sicurezza', p: 'Altro › Impostazioni', k: 'backup sicurezza dati ripristino salvataggio' },
  { t: 'Messaggi ai genitori', h: 'impostazioni/messaggi', p: 'Altro › Impostazioni', k: 'whatsapp testo avviso promemoria genitore scadenza certificato abbonamento' },
  { t: 'Logo della palestra', h: 'impostazioni/aspetto', p: 'Altro › Impostazioni', k: 'logo sfondo sfocato immagine palestra marchio' },
  { t: 'Aspetto', h: 'impostazioni/aspetto', p: 'Altro › Impostazioni', k: 'stile stili tema chiaro scuro movimento colori gestionale squadra minimale sole morbido liquid glass vetro club' },
  { t: 'Suoni all\'avvio e alla chiusura', h: 'impostazioni/aspetto', p: 'Altro › Impostazioni', k: 'suono suoni audio volume avvio chiusura silenzio muto spegnere' },
  { t: 'Corsi, orari e tariffe', h: 'impostazioni/tariffe', p: 'Altro › Impostazioni', k: 'tariffario quote prezzi stagione associazione fasce' },
  { t: 'Dati su questo computer', h: 'impostazioni/dati', p: 'Altro › Impostazioni', k: 'cartella seconda copia dove sono i dati' },
  { t: 'Accesso dal telefono', h: 'impostazioni/telefono', p: 'Altro › Impostazioni', k: 'iphone ipad password rete' },
  { t: 'Importa dal file Excel', h: 'impostazioni/importa', p: 'Altro › Impostazioni', k: 'foglio google csv xlsx portare dati' },
  { t: 'Esporta per Excel', h: 'impostazioni/esporta', p: 'Altro › Impostazioni', k: 'xlsx file excel csv elenco scaricare esportare' },
  { t: 'Assistenza e diario tecnico', h: 'impostazioni/assistenza', p: 'Altro › Impostazioni', k: 'errore errori problema non funziona guasto bloccato file assistenza diario log segnalare bug aiuto tecnico' },
  { t: 'Controlla questo computer', h: 'impostazioni/assistenza', p: 'Altro › Impostazioni', k: 'controllo prove verifica computer scanner suoni audio orologio data ora browser edge chrome spazio disco cartella aggiornamenti internet non funziona' }
];
var VAI_PAROLE = null;
/** Le voci che corrispondono: ogni parola scritta deve essere l'inizio di una parola del nome, del percorso o dei sinonimi. Prima quelle che corrispondono già nel nome. */
function cercaVoci(q) {
  var tok = C.norm(q).split(' ').filter(Boolean), out = [];
  if (!tok.length) return out;
  if (!VAI_PAROLE) VAI_PAROLE = VAI_A.map(function (x) { return { x: x, titolo: C.norm(x.t).split(' '), tutte: C.norm(x.t + ' ' + (x.p || '') + ' ' + (x.k || '')).split(' ') }; });
  VAI_PAROLE.forEach(function (e, i) {
    var inizia = function (parole) { return tok.every(function (t) { return parole.some(function (w) { return w.indexOf(t) === 0; }); }); };
    if (inizia(e.tutte)) out.push({ x: e.x, rank: inizia(e.titolo) ? 0 : 1, i: i });
  });
  out.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
  return out.slice(0, 5).map(function (o) { return o.x; });
}
/** I numeri che si mostrano accanto alle voci dell'elenco rapido (solo quelli che chiedono attenzione). */
function numeriVaiA() {
  if (!S.db) return {};
  var t = today(), r = L.riepilogo(S.db, t), pm = L.elencoPromemoria(S.db, t, {}).conteggi, cz = L.elencoCertificati(S.db, t, {}).conteggi, nt = L.elencoNote(S.db, t).conteggi;
  return { noteDaFare: nt.scadute + nt.oggi, czAgon: cz.agonistico, czNonAgon: cz.nonAgonistico, czRinnovare: cz.daRinnovare, czAttesa: cz.inAttesa, certInAttesa: r.certInAttesa, czSenzaDoc: cz.senzaDocumento, daIncassare: r.daIncassare, bonificiDaVerificare: r.bonificiDaVerificare, scadute: r.scadute, inScadenza: r.inScadenza, certScaduti: r.certScaduti, certInScadenza: r.certInScadenza, certMancanti: r.certMancanti, promemoria: pm.daFare };
}

(function iniziaMenuLaterale() {
  var tg = $('side-toggle'), box = $('cerca'), ris = $('cerca-ris'), voci = [], sel = -1;
  function aggiornaToggle() {
    if (!tg) return;
    var stretto = document.documentElement.classList.contains('rail');
    tg.setAttribute('aria-expanded', stretto ? 'false' : 'true'); tg.setAttribute('aria-label', stretto ? 'Allarga il menu' : 'Riduci il menu');
  }
  if (tg) {
    tg.appendChild(icona('sinistra'));
    tg.addEventListener('click', function () { Aspetto.impostaMenu(!Aspetto.menuRidotto()); aggiornaToggle(); setTimeout(ridisegnaMenu, 380); });
    window.addEventListener('resize', debounce(function () { aggiornaToggle(); ridisegnaMenu(); }, 200));
    aggiornaToggle();
  }
  if (!box || !ris) return;
  box.parentNode.insertBefore(icona('cerca'), box);
  var kbd = document.querySelector('#cerca-box kbd');
  if (kbd && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')) kbd.textContent = '⌘ K';
  box.setAttribute('role', 'combobox'); box.setAttribute('aria-expanded', 'false'); box.setAttribute('aria-controls', 'cerca-ris'); box.setAttribute('aria-autocomplete', 'list');
  var ultima = null;
  function chiudi() { ris.hidden = true; box.setAttribute('aria-expanded', 'false'); box.removeAttribute('aria-activedescendant'); sel = -1; }
  function evidenzia(i) {
    sel = i;
    voci.forEach(function (a, k) { a.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    if (voci[i]) { box.setAttribute('aria-activedescendant', voci[i].id); if (voci[i].scrollIntoView) voci[i].scrollIntoView({ block: 'nearest' }); } else box.removeAttribute('aria-activedescendant');
  }
  function apri(a) { box.value = ''; chiudi(); box.blur(); location.hash = a.getAttribute('href').slice(1); }
  function tutte() { // everybody who matches, in the "Allieve" page
    S.fa.q = box.value.trim(); box.value = ''; chiudi();
    if (location.hash !== '#allieve') location.hash = 'allieve'; else if (!S.dirty) render();
  }
  /** One result: a section (name, path under it) or a number next to a subsection of the quick list. */
  function opzione(x, cls, num) {
    var a = el('a', { href: '#' + x.h, role: 'option', id: 'cerca-ris-' + voci.length, class: cls || null, 'aria-selected': 'false', onclick: function () { box.value = ''; chiudi(); } },
      el('b', { text: x.t }), cls === 'cerca-sub' ? (num ? el('i', { text: String(num) }) : null) : cls === 'cerca-testa' ? null : el('span', { text: x.p || 'Sezione' }));
    voci.push(a); return a;
  }
  /** Clicking in the empty box opens the essential sections with their subsections (with the numbers that need attention). */
  function albero() {
    var n = numeriVaiA();
    add(ris, el('p', { class: 'cerca-gruppo', text: 'Vai a' }));
    VAI_A.filter(function (x) { return x.q && !x.p; }).forEach(function (top) {
      add(ris, opzione(top, 'cerca-testa'));
      VAI_A.filter(function (x) { return x.q && x.p === top.t; }).forEach(function (s) { add(ris, opzione(s, 'cerca-sub', s.n ? n[s.n] : 0)); });
    });
    ris.hidden = false; box.setAttribute('aria-expanded', 'true'); evidenzia(-1);
  }
  function cerca() {
    var q = box.value.trim(), vai, hit;
    ultima = box.value;
    if (!S.db) { chiudi(); return; }
    clear(ris); voci = [];
    if (!q) { albero(); return; }
    if (q.length < 2) { chiudi(); return; }
    vai = cercaVoci(q); hit = L.cercaAllieve(S.db, q, 'tutte');
    if (vai.length) { add(ris, el('p', { class: 'cerca-gruppo', text: 'Vai a' })); vai.forEach(function (x) { add(ris, opzione(x)); }); }
    if (hit.length && vai.length) add(ris, el('p', { class: 'cerca-gruppo', text: 'Allieve' }));
    if (!hit.length && !vai.length) add(ris, el('p', { text: 'Nessun risultato.' }));
    hit.slice(0, 6).forEach(function (a) {
      var x = el('a', { href: '#allieva/' + a.id, role: 'option', id: 'cerca-ris-' + voci.length, 'aria-selected': 'false', onclick: function () { box.value = ''; chiudi(); } },
        el('b', { text: a.name }), el('span', { text: [eta(a), a.archiviata ? 'archiviata' : ''].filter(Boolean).join(' · ') || 'Apri la scheda' }));
      voci.push(x); add(ris, x);
    });
    if (hit.length > 6) add(ris, el('a', { href: '#allieve', onclick: function (e) { e.preventDefault(); tutte(); } }, el('b', { text: 'Vedi tutte le ' + hit.length + ' allieve trovate' })));
    ris.hidden = false; box.setAttribute('aria-expanded', 'true'); evidenzia(voci.length ? 0 : -1);
  }
  ris.addEventListener('mousedown', function (e) { e.preventDefault(); }); // the click on a result must not take the focus away first
  box.addEventListener('input', debounce(cerca, 90));
  box.addEventListener('focus', cerca);
  box.addEventListener('blur', chiudi);
  box.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' && voci.length) { e.preventDefault(); evidenzia((sel + 1) % voci.length); }
    else if (e.key === 'ArrowUp' && voci.length) { e.preventDefault(); evidenzia((sel - 1 + voci.length) % voci.length); }
    else if (e.key === 'Escape') { box.value = ''; chiudi(); box.blur(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (box.value !== ultima) cerca(); // typed a moment ago: the list is not up to date yet
      if (!box.value.trim()) { if (voci[sel]) apri(voci[sel]); return; } // empty box: only what was chosen with the arrows
      if (voci[Math.max(sel, 0)]) apri(voci[Math.max(sel, 0)]); else tutte();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 'k' && e.key !== 'K') || S.bloccato) return;
    e.preventDefault();
    if (box.offsetParent !== null) { box.focus(); box.select(); return; }
    location.hash = 'allieve'; // the search box is not shown (narrow menu, phone): the page "Allieve" has its own
    setTimeout(function () { var i = document.querySelector('#view input[type=search]'); if (i) i.focus(); }, 120);
  });
})();

alive();
setInterval(alive, 10000);
setInterval(caricaAgg, 30 * 60 * 1000);
setTimeout(caricaAgg, 2500); // after the first page: the program has checked on its own in the meantime (a few seconds after the start)
render();
load();
