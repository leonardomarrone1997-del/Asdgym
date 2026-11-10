/* Gym Art Segreteria - scanning, pre-check, payments and the writes to the sheet. */
var DOC_LABEL = { modulo: 'Modulo iscrizione', certificato: 'Certificato medico' };
var DUBBIO_KEYS = { name: ['nome', 'cognome'], nascita: ['nascita'], luogo: ['luogo'], cf: ['fiscale', 'cf'], indirizzo: ['indirizzo', 'civico', 'via'], citta: ['citt'], cap: ['cap'], genitore: ['genitore'], cfGenitore: ['fiscale', 'cf'], tel: ['telefon', 'tel', 'cellulare'], tel2: ['secondo'], email: ['email', 'mail'], dataModulo: ['data modulo', 'data del modulo'], fascia: ['orario'], inizio: ['inizio'], payImporto: ['importo'], certRilascio: ['rilascio'], certScadenza: ['scadenza'] };

function curItem() { for (var i = 0; i < S.queue.length; i++) if (S.queue[i].id === S.curId) return S.queue[i]; return null; }
function itemF(it) { return it.kind === 'certificato' ? it.fc : it.fm; }
function hasDubbio(it, key) {
  var keys = DUBBIO_KEYS[key]; if (!keys || !it.dubbi) return false;
  return it.dubbi.some(function (d) { var c = C.norm(d.campo + ' ' + d.motivo); return keys.some(function (k) { return c.indexOf(k) >= 0; }); });
}

/* ---------- building an item from the reading ---------- */
function fillItem(it, json) {
  var db = S.db, n = C.normalizeAi(json, db.lists, db.tariff), st = n.student, en = n.enrollment, pay = n.payment;
  it.dubbi = n.dubbi;
  it.fm = { name: st.name, nascita: st.nascita, nascitaScritta: st.nascitaScritta, luogo: st.luogo, cf: st.cf, indirizzo: st.indirizzo, citta: st.citta, cap: st.cap, genitore: st.genitore, cfGenitore: st.cfGenitore, tel: st.tel, tel2: st.tel2, email: st.email,
    privacy: st.privacy, liberatoria: st.liberatoria, privacyBarrata: st.privacyBarrata, liberatoriaBarrata: st.liberatoriaBarrata, dataModulo: st.dataModulo, certTipo: st.certTipo, certScadenza: st.certScadenza, firmaGenitore: st.firmaGenitore, noteSanitarie: st.noteSanitarie,
    corso: en.corso, giorni: en.giorni.slice(), fascia: en.fascia, orarioScritto: en.orarioScritto, pacchetto: en.pacchetto, tipo: en.tipo, inizio: en.inizio, nGiorni: en.nGiorni, quota: '',
    quotaIscrizione: en.quotaIscrizione, quotaMensile: en.quotaMensile, scontoFratelli: en.scontoFratelli, modalita: en.modalita, annotazioni: en.annotazioni,
    pagatoSulModulo: pay.pagato, payOn: pay.pagato, payImporto: pay.importo === null ? '' : String(pay.importo), payMetodo: pay.metodo, payData: pay.data || st.dataModulo || '', payDataProposta: !pay.data && !!st.dataModulo };
  it.fc = Object.assign({}, n.cert);
  [it.fm, it.fc].forEach(function (x) { x.luogo = (x.luogo || '').replace(/[,\s]+\(?[A-Za-z]{2}\)?$/, ''); });   // "Avezzano, AQ" -> "Avezzano"
  if (json) it.kind = n.tipoDocumento === 'certificato_medico' ? 'certificato' : 'modulo';
  it.unknownDoc = !!json && n.tipoDocumento === 'altro';
  it.replace = {}; it.replaceE = {}; it.ack = false; it.warnKey = ''; it.pacTouched = false;
  chooseTargets(it);
}
function chooseTargets(it) {
  var f = itemF(it), m = C.matchStudent(S.db.students, f.name || '');
  it.candidates = m.candidates;
  it.studentChoice = m.exact ? m.exact.row : (m.candidates.length ? '' : 'new');
  chooseEnrollment(it);
}
function chooseEnrollment(it) {
  it.enrollChoice = 'new';
  if (it.kind !== 'modulo' || typeof it.studentChoice !== 'number') return;
  var st = P.byRow(S.db.students, it.studentChoice); if (!st) return;
  var act = P.enrollmentsOf(S.db, st.name).filter(function (e) { return e.active; });
  var same = act.filter(function (e) { return e.corso === it.fm.corso; });
  if (same.length) it.enrollChoice = same[0].row; else if (act.length === 1) it.enrollChoice = act[0].row;
}
function computePlan(it) {
  if (it.studentChoice === '') return { errors: ['Scegli a quale allieva appartiene il documento, oppure "Nuova allieva".'], warnings: [], lines: [] };
  var arg = { f: itemF(it), studentChoice: it.studentChoice, enrollChoice: it.enrollChoice, replace: it.replace, replaceE: it.replaceE };
  var plan = it.kind === 'certificato' ? P.planCertificato(S.db, arg) : P.planModulo(S.db, arg);
  if (it.kind === 'certificato' && it.studentChoice === 'new') plan.warnings.push('Stai creando una nuova allieva partendo solo dal certificato: non avrà iscrizione né consensi finché non inserisci il suo modulo.');
  if (it.kind === 'modulo' && it.fm.noteSanitarie) plan.warnings.push('Sul modulo ci sono note sanitarie o allergie: non vengono copiate nel foglio, restano sul modulo di carta.');
  if (it.kind === 'modulo' && !it.fm.firmaGenitore && it.file) plan.warnings.push('Non vedo la firma del genitore sul modulo.');
  if (it.unknownDoc) plan.warnings.push('Non ho riconosciuto con certezza il tipo di documento: controlla la scelta in alto.');
  return plan;
}

/* ---------- reading the photo ---------- */
function loadImage(url) { return new Promise(function (ok, ko) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ko(new Error('immagine non leggibile')); }; im.src = url; }); }
function bandBlob(im, y0, y1) {
  return new Promise(function (ok) {
    try {
      var sw = im.naturalWidth, sh = Math.round((y1 - y0) * im.naturalHeight), scale = Math.min(1, 1500 / sw);
      var c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
      c.getContext('2d').drawImage(im, 0, Math.round(y0 * im.naturalHeight), sw, sh, 0, 0, c.width, c.height);
      c.toBlob(function (b) { ok(b); }, 'image/jpeg', 0.9);
    } catch (e) { ok(null); }
  });
}
async function makeBands(url, max) {
  if (max <= 0) return [];
  try {
    var im = await loadImage(url), cuts = [[0, 0.42], [0.3, 0.72], [0.6, 1]].slice(0, max), out = [];
    for (var i = 0; i < cuts.length; i++) { var b = await bandBlob(im, cuts[i][0], cuts[i][1]); if (b) out.push(b); }
    return out;
  } catch (e) { return []; }
}
function canRead() { return !!(S.rt.sample && S.rt.limits && S.rt.limits.images); }
async function readItem(it) {
  it.status = 'reading'; it.error = ''; refreshScan();
  try {
    var maxCount = (S.rt.limits.images.maxCount || 1), bands = await makeBands(it.url, Math.min(3, maxCount - 1));
    var json = await S.rt.sample.json(C.buildPrompt(), { images: [it.file].concat(bands), modelTier: 'complex', cache: false });
    fillItem(it, json); it.status = 'ready';
  } catch (e) { it.status = 'error'; it.error = sampleErrText(e); }
  refreshScan();
}
var reading = false;
async function pump() {
  if (reading) return; reading = true;
  try { for (;;) { var next = S.queue.filter(function (q) { return q.status === 'queued'; })[0]; if (!next) break; await readItem(next); } }
  finally { reading = false; }
}
function addFiles(files) {
  var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); });
  if (!list.length) { toast('Scegli una o più foto (JPG o PNG).'); return; }
  list.forEach(function (f) {
    var it = { id: S.nextId++, file: f, url: URL.createObjectURL(f), status: canRead() ? 'queued' : 'error', kind: 'modulo', error: canRead() ? '' : 'Da qui non posso far leggere le foto a Claude. Puoi inserire i dati a mano guardando la foto.', result: null };
    S.queue.push(it); if (S.curId === null || !curItem() || curItem().status === 'done') S.curId = it.id;
  });
  render(); pump();
}
function addManual(kind) {
  var it = { id: S.nextId++, file: null, url: '', status: 'ready', kind: kind, error: '', result: null };
  fillItem(it, null); it.kind = kind; chooseTargets(it);
  S.queue.push(it); S.curId = it.id; render();
}
function manualFromPhoto(it) { var k = it.kind; fillItem(it, null); it.kind = k; chooseTargets(it); it.status = 'ready'; it.error = ''; render(); }
function refreshScan() { if (S.view === 'scansiona') render(); else renderConn(); }

/* ---------- Scansiona view ---------- */
function statusChip(it) {
  var m = { queued: ['In coda', 'mute'], reading: ['Lettura…', 'mute'], ready: ['Da controllare', 'warn'], error: ['Non letto', 'bad'], done: ['Inserito', 'ok'], partial: ['Da completare', 'bad'], saving: ['Scrittura…', 'mute'] }[it.status] || ['', 'mute'];
  return chip(m[0], m[1]);
}
function viewScansiona() {
  var out = [problemsBox()], it = curItem();
  var file = el('input', { type: 'file', accept: 'image/*', multiple: true, id: 'scan-file', hidden: true, onchange: function () { addFiles(file.files); file.value = ''; } });
  out.push(el('div', { class: 'card' }, el('h2', { text: 'Scansiona documenti' }),
    el('p', { class: 'muted', text: 'Scegli le foto dei moduli di iscrizione o dei certificati medici. Ogni foto viene letta, poi controlli i dati e confermi.' }), file,
    el('div', { class: 'row' }, el('button', { class: 'btn btn-primary btn-big', type: 'button', text: 'Scegli o scatta le foto', onclick: function () { file.click(); } }),
      el('button', { class: 'btn', type: 'button', text: 'Modulo a mano', onclick: function () { addManual('modulo'); } }), el('button', { class: 'btn', type: 'button', text: 'Certificato a mano', onclick: function () { addManual('certificato'); } })),
    canRead() ? null : note('warn', 'La lettura automatica delle foto non è disponibile in questa finestra: puoi comunque inserire i dati a mano.')));
  if (S.queue.length) out.push(el('div', { class: 'thumbs' }, S.queue.map(function (q, i) {
    return el('button', { class: 'thumb', type: 'button', 'aria-current': q.id === S.curId ? 'true' : null, onclick: function () { S.curId = q.id; render(); } },
      q.url ? el('img', { src: q.url, alt: 'Documento ' + (i + 1) }) : el('div', { class: 'small muted', text: 'A mano' }), el('span', { text: (i + 1) + '. ' + (itemLabel(q) || DOC_LABEL[q.kind]) }), statusChip(q));
  })));
  if (it) out.push(itemView(it));
  return out;
}
function itemLabel(it) { var f = it.fm && itemF(it); return f && f.name ? f.name : ''; }
function photoBox(it) {
  if (!it.url) return null;
  return el('div', { class: 'photo' }, el('img', { src: it.url, alt: 'Foto del documento', onclick: function () { $('zoom-img').src = it.url; $('zoom').hidden = false; } }), el('span', { class: 'small muted', text: 'Tocca la foto per ingrandirla.' }));
}
function itemView(it) {
  if (it.status === 'queued' || it.status === 'reading') return el('div', { class: 'review' }, photoBox(it), el('div', { class: 'card' }, el('div', { class: 'row' }, el('span', { class: 'spin' }), el('b', { text: it.status === 'reading' ? 'Sto leggendo il documento…' : 'In coda per la lettura…' })), el('p', { class: 'muted', text: 'Può volerci fino a un minuto. La prima volta Claude chiede il permesso di leggere le foto: scegli "Consenti".' })));
  if (it.status === 'error') return el('div', { class: 'review' }, photoBox(it), el('div', { class: 'card' }, el('h3', { text: 'Lettura non riuscita' }), note('bad', it.error),
    el('div', { class: 'row' }, canRead() ? el('button', { class: 'btn btn-primary', type: 'button', text: 'Riprova la lettura', onclick: function () { it.status = 'queued'; render(); pump(); } }) : null,
      el('button', { class: 'btn', type: 'button', text: 'Inserisci come modulo', onclick: function () { it.kind = 'modulo'; manualFromPhoto(it); } }), el('button', { class: 'btn', type: 'button', text: 'Inserisci come certificato', onclick: function () { it.kind = 'certificato'; manualFromPhoto(it); } }),
      el('button', { class: 'btn', type: 'button', text: 'Togli', onclick: function () { removeItem(it); } }))));
  if (it.status === 'done' || it.status === 'saving') return el('div', { class: 'review' }, photoBox(it), resultCard(it));
  return el('div', { class: 'review' }, photoBox(it), el('div', { class: 'card' }, formHead(it), it.status === 'partial' ? resultSteps(it) : null, it.kind === 'certificato' ? certForm(it) : moduloForm(it), el('div', { id: 'plan-box' }, planBox(it))));
}
function removeItem(it) {
  S.queue = S.queue.filter(function (q) { return q !== it; }); if (it.url) { try { URL.revokeObjectURL(it.url); } catch (e) { /* ignore */ } }
  S.curId = S.queue.length ? S.queue[S.queue.length - 1].id : null; render();
}
function formHead(it) {
  var kind = select([['modulo', 'Modulo di iscrizione'], ['certificato', 'Certificato medico']], it.kind, function (v) { it.kind = v; chooseTargets(it); render(); });
  var opts = [['', '— scegli —'], ['new', 'Nuova allieva']];
  (it.candidates || []).forEach(function (c) { opts.push([c.student.row, 'Nome simile: ' + c.student.name]); });
  S.db.students.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'it'); }).forEach(function (s) { opts.push([s.row, s.name]); });
  var who = select(opts, it.studentChoice, function (v) { it.studentChoice = v === 'new' || v === '' ? v : Number(v); it.replace = {}; it.replaceE = {}; chooseEnrollment(it); render(); });
  var hint = it.studentChoice === 'new' ? 'Verrà aggiunta una nuova riga in anagrafica.' : it.studentChoice === '' ? 'Ci sono nomi simili nel foglio: scegli quello giusto oppure "Nuova allieva".' : 'Allieva già in anagrafica: completo solo i campi vuoti.';
  var head = [el('div', { class: 'card-head' }, el('h2', { text: 'Preverifica' }), el('button', { class: 'btn', type: 'button', text: 'Togli questo documento', onclick: function () { removeItem(it); } })),
    el('div', { class: 'fields' }, field('Tipo di documento', kind), field('Allieva nel foglio', who, hint, it.studentChoice === '' ? 'bad' : null))];
  if (it.dubbi && it.dubbi.length) head.push(note('warn', 'Letture incerte da controllare sulla foto (campi con bordo giallo):', it.dubbi.map(function (d) { return (d.campo ? d.campo + ': ' : '') + d.motivo; })));
  return head;
}
function refreshPlan(it) { var b = $('plan-box'); if (b) { clear(b); add(b, planBox(it)); } }
function inp(it, key, label, type, hint) {
  var f = itemF(it), i = el('input', { type: type || 'text', value: f[key] === null || f[key] === undefined ? '' : String(f[key]), class: hasDubbio(it, key) ? 'dubbio' : null, autocomplete: 'off',
    oninput: function () { f[key] = type === 'text' || !type ? i.value : i.value.trim(); if (key === 'payData') f.payDataProposta = false; refreshPlan(it); },
    onchange: function () { if (key === 'name') { var keep = it.studentChoice; var m = C.matchStudent(S.db.students, f.name); it.candidates = m.candidates; if (keep === 'new' && m.exact) { it.studentChoice = m.exact.row; chooseEnrollment(it); } render(); } } });
  if (type === 'date') i.max = '2100-12-31';
  return field(label, i, hint);
}
function sel(it, key, label, options, hint, full) {
  var f = itemF(it);
  return field(label, select(options, f[key], function (v) { f[key] = v; if (key === 'pacchetto') it.pacTouched = true; if (key === 'corso') autoPac(it); if (full || key === 'corso') render(); else refreshPlan(it); }), hint);
}
function autoPac(it) { if (it.pacTouched) return; var f = it.fm; f.pacchetto = C.suggestPacchetto(S.db.tariff, f.corso, f.giorni.length || f.nGiorni || null); }
function moduloForm(it) {
  var f = it.fm, db = S.db, L = db.lists, out = [];
  out.push(el('h3', { text: 'Atleta' }), el('div', { class: 'fields' },
    inp(it, 'name', 'Cognome e nome', 'text', 'Prima il cognome.'), inp(it, 'nascita', 'Data di nascita', 'date', f.nascitaScritta ? 'Sul modulo: ' + f.nascitaScritta : null), inp(it, 'luogo', 'Luogo di nascita'),
    inp(it, 'cf', 'Codice fiscale atleta'), inp(it, 'indirizzo', 'Indirizzo'), inp(it, 'citta', 'Città'), inp(it, 'cap', 'CAP')));
  out.push(el('h3', { text: 'Genitore o tutore' }), el('div', { class: 'fields' },
    inp(it, 'genitore', 'Cognome e nome'), inp(it, 'cfGenitore', 'Codice fiscale genitore'), inp(it, 'tel', 'Telefono', 'tel'), inp(it, 'tel2', 'Secondo telefono', 'tel'), inp(it, 'email', 'Email', 'email')));
  out.push(el('h3', { text: 'Consensi e modulo' }), el('div', { class: 'fields' },
    sel(it, 'privacy', 'Consenso privacy', ['Sì', 'No'], f.privacyBarrata === null && it.file ? 'Casella in bianco sul modulo: messo Sì per regola.' : null),
    sel(it, 'liberatoria', 'Liberatoria foto/video', ['Sì', 'No'], f.liberatoriaBarrata === null && it.file ? 'Casella in bianco sul modulo: messo Sì per regola.' : null),
    inp(it, 'dataModulo', 'Data del modulo', 'date'),
    sel(it, 'certTipo', 'Certificato indicato sul modulo', [['', '(non indicato)'], 'Agonistico', 'Non Agonistico']), inp(it, 'certScadenza', 'Scadenza certificato (se scritta)', 'date')));
  var eOpts = [['new', 'Nuova iscrizione'], ['none', 'Nessuna: solo anagrafica']];
  if (typeof it.studentChoice === 'number') { var st = P.byRow(db.students, it.studentChoice); if (st) P.enrollmentsOf(db, st.name).forEach(function (e) { eOpts.splice(1, 0, [e.row, 'Completa l\'esistente: ' + e.corso + (e.fascia ? ' ' + e.fascia : '') + (e.active ? '' : ' (annullata o storica)')]); }); }
  out.push(el('h3', { text: 'Iscrizione al corso' }), el('div', { class: 'fields' }, field('Cosa fare', select(eOpts, it.enrollChoice, function (v) { it.enrollChoice = v === 'new' || v === 'none' ? v : Number(v); it.replaceE = {}; render(); }))));
  if (it.enrollChoice !== 'none') {
    var days = el('div', { class: 'days' }, C.DAY_ORDER.map(function (d) { var c = el('input', { type: 'checkbox', checked: f.giorni.indexOf(d) >= 0, onchange: function () { f.giorni = C.DAY_ORDER.filter(function (x) { return x === d ? c.checked : f.giorni.indexOf(x) >= 0; }); autoPac(it); render(); } }); return el('label', null, c, d); }));
    var q = C.quotaTariffario(db.tariff, f.pacchetto, f.tipo);
    out.push(el('div', { class: 'fields' },
      sel(it, 'corso', 'Corso', [['', '— scegli —']].concat(L.corsi), 'Artistica Baby del modulo = Propedeutico.'),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Giorni' }), days),
      inp(it, 'fascia', 'Orario', 'text', 'Orari nel foglio: ' + L.fasce.join(', ') + (f.orarioScritto ? '. Sul modulo: ' + f.orarioScritto : '')),
      sel(it, 'pacchetto', 'Tariffa / pacchetto', [['', '(nessuno)']].concat(db.tariff.map(function (p) { return p.chiave; })), null, true),
      sel(it, 'tipo', 'Tipo di abbonamento', [['', '(non indicato)']].concat(L.tipi.map(function (t) { return t.nome; })), q !== null ? 'Quota da tariffario: ' + C.fmtMoney(q) : (f.pacchetto && f.tipo ? 'Il tariffario non ha una quota per questa scelta.' : null), true),
      inp(it, 'inizio', 'Data di inizio abbonamento', 'date', 'La data scritta vicino alle sigle sul modulo.'),
      inp(it, 'quota', 'Quota concordata (€)', 'text', 'Solo se diversa dal tariffario o se il tariffario non ha la quota.')));
    var payOn = el('input', { type: 'checkbox', checked: !!f.payOn, id: 'pay-on', onchange: function () { f.payOn = payOn.checked; render(); } });
    out.push(el('h3', { text: 'Pagamento' }), el('label', { class: 'check', for: 'pay-on' }, payOn, el('span', { text: 'Registra il pagamento' + (f.pagatoSulModulo ? ' (sul modulo c\'è la P)' : '') })));
    if (f.payOn) out.push(el('div', { class: 'fields' },
      inp(it, 'payImporto', 'Importo pagato (€)', 'text', q !== null ? 'Da tariffario sarebbero ' + C.fmtMoney(q) + ': scrivi quanto ha pagato davvero.' : 'Scrivi quanto ha pagato davvero.'),
      sel(it, 'payMetodo', 'Metodo', [['', '— scegli —']].concat(L.metodi)), inp(it, 'payData', 'Data del pagamento', 'date', f.payDataProposta ? 'Proposta: la data del modulo. Cambiala se ha pagato in un altro giorno.' : null)));
  }
  return out;
}
function certForm(it) {
  var f = it.fc, out = [];
  var tipoHint = f.originale === 'ludico_motoria' ? 'Sul certificato: attività ludico-motoria.' : (f.titolo ? 'Titolo letto: ' + f.titolo : null);
  var ril = inp(it, 'certRilascio', 'Data di rilascio', 'date', f.rilascioAPenna ? 'Scritta a penna sul certificato.' : null);
  var rin = ril.querySelector('input');
  rin.addEventListener('change', function () { if (!f.scadenzaStampata && C.isIso(f.certRilascio)) { f.certScadenza = C.addYears(f.certRilascio, 1); render(); } });
  out.push(el('h3', { text: 'Certificato' }), el('div', { class: 'fields' },
    sel(it, 'certTipo', 'Tipo', [['', '— scegli —'], 'Agonistico', 'Non Agonistico'], tipoHint), ril,
    inp(it, 'certScadenza', 'Data di scadenza', 'date', f.scadenzaStampata ? 'Stampata sul certificato.' : 'Calcolata: un anno dal rilascio.')));
  out.push(el('h3', { text: 'Dati dell\'atleta sul certificato' }), el('p', { class: 'muted small', text: 'Servono a completare l\'anagrafica dove è vuota.' }), el('div', { class: 'fields' },
    inp(it, 'name', 'Cognome e nome', 'text', 'Prima il cognome.'), inp(it, 'nascita', 'Data di nascita', 'date'), inp(it, 'luogo', 'Luogo di nascita'), inp(it, 'cf', 'Codice fiscale'), inp(it, 'indirizzo', 'Indirizzo'), inp(it, 'citta', 'Città di residenza'), inp(it, 'cap', 'CAP')));
  return out;
}
function conflictRows(it, part, store, sheet) {
  if (!part || !part.conflicts || !part.conflicts.length) return null;
  return el('div', { class: 'note note-warn' }, el('b', { text: 'Nel foglio ' + sheet + ' ci sono già valori diversi. Restano quelli del foglio, a meno che tu non scelga di sostituirli:' }), part.conflicts.map(function (c) {
    var cb = el('input', { type: 'checkbox', checked: !!store[c.key], onchange: function () { store[c.key] = cb.checked; refreshPlan(it); } });
    return el('label', { class: 'check' }, cb, el('span', { text: c.header + ': nel foglio "' + C.expectedDisplay(c.current, c.kind) + '", sul documento "' + C.expectedDisplay(c.proposed, c.kind) + '". Sostituisci.' }));
  }));
}
function planBox(it) {
  var plan = computePlan(it), out = [], f = itemF(it);
  if (it.kind === 'modulo' || it.kind === 'certificato') {
    var cfs = [['Codice fiscale atleta', f.cf, f.name, f.nascita]]; if (it.kind === 'modulo') cfs.push(['Codice fiscale genitore', f.cfGenitore, f.genitore, '']);
    var chips = cfs.filter(function (x) { return x[1]; }).map(function (x) { var r = C.cfCheck(x[1], { fullName: x[2], birthIso: x[3] }); return chip(x[0] + (r.valid ? (r.warnings.length ? ': valido, ma da controllare' : ': verificato') : ': errato'), r.valid ? (r.warnings.length ? 'warn' : 'ok') : 'bad'); });
    if (chips.length) out.push(el('div', { class: 'row' }, chips));
  }
  if (plan.errors.length) out.push(note('bad', 'Da correggere prima di inserire:', plan.errors));
  if (plan.warnings.length) out.push(note('warn', 'Avvisi da leggere:', plan.warnings));
  out.push(conflictRows(it, plan.student, it.replace, 'ANAGRAFICA'), conflictRows(it, plan.enrollment, it.replaceE, 'ISCRIZIONI'));
  if (plan.enrollment && it.enrollChoice !== 'none') { var d = plan.enrollment.dovutoAtteso; out.push(note(d ? '' : 'warn', d ? 'Totale dovuto previsto per questa iscrizione: ' + C.fmtMoney(d) + '.' : 'Totale dovuto non definito: senza tipo di abbonamento con tariffa o senza quota concordata, l\'iscrizione non potrà risultare saldata.')); }
  if (plan.lines.length) out.push(el('details', { open: true }, el('summary', { text: 'Cosa verrà scritto nel foglio (' + plan.lines.length + ' campi)' }), el('div', { class: 'scroll-x' }, el('table', null,
    el('thead', null, el('tr', null, ['Foglio', 'Campo', 'Prima', 'Dopo'].map(function (h) { return el('th', { text: h }); }))),
    el('tbody', null, plan.lines.map(function (l) { return el('tr', null, el('td', { text: l.sheet }), el('td', { text: l.campo }), el('td', { class: 'was', text: l.prima }), el('td', { text: l.dopo })); }))))));
  var wk = plan.warnings.join('|'); if (wk !== it.warnKey) { it.warnKey = wk; it.ack = false; }
  var ack = null;
  if (plan.warnings.length && !plan.errors.length) { var cb = el('input', { type: 'checkbox', checked: it.ack, id: 'ack-' + it.id, onchange: function () { it.ack = cb.checked; refreshPlan(it); } }); ack = el('label', { class: 'check', for: 'ack-' + it.id }, cb, el('span', { text: 'Ho letto gli avvisi e voglio inserire lo stesso.' })); }
  var blocked = plan.errors.length || (plan.warnings.length && !it.ack) || !canWrite() || S.busy;
  out.push(ack, el('div', { class: 'row' }, el('button', { class: 'btn btn-primary btn-big', type: 'button', disabled: !!blocked, text: 'Conferma e inserisci nel foglio', onclick: function () { commitItem(it); } })));
  return out;
}
function resultSteps(it) {
  if (!it.result) return null;
  var bad = it.result.steps.filter(function (s) { return !s.ok; });
  return el('div', { class: 'note ' + (bad.length ? 'note-bad' : 'note-ok') }, el('b', { text: bad.length ? 'Inserimento non completato: controlla qui sotto cosa è stato scritto.' : 'Inserito e verificato.' }),
    el('ul', null, it.result.steps.map(function (s) { return el('li', { text: (s.ok ? '✓ ' : '✗ ') + s.text }); })));
}
function resultCard(it) {
  if (it.status === 'saving') return el('div', { class: 'card' }, el('div', { class: 'row' }, el('span', { class: 'spin' }), el('b', { text: 'Scrivo nel foglio e ricontrollo…' })), el('p', { class: 'muted', text: 'Non chiudere la pagina.' }));
  var next = S.queue.filter(function (q) { return q.status === 'ready' || q.status === 'partial'; })[0];
  return el('div', { class: 'card' }, el('h2', { text: itemLabel(it) || DOC_LABEL[it.kind] }), resultSteps(it),
    el('div', { class: 'row' }, next ? el('button', { class: 'btn btn-primary', type: 'button', text: 'Vai al prossimo documento', onclick: function () { S.curId = next.id; render(); } }) : null,
      el('a', { class: 'btn', href: 'https://docs.google.com/spreadsheets/d/' + C.SHEET_ID + '/edit', target: '_blank', rel: 'noopener', text: 'Apri il foglio' }), el('button', { class: 'btn', type: 'button', text: 'Togli dalla lista', onclick: function () { removeItem(it); } })));
}

/* ---------- writing a scanned document ---------- */
function opsOf(part) { return part.ops.map(function (o) { return { header: o.header, kind: o.kind, value: o.value, prev: o.prev, note: o.note }; }); }
async function commitItem(it) {
  if (S.busy) return;
  var before = JSON.stringify(computePlan(it).lines), steps = [], reg = [], doc = DOC_LABEL[it.kind];
  S.busy = true; it.status = 'saving'; render();
  try {
    await loadDb();
    if (!canWrite()) throw { code: 'x', message: 'Il foglio non ha la struttura attesa: non scrivo nulla.' };
    var plan = computePlan(it), db = S.db;
    if (plan.errors.length) throw { code: 'x', message: 'Nel frattempo il foglio è cambiato: ' + plan.errors.join(' ') };
    if (JSON.stringify(plan.lines) !== before) throw { code: 'x', message: 'Nel frattempo il foglio è cambiato e l\'elenco delle modifiche non è più lo stesso. Non ho scritto nulla: ricontrolla la preverifica e conferma di nuovo.' };
    var serial = C.toSerial(), name = plan.student.name, bad;
    if (plan.addFascia) {
      try { await updateValues('LISTE!' + C.colLetter(plan.addFascia.col) + plan.addFascia.row, [["'" + plan.addFascia.value]]); steps.push({ ok: true, text: 'Orario "' + plan.addFascia.value + '" aggiunto all\'elenco degli orari.' });
        reg.push([serial, name, doc, 'Nuova voce elenco', 'LISTE', plan.addFascia.row, 'Fascia oraria', '', "'" + plan.addFascia.value, 'Orario non presente nell\'elenco']); }
      catch (e) { steps.push({ ok: false, text: 'Non sono riuscito ad aggiungere l\'orario all\'elenco (' + errText(e) + ').' }); }
    }
    if (plan.student.ops.length) {
      var so = opsOf(plan.student), sNew = plan.student.mode === 'new';
      if (sNew) await assertEmptyRow('ANA', db.sMap, plan.student.row, [C.S_COLS.name]);
      bad = await writeRow('ANA', db.sMap, plan.student.row, so);
      steps.push(stepFromWrite(sNew ? 'Nuova allieva in anagrafica' : 'Anagrafica aggiornata', plan.student.row, bad));
      reg = reg.concat(C.registroRows(serial, name, doc, sNew ? 'Nuova allieva' : 'Aggiornamento', 'ANAGRAFICA', plan.student.row, so));
      it.studentChoice = plan.student.row; it.replace = {};
    }
    if (plan.enrollment && plan.enrollment.ops.length) {
      var eo = opsOf(plan.enrollment), eNew = plan.enrollment.mode === 'new';
      if (eNew) await assertEmptyRow('ISC', db.eMap, plan.enrollment.row, [C.E_COLS.allieva]);
      bad = await writeRow('ISC', db.eMap, plan.enrollment.row, eo);
      steps.push(stepFromWrite(eNew ? 'Nuova iscrizione' : 'Iscrizione aggiornata', plan.enrollment.row, bad));
      reg = reg.concat(C.registroRows(serial, name, doc, eNew ? 'Nuova iscrizione' : 'Aggiornamento', 'ISCRIZIONI', plan.enrollment.row, eo));
      it.enrollChoice = plan.enrollment.row; it.replaceE = {};
    }
    if (plan.payment) {
      var r = await savePayment(db, plan.payment, plan.enrollment.row, name, doc, serial);
      steps.push(r.step); reg = reg.concat(r.reg); it.fm.payOn = false; it.fm.pagatoSulModulo = false;
    }
  } catch (e) { steps.push({ ok: false, text: e && e.code === 'x' ? e.message : (e && (e.code === 'busy_row' || e.code === 'verify') ? e.message : 'Interrotto: ' + errText(e)) }); }
  await writeRegistro(reg, steps);
  try { await loadDb(); } catch (e2) { /* shown by the connection chip */ }
  it.result = { steps: steps }; it.status = steps.every(function (s) { return s.ok; }) ? 'done' : 'partial';
  S.busy = false; render();
}
/** Writes one payment linked to the enrollment in row eRow; returns the step and the registro rows. Throws if nothing was written. */
async function savePayment(db, pay, eRow, name, doc, serial) {
  var back = await getValues(rowRange(C.SHEETS.ISC.name, eRow)), chiave = C.cell(back[0] || [], db.eMap, 'Chiave elenco');
  if (!chiave) throw { code: 'x', message: 'Pagamento NON registrato: non riesco a leggere la chiave dell\'iscrizione nella riga ' + eRow + ' di ISCRIZIONI.' };
  var ops = P.paymentOps(pay, chiave);
  await assertEmptyRow('PAG', db.pMap, pay.row, [C.P_COLS.data, C.P_COLS.iscrizione, C.P_COLS.importo, C.P_COLS.metodo]);
  var bad = await writeRow('PAG', db.pMap, pay.row, ops), ric = '', linked = '';
  try { var pr = (await getValues(rowRange(C.SHEETS.PAG.name, pay.row)))[0] || []; ric = C.cell(pr, db.pMap, 'N. ricevuta'); linked = C.cell(pr, db.pMap, 'Allieva'); } catch (e) { /* receipt shown only if readable */ }
  var step = stepFromWrite('Pagamento di ' + C.fmtMoney(pay.importo) + (ric ? ', ricevuta ' + ric : ''), pay.row, bad);
  if (step.ok && linked && C.tokenKey(linked) !== C.tokenKey(name)) step = { ok: false, text: 'Pagamento scritto nella riga ' + pay.row + ', ma il foglio lo collega a "' + linked + '" invece che a "' + name + '". Controllalo subito nel foglio PAGAMENTI.' };
  return { step: step, reg: C.registroRows(serial, name, doc, 'Nuovo pagamento', 'PAGAMENTI', pay.row, ops.map(function (o) { return Object.assign({}, o, { note: o.header === C.P_COLS.importo && ric ? 'Ricevuta ' + ric : '' }); })) };
}

/* ---------- Pagamenti view ---------- */
function viewPagamenti() {
  var p = S.pay, db = S.db, out = [problemsBox()];
  var m = p.name ? C.matchStudent(db.students, p.name) : null, st = m && m.exact, ens = st ? P.enrollmentsOf(db, st.name) : [];
  if (st && (p.enrollRow === null || !ens.some(function (e) { return e.row === p.enrollRow; }))) { var act = ens.filter(function (e) { return e.active; }); p.enrollRow = act.length ? act[0].row : (ens.length ? ens[0].row : null); }
  if (!st) p.enrollRow = null;
  if (!p.data) p.data = C.todayIso();
  var card = el('div', { class: 'card' }, el('h2', { text: 'Registra un pagamento' }));
  if (p.result) add(card, el('div', { class: 'note ' + (p.result.every(function (s) { return s.ok; }) ? 'note-ok' : 'note-bad') }, el('ul', null, p.result.map(function (s) { return el('li', { text: (s.ok ? '✓ ' : '✗ ') + s.text }); }))));
  var pick = studentPicker(p.name, function (v) { p.name = v; p.enrollRow = null; p.result = null; p.ack = false; render(); }, 'pay-allieva');
  add(card, el('div', { class: 'fields' }, field('Allieva', el('span', null, pick), p.name && !st ? 'Nessuna allieva con questo nome: sceglila dall\'elenco.' : null, p.name && !st ? 'bad' : null),
    st ? field('Iscrizione', select(ens.map(function (e) { return [e.row, e.corso + (e.fascia ? ' ' + e.fascia : '') + (e.tipo ? ' · ' + e.tipo : '') + (e.active ? '' : ' (annullata o storica)')]; }), p.enrollRow, function (v) { p.enrollRow = Number(v); p.ack = false; render(); })) : null));
  if (st && !ens.length) add(card, note('bad', 'Questa allieva non ha iscrizioni: inserisci prima il suo modulo.'));
  var e = st && p.enrollRow !== null ? P.byRow(db.enrollments, p.enrollRow) : null;
  if (e) {
    add(card, el('div', { class: 'grid' }, tile(C.fmtMoney(e.dovutoN || 0), 'Dovuto', ''), tile(C.fmtMoney(e.pagatoN || 0), 'Pagato', 'ok'), tile(C.fmtMoney(e.residuoN || 0), 'Residuo', e.residuoN > 0 ? 'warn' : 'ok')));
    function pin(key, label, type, hint) { var i = el('input', { type: type, value: p[key], autocomplete: 'off', oninput: function () { p[key] = i.value; refreshPay(); } }); return field(label, i, hint); }
    add(card, el('div', { class: 'fields' }, pin('data', 'Data del pagamento', 'date'), pin('importo', 'Importo (€)', 'text', e.residuoN > 0 ? 'Residuo: ' + C.fmtMoney(e.residuoN) : null),
      field('Metodo', select([['', '— scegli —']].concat(db.lists.metodi), p.metodo, function (v) { p.metodo = v; refreshPay(); })), pin('note', 'Nota (facoltativa)', 'text')));
    add(card, el('div', { id: 'pay-box' }, payBox()));
    var hist = db.payments.filter(function (x) { return parseInt(x.idIscr, 10) === parseInt(e.id, 10); });
    add(card, el('details', null, el('summary', { text: 'Versamenti già registrati per questa iscrizione (' + hist.length + ')' }), hist.length ? el('div', { class: 'scroll-x' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { text: 'Data' }), el('th', { class: 'num', text: 'Importo' }), el('th', { text: 'Metodo' }), el('th', { text: 'Ricevuta' }))),
      el('tbody', null, hist.map(function (x) { return el('tr', null, el('td', { class: 'mono', text: C.isoToIt(x.data) || 'senza data' }), el('td', { class: 'num', text: C.fmtMoney(x.importoN) }), el('td', { text: x.metodo }), el('td', { text: x.ricevuta })); })))) : el('p', { class: 'muted', text: 'Nessuno.' })));
  }
  out.push(card);
  return out;
}
function refreshPay() { var b = $('pay-box'); if (b) { clear(b); add(b, payBox()); } }
function payBox() {
  var p = S.pay, plan = P.planPagamento(S.db, { enrollRow: p.enrollRow, data: p.data, importo: p.importo, metodo: p.metodo, note: p.note }), out = [];
  var typing = !p.importo && !p.metodo;
  if (plan.errors.length && !typing) out.push(note('bad', 'Da correggere:', plan.errors));
  if (plan.warnings.length) out.push(note('warn', 'Avvisi da leggere:', plan.warnings));
  var ack = null;
  if (plan.warnings.length && !plan.errors.length) { var cb = el('input', { type: 'checkbox', checked: p.ack, id: 'pay-ack', onchange: function () { p.ack = cb.checked; refreshPay(); } }); ack = el('label', { class: 'check', for: 'pay-ack' }, cb, el('span', { text: 'Ho letto gli avvisi e voglio registrare lo stesso.' })); }
  var blocked = plan.errors.length || (plan.warnings.length && !p.ack) || !canWrite() || S.busy;
  out.push(ack, el('div', { class: 'row' }, el('button', { class: 'btn btn-primary btn-big', type: 'button', disabled: !!blocked, text: plan.errors.length ? 'Registra il pagamento' : 'Registra ' + C.fmtMoney(plan.payment.importo) + ' · ' + p.metodo, onclick: commitPayment })));
  return out;
}
async function commitPayment() {
  if (S.busy) return;
  var p = S.pay, steps = [], reg = [];
  S.busy = true; render();
  try {
    await loadDb();
    if (!canWrite()) throw { code: 'x', message: 'Il foglio non ha la struttura attesa: non scrivo nulla.' };
    var db = S.db, plan = P.planPagamento(db, { enrollRow: p.enrollRow, data: p.data, importo: p.importo, metodo: p.metodo, note: p.note });
    if (plan.errors.length) throw { code: 'x', message: plan.errors.join(' ') };
    if (!plan.enrollment || C.tokenKey(plan.enrollment.allieva) !== C.tokenKey(p.name)) throw { code: 'x', message: 'Nel frattempo il foglio è cambiato e l\'iscrizione scelta non è più la stessa. Non ho scritto nulla: riscegli l\'allieva.' };
    var r = await savePayment(db, plan.payment, plan.enrollment.row, plan.enrollment.allieva, 'Pagamento', C.toSerial());
    steps.push(r.step); reg = r.reg;
    p.importo = ''; p.note = ''; p.ack = false;
  } catch (e) { steps.push({ ok: false, text: e && (e.code === 'x' || e.code === 'busy_row' || e.code === 'verify') ? e.message : 'Pagamento NON registrato: ' + errText(e) }); }
  await writeRegistro(reg, steps);
  try { await loadDb(); } catch (e2) { /* shown by the connection chip */ }
  p.result = steps; S.busy = false; render();
}

/* ---------- start ---------- */
window.addEventListener('hashchange', route);
$('btn-reload').addEventListener('click', function () { reload(); });
$('zoom-close').addEventListener('click', function () { $('zoom').hidden = true; });
route();
initRuntime().then(function () { render(); if (S.rt.mcp) { var p = loadDb(); render(); return p.then(render, render); } });
