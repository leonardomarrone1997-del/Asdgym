/* Gym Art Segreteria - visita guidata: i passi per imparare il programma, mostrati una volta sola.
   Ogni passo porta nella pagina giusta, evidenzia un punto (il resto si oscura) e dice che cosa fare. Si può saltare in ogni momento e rifare da Impostazioni o dal punto interrogativo in alto.
   Usa le funzioni della pagina (go, el, S, L) solo quando serve, quindi può essere caricato prima di app.js. Non scrive mai nei dati: salva solo "visita fatta" in questo dispositivo. */
(function (root) {
  'use strict';
  var CHIAVE = 'gymart-tutorial';

  function fatta() { try { return localStorage.getItem(CHIAVE) === 'fatto'; } catch (e) { return true; } } // senza memoria nel browser non si ripropone a ogni apertura
  function segnaFatta() { try { localStorage.setItem(CHIAVE, 'fatto'); } catch (e) { /* niente */ } }

  /* I passi. mira: i selettori del punto da evidenziare (vale il primo visibile: sul telefono il menu è in basso). vai: la pagina in cui mostrarlo.
     azione 'click': il punto evidenziato si può premere davvero, e la visita va avanti da sola. testo può essere una funzione (dipende dai dati). */
  function giorniAttesa() { try { return root.L.giorniAttesaCert(root.S.db); } catch (e) { return 15; } }
  var PASSI = [
    { titolo: 'Il programma in due minuti', vai: 'inizio', etichetta: 'Cominciamo', salta: 'Non adesso',
      testo: 'Ti faccio fare un giro di due minuti: vedrai dove sono le cose di ogni giorno. Puoi fermarti quando vuoi, e rifare la visita da Impostazioni oppure dal punto interrogativo in alto.' },
    { titolo: 'Il menu', vai: 'inizio', mira: ['#tabs', '#bottom'],
      testo: 'Qui ci sono le pagine di tutti i giorni: Inizio, Allieve, Iscrizioni, Pagamenti, Scadenze, Calendario, Certificati e Grafici. Il resto (corsi, assistente, impostazioni, manuale) sta sotto «Altro». I numeri accanto alle voci dicono quante cose aspettano.' },
    { titolo: 'Quando arriva una persona', vai: 'inizio', mira: ['#nuova'], azione: 'click', consiglio: 'Premi «Nuova iscrizione» (o «Avanti»).',
      testo: 'Per iscrivere una persona nuova, o una già presente a un altro corso, si usa sempre questo pulsante.' },
    { titolo: 'Un solo modulo', vai: 'iscrizione/nuova', mira: ['#view form.card'],
      testo: 'Scrivi cognome e nome, data di nascita, telefono e genitore; poi scegli il corso, i giorni e il tipo di abbonamento. Tariffa e scadenza le calcola il programma. Se la persona è già in elenco, scegli il suo nome nel primo campo.' },
    { titolo: 'Il certificato medico', vai: 'iscrizione/nuova', mira: ['.cert-blocco'],
      testo: function () { return 'Per ogni iscrizione serve il certificato medico. Se la persona lo porta dopo, lascia «Lo porta dopo»: resta «in attesa» per ' + giorniAttesa() + ' giorni e il programma te lo ricorda. Se ce l\'ha già, scegli «Lo ha portato adesso» e scrivi tipo e data.'; } },
    { titolo: 'I pagamenti', vai: 'pagamenti', mira: ['#tabs a[href="#pagamenti"]', '#bottom a[href="#pagamenti"]'],
      testo: 'Dopo l\'iscrizione si registra il pagamento: importo, metodo e data. Il programma numera le ricevute e le prepara in PDF. Qui vedi anche chi deve ancora pagare e i bonifici da controllare.' },
    { titolo: 'Le scadenze', vai: 'scadenze', mira: ['#view .card', '#view'],
      testo: 'Chi deve rinnovare l\'abbonamento e chi deve portare il certificato. Su ogni riga: «Avvisa» prepara il messaggio WhatsApp per il genitore, «Rinnova» apre il nuovo periodo, «Registra certificato» scrive il certificato appena arrivato.' },
    { titolo: 'I certificati', vai: 'certificati', mira: ['#view .card', '#view'],
      testo: 'Tutti i certificati in un colpo d\'occhio, con il tipo (agonistico o non agonistico) sempre in vista. Dalla scheda di ogni allieva puoi anche scansionare il documento, allegarlo o fotografarlo.' },
    { titolo: 'I grafici', vai: 'analisi', mira: ['#view'],
      testo: 'Incassi, iscrizioni e rinnovi dei prossimi mesi: ti avvisano in tempo dei rinnovi trimestrali di dicembre e marzo e della nuova stagione di settembre.' },
    { titolo: 'Cerca e vai veloce', vai: 'inizio', mira: ['#cerca-box'],
      testo: 'Scrivi qui il nome di una persona o di una pagina (per esempio «verifica» o «copie») e premi Invio. Da tastiera si raggiunge con Ctrl + K.' },
    { titolo: 'Se hai un dubbio', vai: 'inizio', mira: ['#aiuto'], etichetta: 'Ho capito',
      testo: 'Il punto interrogativo apre il manuale: i passi di ogni compito e le risposte alle domande più comuni. Il programma salva da solo le copie dei dati: ogni tanto controlla la seconda copia (Impostazioni → Dati su questo computer).' }
  ];

  var st = { i: 0, attiva: false, bersaglio: null, mira: null, el: null, ascolto: null };

  function paginaAperta() { return root.location.hash.replace(/^#/, '') || 'inizio'; }
  function haCasella(n) {
    if (!n) return false;
    var r = n.getBoundingClientRect(), cs = getComputedStyle(n);
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  function trova(sel) { for (var i = 0; sel && i < sel.length; i++) { var n = document.querySelector(sel[i]); if (haCasella(n)) return n; } return null; }
  function div(cls, figli) { var d = document.createElement('div'); if (cls) d.className = cls; (figli || []).forEach(function (f) { if (f) d.appendChild(f); }); return d; }
  function bottone(testo, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + (cls || ''); b.textContent = testo; b.addEventListener('click', fn); return b; }

  function costruisci() {
    var velo = div('tut-velo'), pannelli = [0, 1, 2, 3].map(function () { return div('tut-pannello'); }), anello = div('tut-anello');
    pannelli.forEach(function (p) { velo.appendChild(p); }); velo.appendChild(anello);
    var card = document.createElement('div'); card.className = 'tut-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'false'); card.setAttribute('aria-labelledby', 'tut-titolo'); card.setAttribute('aria-describedby', 'tut-testo'); card.tabIndex = -1;
    var passo = div('tut-passo'), prog = document.createElement('i'), barra = div('tut-prog', [prog]);
    var chiudi = document.createElement('button'); chiudi.type = 'button'; chiudi.className = 'tut-x'; chiudi.setAttribute('aria-label', 'Chiudi la visita guidata'); chiudi.textContent = '×'; chiudi.addEventListener('click', function () { termina(); });
    var titolo = document.createElement('h2'); titolo.id = 'tut-titolo';
    var testo = document.createElement('p'); testo.id = 'tut-testo';
    var consiglio = div('tut-consiglio');
    var indietro = bottone('Indietro', '', function () { vai(st.i - 1); });
    var salta = bottone('Salta la visita', 'btn-small tut-salta', function () { termina(); });
    var avanti = bottone('Avanti', 'btn-primary', function () { if (st.i >= PASSI.length - 1) termina(true); else vai(st.i + 1); });
    var azioni = div('tut-azioni', [salta, div('tut-spazio'), indietro, avanti]);
    [div('tut-testa', [passo, chiudi]), barra, titolo, testo, consiglio, azioni].forEach(function (n) { card.appendChild(n); });
    return { velo: velo, pannelli: pannelli, anello: anello, card: card, passo: passo, prog: prog, titolo: titolo, testo: testo, consiglio: consiglio, indietro: indietro, salta: salta, avanti: avanti };
  }

  /** Mette il velo (oscura tutto tranne il punto evidenziato) e la scheda accanto al punto. */
  function posiziona() {
    var e = st.el; if (!e) return;
    var vw = window.innerWidth, vh = window.innerHeight, m = 12, t = st.bersaglio, buco = null;
    if (st.mira && (!t || !document.body.contains(t))) t = st.bersaglio = trova(st.mira); // la pagina è stata ridisegnata: il punto è un altro elemento
    if (t && document.body.contains(t)) {
      var r = t.getBoundingClientRect(), pad = 6;
      var x1 = Math.max(0, r.left - pad), y1 = Math.max(0, r.top - pad), x2 = Math.min(vw, r.right + pad), y2 = Math.min(vh, r.bottom + pad);
      if (x2 - x1 > 4 && y2 - y1 > 4) buco = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    function rett(p, x, y, w, h) { p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.width = Math.max(0, w) + 'px'; p.style.height = Math.max(0, h) + 'px'; }
    if (!buco) { rett(e.pannelli[0], 0, 0, vw, vh); rett(e.pannelli[1], 0, 0, 0, 0); rett(e.pannelli[2], 0, 0, 0, 0); rett(e.pannelli[3], 0, 0, 0, 0); e.anello.style.display = 'none'; }
    else {
      rett(e.pannelli[0], 0, 0, vw, buco.y); rett(e.pannelli[1], 0, buco.y + buco.h, vw, vh - buco.y - buco.h);
      rett(e.pannelli[2], 0, buco.y, buco.x, buco.h); rett(e.pannelli[3], buco.x + buco.w, buco.y, vw - buco.x - buco.w, buco.h);
      e.anello.style.display = 'block'; rett(e.anello, buco.x, buco.y, buco.w, buco.h);
    }
    // la scheda: accanto al punto, dove c'è posto; al centro se non c'è un punto; in basso se il punto è enorme
    var cw = e.card.offsetWidth, ch = e.card.offsetHeight, x, y, alto = buco && buco.h > vh * 0.55;
    function dentro(a, lo, hi) { return Math.max(lo, Math.min(hi, a)); }
    if (!buco) { x = (vw - cw) / 2; y = (vh - ch) / 2; }
    else {
      var prove = alto ? [] : [
        function () { return buco.y + buco.h + m + ch + m <= vh ? [buco.x, buco.y + buco.h + m] : null; },
        function () { return buco.y - m - ch >= m ? [buco.x, buco.y - m - ch] : null; },
        function () { return vw >= 700 && buco.x + buco.w + m + cw + m <= vw ? [buco.x + buco.w + m, buco.y] : null; },
        function () { return vw >= 700 && buco.x - m - cw >= m ? [buco.x - m - cw, buco.y] : null; }];
      var p = null; for (var i = 0; i < prove.length && !p; i++) p = prove[i]();
      if (!p) p = [vw - cw - m, vh - ch - m]; // non c'è un posto libero: in basso, sopra il punto evidenziato
      x = p[0]; y = p[1];
    }
    e.card.style.left = dentro(x, m, Math.max(m, vw - cw - m)) + 'px'; e.card.style.top = dentro(y, m, Math.max(m, vh - ch - m)) + 'px';
  }

  function ascoltaClick(n) {
    scolta();
    var f = function () { setTimeout(function () { if (st.attiva && PASSI[st.i].azione === 'click' && st.bersaglio === n) vai(st.i + 1); }, 350); };
    n.addEventListener('click', f, true); st.ascolto = function () { n.removeEventListener('click', f, true); };
  }
  function scolta() { if (st.ascolto) { st.ascolto(); st.ascolto = null; } }

  /** Mostra il passo i: va nella pagina giusta, aspetta che il punto compaia, lo porta in vista e lo evidenzia. */
  function vai(i) {
    if (!st.attiva) return;
    i = Math.max(0, Math.min(PASSI.length - 1, i)); st.i = i;
    var p = PASSI[i], e = st.el;
    scolta(); st.bersaglio = null; st.mira = p.mira || null;
    e.passo.textContent = 'Passo ' + (i + 1) + ' di ' + PASSI.length; e.prog.style.transform = 'scaleX(' + ((i + 1) / PASSI.length) + ')';
    e.titolo.textContent = p.titolo; e.testo.textContent = typeof p.testo === 'function' ? p.testo() : p.testo;
    e.consiglio.textContent = p.consiglio || ''; e.consiglio.hidden = !p.consiglio;
    e.indietro.hidden = i === 0; e.avanti.textContent = p.etichetta || (i === PASSI.length - 1 ? 'Fine' : 'Avanti'); e.salta.textContent = p.salta || (i === PASSI.length - 1 ? 'Chiudi' : 'Salta la visita'); e.salta.hidden = i === PASSI.length - 1;
    var cambia = !!p.vai && paginaAperta() !== p.vai;
    if (cambia) root.go(p.vai);
    var prova = 0;
    setTimeout(function attendi() {
      if (!st.attiva || st.i !== i) return;
      var n = p.mira ? trova(p.mira) : null;
      if (!n && p.mira && prova++ < 30) { setTimeout(attendi, 50); return; } // la pagina si sta ancora disegnando
      st.bersaglio = n;
      if (n) { // se il punto è già tutto in vista non si scorre (il menu e la barra in alto restano fermi)
        var r = n.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) { try { n.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (x) { /* niente */ } }
      }
      if (n && p.azione === 'click') ascoltaClick(n);
      posiziona();
      setTimeout(posiziona, 120); // dopo lo scorrimento e la dissolvenza
      e.card.focus({ preventScroll: true });
    }, cambia ? 120 : 0); // dopo un cambio di pagina il menu e la pagina vengono ridisegnati: si aspetta
  }

  function sulRidimensiona() { if (st.attiva) posiziona(); }
  function suTasto(ev) {
    if (!st.attiva) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); termina(); }
  }

  /** Chiude la visita. In ogni caso non si ripropone da sola: si rifà da Impostazioni o dal punto interrogativo. fine = arrivata all'ultimo passo. */
  function termina() {
    if (!st.attiva) return;
    st.attiva = false; scolta();
    if (st.el) { st.el.velo.remove(); st.el.card.remove(); st.el = null; }
    window.removeEventListener('resize', sulRidimensiona); window.removeEventListener('scroll', sulRidimensiona, true); document.removeEventListener('keydown', suTasto, true);
    segnaFatta();
    // il modulo aperto per la visita non va lasciato lì
    if (/^#iscrizione\/nuova$/.test(root.location.hash)) root.go('inizio');
    var a = document.getElementById('aiuto'); if (a && a.focus) a.focus({ preventScroll: true });
  }

  /** Avvia la visita dal primo passo (anche se già fatta). */
  function avvia() {
    if (st.attiva) return;
    if (root.S && root.S.dirty) { (root.avviso || root.alert)('Hai modifiche non salvate: salvale (o annullale), poi riavvia la visita guidata.'); return; } // andare di pagina in pagina le scarterebbe
    var e = costruisci(); st.el = e; st.attiva = true;
    document.body.appendChild(e.velo); document.body.appendChild(e.card);
    window.addEventListener('resize', sulRidimensiona); window.addEventListener('scroll', sulRidimensiona, true); document.addEventListener('keydown', suTasto, true);
    vai(0);
  }
  /** Al primo avvio su questo dispositivo, quando si è sulla pagina Inizio e non c'è altro sullo schermo. */
  function avviaSeServe() {
    if (fatta() || st.attiva) return false;
    if (paginaAperta() !== 'inizio' || document.querySelector('dialog[open]')) return false;
    avvia(); return true;
  }

  root.Tutorial = { avvia: avvia, avviaSeServe: avviaSeServe, attiva: function () { return st.attiva; }, fatta: fatta, chiudi: termina, passi: PASSI.length, CHIAVE: CHIAVE };
})(window);
