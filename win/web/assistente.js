/* Gym Art Segreteria - l'assistente: legge l'archivio e dice che cosa fare adesso, che cosa controllare e quali messaggi mandare.
   È un assistente "a regole": lavora sul computer, senza internet, e non manda niente a nessuno. Non è un modello linguistico: risponde alle domande che conosce
   (scadenze, certificati, incassi, compleanni, una persona, come si fa una cosa) e, quando non capisce, lo dice e propone che cosa chiedere.
   Gira nella pagina e nei test (Node). Tutti i numeri vengono da Logic: l'assistente non calcola niente da solo, mette in ordine e spiega. */
(function (root) {
  'use strict';
  var L = typeof module !== 'undefined' && module.exports ? require('./logic.js') : root.Logic;
  var C = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.Core;

  var URGENZA = { subito: 1, importante: 2, dafare: 3, quandopuoi: 4 };
  var ETICHETTA_URGENZA = { 1: 'Subito', 2: 'Importante', 3: 'Da fare', 4: 'Quando puoi' };
  var ESEMPI = ['Che cosa devo fare oggi?', 'Chi deve portare il certificato?', 'Quanto devo incassare?', 'Chi viene il lunedì?', 'Incassi di questo mese', 'Chi non ha il codice fiscale?'];
  var GIORNI_PAROLE = [['lunedi', 'Lun'], ['martedi', 'Mar'], ['mercoledi', 'Mer'], ['giovedi', 'Gio'], ['venerdi', 'Ven'], ['sabato', 'Sab']];
  var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  /** One letter wrong, missing or in more (1.27.0: «Rosi Giulia» finds «Rossi Giulia»). */
  function quasiUguali(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }

  function plurale(n, uno, molti) { return n + ' ' + (n === 1 ? uno : molti); }
  function giorniTesto(g) { return g === 0 ? 'oggi' : g === 1 ? 'domani' : g === -1 ? 'ieri' : g < 0 ? (-g) + ' giorni fa' : 'tra ' + g + ' giorni'; }
  function nome(x) { return x && x.allieva ? x.allieva.name : '(allieva mancante)'; }
  function euro(n) { return C.fmtMoney(n); }
  function tel(a) { return C.validPhone(a.tel) ? a.tel : C.validPhone(a.tel2) ? a.tel2 : ''; }

  /* ---------- che cosa fare adesso ---------- */
  /**
   * La lista dei consigli, dal più urgente. opz = { copie2: { cartella, ultima }, aggiornamento: { versione } | null, ora: 0-23 }.
   * Ogni consiglio: { id, urgenza (1-4), etichetta, titolo, perche, azioni: [{ etichetta, vai, avvisa? }], messaggi: [{ chi, tel, testo, tipo, rif }] }.
   * avvisa: 'abbonamento' | 'certificato' = la pagina fa partire "Avvisa uno alla volta" per quel tipo.
   */
  function consigli(db, today, opz) {
    opz = opz || {};
    var out = [], imp = db.impostazioni, sc = L.scadenze(db, today), ce = L.scadenzeCertificati(db, today), inc = L.daIncassare(db), ver = L.daVerificare(db), r = L.riepilogo(db, today);
    var righe = L.elencoPromemoria(db, today, { contatto: 'fare', ora: opz.ora }).righe;
    // i messaggi pronti di un tipo e di uno stato (abbonamento SCADUTO, certificato MANCANTE...): solo di chi ha un telefono valido
    function messaggi(tipo, stato, max) {
      return righe.filter(function (x) { return x.tipo === tipo && x.stato === stato && x.tel; }).slice(0, max || 3).map(function (x) { return { chi: x.allieva.name, tel: x.tel, testo: x.testo, tipo: x.tipo, rif: x.rif }; });
    }
    function nuovo(id, urg, titolo, perche, azioni, msgs) { out.push({ id: id, urgenza: urg, etichetta: ETICHETTA_URGENZA[urg], titolo: titolo, perche: perche, azioni: azioni || [], messaggi: msgs || [] }); }

    if (sc.scadute.length) {
      var vecchio = sc.scadute.slice().sort(function (a, b) { return a.giorni - b.giorni; })[0];
      nuovo('abb-scaduti', URGENZA.subito, plurale(sc.scadute.length, 'abbonamento scaduto', 'abbonamenti scaduti') + ': avvisa i genitori',
        'Il più vecchio è quello di ' + nome(vecchio) + ', scaduto da ' + (-vecchio.giorni) + ' giorni. Chi non rinnova resta fuori dal corso: un messaggio gentile di solito basta.',
        [{ etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'abbonamento' }, { etichetta: 'Apri l\'elenco', vai: 'scadenze/abb-scaduti' }], messaggi('abbonamento', 'SCADUTO'));
    }
    if (ce.scaduti.length) {
      var cv = ce.scaduti[0];
      nuovo('cert-scaduti', URGENZA.subito, plurale(ce.scaduti.length, 'certificato medico scaduto', 'certificati medici scaduti') + ': chiedi quello nuovo',
        'Sono allieve con un\'iscrizione aperta. Il più scaduto è quello di ' + nome(cv) + ' (da ' + (-cv.stato.giorni) + ' giorni).',
        [{ etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }, { etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-scaduti' }], messaggi('certificato', 'SCADUTO'));
    }
    if (ce.mancanti.length) {
      var cm = ce.mancanti[0];
      nuovo('cert-mancanti', URGENZA.subito, plurale(ce.mancanti.length, 'allieva senza certificato, oltre il termine', 'allieve senza certificato, oltre il termine'),
        'Avevano ' + L.giorniAttesaCert(db) + ' giorni per portarlo. La più in ritardo è ' + nome(cm) + (cm.stato.ritardo ? ' (da ' + cm.stato.ritardo + ' giorni)' : '') + '. Ricordalo ai genitori e, quando arriva, registralo.',
        [{ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-mancanti' }, { etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }], messaggi('certificato', 'MANCANTE'));
    }
    var nt = L.elencoNote(db, today).conteggi;
    if (nt.scadute || nt.oggi) {
      var pn = L.noteInArrivo(db, today, 0)[0];
      nuovo('note', nt.scadute ? URGENZA.importante : URGENZA.dafare,
        nt.scadute && nt.oggi ? plurale(nt.scadute, 'nota in ritardo', 'note in ritardo') + ' e ' + plurale(nt.oggi, 'per oggi', 'per oggi') : nt.scadute ? plurale(nt.scadute, 'nota in ritardo', 'note in ritardo') : plurale(nt.oggi, 'nota per oggi', 'note per oggi'),
        'La prima è «' + L.anteprimaNota(pn.nota.testo, 70) + '»' + (pn.stato === 'SCADUTA' ? ' (in ritardo di ' + plurale(pn.giorni, 'giorno', 'giorni') + ')' : '') + '. Quando l\'hai fatta, spunta la casella.', [{ etichetta: 'Apri le note', vai: 'calendario/note' }, { etichetta: 'Apri il calendario', vai: 'calendario' }]);
    }
    if (ver.n) {
      nuovo('bonifici', URGENZA.importante, plurale(ver.n, 'bonifico da confermare', 'bonifici da confermare') + ' (' + euro(ver.totale) + ')',
        'Guarda l\'estratto conto: se i soldi sono arrivati premi «Segna verificato». Il programma non verifica niente da solo.', [{ etichetta: 'Apri i bonifici', vai: 'pagamenti/verifica' }]);
    }
    if (sc.inScadenza.length) {
      var prima = sc.inScadenza[0];
      nuovo('abb-in-scadenza', URGENZA.importante, plurale(sc.inScadenza.length, 'abbonamento scade', 'abbonamenti scadono') + ' nei prossimi ' + imp.preavvisoAbb + ' giorni',
        'Il primo è quello di ' + nome(prima) + ', ' + giorniTesto(prima.giorni) + '. Avvisare per tempo evita i buchi tra un periodo e l\'altro.',
        [{ etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'abbonamento' }, { etichetta: 'Apri l\'elenco', vai: 'scadenze/abb-in-scadenza' }], messaggi('abbonamento', 'IN SCADENZA'));
    }
    var presto = ce.inAttesa.filter(function (x) { return x.stato.giorni <= L.GIORNI_ULTIMO_AVVISO; });
    if (presto.length) {
      nuovo('cert-ultimi-giorni', URGENZA.dafare, plurale(presto.length, 'certificato da ricordare', 'certificati da ricordare') + ': il termine è vicino',
        'Il primo termine è ' + giorniTesto(presto[0].stato.giorni) + ' (' + nome(presto[0]) + '). Un promemoria ai genitori ora evita la corsa dopo.',
        [{ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-attesa' }], messaggi('certificato', 'IN ATTESA'));
    } else if (ce.inAttesa.length) {
      nuovo('cert-attesa', URGENZA.quandopuoi, plurale(ce.inAttesa.length, 'allieva deve ancora portare il certificato', 'allieve devono ancora portare il certificato'),
        'Hanno tempo: il primo termine è il ' + C.isoToIt(ce.inAttesa[0].stato.consegna) + ' (' + nome(ce.inAttesa[0]) + '). Quando lo portano, «Registra certificato».', [{ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-attesa' }]);
    }
    if (ce.inScadenza.length) {
      nuovo('cert-in-scadenza', URGENZA.dafare, plurale(ce.inScadenza.length, 'certificato scade', 'certificati scadono') + ' nei prossimi ' + imp.preavvisoCert + ' giorni',
        'Il primo è quello di ' + nome(ce.inScadenza[0]) + ', ' + giorniTesto(ce.inScadenza[0].stato.giorni) + '.', [{ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-in-scadenza' }, { etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }], messaggi('certificato', 'IN SCADENZA'));
    }
    if (inc.righe.length) {
      var alto = inc.righe.slice().sort(function (a, b) { return b.conto.residuo - a.conto.residuo; })[0];
      nuovo('da-incassare', inc.totale >= 500 ? URGENZA.importante : URGENZA.dafare, euro(inc.totale) + ' ancora da incassare (' + plurale(inc.righe.length, 'iscrizione', 'iscrizioni') + ')',
        'Il residuo più alto è di ' + nome(alto) + ': ' + euro(alto.conto.residuo) + '. Chiedi un saldo o un acconto con un messaggio.', [{ etichetta: 'Apri l\'elenco', vai: 'pagamenti/da-incassare' }]);
    }
    if (r.daCompletare) {
      nuovo('da-completare', URGENZA.dafare, plurale(r.daCompletare, 'iscrizione senza tipo o data di inizio', 'iscrizioni senza tipo o data di inizio'),
        'Senza queste due cose non si può calcolare la scadenza e il programma non può avvisarti in tempo. Le completo io, corso per corso: tu controlli e confermi.', [{ etichetta: 'Completale ora', fai: 'completa' }, { etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
    }
    var senzaTelId = {}, senzaTel = 0; // le persone (non le righe: una persona può avere due scadenze) che andrebbero avvisate e non hanno un telefono valido
    L.elencoPromemoria(db, today, { contatto: 'tutte', conAttesa: true }).righe.forEach(function (x) { if (!x.tel && !senzaTelId[x.allieva.id]) { senzaTelId[x.allieva.id] = 1; senzaTel++; } });
    if (senzaTel) {
      nuovo('senza-telefono', URGENZA.quandopuoi, plurale(senzaTel, 'persona da avvisare non ha un telefono valido', 'persone da avvisare non hanno un telefono valido'),
        'Senza un numero non posso preparare il messaggio per WhatsApp. Aggiungilo nella scheda dell\'allieva.', [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // stagione: a settembre
    var stagioneAttuale = L.stagioneDi(today), mese = +today.slice(5, 7);
    if (stagioneAttuale !== imp.stagione && C.str(imp.stagione) < stagioneAttuale) {
      nuovo('nuova-stagione', URGENZA.importante, 'È iniziata la stagione ' + stagioneAttuale + ': apri la nuova stagione',
        'In «Nuova stagione» per ogni iscrizione scegli rinnova, chiudi o lascia com\'è: il programma fa prima una copia dei dati.', [{ etichetta: 'Apri la nuova stagione', vai: 'stagione' }]);
    } else if (mese === 6 || mese === 7 || (mese === 8 && +today.slice(8, 10) < 15)) {
      nuovo('prepara-stagione', URGENZA.quandopuoi, 'A settembre parte la nuova stagione',
        'Ricontrolla le tariffe in Impostazioni e prepara l\'elenco di chi rinnova: poi, a settembre, basta aprire «Nuova stagione».', [{ etichetta: 'Apri le impostazioni', vai: 'impostazioni/tariffe' }]);
    }
    // i rinnovi dei prossimi mesi, soprattutto dicembre e marzo (i trimestrali di settembre e di dicembre)
    var prev = L.previsioneRinnovi(db, today, 2), MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
    prev.mesi.forEach(function (m, i) {
      var nm = +m.chiave.slice(5, 7), speciale = nm === 12 || nm === 3;
      if (!m.n || (i === 1 && m.n < 3 && !speciale)) return; // the next month is announced when it is big, or one of the two months of the quarterly renewals
      nuovo('rinnovi-' + m.chiave, URGENZA.dafare, 'A ' + MESI[nm - 1] + ' scadono ' + plurale(m.n, 'abbonamento', 'abbonamenti') + ' (' + euro(m.euro) + ')',
        (speciale ? 'È uno dei mesi dei rinnovi trimestrali. ' : '') + 'Prepara gli avvisi a inizio mese; «Rinnova» apre il nuovo periodo con gli stessi dati.', [{ etichetta: 'Vedi i rinnovi', vai: 'analisi' }, { etichetta: 'Apri le scadenze', vai: 'scadenze' }]);
    });
    // copie dei dati
    if (db.allieve.length) {
      var copia = L.promemoriaCopia(db, today, opz.copie2);
      if (opz.copie2 && !opz.copie2.cartella) nuovo('seconda-copia', URGENZA.importante, 'Scegli una seconda cartella per le copie',
        'Le copie dei dati stanno solo su questo computer: se il disco si rompe, si perdono anche loro. Una chiavetta o una cartella sincronizzata (OneDrive) basta.', [{ etichetta: 'Imposta la seconda copia', vai: 'impostazioni/dati' }]);
      else if (copia.serve) nuovo('copia', URGENZA.dafare, copia.giorni === null ? 'Non hai ancora scaricato una copia di sicurezza' : 'L\'ultima copia scaricata è di ' + copia.giorni + ' giorni fa',
        'Scaricane una e conservala fuori dal computer (una chiavetta): è il modo più sicuro di non perdere niente.', [{ etichetta: 'Apri le copie di sicurezza', vai: 'impostazioni/sicurezza' }]);
    }
    // compleanni di oggi: gli auguri sono un bel messaggio
    var comp = L.compleanni(db, today, 0).filter(function (x) { return x.giorni === 0; });
    if (comp.length) {
      nuovo('compleanni', URGENZA.quandopuoi, comp.length === 1 ? 'Oggi compie gli anni ' + comp[0].allieva.name + ' (' + comp[0].eta + ' anni)' : 'Oggi compiono gli anni ' + plurale(comp.length, 'allieva', 'allieve'),
        'Un augurio dalla palestra fa piacere alla famiglia.', [{ etichetta: 'Apri l\'elenco', vai: 'inizio' }],
        comp.filter(function (x) { return tel(x.allieva); }).slice(0, 3).map(function (x) { return { chi: x.allieva.name, tel: tel(x.allieva), testo: 'Buongiorno, tanti auguri a ' + C.titleCase(x.allieva.name.split(' ').slice(1).join(' ') || x.allieva.name) + ' da tutta la ' + (C.str(imp.ente) || 'A.S.D. Gym Art Avezzano') + '!', tipo: 'auguri', rif: x.allieva.id }; }));
    }
    if (opz.aggiornamento && opz.aggiornamento.versione) {
      nuovo('aggiornamento', URGENZA.dafare, 'C\'è una versione nuova del programma: la ' + opz.aggiornamento.versione, 'Leggi le novità e scegli se aggiornare: i dati non si toccano.', [{ etichetta: 'Vedi le novità', vai: 'aggiornamenti' }]);
    }
    out.sort(function (a, b) { return a.urgenza - b.urgenza; });
    if (!out.length) out.push({ id: 'tutto-bene', urgenza: 4, etichetta: 'Tutto in regola', titolo: 'Non c\'è niente di urgente', perche: 'Nessuna scadenza da seguire e niente da incassare. Un buon momento per guardare i grafici o per fare una copia di sicurezza.', azioni: [{ etichetta: 'Apri i grafici', vai: 'analisi' }], messaggi: [] });
    return out;
  }

  /* ---------- il lavoro che l'assistente prepara da solo (1.27.0) ---------- */
  /**
   * What the assistant has already prepared and can do with one click, after the person has looked at it. It never changes the data by itself:
   * each job opens a window with what will change (or the messages one at a time), and what it writes can be taken back.
   * [{ id, titolo, perche, azioni: [{ etichetta, fai? | vai? | avvisa? }] }]
   */
  function lavori(db, today, opz) {
    opz = opz || {};
    var out = [], pc = L.pianoCompleta(db);
    if (pc.totale) out.push({ id: 'completa', titolo: 'Posso completare ' + plurale(pc.totale, 'iscrizione', 'iscrizioni') + ' senza tipo o data di inizio',
      perche: 'Ho diviso per corso (' + pc.gruppi.slice(0, 3).map(function (g) { return (g.corso || 'senza corso') + ' ' + g.n; }).join(', ') + (pc.gruppi.length > 3 ? '…' : '') + ') e per ognuno propongo il tipo e la data di inizio. Riempio solo i campi vuoti; dopo c\'è «Annulla».',
      azioni: [{ etichetta: 'Guarda e completa', fai: 'completa' }] });
    var righe = L.elencoPromemoria(db, today, { contatto: 'fare', ora: opz.ora }).righe.filter(function (x) { return x.tel; });
    var abb = righe.filter(function (x) { return x.tipo === 'abbonamento'; }).length, cer = righe.filter(function (x) { return x.tipo === 'certificato'; }).length;
    if (abb + cer) out.push({ id: 'messaggi', titolo: 'Ho preparato ' + plurale(abb + cer, 'messaggio', 'messaggi') + ' per i genitori',
      perche: [abb ? plurale(abb, 'abbonamento', 'abbonamenti') : '', cer ? plurale(cer, 'certificato', 'certificati') : ''].filter(Boolean).join(' e ') + ' da ricordare. Si aprono uno alla volta su WhatsApp con il testo già scritto (lo puoi cambiare) e segno chi hai avvisato.',
      azioni: [abb ? { etichetta: 'Abbonamenti (' + abb + ')', avvisa: 'abbonamento' } : null, cer ? { etichetta: 'Certificati (' + cer + ')', avvisa: 'certificato' } : null].filter(Boolean) });
    var minori = db.allieve.filter(function (a) { return !a.archiviata && L.mancaGenitore(a, today).length; });
    if (minori.length) out.push({ id: 'minorenni', titolo: plurale(minori.length, 'minorenne è', 'minorenni sono') + ' senza il genitore o il suo telefono',
      perche: 'Per le minorenni serve il numero del genitore o del tutore: ti porto alla prima, e quando l\'hai completata passo alla successiva.',
      azioni: [{ etichetta: 'Completa ' + minori[0].name, vai: 'allieva/' + minori[0].id }, { etichetta: 'Vedi l\'elenco', domanda: 'minorenni senza genitore' }] });
    return out;
  }

  /* ---------- domande ---------- */
  function risposta(titolo, righe, azioni, extra) { return Object.assign({ tipo: 'risposta', titolo: titolo, righe: righe || [], azioni: azioni || [], messaggi: [], suggerimenti: [] }, extra || {}); }
  function elenco(items, max, f) {
    var righe = items.slice(0, max || 8).map(f);
    if (items.length > (max || 8)) righe.push({ t: '… e altre ' + (items.length - (max || 8)) + '.' });
    return righe;
  }

  /** Le persone nominate nella domanda: tutte le parole del loro nome (di almeno 3 lettere) o il cognome da solo. */
  function personeCitate(db, q) {
    var toks = q.split(' ').filter(function (t) { return t.length >= 3; }), out = [];
    db.allieve.forEach(function (a) {
      var nt = C.norm(a.name).split(' ').filter(function (t) { return t.length >= 3; }), hit = nt.filter(function (t) { return toks.indexOf(t) >= 0 || (t.length >= 5 && toks.some(function (w) { return w.length >= 4 && quasiUguali(w, t); })); });
      if (hit.length) out.push({ a: a, punti: hit.length });
    });
    out.sort(function (x, y) { return y.punti - x.punti; });
    return out.length && out[0].punti >= 2 ? out.filter(function (x) { return x.punti === out[0].punti; }) : out;
  }

  function schedaPersona(db, a, today, opz) {
    var righe = [], azioni = [], etaTxt = C.isIso(a.nascita) ? C.ageOn(a.nascita, today) + ' anni' : '';
    righe.push({ t: [etaTxt, a.genitore ? 'genitore ' + a.genitore : '', tel(a) ? 'tel. ' + tel(a) : 'senza telefono valido'].filter(Boolean).join(' · ') });
    var aperte = L.iscrizioniDi(db, a.id).filter(function (e) { return !e.annullata && !e.storica; });
    if (!aperte.length) righe.push({ t: 'Nessuna iscrizione aperta.' });
    aperte.forEach(function (e) {
      var s = L.statoIscrizione(db, e, today);
      righe.push({ t: e.corso + (e.giorni.length ? ' (' + e.giorni.join(', ') + ')' : '') + ' · ' + (e.tipo || 'tipo da definire').toLowerCase() + (s.scadenza ? ' · ' + (s.giorni < 0 ? 'scaduto il ' : 'scade il ') + C.isoToIt(s.scadenza) + ' (' + giorniTesto(s.giorni) + ')' : ''), vai: 'iscrizione/' + e.id });
    });
    var cs = L.statoCertificato(db, a, today);
    righe.push({ t: cs.stato === 'VALIDO' || cs.stato === 'IN SCADENZA' ? 'Certificato ' + (a.certTipo || '').toLowerCase() + ' ' + (cs.stato === 'VALIDO' ? 'valido' : 'in scadenza') + ' fino al ' + C.isoToIt(cs.scadenza)
      : cs.stato === 'SCADUTO' ? 'Certificato scaduto il ' + C.isoToIt(cs.scadenza) : cs.stato === 'IN ATTESA' ? 'Certificato da consegnare entro il ' + C.isoToIt(cs.consegna) + ' (' + giorniTesto(cs.giorni) + ')' : 'Certificato mancante' + (cs.consegna ? ': era da consegnare entro il ' + C.isoToIt(cs.consegna) : ''), vai: 'allieva/' + a.id });
    var cn = L.contoAllieva(db, a.id);
    righe.push({ t: cn.residuo > 0.005 ? 'Da pagare: ' + euro(cn.residuo) + ' su ' + euro(cn.dovuto) : cn.dovuto ? 'Tutto pagato (' + euro(cn.pagato) + ').' : 'Nessun importo da pagare.' });
    azioni.push({ etichetta: 'Apri la scheda', vai: 'allieva/' + a.id });
    if (cs.stato !== 'VALIDO') azioni.push({ etichetta: 'Registra il certificato', vai: 'allieva/' + a.id });
    var messaggi = L.elencoPromemoria(db, today, { contatto: 'tutte', conAttesa: true, ora: opz && opz.ora }).righe.filter(function (x) { return x.allieva.id === a.id && x.tel; })
      .map(function (x) { return { chi: x.allieva.name, tel: x.tel, testo: x.testo, tipo: x.tipo, rif: x.rif }; });
    return risposta(a.name, righe, azioni, { messaggi: messaggi, persona: a.id });
  }

  /**
   * The one line that answers what was asked about a person (1.27.0): what she still has to pay, her certificate, phone, parent, course.
   * corto = without her name (for the lines of two students with the same name). '' if the question is not about one of these.
   */
  function rispostaSu(db, a1, q, today, corto) {
    function ha(re) { return re.test(q); }
    var n = a1.name;
    if (ha(/\b(pag|deve|devono|debit|residu|saldo|quota|soldi|quanto)/)) {
      var cn1 = L.contoAllieva(db, a1.id), r = cn1.residuo > 0.005 ? 'deve ancora ' + euro(cn1.residuo) : cn1.pagato > 0 ? 'ha pagato tutto (' + euro(cn1.pagato) + ')' : 'nessun importo da pagare';
      return corto ? r : n + (cn1.residuo > 0.005 || cn1.pagato > 0 ? ' ' : ': ') + r;
    }
    if (ha(/\bcertific/)) {
      var cs1 = L.statoCertificato(db, a1, today);
      var c = cs1.stato === 'VALIDO' ? 'valido fino al ' + C.isoToIt(cs1.scadenza) : cs1.stato === 'IN SCADENZA' ? 'scade il ' + C.isoToIt(cs1.scadenza) + ' (' + giorniTesto(cs1.giorni) + ')'
        : cs1.stato === 'SCADUTO' ? 'scaduto il ' + C.isoToIt(cs1.scadenza) : cs1.stato === 'IN ATTESA' ? 'da portare entro il ' + C.isoToIt(cs1.consegna) : 'non c\'è';
      return corto ? 'certificato ' + c : 'Il certificato di ' + n + ': ' + c;
    }
    if (ha(/\b(telefon|numero|cellular|chiamar|contatt)/)) {
      var t = tel(a1) ? tel(a1) + (a1.genitore ? ' (' + a1.genitore + ')' : '') : '';
      return corto ? (t ? 'tel. ' + t : 'nessun telefono valido') : t ? 'Telefono di ' + n + ': ' + t : n + ' non ha un telefono valido';
    }
    if (ha(/\b(genitor|mamma|madre|papa|padre|tutor|referent)/)) {
      var g = a1.genitore ? a1.genitore + (tel(a1) ? ', tel. ' + tel(a1) : '') : '';
      return corto ? (g ? 'genitore ' + g : 'genitore non scritto') : g ? 'Genitore di ' + n + ': ' + g : 'Per ' + n + ' il genitore non è scritto';
    }
    if (ha(/\b(corso|corsi|giorni|giorno|orario|ora|quando viene|allenament|frequent)/)) {
      var ap1 = L.iscrizioniDi(db, a1.id).filter(function (e) { return !e.annullata && !e.storica; });
      var k = ap1.map(function (e) { return (e.corso || 'corso da definire') + (e.giorni.length ? ' ' + e.giorni.join(', ') : '') + (e.fascia ? ' ' + e.fascia : ''); }).join(' · ');
      return corto ? (k || 'nessun corso') : k ? n + ': ' + k : n + ' non è iscritta a nessun corso';
    }
    return '';
  }

  /**
   * Risponde a una domanda in italiano. opz = { ora, manuale: [{ t, passi, consiglio }], copie2 }.
   * Restituisce { titolo, righe: [{ t, vai? }], azioni, messaggi, suggerimenti }. Se non capisce lo dice e propone qualche domanda.
   */
  function rispondi(db, domanda, today, opz) {
    opz = opz || {};
    var q = C.norm(domanda);
    if (!q) return risposta('Che cosa vuoi sapere?', [{ t: 'Scrivi una domanda, per esempio: «chi deve portare il certificato?»' }], [], { suggerimenti: ESEMPI });
    function ha(re) { return re.test(q); }
    var pers = personeCitate(db, q);
    var forte = /\b(certific|incass|bonific|verific|rinnov|scadenz|scadut|scade|complean|auguri|corso|copia|copie|backup|quant[eio]|priorita|consigli|oggi|adesso|da fare|soldi|debit|moros|abbonament|dicembre|marzo)/.test(q);
    var vuoleMessaggio = ha(/\b(messagg|scriv|avvis|whatsapp|mandare|manda|inviare|invia)/);
    // una persona (da sola, o con "messaggio per...")
    if (pers.length === 1 && (pers[0].punti >= 2 || !forte)) {
      var s = schedaPersona(db, pers[0].a, today, opz), a1 = pers[0].a;
      if (vuoleMessaggio && !s.messaggi.length) s.righe.unshift({ t: 'Per ' + a1.name + ' non c\'è niente da ricordare adesso: nessun messaggio pronto.' });
      // 1.27.0: the answer to what was asked comes first, the card of the person under it
      var su = rispostaSu(db, a1, q, today);
      if (su) s.titolo = su;
      return s;
    }
    if (pers.length > 1 && pers.length <= 8 && (pers[0].punti >= 2 || !forte)) {
      var omonime = pers[0].punti >= 2 && pers.every(function (x) { return C.norm(x.a.name) === C.norm(pers[0].a.name); });
      return risposta(omonime ? 'Ci sono ' + pers.length + ' allieve che si chiamano ' + pers[0].a.name : 'Ho trovato ' + pers.length + ' persone',
        pers.map(function (x) { var su = rispostaSu(db, x.a, q, today, true), et = C.isIso(x.a.nascita) ? C.ageOn(x.a.nascita, today) + ' anni' : ''; return { t: x.a.name + ' (n. ' + x.a.id + (et ? ', ' + et : '') + ')' + (su ? ': ' + su : ''), vai: 'allieva/' + x.a.id }; }),
        [], { suggerimenti: omonime ? [] : ['Scrivi nome e cognome per vedere una persona sola'] });
    }
    // le note
    if (ha(/\b(note|nota|appunti)\b/)) {
      var en = L.elencoNote(db, today, {}), cn = en.conteggi;
      return risposta(cn.daFare ? plurale(cn.daFare, 'nota da fare', 'note da fare') + (cn.scadute ? ', ' + cn.scadute + ' in ritardo' : '') : 'Non hai note da fare',
        en.righe.slice(0, 6).map(function (x) { return { t: L.anteprimaNota(x.nota.testo, 80) + (x.nota.data ? ' · ' + C.isoToIt(x.nota.data) : '') + (x.stato === 'SCADUTA' ? ' (in ritardo)' : ''), vai: 'calendario/note' }; }),
        [{ etichetta: 'Apri le note', vai: 'calendario/note' }, { etichetta: 'Apri il calendario', vai: 'calendario' }]);
    }
    // 1.27.0: chi viene in un giorno (e in un corso)
    var giorno = GIORNI_PAROLE.filter(function (g) { return q.indexOf(g[0]) >= 0; })[0];
    var corsoQ = (db.liste.corsi || []).filter(function (c) { return c && q.indexOf(C.norm(c)) >= 0; })[0];
    if (giorno && ha(/\b(chi|quant|quali|iscritt|viene|vengono|c e|ce|lezion|allena|elenco)/)) {
      var gi = L.iscritte(db, { giorno: giorno[1], corso: corsoQ || '' }, today);
      return risposta(plurale(gi.length, 'allieva', 'allieve') + ' ' + (gi.length === 1 ? 'viene' : 'vengono') + ' il ' + giorno[0].replace(/i$/, 'ì') + (corsoQ ? ' al corso ' + corsoQ : ''),
        elenco(gi, 20, function (x) { return { t: x.allieva.name + ' · ' + (x.iscrizione.corso || 'corso da definire') + (x.iscrizione.fascia ? ' · ' + x.iscrizione.fascia : ''), vai: 'allieva/' + x.allieva.id }; }),
        corsoQ ? [{ etichetta: 'Apri il corso', vai: 'corsi/' + encodeURIComponent(corsoQ) }] : [{ etichetta: 'Apri i corsi', vai: 'corsi' }]);
    }
    // 1.27.0: chi non ha un dato (codice fiscale, telefono, privacy, data di nascita, genitore)
    var DATI = [[/\b(codice fiscale|codici fiscali|cf)\b/, 'il codice fiscale', function (a) { return !a.cf; }],
      [/\b(genitor|tutor)/, 'il genitore o il suo telefono (minorenni)', function (a) { return L.mancaGenitore(a, today).length > 0; }],
      [/\b(telefon|numero|cellular)/, 'un telefono valido', function (a) { return !tel(a); }],
      [/\b(privacy|consens)/, 'il consenso privacy', function (a) { return !a.privacy; }],
      [/\b(data di nascita|nascita|nata|eta)\b/, 'la data di nascita', function (a) { return !C.isIso(a.nascita); }],
      [/\b(email|mail)\b/, 'l\'email', function (a) { return !a.email; }]];
    if (ha(/\b(senza|non ha|non hanno|manca|mancano|mancante|mancanti|vuot)/) && !ha(/\bcertific/)) {
      var dato = DATI.filter(function (d) { return d[0].test(q); })[0];
      if (dato) {
        var chi = db.allieve.filter(function (a) { return !a.archiviata && dato[2](a); });
        return risposta(chi.length ? plurale(chi.length, 'allieva', 'allieve') + ' senza ' + dato[1] : 'Tutte le allieve hanno ' + dato[1],
          elenco(chi, 15, function (a) { return { t: a.name, vai: 'allieva/' + a.id }; }), [{ etichetta: 'Dati da completare', vai: 'analisi' }]);
      }
    }
    // 1.27.0: incassi di un periodo (oggi, questa settimana, questo mese, il mese scorso, un mese per nome)
    var mesePar = MESI.filter(function (m) { return q.indexOf(m) >= 0; })[0];
    if (ha(/\b(incass|incasso|entrate|pagament|pagato|pagati|preso|presi|soldi)/) && (mesePar || ha(/\b(oggi|ieri|settimana|questo mese|mese scorso|mese passato)\b/))) {
      var da = '', a2 = today, nomeP = '';
      if (ha(/\boggi\b/)) { da = today; nomeP = 'oggi'; }
      else if (ha(/\bieri\b/)) { da = a2 = L.piuGiorni(today, -1); nomeP = 'ieri'; }
      else if (ha(/\bsettimana\b/)) { da = L.piuGiorni(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7)); nomeP = 'questa settimana'; }
      else if (ha(/\b(mese scorso|mese passato)\b/)) { var pm = C.addMonths(today.slice(0, 7) + '-01', -1); da = pm; a2 = L.piuGiorni(today.slice(0, 7) + '-01', -1); nomeP = 'a ' + MESI[+pm.slice(5, 7) - 1]; }
      else if (mesePar) { var mi = MESI.indexOf(mesePar) + 1, anno = +today.slice(0, 4); if (mi > +today.slice(5, 7)) anno--; da = anno + '-' + (mi < 10 ? '0' : '') + mi + '-01'; a2 = L.piuGiorni(C.addMonths(da, 1), -1); nomeP = 'a ' + mesePar + ' ' + anno; }
      else { da = today.slice(0, 7) + '-01'; nomeP = 'questo mese'; }
      var pg = db.pagamenti.filter(function (p) { return p.data >= da && p.data <= a2; }), tot = 0, perMetodo = {};
      pg.forEach(function (p) { tot += p.importo; perMetodo[p.metodo] = (perMetodo[p.metodo] || 0) + p.importo; });
      var ix = L.indice(db);
      return risposta('Incassati ' + nomeP + ': ' + euro(Math.round(tot * 100) / 100) + ' (' + plurale(pg.length, 'pagamento', 'pagamenti') + ')',
        Object.keys(perMetodo).map(function (m) { return { t: m + ': ' + euro(Math.round(perMetodo[m] * 100) / 100) }; }).concat(elenco(pg.slice().sort(function (x, y) { return x.data < y.data ? 1 : -1; }), 8, function (p) { var e = ix.perId[p.iscrizioneId], al = e ? ix.allieve[e.allievaId] : null; return { t: C.isoToIt(p.data) + ' · ' + (al ? al.name : '?') + ' · ' + euro(p.importo) + ' · ' + p.metodo }; })),
        [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // che cosa fare
    if (ha(/\b(cosa|che cosa|che)\b.*\b(fare|faccio|devo|controllare)\b/) || ha(/\b(priorita|consigli|consigliami|oggi|adesso|da fare|urgent)/)) {
      var cons = consigli(db, today, opz);
      return risposta('Consigli per oggi', cons.slice(0, 5).map(function (c) { return { t: c.etichetta + ': ' + c.titolo, vai: (c.azioni[0] || {}).vai }; }), [{ etichetta: 'Apri l\'assistente', vai: 'assistente' }]);
    }
    // certificati
    if (ha(/\bcertific/) || ha(/\b(portare|portano|consegnare|consegnano)\b/)) {
      var ce = L.scadenzeCertificati(db, today), righe = [], azioni = [];
      var tutti = ha(/\bagonist|non agonist|ludic/);
      if (ha(/\b(attesa|portare|portano|consegn)/) || ha(/\bdeve portare/)) {
        righe = elenco(ce.inAttesa, 10, function (x) { return { t: nome(x) + ' · entro il ' + C.isoToIt(x.stato.consegna) + ' (' + giorniTesto(x.stato.giorni) + ')', vai: 'allieva/' + x.allieva.id }; });
        azioni.push({ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-attesa' });
        return risposta(ce.inAttesa.length ? plurale(ce.inAttesa.length, 'allieva deve ancora portare il certificato', 'allieve devono ancora portare il certificato') : 'Nessuno deve portare il certificato adesso', righe, azioni);
      }
      if (ha(/\b(mancant|manca|mancano|senza)/)) {
        righe = elenco(ce.mancanti, 10, function (x) { return { t: nome(x) + (x.stato.ritardo ? ' · in ritardo di ' + plurale(x.stato.ritardo, 'giorno', 'giorni') : ''), vai: 'allieva/' + x.allieva.id }; });
        return risposta(ce.mancanti.length ? plurale(ce.mancanti.length, 'allieva senza certificato (oltre il termine)', 'allieve senza certificato (oltre il termine)') : 'Nessun certificato mancante oltre il termine', righe, [{ etichetta: 'Apri l\'elenco', vai: 'scadenze/cert-mancanti' }]);
      }
      if (ha(/\b(scadut|scadenza|scade|scadono|rinnov)/) || !tutti) {
        var rin = ce.scaduti.concat(ce.inScadenza);
        righe = elenco(rin, 10, function (x) { return { t: nome(x) + ' · ' + (x.stato.giorni < 0 ? 'scaduto ' : 'scade ') + giorniTesto(x.stato.giorni), vai: 'allieva/' + x.allieva.id }; });
        var riep = [plurale(ce.scaduti.length, 'scaduto', 'scaduti'), plurale(ce.inScadenza.length, 'in scadenza', 'in scadenza'), plurale(ce.inAttesa.length, 'in attesa', 'in attesa'), plurale(ce.mancanti.length, 'mancante', 'mancanti')].join(' · ');
        return risposta('Certificati: ' + riep, righe, [{ etichetta: 'Apri i certificati', vai: 'certificati' }, { etichetta: 'Scadenze dei certificati', vai: 'scadenze/cert-scaduti' }]);
      }
      var cz = L.elencoCertificati(db, today, {}).conteggi;
      return risposta('Certificati delle iscritte', [{ t: cz.agonistico + ' agonistici · ' + cz.nonAgonistico + ' non agonistici · ' + cz.ludico + ' ludico-motoria' }, { t: cz.daRinnovare + ' da rinnovare · ' + cz.inAttesa + ' in attesa · ' + cz.mancanti + ' mancanti' }], [{ etichetta: 'Apri i certificati', vai: 'certificati' }]);
    }
    // incassi e soldi
    if (ha(/\b(da incassare|debit|devono pagare|deve pagare|devo incassare|quanto devo incassare|residu|moros|non hanno pagato|non pagat)/)) {
      var inc = L.daIncassare(db), top = inc.righe.slice().sort(function (a, b) { return b.conto.residuo - a.conto.residuo; });
      return risposta(inc.righe.length ? euro(inc.totale) + ' da incassare (' + plurale(inc.righe.length, 'iscrizione', 'iscrizioni') + ')' : 'Non c\'è niente da incassare',
        elenco(top, 8, function (x) { return { t: nome(x) + ' · ' + euro(x.conto.residuo), vai: 'iscrizione/' + x.iscrizione.id }; }), [{ etichetta: 'Apri l\'elenco', vai: 'pagamenti/da-incassare' }]);
    }
    if (ha(/\b(bonific|verific)/)) {
      var v = L.daVerificare(db);
      return risposta(v.n ? plurale(v.n, 'bonifico da verificare', 'bonifici da verificare') + ' (' + euro(v.totale) + ')' : 'Nessun bonifico da verificare',
        elenco(v.righe, 8, function (x) { return { t: (x.allieva ? x.allieva.name : '?') + ' · ' + euro(x.pagamento.importo) + ' · ' + C.isoToIt(x.pagamento.data), vai: 'pagamenti/verifica' }; }), [{ etichetta: 'Apri i bonifici', vai: 'pagamenti/verifica' }]);
    }
    if (ha(/\b(incass|incasso|soldi|entrate|guadagn|quanto abbiamo|fatturat)/)) {
      var an = L.analisi(db, today, 'stagione'), mese = an.incassiMese[an.incassiMese.length - 1], inc2 = L.daIncassare(db);
      return risposta('Incassi', [{ t: 'Questo mese: ' + euro(mese ? mese.euro : 0) }, { t: 'Nella stagione: ' + euro(an.incassiTot) + ' (' + plurale(an.incassiN, 'pagamento', 'pagamenti') + ')' }, { t: 'Ancora da incassare: ' + euro(inc2.totale) }],
        [{ etichetta: 'Apri i grafici', vai: 'analisi' }, { etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // rinnovi, scadenze degli abbonamenti, previsione
    if (ha(/\b(rinnov|scadenz|scadut|scade|scadono|abbonament|dicembre|marzo|prossimi mesi|previsione)/)) {
      var sc = L.scadenze(db, today), tutto = sc.scadute.concat(sc.inScadenza);
      var prev = L.previsioneRinnovi(db, today, 4);
      var righe2 = elenco(tutto, 10, function (x) { return { t: nome(x) + ' · ' + x.iscrizione.corso + ' · ' + (x.giorni < 0 ? 'scaduto ' : 'scade ') + giorniTesto(x.giorni), vai: 'iscrizione/' + x.iscrizione.id }; });
      prev.mesi.forEach(function (m) { if (m.n) righe2.push({ t: 'Rinnovi in ' + m.l + ': ' + m.n + ' (' + euro(m.euro) + ')', vai: 'analisi' }); });
      return risposta(tutto.length ? plurale(sc.scadute.length, 'abbonamento scaduto', 'abbonamenti scaduti') + ' · ' + plurale(sc.inScadenza.length, 'in scadenza', 'in scadenza') : 'Nessun abbonamento scaduto o in scadenza', righe2,
        [{ etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'abbonamento' }, { etichetta: 'Apri le scadenze', vai: 'scadenze' }], { messaggi: L.elencoPromemoria(db, today, { tipo: 'abbonamento', contatto: 'fare', ora: opz.ora }).righe.filter(function (x) { return x.tel; }).slice(0, 3).map(function (x) { return { chi: x.allieva.name, tel: x.tel, testo: x.testo, tipo: x.tipo, rif: x.rif }; }) });
    }
    // compleanni
    if (ha(/\b(complean|anni|auguri)/) && !ha(/\bquant[ei] anni\b/)) {
      var cp = L.compleanni(db, today, 14);
      return risposta(cp.length ? 'Compleanni nei prossimi 14 giorni' : 'Nessun compleanno nei prossimi 14 giorni', cp.map(function (x) { return { t: x.allieva.name + ' · ' + (x.giorni === 0 ? 'oggi' : 'tra ' + x.giorni + ' giorni') + ' · ' + x.eta + ' anni', vai: 'allieva/' + x.allieva.id }; }));
    }
    // corsi
    var corso = (db.liste.corsi || []).filter(function (c) { return c && q.indexOf(C.norm(c)) >= 0; })[0];
    if (corso && ha(/\b(corso|chi|frequent|iscritt|elenco)/)) {
      var is = L.iscritte(db, { corso: corso }, today);
      return risposta('Corso ' + corso + ': ' + plurale(is.length, 'iscritta', 'iscritte'), elenco(is, 15, function (x) { return { t: x.allieva.name + (x.iscrizione.giorni.length ? ' · ' + x.iscrizione.giorni.join(', ') : ''), vai: 'allieva/' + x.allieva.id }; }), [{ etichetta: 'Apri il corso', vai: 'corsi/' + encodeURIComponent(corso) }]);
    }
    if (ha(/\b(quant[eio]|numero)\b.*\b(allieve|iscritt|person|bambin|ragazz|atlet|bimb)/) || ha(/\bquante (sono|siamo)\b/)) {
      var r = L.riepilogo(db, today), corsi = L.corsiRiepilogo(db).filter(function (x) { return x.iscritte > 0; });
      return risposta(plurale(r.allieve, 'allieva', 'allieve') + ', ' + plurale(r.correnti, 'iscrizione aperta', 'iscrizioni aperte'), corsi.map(function (x) { return { t: x.corso + ': ' + x.iscritte, vai: 'corsi/' + encodeURIComponent(x.corso) }; }), [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // il programma non funziona: il file per l'assistenza e il diario tecnico (non "ho sbagliato un dato": per quello c'è il manuale)
    if (ha(/\b(assistenza|diario tecnico|guasto|non funziona|non parte|non si apre|si blocca|si e bloccat|va in errore|mi da errore|da errore|messaggio di errore|errore del programma|bug\b|controlla il computer|controllo del computer|scanner non|non scansiona|non si sente|non sento)/)) {
      return risposta('Se il programma non funziona', [{ t: '1. Apri Altro, Impostazioni, «Assistenza» e premi «Controlla questo computer»: prova orologio, spazio, copie, scanner, suoni e aggiornamenti e dice che cosa fare.' },
        { t: '2. Se non basta, premi «Crea il file per l\'assistenza»: è un file di testo con informazioni tecniche e numeri, senza nomi, telefoni o importi.' },
        { t: '3. Premi «Scarica il file» e mandalo a chi cura il programma, con due righe su che cosa stavi facendo.' }, { t: 'Il programma annota da solo gli errori nel diario tecnico, nella stessa sezione.' }],
        [{ etichetta: 'Apri Assistenza', vai: 'impostazioni/assistenza' }]);
    }
    if (ha(/\b(copia|copie|backup|sicurezz|salvat)/)) {
      var cop = L.promemoriaCopia(db, today, opz.copie2);
      return risposta('Copie di sicurezza', [{ t: cop.giorni === null ? 'Non hai ancora scaricato una copia.' : 'L\'ultima copia scaricata è di ' + cop.giorni + ' giorni fa.' }, { t: opz.copie2 && opz.copie2.cartella ? 'Seconda copia attiva: ' + opz.copie2.cartella : 'La seconda copia non è impostata: le copie stanno solo su questo computer.' },
        { t: 'Il programma fa da solo una copia al giorno.' }], [{ etichetta: 'Apri le copie di sicurezza', vai: 'impostazioni/sicurezza' }]);
    }
    // come si fa una cosa: si cerca nel manuale
    if (opz.manuale && opz.manuale.length) {
      // whole words of at least five letters, compared by their beginning ("registro" finds "registrare"): a short or common word must not find a page by chance
      var parole = q.split(' ').filter(function (w) { return w.length >= 5 && !/^(faccio|posso|fanno|quando|perche|della|delle|degli|nelle|nella|sulla|dalla|dello|questo|questa|vorrei|voglio|quale|quali|quanto|quanti|quante|molto|tutto|tutti|tutte|sempre|ancora|anche|senza|oggi)$/.test(w); });
      var migliore = null, punteggio = 0;
      opz.manuale.forEach(function (x) {
        var tit = C.norm(x.t).split(' '), txt = C.norm(x.passi.join(' ') + ' ' + (x.consiglio || '')).split(' '), p = 0;
        parole.forEach(function (w) {
          var radice = w.slice(0, Math.max(5, w.length - 2)), inizia = function (t) { return t.indexOf(radice) === 0; };
          if (tit.some(inizia)) p += 3; else if (txt.some(inizia)) p += 1;
        });
        if (p > punteggio) { punteggio = p; migliore = x; }
      });
      if (migliore && punteggio >= 3) {
        return risposta(migliore.t, migliore.passi.map(function (t, i) { return { t: (i + 1) + '. ' + t }; }).concat(migliore.consiglio ? [{ t: 'Consiglio: ' + migliore.consiglio }] : []), [{ etichetta: 'Apri il manuale', vai: 'guida' }]);
      }
    }
    return risposta('Non ho capito la domanda', [{ t: 'Conosco scadenze, certificati, incassi (anche di un mese o di oggi), chi viene in un giorno, chi non ha un dato, compleanni, i corsi e le singole persone (quanto devono pagare, il certificato, il telefono, il genitore), e le istruzioni del manuale.' }, { t: 'Prova con una di queste domande, oppure scrivi il nome di una persona.' }],
      [{ etichetta: 'Apri il manuale', vai: 'guida' }], { tipo: 'non-capito', suggerimenti: ESEMPI });
  }

  var Assistente = { consigli: consigli, lavori: lavori, rispondi: rispondi, ESEMPI: ESEMPI, URGENZA: URGENZA, ETICHETTA_URGENZA: ETICHETTA_URGENZA };
  if (typeof module !== 'undefined' && module.exports) module.exports = Assistente; else root.Assistente = Assistente;
})(typeof window !== 'undefined' ? window : this);
