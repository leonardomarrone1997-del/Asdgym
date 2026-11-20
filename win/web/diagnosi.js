/* Gym Art Segreteria - segnala al programma gli errori imprevisti della pagina: finiscono nel diario tecnico (Altro › Impostazioni › Assistenza).
   Si carica per primo, così vede anche gli errori che nascono mentre le altre parti si caricano. Non scrive niente nella pagina (tranne un
   avviso discreto la prima volta) e non si ferma mai: se la segnalazione non parte, pazienza.
   Manda solo il tipo di errore, i punti del codice dove è successo e il nome della sezione (non l'indirizzo intero): mai i dati.
   Il programma poi ripulisce ancora il testo (codici fiscali, e-mail, telefoni, IBAN) prima di scriverlo. */
(function (root) {
  'use strict';
  var MAX = 5; // segnalazioni per ogni apertura della pagina: un errore in ciclo non deve intasare niente
  var meta = root.document && root.document.querySelector('meta[name="gymart-token"]');
  var token = meta ? meta.content : '', viste = {}, quante = 0;

  /** Il nome della sezione in cui si è (la prima parte dell'indirizzo): «allieva», «pagamenti»… mai l'identificativo né quello che si cerca. */
  function sezione() {
    var h = String((root.location && root.location.hash) || '').replace(/^#/, '').split('/')[0].toLowerCase();
    return !h ? 'inizio' : /^[a-z0-9-]{1,24}$/.test(h) ? h : 'altro';
  }
  /** Dalla pila di Chrome/Edge tiene «funzione (file:riga:colonna)», senza indirizzo del sito né parametri. */
  function punti(stack) {
    var out = [], righe = String(stack || '').split('\n'), i, m;
    for (i = 0; i < righe.length && out.length < 6; i++) {
      m = /^\s*at\s+(?:(.+?)\s+\()?(?:[a-z][a-z0-9+.-]*:\/\/[^\/\s)]*\/)?([^\s():?]+)(?:\?[^:)\s]*)?:(\d+):(\d+)\)?\s*$/i.exec(righe[i]);
      if (m) out.push((m[1] ? m[1].replace(/^Object\./, '') + ' (' : '(') + m[2] + ':' + m[3] + ':' + m[4] + ')');
    }
    return out;
  }
  function invia(tipo, messaggio, pila) {
    var chiave = tipo + '|' + messaggio + '|' + (pila[0] || '');
    if (viste[chiave] || quante >= MAX) return false;
    viste[chiave] = true; quante++;
    try {
      root.fetch('/api/diario', { method: 'POST', keepalive: true, headers: { 'X-Gymart-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipo, messaggio: String(messaggio).slice(0, 300), pila: pila, pagina: sezione() }) }).catch(function () { /* niente */ });
    } catch (e) { return false; }
    if (quante === 1 && typeof root.toast === 'function') {
      try { root.toast('Qualcosa non ha funzionato. Il programma l\'ha annotato: se si ripete, vedi Altro › Impostazioni › Assistenza.'); } catch (e) { /* niente */ }
    }
    return true;
  }
  /** Errori che il browser dà senza che sia successo niente di rotto, o che non dicono nulla. */
  function ignorabile(messaggio, file) {
    if (!messaggio || /^ResizeObserver loop/.test(messaggio) || /^Script error\.?$/.test(messaggio)) return true;
    return !!file && root.location && file.indexOf(root.location.origin) !== 0;
  }

  if (root.addEventListener) {
    root.addEventListener('error', function (e) {
      if (!e || (!e.message && !e.error)) return; // un'immagine o un file che non si carica non è un errore del programma
      var msg = (e.error && e.error.message) || e.message;
      if (ignorabile(msg, e.filename)) return;
      var pila = punti(e.error && e.error.stack);
      if (!pila.length && e.filename) pila = ['(' + String(e.filename).replace(/^[a-z]+:\/\/[^\/]*\//i, '').replace(/\?.*$/, '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0) + ')'];
      invia('errore', (e.error && e.error.name ? e.error.name + ': ' : '') + msg, pila);
    });
    root.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason, msg = r && r.message ? (r.name ? r.name + ': ' : '') + r.message : String(r);
      if (ignorabile(msg) || (r && r.name === 'AbortError')) return;
      invia('promessa', msg, punti(r && r.stack));
    });
  }
  root.GymDiagnosi = { invia: invia, punti: punti, sezione: sezione, ignorabile: ignorabile, inviate: function () { return quante; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GymDiagnosi;
})(typeof window !== 'undefined' ? window : this);
