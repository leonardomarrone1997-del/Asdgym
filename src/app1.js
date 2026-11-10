/* Gym Art Segreteria - page runtime, data loading, shell and the read-only views. */
var C = window.Core, P = window.Plan;
var TABS = [['inizio', 'Inizio'], ['scansiona', 'Scansiona'], ['pagamenti', 'Pagamenti'], ['scadenze', 'Scadenze'], ['stampa', 'Stampa'], ['registro', 'Registro'], ['guida', 'Guida']];
var S = {
  rt: { state: 'wait', mcp: null, sample: null, downloads: null, limits: null },
  db: null, loading: false, loadError: '', loadedAt: null, view: 'inizio', busy: false,
  queue: [], curId: null, nextId: 1, pendingReg: [],
  pay: { name: '', enrollRow: null, data: '', importo: '', metodo: '', note: '', ack: false, result: null },
  stampa: { doc: 'modulo', name: '', tipo: 'non_agonistico', msg: '', bad: false },
  regFilter: ''
};

/* ---------- DOM helpers (text is always inserted as text, never as HTML) ---------- */
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
function add(n, kid) {
  if (kid === null || kid === undefined || kid === false) return;
  if (Array.isArray(kid)) { kid.forEach(function (x) { add(n, x); }); return; }
  n.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
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
function field(label, control, hint, hintKind) {
  var id = control.id || ('f' + (S.nextId++)); control.id = id;
  return el('div', { class: 'field' }, el('label', { for: id, text: label }), control, hint ? el('span', { class: 'hint' + (hintKind ? ' h-' + hintKind : ''), text: hint }) : null);
}
function select(options, value, onchange, extra) {
  var s = el('select', Object.assign({ onchange: function () { onchange(s.value); } }, extra || {}));
  options.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : (o === '' ? '(nessuno)' : o); s.appendChild(el('option', { value: String(v), text: t })); });
  if (value !== null && value !== undefined && !options.some(function (o) { return String(Array.isArray(o) ? o[0] : o) === String(value); })) s.appendChild(el('option', { value: String(value), text: String(value) }));
  s.value = value === null || value === undefined ? '' : String(value);
  return s;
}

/* ---------- runtime: Google Sheets connector, Claude for reading photos, downloads ---------- */
function errText(e) {
  var code = e && e.code, msg = (e && e.message) || String(e || '');
  switch (code) {
    case 'server_not_connected': case 'server_not_found': return 'Google Sheets non è collegato a Claude. Collegalo nelle impostazioni di Claude (Connettori) e riapri questa pagina.';
    case 'needs_reauth': case 'session_expired': return 'Il collegamento è scaduto. Ricollega Google Sheets nelle impostazioni di Claude (Connettori) e riapri questa pagina.';
    case 'selection_required': return 'Hai più collegamenti Google Sheets: scegli quale usare nella finestra di Claude e riprova.';
    case 'not_in_manifest': case 'not_granted': case 'approval_required': case 'consent_required': case 'blocked_by_policy': return 'Questa pagina non ha il permesso di usare Google Sheets. Riapri la pagina e scegli "Consenti" quando Claude lo chiede.';
    case 'server_unavailable': case 'upstream_error': case 'rate_limited': return 'Google Sheets non ha risposto. Aspetta qualche secondo e riprova.';
    case 'tool_error': return 'Google Sheets ha rifiutato l\'operazione: ' + msg;
    case 'nomcp': return 'Collegamento a Google Sheets non disponibile in questa pagina.';
    default: return msg || 'Errore sconosciuto.';
  }
}
function sampleErrText(e) {
  switch (e && e.code) {
    case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed': return 'Questa pagina non ha il permesso di far leggere le foto a Claude. Riapri la pagina e scegli "Consenti", oppure inserisci i dati a mano.';
    case 'images_unavailable': return 'Da qui non è possibile inviare foto a Claude. Inserisci i dati a mano.';
    case 'image_rejected': return 'La foto non è stata accettata (formato o dimensione). Prova con un\'altra foto.';
    case 'rate_limited': return 'Troppe letture in poco tempo, oppure hai raggiunto il limite d\'uso di Claude. Riprova più tardi.';
    case 'refused': return 'Claude non ha potuto leggere questo documento. Inserisci i dati a mano.';
    case 'invalid_json': case 'empty_completion': return 'La lettura non è riuscita. Riprova, oppure inserisci i dati a mano.';
    case 'cancelled': return 'Lettura interrotta.';
    default: return 'La lettura non è riuscita' + (e && e.message ? ' (' + e.message + ')' : '') + '. Riprova tra poco.';
  }
}
function initRuntime() {
  var cl = window.claude;
  if (!cl || typeof cl.use !== 'function') { S.rt.state = 'none'; return Promise.resolve(); }
  function get(n) { try { return Promise.resolve(cl.use(n)).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); } }
  return Promise.all([get('mcp'), get('sample'), get('downloads')]).then(function (r) {
    S.rt.mcp = r[0]; S.rt.sample = r[1]; S.rt.downloads = r[2]; S.rt.state = r[0] ? 'ok' : 'nomcp';
    if (r[1] && typeof r[1].limits === 'function') return r[1].limits().then(function (l) { S.rt.limits = l || null; }).catch(function () { S.rt.limits = null; });
  });
}
function payloadOf(res) {
  if (!res) return null;
  var p = res.payload;
  if (p === undefined && res.structuredContent !== undefined) p = res.structuredContent;
  if (p === undefined && Array.isArray(res.content)) { var t = res.content.filter(function (b) { return b && b.type === 'text'; })[0]; if (t) p = t.text; }
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { /* keep text */ } }
  return p;
}
function gs(tool, input) {
  if (!S.rt.mcp) return Promise.reject({ code: 'nomcp', message: '' });
  return S.rt.mcp.callTool(C.SERVER, tool, input, { cache: false }).then(function (res) {
    var p = payloadOf(res);
    if (!p || typeof p !== 'object') throw { code: 'tool_error', message: 'risposta non riconosciuta' + (typeof p === 'string' ? ': ' + p.slice(0, 160) : '') };
    if (p.error) throw { code: 'tool_error', message: typeof p.error === 'string' ? p.error : (p.error.message || 'errore') };
    return p;
  });
}
function getValues(range) { return gs('get_values', { spreadsheetId: C.SHEET_ID, range: range }).then(function (p) { return Array.isArray(p.values) ? p.values : []; }); }
function updateValues(range, values) { return gs('update_values', { spreadsheetId: C.SHEET_ID, range: range, values: values }); }
function appendValues(range, values) { return gs('append_values', { spreadsheetId: C.SHEET_ID, range: range, values: values }); }
function quoteSheet(name) { return /[^A-Za-z0-9_]/.test(name) ? "'" + name.replace(/'/g, "''") + "'" : name; }
function rowRange(sheetName, row) { return quoteSheet(sheetName) + '!' + row + ':' + row; }

async function loadDb() {
  if (!S.rt.mcp) throw { code: 'nomcp', message: '' };
  S.loading = true; renderConn();
  try {
    var R = C.SHEETS, raw = {};
    raw.lis = await getValues(R.LIS.range);                    // first call alone: it is the one that asks for consent
    var a = await Promise.all([getValues(R.ANA.range), getValues(R.ISC.range), getValues(R.TAR.range)]);
    raw.ana = a[0]; raw.isc = a[1]; raw.tar = a[2];
    var b = await Promise.all([getValues(R.PAG.range), getValues(R.REG.range)]);
    raw.pag = b[0]; raw.reg = b[1];
    S.db = P.buildDb(raw); S.loadError = ''; S.loadedAt = new Date();
    $('stagione').textContent = S.db.settings.stagione;
    return S.db;
  } catch (e) { S.loadError = errText(e); throw e; }
  finally { S.loading = false; renderConn(); }
}
function reload(silent) {
  return loadDb().then(function () { if (!silent) toast('Dati aggiornati dal foglio.'); render(); }).catch(function () { render(); });
}
function canWrite() { return !!(S.db && !S.db.problems.length && S.rt.mcp); }

/** Writes one row and reads it back. Returns the list of cells that do not show the expected value ([] = verified). */
async function writeRow(key, map, row, ops) {
  var sh = C.SHEETS[key], u = C.buildRowUpdate(sh.name, map, row, ops), failed = null, back;
  try { await updateValues(u.range, u.values); } catch (e) { failed = e; }
  try { back = await getValues(rowRange(sh.name, row)); }
  catch (e2) { if (failed) throw failed; throw { code: 'verify', message: 'I dati sono stati inviati, ma non riesco a rileggere la riga ' + row + ' di ' + sh.name + ' per controllarla. Apri il foglio e verifica prima di riprovare.' }; }
  var bad = C.verifyRow(back[0] || [], map, ops);
  if (failed && bad.length) throw failed;                      // the write did not arrive: nothing changed in that row
  return bad;
}
async function assertEmptyRow(key, map, row, headers) {
  var sh = C.SHEETS[key], back = await getValues(rowRange(sh.name, row));
  var r = back[0] || [];
  if (headers.some(function (h) { return C.cell(r, map, h) !== ''; })) throw { code: 'busy_row', message: 'La riga ' + row + ' di ' + sh.name + ' non è più libera (qualcuno ha modificato il foglio). Aggiorna i dati e riprova.' };
}
function stepFromWrite(label, row, bad) {
  if (!bad.length) return { ok: true, text: label + ': scritto e verificato (riga ' + row + ').' };
  return { ok: false, text: label + ' (riga ' + row + '): scritto, ma questi campi non risultano come previsto: ' + bad.map(function (b) { return b.header + ' (atteso "' + b.atteso + '", nel foglio "' + b.trovato + '")'; }).join('; ') + '. Controllali nel foglio.' };
}
async function writeRegistro(rows, steps) {
  var all = S.pendingReg.concat(rows);
  if (!all.length) return;
  try { await appendValues(C.SHEETS.REG.append, all); S.pendingReg = []; steps.push({ ok: true, text: 'Registro aggiornato (' + all.length + ' righe).' }); }
  catch (e) { S.pendingReg = all; steps.push({ ok: false, text: 'Il registro NON è stato aggiornato (' + errText(e) + '). I dati sono nel foglio; riprova dal pulsante in Inizio.' }); }
}

/* ---------- shell ---------- */
function renderConn() {
  var c = $('conn'); if (!c) return;
  var st = S.rt.state, text, kind;
  if (st === 'wait') { text = 'Collegamento…'; kind = 'mute'; }
  else if (st !== 'ok') { text = 'Foglio non collegato'; kind = 'bad'; }
  else if (S.loading) { text = 'Leggo il foglio…'; kind = 'mute'; }
  else if (S.loadError) { text = 'Errore di lettura'; kind = 'bad'; }
  else if (S.db && S.db.problems.length) { text = 'Foglio da controllare'; kind = 'warn'; }
  else if (S.db) { text = 'Foglio collegato'; kind = 'ok'; }
  else { text = 'In attesa'; kind = 'mute'; }
  c.textContent = text; c.className = 'chip chip-' + kind;
  $('btn-reload').disabled = S.loading || st !== 'ok' || S.busy;
}
function renderTabs() {
  var t = clear($('tabs'));
  TABS.forEach(function (x) { t.appendChild(el('a', { href: '#' + x[0], text: x[1], 'aria-current': S.view === x[0] ? 'page' : null })); });
}
function route() {
  var h = (location.hash || '').replace(/^#/, '');
  S.view = TABS.some(function (x) { return x[0] === h; }) ? h : 'inizio';
  render();
}
function go(v) { if (location.hash === '#' + v) route(); else location.hash = '#' + v; }
var rendering = false, renderAgain = false;
function render() {
  if (rendering) { renderAgain = true; return; }      // a blur/change fired while the old nodes were being removed
  rendering = true;
  try { renderNow(); } finally { rendering = false; }
  if (renderAgain) { renderAgain = false; render(); }
}
function renderNow() {
  renderTabs(); renderConn();
  var v = clear($('view'));
  var fn = { inizio: viewInizio, scansiona: viewScansiona, pagamenti: viewPagamenti, scadenze: viewScadenze, stampa: viewStampa, registro: viewRegistro, guida: viewGuida }[S.view];
  if (S.view !== 'guida') { var g = gate(); if (g) { add(v, g); return; } }
  add(v, fn());
}
/** What to show when the sheet data is not available. */
function gate() {
  var st = S.rt.state;
  if (st === 'wait') return el('div', { class: 'card' }, el('div', { class: 'row' }, el('span', { class: 'spin' }), el('b', { text: 'Collegamento a Claude in corso…' })), el('p', { class: 'muted', text: 'Se resta così per più di mezzo minuto, chiudi e riapri la pagina.' }));
  if (st === 'none' || st === 'nomcp') return el('div', { class: 'card' }, el('h2', { text: 'Il foglio non è raggiungibile da qui' }), el('p', { text: 'Questa pagina funziona quando è aperta dentro Claude, con il tuo account e con Google Sheets collegato. Aprila da claude.ai o dall\'app Claude.' }), el('p', { class: 'muted', text: 'La Guida resta consultabile.' }));
  if (!S.db) {
    if (S.loading) return el('div', { class: 'card' }, el('div', { class: 'row' }, el('span', { class: 'spin' }), el('b', { text: 'Leggo il gestionale da Google Sheets…' })), el('p', { class: 'muted', text: 'La prima volta Claude ti chiede il permesso di usare Google Sheets: scegli "Consenti".' }));
    return el('div', { class: 'card' }, el('h2', { text: 'Non riesco a leggere il foglio' }), note('bad', S.loadError || 'Lettura non riuscita.'), el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', type: 'button', text: 'Riprova', onclick: function () { reload(); render(); } })));
  }
  return null;
}
function problemsBox() {
  if (!S.db || !S.db.problems.length) return null;
  return note('bad', 'Il foglio non ha la struttura attesa: per sicurezza non scrivo nulla finché non è a posto.', S.db.problems);
}

/* ---------- Inizio ---------- */
function viewInizio() {
  var db = S.db, sc = C.scadenze(db), out = [];
  var residuo = db.enrollments.reduce(function (a, e) { return a + (e.active && e.residuoN ? e.residuoN : 0); }, 0);
  out.push(problemsBox());
  if (S.pendingReg.length) out.push(el('div', { class: 'note note-warn' }, el('b', { text: 'Ci sono ' + S.pendingReg.length + ' righe di registro non ancora scritte.' }), el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', text: 'Scrivi ora il registro', onclick: async function () { var st = []; await writeRegistro([], st); toast(st[0] ? st[0].text : 'Fatto.'); render(); } }))));
  out.push(el('div', { class: 'row' },
    el('a', { class: 'btn btn-primary btn-big', href: '#scansiona', text: 'Scansiona un modulo o un certificato' }),
    el('a', { class: 'btn btn-big', href: '#pagamenti', text: 'Registra un pagamento' })));
  out.push(el('div', { class: 'grid' },
    tile(db.students.length, 'Allieve', ''), tile(sc.validi, 'Certificati validi', 'ok'), tile(sc.inScadenza.length, 'In scadenza', 'warn'),
    tile(sc.scaduti.length, 'Scaduti', 'bad'), tile(sc.mancanti.length, 'Mancanti', 'mute'), tile(C.fmtMoney(residuo).replace(',00', ''), 'Da incassare', '')));
  var urgent = sc.scaduti.concat(sc.inScadenza).slice(0, 6);
  out.push(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', { text: 'Certificati da sistemare per primi' }), el('a', { href: '#scadenze', text: 'Vedi tutte le scadenze' })),
    urgent.length ? el('div', { class: 'list' }, urgent.map(certItem)) : el('p', { class: 'muted', text: 'Nessun certificato scaduto o in scadenza nei prossimi ' + db.settings.preavvisoCert + ' giorni.' })));
  out.push(el('p', { class: 'muted small', text: 'Dati letti dal foglio alle ' + (S.loadedAt ? S.loadedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--') + '. Se hai modificato il foglio a mano, premi "Aggiorna dati".' }));
  return out;
}
function tile(n, label, kind) { return el('div', { class: 'tile' + (kind ? ' t-' + kind : '') }, el('b', { text: String(n) }), el('span', { text: label })); }
function certItem(x) {
  var s = x.student, late = x.giorni < 0;
  var msg = late ? 'Gentile genitore, ti ricordiamo che il certificato medico di ' + s.name + ' è scaduto il ' + C.isoToIt(s.certScadenza) + '. Per la sicurezza di tutti e la copertura assicurativa, ti chiediamo di consegnare il rinnovo prima del prossimo allenamento. Grazie! ASD Gym Art'
    : 'Gentile genitore, ti ricordiamo che il certificato medico di ' + s.name + ' scade il ' + C.isoToIt(s.certScadenza) + '. Ti chiediamo di consegnare il rinnovo in segreteria prima della scadenza. Grazie! ASD Gym Art';
  var wa = C.waLink(s.tel, msg);
  return el('div', { class: 'list-item' },
    el('div', null, el('b', { text: s.name }), el('div', { class: 'small muted', text: (s.certTipo || 'Certificato') + ' · scadenza ' + C.isoToIt(s.certScadenza) })),
    el('div', { class: 'row' }, chip(late ? 'Scaduto da ' + (-x.giorni) + ' g' : (x.giorni === 0 ? 'Scade oggi' : 'Scade tra ' + x.giorni + ' g'), late ? 'bad' : 'warn'),
      wa ? el('a', { class: 'btn', href: wa, target: '_blank', rel: 'noopener', text: 'WhatsApp' }) : null,
      el('button', { class: 'btn', type: 'button', text: 'Copia messaggio', onclick: function () { copy(msg); } })));
}
function copy(text) {
  try { navigator.clipboard.writeText(text).then(function () { toast('Messaggio copiato.'); }, function () { toast('Copia non riuscita: seleziona il testo a mano.'); }); }
  catch (e) { toast('Copia non disponibile su questo dispositivo.'); }
}

/* ---------- Scadenze ---------- */
function viewScadenze() {
  var db = S.db, sc = C.scadenze(db), out = [];
  out.push(el('div', { class: 'card' }, el('h2', { text: 'Certificati medici' }),
    el('p', { class: 'muted', text: 'Un certificato vale un anno dal rilascio. "In scadenza" vuol dire entro ' + db.settings.preavvisoCert + ' giorni.' }),
    block('Scaduti', sc.scaduti, 'bad', true), block('In scadenza', sc.inScadenza, 'warn', true),
    el('details', null, el('summary', { text: 'Mancanti (' + sc.mancanti.length + ')' }), el('div', { class: 'list' }, sc.mancanti.map(function (x) {
      return el('div', { class: 'list-item' }, el('b', { text: x.student.name }), x.student.certTipo && x.student.certTipo !== 'Mancante' ? chip('Tipo indicato, manca la scadenza', 'warn') : chip('Mancante', 'mute'));
    })))));
  out.push(el('div', { class: 'card' }, el('h2', { text: 'Abbonamenti scaduti o in scadenza' }),
    sc.abbonamenti.length ? el('div', { class: 'list' }, sc.abbonamenti.map(function (x) {
      var e = x.enrollment;
      return el('div', { class: 'list-item' }, el('div', null, el('b', { text: e.allieva }), el('div', { class: 'small muted', text: e.corso + ' · ' + (e.tipo || '') + ' · scadenza ' + C.isoToIt(e.scadenza) })),
        chip(x.giorni < 0 ? 'Scaduto da ' + (-x.giorni) + ' g' : 'Scade tra ' + x.giorni + ' g', x.giorni < 0 ? 'bad' : 'warn'));
    })) : el('p', { class: 'muted', text: 'Nessun abbonamento in scadenza. Molte iscrizioni non hanno ancora tipo e data di inizio, quindi non hanno una scadenza.' })));
  return out;
  function block(title, items, kind, open) {
    return el('details', { open: open && items.length ? true : null }, el('summary', { text: title + ' (' + items.length + ')' }), items.length ? el('div', { class: 'list' }, items.map(certItem)) : el('p', { class: 'muted', text: 'Nessuno.' }));
  }
}

/* ---------- Registro ---------- */
function viewRegistro() {
  var rows = S.db.registro.slice().reverse(), f = C.norm(S.regFilter);
  if (f) rows = rows.filter(function (r) { return C.norm(r.allieva).indexOf(f) >= 0; });
  var shown = rows.slice(0, 150);
  var search = el('input', { type: 'search', placeholder: 'Cerca per allieva', value: S.regFilter, oninput: function () { S.regFilter = search.value; var c = $('reg-body'); if (c) { var p = c.parentNode; p.replaceChild(table(), c); } } });
  function table() {
    var rr = S.db.registro.slice().reverse(), ff = C.norm(S.regFilter);
    if (ff) rr = rr.filter(function (r) { return C.norm(r.allieva).indexOf(ff) >= 0; });
    rr = rr.slice(0, 150);
    return el('div', { class: 'scroll-x', id: 'reg-body' }, rr.length ? el('table', null,
      el('thead', null, el('tr', null, ['Quando', 'Allieva', 'Operazione', 'Dove', 'Campo', 'Prima', 'Dopo', 'Note'].map(function (h) { return el('th', { text: h }); }))),
      el('tbody', null, rr.map(function (r) {
        return el('tr', null, el('td', { class: 'mono', text: r.quando }), el('td', { text: r.allieva }), el('td', { text: r.operazione + ' · ' + r.documento }), el('td', { text: r.foglio + ' r.' + r.riga }), el('td', { text: r.campo }), el('td', { class: 'was', text: r.prima }), el('td', { text: r.dopo }), el('td', { class: 'small muted', text: r.note }));
      }))) : el('p', { class: 'muted', text: 'Nessuna riga.' }));
  }
  return el('div', { class: 'card' }, el('h2', { text: 'Registro delle modifiche' }),
    el('p', { class: 'muted', text: 'Ogni dato inserito o cambiato da questa pagina lascia una riga qui e nel foglio "REGISTRO SCANSIONI", con il valore che c\'era prima. Sono mostrate le ultime 150 righe (' + S.db.registro.length + ' in tutto).' }),
    field('Filtro', search), shown.length ? table() : el('p', { class: 'muted', id: 'reg-body', text: 'Nessuna riga.' }));
}

/* ---------- Stampa ---------- */
function studentPicker(value, onpick, id) {
  var list = el('datalist', { id: id + '-dl' }, S.db.students.map(function (s) { return el('option', { value: s.name }); }));
  var inp = el('input', { type: 'search', id: id, list: id + '-dl', placeholder: 'Scrivi cognome o nome', value: value, autocomplete: 'off', onchange: function () { onpick(inp.value); }, oninput: function () { var m = C.matchStudent(S.db.students, inp.value); if (m.exact && m.exact.name === inp.value) onpick(inp.value); } });
  return [inp, list];
}
function pdfData(st) {
  var d = { stagione: S.db.settings.stagione };
  if (st) {
    d.atleta = { nome: st.name, nascita: C.isoToIt(st.nascita), luogo: st.luogo, cf: st.cf, indirizzo: st.indirizzo, citta: st.citta, cap: st.cap };
    d.genitore = { nome: st.genitore, cf: st.cfGenitore, tel: st.tel, email: st.email, tel2: st.tel2 };
  }
  return d;
}
function viewStampa() {
  var st = S.stampa, m = st.name ? C.matchStudent(S.db.students, st.name) : null, student = m && m.exact;
  var out = el('div', { class: 'card' }, el('h2', { text: 'Stampa' }),
    el('p', { class: 'muted', text: 'Scarichi un PDF in formato A4 già pronto da stampare. Se scegli un\'allieva, i dati che conosciamo sono già compilati; il resto resta in bianco per la penna.' }));
  var doc = select([['modulo', 'Modulo di iscrizione'], ['richiesta', 'Richiesta di certificato medico']], st.doc, function (v) { st.doc = v; st.msg = ''; render(); });
  var pick = studentPicker(st.name, function (v) { st.name = v; st.msg = ''; render(); }, 'stampa-allieva');
  var fields = el('div', { class: 'fields' }, field('Documento', doc), field('Allieva (facoltativa)', el('span', null, pick), student ? 'Trovata: i suoi dati saranno precompilati.' : (st.name ? 'Nessuna allieva con questo nome: il documento uscirà in bianco.' : 'Lascia vuoto per un documento in bianco.'), student ? 'ok' : null));
  if (st.doc === 'richiesta') add(fields, field('Tipo di certificato', select([['non_agonistico', 'Non agonistico'], ['agonistico', 'Agonistico']], st.tipo, function (v) { st.tipo = v; })));
  add(out, fields);
  if (st.doc === 'richiesta' && !S.db.settings.legale) add(out, note('warn', 'Nel foglio LISTE mancano il nome del legale rappresentante e l\'ente di affiliazione: nella richiesta resteranno righe in bianco. Puoi scriverli nelle celle gialle del foglio LISTE.'));
  if (st.doc === 'modulo') add(out, note('', 'Il modulo ha in fondo un riquadro "Riservato alla segreteria" per segnare pagato, importo, metodo, tipo di abbonamento e data di inizio: se lo compili, la lettura della foto è molto più sicura.'));
  var ok = !!S.rt.downloads && !!window.GymPdf;
  add(out, el('div', { class: 'row' }, el('button', { class: 'btn btn-primary', type: 'button', disabled: !ok, text: 'Scarica il PDF', onclick: function () { stampa(student || null); } })));
  if (!ok) add(out, note('warn', 'Da questa finestra non è possibile scaricare file. Apri la pagina da claude.ai o dall\'app Claude.'));
  if (st.msg) add(out, note(st.bad ? 'bad' : 'ok', st.msg));
  return out;
}
async function stampa(student) {
  var st = S.stampa, d = pdfData(student), bytes, name;
  try {
    if (st.doc === 'modulo') { bytes = window.GymPdf.moduloIscrizione(d); name = 'Modulo_iscrizione'; }
    else { d.tipo = st.tipo; d.societa = { legale: S.db.settings.legale, ente: S.db.settings.ente, codice: S.db.settings.codice }; bytes = window.GymPdf.richiestaCertificato(d); name = 'Richiesta_certificato_' + st.tipo; }
    name += (student ? '_' + student.name.replace(/[^A-Za-z0-9]+/g, '_') : '_in_bianco') + '.pdf';
    await S.rt.downloads.save({ filename: name, data: new Blob([bytes], { type: 'application/pdf' }) });
    st.msg = 'PDF pronto: ' + name; st.bad = false;
  } catch (e) {
    st.bad = true;
    st.msg = e && e.code === 'declined' ? 'Download annullato.' : 'Non sono riuscito a creare il PDF' + (e && e.message ? ': ' + e.message : '.');
  }
  render();
}

/* ---------- Guida ---------- */
function viewGuida() {
  function sec(title, items, open) { return el('details', { open: open ? true : null }, el('summary', { text: title }), el('div', { class: 'guide' }, items.map(function (t) { return typeof t === 'string' ? el('p', { text: t }) : t; }))); }
  function steps(a) { return el('ol', { class: 'steps' }, a.map(function (t) { return el('li', { text: t }); })); }
  var rt = S.rt;
  return [
    el('div', { class: 'card' }, el('h2', { text: 'Guida rapida' }), el('p', { class: 'muted', text: 'Questa pagina legge le foto dei documenti, ti mostra cosa ha capito e, solo dopo la tua conferma, scrive nel gestionale su Google Sheets. Niente entra nel foglio senza che tu lo veda prima.' })),
    sec('Inserire un modulo o un certificato da foto', [steps([
      'Vai in "Scansiona" e scegli una o più foto (dal telefono puoi scattarle al momento).',
      'Aspetta la lettura: ci vuole fino a un minuto per foto.',
      'Controlla i campi accanto alla foto. Quelli con il bordo giallo sono letture incerte: toccando la foto la ingrandisci.',
      'Correggi quello che serve. Gli errori in rosso bloccano l\'inserimento; gli avvisi in giallo vanno letti e spuntati.',
      'Premi "Conferma e inserisci". La pagina scrive, rilegge il foglio per controllo e segna tutto nel Registro.'
    ]), 'Per foto leggibili: togli il foglio dalla busta di plastica, inquadra tutta la pagina, buona luce, niente ombre.'], true),
    sec('Le sigle che la pagina riconosce sui moduli', [
      'P (cerchiata o no): pagato. Per registrare il pagamento servono comunque importo e metodo: se non sono scritti, li chiede a te.',
      'TRIM, MENS, SEM, ANN: abbonamento trimestrale, mensile, semestrale, annuale.',
      'mono, bi, tri: uno, due o tre giorni a settimana.',
      'Una data vicino alle sigle: è la data di inizio dell\'abbonamento.',
      'Consensi privacy e foto lasciati in bianco: vengono messi su "Sì" per regola della palestra, e nel Registro resta scritto che la casella non era barrata.',
      'Anno di nascita impossibile (per esempio l\'anno in corso): la pagina si ferma e ti chiede l\'anno giusto.'
    ]),
    sec('Certificati medici', [
      'Il tipo (agonistico o non agonistico) viene letto dal titolo del certificato.',
      'Se la scadenza è stampata si usa quella; altrimenti si calcola un anno dalla data di rilascio.',
      'Un certificato per attività ludico-motoria viene segnalato: è un tipo diverso dal non agonistico.',
      'Il codice fiscale viene controllato con il carattere di controllo, la data di nascita e il nome: se non torna, lo vedi prima di confermare.',
      'In "Scadenze" trovi scaduti, in scadenza e mancanti, con il messaggio WhatsApp già pronto.'
    ]),
    sec('Pagamenti', [
      'In "Pagamenti" scegli l\'allieva e la sua iscrizione, poi data, importo e metodo.',
      'Il numero di ricevuta lo genera il foglio. Dopo il salvataggio lo vedi nella conferma.',
      'La pagina avvisa se l\'importo supera il residuo o se esiste già un pagamento uguale nello stesso giorno.',
      'Un pagamento registrato non si cancella da qui: per correggerlo apri il foglio PAGAMENTI. Nel Registro resta la traccia.'
    ]),
    sec('Stampa', [
      'In "Stampa" scarichi il modulo di iscrizione o la richiesta di certificato medico in PDF, in bianco o con i dati dell\'allieva già scritti.',
      'Il nome del legale rappresentante e l\'ente di affiliazione si scrivono una volta nelle celle gialle del foglio LISTE.'
    ]),
    sec('Se qualcosa non va', [
      '"Foglio non collegato": apri la pagina da Claude con il tuo account e controlla che Google Sheets sia tra i connettori.',
      'Se un salvataggio si interrompe a metà, la pagina ti dice cosa è stato scritto e cosa no. Premi "Aggiorna dati" e riprova: scrive solo quello che manca.',
      'Non rinominare i fogli e non cambiare i titoli delle colonne: la pagina le trova dal titolo. Se un titolo manca, si ferma e te lo dice.',
      'La lettura delle foto usa Claude con il tuo account: conta nel tuo utilizzo.'
    ]),
    el('div', { class: 'card' }, el('h3', { text: 'Stato dei collegamenti' }), el('div', { class: 'row' },
      chip('Google Sheets: ' + (rt.mcp ? 'disponibile' : 'non disponibile'), rt.mcp ? 'ok' : 'bad'),
      chip('Lettura foto: ' + (rt.sample && rt.limits && rt.limits.images ? 'disponibile' : 'non disponibile'), rt.sample && rt.limits && rt.limits.images ? 'ok' : 'warn'),
      chip('Download PDF: ' + (rt.downloads ? 'disponibile' : 'non disponibile'), rt.downloads ? 'ok' : 'warn')),
      S.db ? el('p', { class: 'muted small', text: S.db.students.length + ' allieve, ' + S.db.enrollments.length + ' iscrizioni, ' + S.db.payments.length + ' versamenti letti dal foglio.' }) : null, problemsBox())
  ];
}
