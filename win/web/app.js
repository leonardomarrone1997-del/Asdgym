/* Gym Art Segreteria per Windows - interfaccia. Text is always inserted as text, never as HTML. */
var C = window.Core, L = window.Logic;
var TOKEN = document.querySelector('meta[name="gymart-token"]').content;
var CID = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
var TABS = [['inizio', 'Inizio'], ['allieve', 'Allieve'], ['iscrizioni', 'Iscrizioni'], ['scadenze', 'Scadenze'], ['registro', 'Registro'], ['impostazioni', 'Impostazioni'], ['guida', 'Guida']];
var TAB_OF = { allieva: 'allieve', iscrizione: 'iscrizioni' };
var S = {
  db: null, rev: 0, salvato: '', cartella: '', versione: '', fatal: '', busy: false, dirty: false, revert: false, nextId: 1, missed: 0,
  fa: { q: '', filtro: 'tutte' }, fi: { q: '', stato: 'correnti', corso: '' }, reg: { rows: null, q: '', error: '' }, imp: null
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
function commit(res, okMsg) {
  if (S.busy) return Promise.resolve(false);
  S.busy = true; setConn();
  return api('POST', '/api/salva', { rev: S.rev, db: res.db, registro: res.registro || [] }).then(function (j) {
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
  var views = { inizio: vInizio, allieve: vAllieve, allieva: vAllieva, iscrizioni: vIscrizioni, iscrizione: vIscrizione, scadenze: vScadenze, registro: vRegistro, impostazioni: vImpostazioni, guida: vGuida };
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
  var all = sc.scadute.concat(sc.inScadenza), card = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Abbonamenti da seguire' }), all.length ? link('Vedi tutte le scadenze', 'scadenze') : null));
  if (!all.length) add(card, el('p', { class: 'empty', text: 'Nessun abbonamento scaduto o in scadenza nei prossimi ' + S.db.impostazioni.preavvisoAbb + ' giorni.' }));
  else add(card, el('div', { class: 'list' }, all.slice(0, 8).map(function (x) { return rigaScadenza(x, false); })));
  add(v, card);
}

/* ---------- Allieve ---------- */
function vAllieve(v) {
  var box = el('div', { class: 'scroll-x' }), count = el('span', { class: 'count' });
  function draw() {
    var rows = L.cercaAllieve(S.db, S.fa.q, S.fa.filtro), t = today();
    count.textContent = rows.length === 1 ? '1 allieva' : rows.length + ' allieve';
    clear(box);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.allieve.length ? 'Nessuna allieva corrisponde alla ricerca.' : 'Non ci sono ancora allieve.' })); return; }
    add(box, el('table', null, el('thead', null, el('tr', null, ['Allieva', 'Età', 'Telefono', 'Genitore / Referente', 'Iscrizioni'].map(function (h) { return el('th', { text: h }); }))),
      el('tbody', null, rows.map(function (a) {
        var isc = L.iscrizioniDi(S.db, a.id).filter(L.corrente);
        return el('tr', { class: 'link', onclick: function () { go('allieva/' + a.id); } },
          el('td', null, link(a.name, 'allieva/' + a.id, 'name'), a.archiviata ? [' ', chip('Archiviata')] : null),
          el('td', { class: 'nowrap', text: eta(a) }), el('td', { class: 'nowrap mono', text: a.tel }), el('td', { text: a.genitore }),
          el('td', null, isc.length ? isc.map(function (e) { var s = L.statoIscrizione(S.db, e, t); return chip((e.corso || 'Corso da definire') + (s.stato === 'ATTIVO' ? '' : ' · ' + s.stato.toLowerCase()), STATO_KIND[s.stato]); }) : el('span', { class: 'muted small', text: 'nessuna' })));
      }))));
  }
  var search = el('input', { type: 'search', value: S.fa.q, placeholder: 'Nome, telefono, genitore, codice fiscale…', oninput: function () { S.fa.q = search.value; draw(); } });
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Allieve' }), link('Nuova allieva', 'allieva/nuova', 'btn btn-primary')));
  add(v, el('div', { class: 'card' },
    el('div', { class: 'toolbar' }, field('Cerca', search),
      field('Mostra', select([['tutte', 'Tutte'], ['con', 'Con iscrizione aperta'], ['senza', 'Senza iscrizione'], ['archiviate', 'Archiviate']], S.fa.filtro, function (x) { S.fa.filtro = x; draw(); }), null, 'narrow')),
    count, box));
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
    cur ? el('div', { class: 'row' }, chip('n. ' + cur.id), eta(cur) ? chip(eta(cur)) : null, cur.archiviata ? chip('Archiviata', 'warn') : null) : null));
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
        if (res) commit(res, 'Allieva eliminata.').then(function (ok) { if (ok) go('allieve'); });
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
  } else v.querySelector('input').focus();
}
function rinnova(iscrId, poi) {
  var e = L.byId(S.db.iscrizioni, iscrId), nome = L.nomeAllieva(S.db, e.allievaId), sc = L.scadenza(e);
  if (!confirm('Rinnovare l\'abbonamento ' + (e.tipo || '').toLowerCase() + ' di ' + nome + ' (' + e.corso + ')?\n\nIl nuovo periodo parte dal ' + C.isoToIt(sc) + ' con gli stessi dati. L\'iscrizione attuale resta nello storico.')) return;
  var res = attempt(function () { return L.rinnova(S.db, iscrId, nowIso(), today()); });
  if (res) commit(res, 'Abbonamento rinnovato.').then(function (ok) { if (ok) go(poi); });
}

/* ---------- Iscrizioni ---------- */
function vIscrizioni(v) {
  var box = el('div', { class: 'scroll-x' }), count = el('span', { class: 'count' });
  function draw() {
    var t = today(), words = C.norm(S.fi.q).split(' ').filter(Boolean);
    var rows = S.db.iscrizioni.map(function (e) { return { e: e, s: L.statoIscrizione(S.db, e, t), nome: L.nomeAllieva(S.db, e.allievaId) }; }).filter(function (x) {
      if (S.fi.stato === 'correnti' ? !L.corrente(x.e) : S.fi.stato === 'chiuse' ? L.corrente(x.e) : S.fi.stato !== 'tutte' && x.s.stato !== S.fi.stato) return false;
      if (S.fi.corso && x.e.corso !== S.fi.corso) return false;
      var hay = C.norm(x.nome + ' ' + x.e.corso + ' ' + x.e.id);
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) { return C.norm(a.nome) < C.norm(b.nome) ? -1 : C.norm(a.nome) > C.norm(b.nome) ? 1 : (a.e.inizio || '') < (b.e.inizio || '') ? -1 : 1; });
    count.textContent = rows.length === 1 ? '1 iscrizione' : rows.length + ' iscrizioni';
    clear(box);
    if (!rows.length) { add(box, el('p', { class: 'empty', text: S.db.iscrizioni.length ? 'Nessuna iscrizione corrisponde ai filtri.' : 'Non ci sono ancora iscrizioni.' })); return; }
    add(box, el('table', null, el('thead', null, el('tr', null, ['Allieva', 'Corso', 'Giorni', 'Fascia', 'Abbonamento', 'Inizio', 'Scadenza'].map(function (h) { return el('th', { text: h }); }), el('th', { class: 'num', text: 'Quota' }), el('th', { text: 'Stato' }))),
      el('tbody', null, rows.map(function (x) {
        var e = x.e, q = L.quotaDovuta(S.db, e);
        return el('tr', { class: 'link', onclick: function () { go('iscrizione/' + e.id); } },
          el('td', null, link(x.nome, 'iscrizione/' + e.id, 'name')), el('td', { text: e.corso }), el('td', { class: 'nowrap', text: e.giorni.join(', ') }), el('td', { class: 'nowrap', text: e.fascia }), el('td', { text: e.tipo }),
          el('td', { class: 'nowrap mono', text: C.isoToIt(e.inizio) }), el('td', { class: 'nowrap mono', text: C.isoToIt(x.s.scadenza) }), el('td', { class: 'num', text: q === null ? '' : C.fmtMoney(q) }), el('td', null, chipStato(x.s.stato)));
      }))));
  }
  var search = el('input', { type: 'search', value: S.fi.q, placeholder: 'Nome dell\'allieva o corso…', oninput: function () { S.fi.q = search.value; draw(); } });
  var corsi = [['', 'Tutti i corsi']].concat(S.db.liste.corsi);
  add(v, el('div', { class: 'head-row' }, el('h1', { text: 'Iscrizioni' }), link('Nuova iscrizione', 'iscrizione/nuova', 'btn btn-primary')));
  add(v, el('div', { class: 'card' },
    el('div', { class: 'toolbar' }, field('Cerca', search),
      field('Stato', select([['correnti', 'Aperte'], ['ATTIVO', 'Attive'], ['IN SCADENZA', 'In scadenza'], ['SCADUTO', 'Scadute'], ['DA COMPLETARE', 'Da completare'], ['chiuse', 'Chiuse o annullate'], ['tutte', 'Tutte']], S.fi.stato, function (x) { S.fi.stato = x; draw(); }), null, 'narrow'),
      field('Corso', select(corsi, S.fi.corso, function (x) { S.fi.corso = x; draw(); }), null, 'narrow')),
    count, box));
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
        if (res) commit(res, 'Iscrizione eliminata.').then(function (ok) { if (ok) go(back); });
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
    el('div', { class: 'row' }, conRinnovo ? button('Rinnova', function () { rinnova(e.id, 'scadenze'); }, 'btn-small btn-primary') : null, link('Apri', 'iscrizione/' + e.id, 'btn btn-small')));
}
function vScadenze(v) {
  var sc = L.scadenze(S.db, today()), n = S.db.impostazioni.preavvisoAbb;
  add(v, el('h1', { text: 'Scadenze degli abbonamenti' }));
  add(v, el('div', { class: 'grid' }, tile(sc.scadute.length, 'Scaduti', 'bad', 'scadenze'), tile(sc.inScadenza.length, 'In scadenza entro ' + n + ' giorni', 'warn', 'scadenze')));
  [['Scaduti', sc.scadute, 'Nessun abbonamento scaduto.'], ['In scadenza entro ' + n + ' giorni', sc.inScadenza, 'Nessun abbonamento in scadenza.']].forEach(function (g) {
    add(v, el('div', { class: 'card' }, el('h2', { text: g[0] }), g[1].length ? el('div', { class: 'list' }, g[1].map(function (x) { return rigaScadenza(x, true); })) : el('p', { class: 'empty', text: g[2] })));
  });
  add(v, el('p', { class: 'muted small', text: '"Rinnova" apre un nuovo periodo con gli stessi dati, a partire dalla scadenza; quello vecchio resta nello storico. Il preavviso si cambia in Impostazioni.' }));
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
  var db = S.db, f = { stagione: db.impostazioni.stagione, preavvisoAbb: String(db.impostazioni.preavvisoAbb), corsi: db.liste.corsi.join('\n'), fasce: db.liste.fasce.join('\n'),
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
      field('Corsi', area('corsi'), 'Uno per riga.'), field('Fasce orarie', area('fasce'), 'Una per riga, per esempio 17:00-18:30.')),
    el('h3', { text: 'Tariffario' }),
    el('p', { class: 'muted small', text: 'Prezzi in euro per tipo di abbonamento. Lascia vuoto un prezzo se quell\'abbonamento non è previsto per la tariffa.' }),
    el('div', { class: 'scroll-x' }, el('table', { class: 'tariff' }, el('thead', null, el('tr', null, ['Corso / Pacchetto', 'Frequenza', 'Mensile', 'Trimestrale', 'Semestrale', 'Annuale', 'Iscrizione', ''].map(function (h) { return el('th', { text: h }); }))), tbody)),
    el('div', { class: 'row' }, button('Aggiungi una tariffa', function () { f.tariffario.push({ pacchetto: '', frequenza: '', Mensile: '', Trimestrale: '', Semestrale: '', Annuale: '', iscrizione: '' }); touch(); drawTariff(); }, 'btn-small')),
    notes, el('div', { class: 'actions' }, button('Salva le impostazioni', salva, 'btn-primary'))));

  /* data on this computer */
  var restore = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: function () { if (restore.files[0]) ripristina(restore.files[0]); restore.value = ''; } });
  add(v, el('div', { class: 'card' }, el('h2', { text: 'Dati su questo computer' }),
    el('p', { text: 'L\'archivio, il registro e le copie automatiche sono in questa cartella:' }), el('div', { class: 'path', text: S.cartella }),
    el('div', { class: 'row' }, button('Apri la cartella', function () { api('POST', '/api/apri-cartella').catch(function (e) { alert(e.message); }); }),
      button('Scarica una copia di sicurezza', function () { download('gymart-copia-' + stamp() + '.json', JSON.stringify({ programma: 'Gym Art Segreteria', salvato: S.salvato, rev: S.rev, db: S.db }, null, 1), 'application/json'); }),
      button('Ripristina da una copia…', function () { restore.click(); }), restore),
    el('p', { class: 'muted small', text: 'Il programma fa da solo una copia dell\'archivio prima di modificarlo (al massimo una ogni mezz\'ora, conserva le ultime 60) nella sottocartella "copie". Tieni anche una copia fuori dal computer, per esempio su una chiavetta.' })));

  /* import */
  var imp = el('div'), files = el('input', { type: 'file', accept: '.csv,text/csv', multiple: true, onchange: function () { if (files.files.length) leggiFogli(files.files, function () { drawImport(); }); } });
  function drawImport() {
    clear(imp);
    if (!S.imp) return;
    S.imp.parti.forEach(function (p) { add(imp, note(p.kind, p.titolo, p.righe)); });
    if (S.imp.registro.length) add(imp, el('div', { class: 'actions' }, button('Importa nell\'archivio', function () {
      var res = { db: S.imp.db, registro: S.imp.registro };
      commit(res, 'Importazione completata.').then(function (ok) { if (ok) { S.imp = null; go('impostazioni'); } });
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
    S.imp = { parti: parti, db: db, registro: reg };
    poi();
  }, function () { alert('Non riesco a leggere i file scelti.'); });
}
function ripristina(file) {
  file.text().then(function (t) {
    var obj; try { obj = JSON.parse(t); } catch (e) { alert('Il file scelto non è una copia dell\'archivio.'); return; }
    var db = obj && obj.db && typeof obj.db === 'object' ? obj.db : obj, bad = L.validaArchivio(db);
    if (bad) { alert(bad); return; }
    if (!confirm('Sostituire l\'archivio attuale (' + plurale(S.db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(S.db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ') con la copia "' + file.name + '" (' + plurale(db.allieve.length, 'allieva', 'allieve') + ', ' + plurale(db.iscrizioni.length, 'iscrizione', 'iscrizioni') + ')?\n\nPrima della sostituzione il programma conserva una copia dell\'archivio attuale.')) return;
    commit({ db: L.completa(db, today()), registro: [{ allieva: '', operazione: 'Ripristino da copia', campo: '', prima: '', dopo: '', nota: file.name }] }, 'Archivio ripristinato.').then(function (ok) { if (ok) go('inizio'); });
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
  add(v, sec('Scadenze e rinnovi', [
    'La pagina "Scadenze" elenca gli abbonamenti scaduti e quelli che scadono entro i giorni di preavviso scelti in Impostazioni.',
    '"Rinnova" apre un nuovo periodo con gli stessi dati a partire dalla scadenza, e sposta il periodo vecchio nello storico.']));
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
