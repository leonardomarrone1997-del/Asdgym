/* Demo of Gym Art Segreteria: the real page, with the program's requests answered inside the page and invented data.
 * Nothing is saved anywhere: a reload starts again. Used only by tools/anteprima/costruisci.js. */
(function () {
  var C = window.Core, L = window.Logic, real = window.fetch.bind(window), DB = null, REV = 1, REG = [], SALV = '';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ora() { var d = new Date(); return C.todayIso() + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dd(iso, k) { return new Date(Date.parse(iso) + k * 864e5).toISOString().slice(0, 10); }

  function seed() {
    var today = C.todayIso(), now = ora(), db = L.nuovoArchivio(today);
    var COGN = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Leone', 'Fontana', 'Santoro', 'Mariani'];
    var NOMI = ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma', 'Giorgia', 'Greta', 'Beatrice', 'Anna', 'Vittoria', 'Matilde', 'Noemi', 'Francesca', 'Sara', 'Chiara', 'Martina', 'Nicole', 'Bianca', 'Gaia', 'Arianna', 'Rebecca', 'Elena', 'Camilla'];
    var corsi = [['Propedeutico', 'Corso Propedeutico · 1 giorno/settimana', ['Sab']], ['Base', 'Corso Base e Avanzato · 2 giorni/settimana', ['Lun', 'Mer']], ['Avanzato', 'Corso Base e Avanzato · 3 giorni/settimana', ['Lun', 'Mer', 'Ven']], ['Agonismo', 'Corso Agonistico · 3 giorni/settimana', ['Mar', 'Gio', 'Sab']], ['FitKid', 'FitKid (1 giorno)', ['Ven']]];
    var tipi = ['Mensile', 'Trimestrale', 'Trimestrale', 'Annuale'], metodi = ['Contanti', 'Bonifico', 'POS'], i, k;
    for (i = 0; i < 36; i++) {
      var cert = i % 7 === 0 ? {} : i % 7 === 1 ? { certTipo: 'Agonistico', certRilascio: dd(today, -355), certScadenza: dd(today, 10) } : i % 7 === 2 ? { certTipo: 'Non Agonistico', certRilascio: dd(today, -400), certScadenza: dd(today, -35) } : { certTipo: 'Non Agonistico', certRilascio: dd(today, -120), certScadenza: dd(today, 245) };
      db = L.salvaAllieva(db, null, Object.assign({ name: COGN[i % 24] + ' ' + NOMI[(i * 5) % 24], nascita: (2009 + (i % 12)) + '-' + pad(1 + (i * 7) % 12) + '-' + pad(1 + (i * 11) % 28), tel: i % 11 === 3 ? '' : '333' + String(1000000 + i * 3717).slice(0, 7), genitore: COGN[i % 24] + ' ' + ['Paolo', 'Luca', 'Anna', 'Laura'][i % 4], citta: 'Avezzano', email: 'famiglia' + i + '@example.com', privacy: i % 9 === 4 ? '' : 'Sì', liberatoria: 'Sì' }, cert), now).db;
    }
    for (i = 0; i < 36; i++) {
      var c = corsi[i % 5], id = String(i + 1).padStart ? String(i + 1).padStart(4, '0') : ('000' + (i + 1)).slice(-4);
      for (k = 0; k < 3; k++) {
        var inizio = dd(today, -Math.round((6 - k * 2 - (i % 3)) * 30) + (i % 9) * 3);
        db = L.salvaIscrizione(db, null, { allievaId: id, corso: c[0], giorni: c[2], pacchetto: c[1], tipo: k === 2 ? tipi[(i + k) % 4] : 'Trimestrale', inizio: inizio, fascia: i % 2 ? '17:00-18:30' : '16:00-17:00', quota: '', quotaIscrizione: k === 0 ? '10' : '', storica: k < 2 && i % 6 !== 0 }, now).db;
        var isc = db.iscrizioni[db.iscrizioni.length - 1], dov = L.dovuto(db, isc) || 0, q = (i + k) % 5 === 0 ? 0.4 : (i + k) % 7 === 0 ? 0 : 1, dp = dd(inizio, i % 5);
        if (dov > 0 && q > 0) db = L.salvaPagamento(db, { iscrizioneId: isc.id, data: dp > today ? today : dp, importo: Math.round(dov * q), metodo: metodi[(i + k) % 3] }, now).db;
      }
    }
    [{ testo: 'Chiamare il comune per la palestra', data: dd(today, 0) }, { testo: 'Ordinare le tute nuove', data: dd(today, 2) }, { testo: 'Pagare la quota di affiliazione', data: dd(today, -3) },
      { testo: 'Gara regionale a Pescara', data: dd(today, 9), dataFine: dd(today, 10) }, { testo: 'Palestra chiusa per le feste', data: dd(today, 35), dataFine: dd(today, 46) },
      { testo: 'La famiglia preferisce essere chiamata la sera', allievaId: '0003' }].forEach(function (n) { db = L.salvaNota(db, null, n, now, today).db; });
    db.impostazioni.ultimaCopia = today;
    return db;
  }

  function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json' } }); }
  var COPIE = { cartella: '', ultima: '', errore: '' }, AGG_ULTIMO = '';
  function AGGST() { return { versione: '@VERSIONE@ (demo)', canale: '', canalePredefinito: true, automatico: true, ultimoControllo: AGG_ULTIMO, controllo: false, errore: '', disponibile: null, rimandata: false, ignorata: false, fase: '', scaricati: 0, totale: 0, installabile: false }; }
  function SIC() { var oggi = ora().slice(0, 10); return { giornaliere: 12, ultima: ora(), ultimaGiorno: oggi, prima: '2026-10-28', recenti: 31, registroRighe: REG.length, registroByte: 0, errore: '', recupero: null }; }
  window.fetch = function (url, opt) {
    var u = String(url), p = u.split('?')[0], m = ((opt && opt.method) || 'GET').toUpperCase(), body = {};
    if (p.indexOf('/api/') !== 0 && p !== '/logout') return real.apply(null, arguments);
    try { body = opt && opt.body ? JSON.parse(opt.body) : {}; } catch (e) {}
    if (!DB) { DB = seed(); SALV = ora(); }
    var out;
    switch (p) {
      case '/api/stato': out = json({ rev: REV, db: DB, salvato: SALV, cartella: 'Demo: i dati restano solo in questa pagina', versione: '@VERSIONE@ (demo)', protetto: false, copie2: COPIE, sicurezza: SIC(), sceltaCartella: false, remoto: false }); break;
      case '/api/salva':
        DB = body.db; REV++; SALV = ora();
        (body.registro || []).slice().reverse().forEach(function (e) { REG.unshift(Object.assign({ quando: SALV }, e)); });
        out = json({ rev: REV, salvato: SALV, avviso: '' }); break;
      case '/api/registro': out = json({ righe: REG.slice(0, parseInt((u.split('limite=')[1] || '500'), 10) || 500) }); break;
      case '/api/vivo': case '/api/chiudi': out = new Response(null, { status: 204 }); break;
      case '/api/copia': out = json({ testo: JSON.stringify({ programma: 'Gym Art Segreteria', rev: REV, db: DB }), protetto: false }); break;
      case '/api/decifra': try { var o = JSON.parse(body.testo); out = json({ db: o.db || o }); } catch (e) { out = json({ errore: 'Il file scelto non è una copia dell\'archivio.' }, 400); } break;
      case '/api/rete': out = m === 'GET' ? json({ stato: { attiva: false, porta: 47816, haPassword: false, inAscolto: false, indirizzi: [], certificato: '', errore: '', sessioni: 0 }, impronta: '', avvioWindows: false, avvioDisponibile: false }) : json({ errore: 'Nella demo l\'accesso dal telefono non si può attivare: serve il programma installato sul computer della segreteria.' }, 400); break;
      case '/api/sicurezza': out = json({ sicurezza: SIC(), copie2: COPIE }); break;
      case '/api/sicurezza/adesso': out = json({ nome: 'demo', sicurezza: SIC(), copie2: COPIE }); break;
      case '/api/sicurezza/controlla': out = json({ locali: { controllate: 12, errori: [] } }); break;
      case '/api/sicurezza/letto': out = json({ ok: true }); break;
      case '/api/giornaliere': out = json({ copie: [1, 2, 3].map(function (i) { var d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); return { nome: d, creato: d + 'T08:00:00', motivo: 'inizio-giornata', allieve: DB.allieve.length, iscrizioni: DB.iscrizioni.length, pagamenti: DB.pagamenti.length, registroRighe: REG.length, byte: 0 }; }) }); break;
      case '/api/giornaliere/archivio': out = json({ errore: 'Nella demo non si può ripristinare.' }, 400); break;
      case '/api/copie2': out = m === 'GET' ? json({ copie2: COPIE }) : json({ errore: 'Nella demo non si può scegliere una cartella.' }, 400); break;
      case '/api/sblocca': out = json({ ok: true }); break;
      case '/api/aggiornamenti': out = json(AGGST()); break;
      case '/api/aggiornamenti/controlla': AGG_ULTIMO = ora(); out = json(AGGST()); break;
      case '/api/aggiornamenti/impostazioni': case '/api/aggiornamenti/scarica': case '/api/aggiornamenti/installa': out = json({ errore: 'Nella demo il programma non si aggiorna: serve il programma sul computer della segreteria.' }, 400); break;
      case '/api/esci-programma': out = json({ errore: 'Nella demo il programma non si chiude davvero: resti su questa pagina.' }, 400); break;
      case '/api/logo': out = json({ errore: 'Nella demo il logo non si cambia.' }, 400); break;
      case '/logout': out = json({ ok: true }); break;
      case '/api/diario': out = m === 'GET' ? json({ righe: [] }) : new Response(null, { status: 204 }); break;
      case '/api/suoni': out = json({ livello: 'spento', inProva: false }); break;
      case '/api/apri-cartella': case '/api/scegli-cartella': case '/api/scansiona': case '/api/controllo': case '/api/assistenza': out = json({ errore: 'Nell\'anteprima questa funzione non c\'è: serve il programma sul computer della segreteria.' }, 400); break;
      default: out = json({ errore: 'Non disponibile nella demo.' }, 501);
    }
    return Promise.resolve(out);
  };
  navigator.sendBeacon = function () { return true; };
})();
