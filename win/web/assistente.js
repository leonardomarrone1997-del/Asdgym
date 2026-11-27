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
  var ESEMPI = ['Che cosa devo fare oggi?', 'Chi deve ancora pagare?', 'Chi deve portare il certificato?', 'Chi non è in regola?', 'Incassi di questo mese', 'Chi devo avvisare?'];
  var GIORNI_PAROLE = [['lunedi', 'Lun'], ['martedi', 'Mar'], ['mercoledi', 'Mer'], ['giovedi', 'Gio'], ['venerdi', 'Ven'], ['sabato', 'Sab']];
  var PAROLE_DOMANDA = /^(giorn|corsi|corso|quant|quand|certif|pagam|pagat|pagar|deve|devon|telef|numer|genit|mamma|papa|tutor|scad|rinnov|incass|soldi|iscri|allie|mancan|senza|chiam|messag|avvis|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|oggi|ieri|domani|settiman|mese|mesi|anno|anni|tutte|tutti|quali|quale|elenco|nome|nomi|codice|fiscal|privacy|consens|nascit|email|orari|frequen|allena|lezion)/;
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
        [{ etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }, { etichetta: 'Apri l\'elenco', vai: 'certificati/da-rinnovare' }], messaggi('certificato', 'SCADUTO'));
    }
    if (ce.mancanti.length) {
      var cm = ce.mancanti[0];
      nuovo('cert-mancanti', URGENZA.subito, plurale(ce.mancanti.length, 'allieva senza certificato', 'allieve senza certificato'),
        'Avevano ' + L.giorniAttesaCert(db) + ' giorni per portarlo. La più in ritardo è ' + nome(cm) + (cm.stato.ritardo ? ' (da ' + cm.stato.ritardo + ' giorni)' : '') + '. Ricordalo ai genitori e, quando arriva, registralo.',
        [{ etichetta: 'Apri l\'elenco', vai: 'certificati/mancanti' }, { etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }], messaggi('certificato', 'MANCANTE'));
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
        [{ etichetta: 'Apri l\'elenco', vai: 'certificati/in-attesa' }], messaggi('certificato', 'IN ATTESA'));
    } else if (ce.inAttesa.length) {
      nuovo('cert-attesa', URGENZA.quandopuoi, plurale(ce.inAttesa.length, 'allieva deve ancora portare il certificato', 'allieve devono ancora portare il certificato'),
        'Hanno tempo: il primo termine è il ' + C.isoToIt(ce.inAttesa[0].stato.consegna) + ' (' + nome(ce.inAttesa[0]) + '). Quando lo portano, «Registra certificato».', [{ etichetta: 'Apri l\'elenco', vai: 'certificati/in-attesa' }]);
    }
    if (ce.inScadenza.length) {
      nuovo('cert-in-scadenza', URGENZA.dafare, plurale(ce.inScadenza.length, 'certificato scade', 'certificati scadono') + ' nei prossimi ' + imp.preavvisoCert + ' giorni',
        'Il primo è quello di ' + nome(ce.inScadenza[0]) + ', ' + giorniTesto(ce.inScadenza[0].stato.giorni) + '.', [{ etichetta: 'Apri l\'elenco', vai: 'certificati/da-rinnovare' }, { etichetta: 'Avvisa uno alla volta', vai: 'promemoria', avvisa: 'certificato' }], messaggi('certificato', 'IN SCADENZA'));
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
    var dc = L.dateDaControllare(db, today); // 1.29.0: nel foglio vero un pagamento del 2028 e alcuni con giorno e mese scambiati
    if (dc.n) {
      var p0 = dc.righe[0], conP = dc.righe.filter(function (x) { return x.proposta; }).length;
      nuovo('date-pagamenti', URGENZA.importante, plurale(dc.n, 'pagamento ha una data da controllare', 'pagamenti hanno una data da controllare'),
        'Per esempio ' + nome(p0) + ': ' + euro(p0.pagamento.importo) + ' il ' + C.isoToIt(p0.pagamento.data) + (p0.motivo === 'futuro' ? ', nel futuro' : ', mesi prima della stagione') + '. Incassi e ricevute la usano così com\'è. ' +
        (conP ? (conP === dc.n ? 'Propongo io la data giusta' : 'Per ' + conP + ' propongo io la data giusta') + ': tu controlli e confermi.' : 'Scrivi tu la data giusta.'), [{ etichetta: 'Controlla le date', fai: 'date' }]);
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
    var dc = L.dateDaControllare(db, today), conP = dc.righe.filter(function (x) { return x.proposta; });
    if (conP.length) out.push({ id: 'date', titolo: 'Posso correggere ' + plurale(conP.length, 'data di un pagamento', 'date di pagamenti'),
      perche: conP.slice(0, 2).map(function (x) { return C.isoToIt(x.pagamento.data) + ' → ' + C.isoToIt(x.proposta) + ' (' + x.perche + ')'; }).join('; ') + (conP.length > 2 ? '…' : '') + '. Correggo solo quelle che lasci spuntate, la ricevuta tiene il suo numero, e dopo c\'è «Annulla».',
      azioni: [{ etichetta: 'Guarda e correggi', fai: 'date' }] });
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

  /**
   * The period named in a question about what falls due (1.30.0): oggi, domani, questa / la prossima settimana, questo / il prossimo mese,
   * a month by name (the next one with that name). { da, a, nome } or null.
   */
  function periodoCitato(q, today) {
    var lun = L.piuGiorni(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7)), fineMese = function (d) { return L.piuGiorni(C.addMonths(d.slice(0, 7) + '-01', 1), -1); };
    if (/\b(questo mese|entro fine mese|fine mese|fine del mese)\b/.test(q)) return /\bscadut/.test(q) ? { da: today.slice(0, 7) + '-01', a: fineMese(today), nome: 'questo mese' } : { da: today, a: fineMese(today), nome: 'entro fine mese' };
    if (/\boggi\b/.test(q)) return { da: today, a: today, nome: 'oggi' };
    if (/\bdomani\b/.test(q)) { var dm = L.piuGiorni(today, 1); return { da: dm, a: dm, nome: 'domani' }; }
    if (/\b(prossima settimana|settimana prossima)\b/.test(q)) return { da: L.piuGiorni(lun, 7), a: L.piuGiorni(lun, 13), nome: 'la prossima settimana' };
    if (/\bsettimana\b/.test(q)) return { da: today, a: L.piuGiorni(lun, 6), nome: 'questa settimana' };
    if (/\b(prossimo mese|mese prossimo)\b/.test(q)) { var pm = C.addMonths(today.slice(0, 7) + '-01', 1); return { da: pm, a: fineMese(pm), nome: 'il mese prossimo' }; }
    var m = meseCitato(q, today, true);
    return m ? { da: m.da, a: fineMese(m.da), nome: 'a ' + m.nome + ' ' + m.anno } : null;
  }

  var inRegola = function (db, a, today) { return L.inRegola(db, a, today); }; // 1.30.0: in logic.js (the students page filters on it too)

  /** The payment method named in the question (1.29.0): one of the methods of the archive, «bonifici» for «Bonifico», «carta» or «bancomat» for the POS. '' if none. */
  function metodoCitato(db, q) {
    var metodi = (db.liste && db.liste.metodi) || [];
    var m = metodi.filter(function (x) {
      var n = C.norm(x); if (!n) return false;
      var e = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('\\b' + e + '\\b').test(q) || (n.length >= 6 && new RegExp('\\b' + e.slice(0, -1) + '\\w?\\b').test(q));
    })[0];
    if (m) return m;
    return /\b(carta|bancomat)\b/.test(q) ? metodi.filter(function (x) { return /^pos$/i.test(x); })[0] || '' : '';
  }
  /** Topics that «a posto» or «in ordine» may be about, other than a student (1.30.0): «le copie sono a posto?», «in ordine alfabetico». */
  var ALTRO_ARGOMENTO = /\b(copi\w*|backup|archivi\w*|dati|programma|computer|alfabetic\w*|bonific\w*|stampant\w*|scanner|aggiornament\w*|finestr\w*)\b/;
  /** Words of a question about many people or about a total, not about one person: «chi», «quali», «tutte», «certificati mancanti»… («quanti anni ha» is about her). */
  var ELENCO = /\b(chi|quali|quante|tutte|tutti|elenco|certificati|mancanti|scaduti|scadute|iscritte)\b|\bquanti\b(?! anni)/;
  /** A question that goes on from the one before (1.29.0): not a list or a total, and short, or starting with «e», «ha», «quando»…, or speaking of «lei», «suo», «sua». */
  function seguito(db, q) {
    if (ELENCO.test(q) || /\b(incass\w*|entrate|settimana|stagione|palestra|oggi|ieri|domani|rinnovi|abbonamenti|scadenze|pagamenti|iscrizioni|allieve|compleanni|corsi|bonifici|messaggi|avvisi|note|famiglie|sorelle|minorenni|maggiorenni|costa|costano|costo|costi|prezz\w*|tariff\w*|listino|cassa|media|medie|totale)\b/.test(q)) return false;
    if (MESI.some(function (m) { return q.indexOf(m) >= 0; })) return false; // «rinnovo di dicembre» is about the month
    // a course or a payment method named: «quanto costa il corso Base?», «e in contanti?» are not about her
    if (((db.liste && db.liste.corsi) || []).some(function (c) { var n = C.norm(c); return n && new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(q); }) || metodoCitato(db, q)) return false;
    return /^(e|ed|ma|lei|ha|deve|quando|quanto|quanti|che|qual|quale|a che|dove|il suo|la sua|i suoi|le sue)\b/.test(q) || /\b(lei|suo|sua|suoi|sue|questa allieva|la stessa)\b/.test(q) || q.split(' ').length <= 3;
  }

  /** Le persone nominate nella domanda: tutte le parole del loro nome (di almeno 3 lettere) o il cognome da solo. */
  function personeCitate(db, q) {
    var toks = q.split(' ').filter(function (t) { return t.length >= 3; }), out = [];
    function cerca(simile) {
      db.allieve.forEach(function (a) {
        var nt = C.norm(a.name).split(' ').filter(function (t) { return t.length >= 3; }), hit = nt.filter(function (t) { return toks.indexOf(t) >= 0 || (simile && t.length >= 5 && toks.some(function (w) { return w.length >= 4 && !PAROLE_DOMANDA.test(w) && quasiUguali(w, t); })); });
        if (hit.length) out.push({ a: a, punti: hit.length });
      });
    }
    cerca(false);
    // a letter wrong in a name (1.27.0) only when no name is written right, and never on the words of the questions («giorni», «corsi», «quanto»…)
    if (!out.length) cerca(true);
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
      : cs.stato === 'SCADUTO' ? 'Certificato scaduto il ' + C.isoToIt(cs.scadenza) : cs.stato === 'IN ATTESA' ? 'Certificato da consegnare entro il ' + C.isoToIt(cs.consegna) + ' (' + giorniTesto(cs.giorni) + ')' : 'Certificato mancante', vai: 'allieva/' + a.id });
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
    // 1.30.0: «è in regola?», «è tutto a posto?»
    if (ha(/\b(in regola|regolare)\b/) || (ha(/\b(a posto|in ordine|tutto ok|e ok)\b/) && !ALTRO_ARGOMENTO.test(q))) {
      var rg = inRegola(db, a1, today);
      var tr = rg.ok ? (rg.aperte ? 'è in regola' : 'non ha iscrizioni aperte (niente da controllare)') : 'non è in regola: ' + rg.problemi.join(', ');
      return corto ? tr : n + ' ' + tr;
    }
    // 1.29.0: «quando ha pagato?», «l'ultimo pagamento di…»: the last payment, with what is still to pay
    if (ha(/\b(pag|versat|versament|ricevut)/) && ha(/\b(quando|ultim[oiae]|data|che giorno)\b/)) {
      var pg1 = [];
      L.iscrizioniDi(db, a1.id).forEach(function (e) { if (!e.annullata) pg1 = pg1.concat(L.pagamentiDi(db, e.id).filter(function (p) { return p.data <= today; })); });
      pg1.sort(function (x, y) { return x.data < y.data ? 1 : x.data > y.data ? -1 : 0; });
      var res1 = L.contoAllieva(db, a1.id).residuo, dopo1 = res1 > 0.005 ? ', deve ancora ' + euro(res1) : '';
      var u1 = pg1.length ? 'ultimo pagamento il ' + C.isoToIt(pg1[0].data) + ': ' + euro(pg1[0].importo) + (pg1[0].metodo ? ' (' + C.str(pg1[0].metodo).toLowerCase() + ')' : '') + dopo1 : 'nessun pagamento registrato' + dopo1;
      return corto ? u1 : n + ': ' + u1;
    }
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
    // 1.29.0: her subscription (type, course, when it ends)
    if (ha(/\b(abbonament|scade|scadenza|scaduto|rinnov|finisce|termina)/)) {
      var ab1 = L.iscrizioniDi(db, a1.id).filter(function (e) { return !e.annullata && !e.storica; }).map(function (e) {
        var s1 = L.statoIscrizione(db, e, today);
        return (e.corso || 'corso da definire') + ', ' + (e.tipo ? e.tipo.toLowerCase() : 'tipo da definire') + (s1.scadenza ? (s1.giorni < 0 ? ', scaduto il ' : ', scade il ') + C.isoToIt(s1.scadenza) + ' (' + giorniTesto(s1.giorni) + ')' : ': senza data di fine (manca il tipo o la data di inizio)');
      }).join(' · ');
      return corto ? (ab1 || 'nessun abbonamento aperto') : ab1 ? 'L\'abbonamento di ' + n + ': ' + ab1 : n + ' non ha abbonamenti aperti';
    }
    if (ha(/\b(telefon|numero|cellular|chiamar|contatt)/)) {
      var t = tel(a1) ? tel(a1) + (a1.genitore ? ' (' + a1.genitore + ')' : '') : '';
      return corto ? (t ? 'tel. ' + t : 'nessun telefono valido') : t ? 'Telefono di ' + n + ': ' + t : n + ' non ha un telefono valido';
    }
    if (ha(/\b(genitor|mamma|madre|papa|padre|tutor|referent)/)) {
      var g = a1.genitore ? a1.genitore + (tel(a1) ? ', tel. ' + tel(a1) : '') : '';
      return corto ? (g ? 'genitore ' + g : 'genitore non scritto') : g ? 'Genitore di ' + n + ': ' + g : 'Per ' + n + ' il genitore non è scritto';
    }
    // 1.29.0: her age and birthday
    if (ha(/\b(anni|eta|nata|nascita|compleann|compie)\b/) || ha(/\bcompleann/)) {
      if (!C.isIso(a1.nascita)) return corto ? 'data di nascita non scritta' : 'Per ' + n + ' la data di nascita non è scritta';
      var et1 = C.ageOn(a1.nascita, today), gm1 = (+a1.nascita.slice(8)) + ' ' + MESI[+a1.nascita.slice(5, 7) - 1];
      var e1 = et1 + ' anni, nata il ' + C.isoToIt(a1.nascita) + (ha(/\bcompleann|\bcompie/) ? ' (compleanno il ' + gm1 + ')' : '');
      return corto ? e1 : n + ' ha ' + e1;
    }
    if (ha(/\b(corso|corsi|giorni|giorno|orario|ora|quando viene|allenament|frequent|iscritta)\b/) || ha(/\b(allenament|frequent)/)) {
      var ap1 = L.iscrizioniDi(db, a1.id).filter(function (e) { return !e.annullata && !e.storica; });
      var k = ap1.map(function (e) { return (e.corso || 'corso da definire') + (e.giorni.length ? ' ' + e.giorni.join(', ') : '') + (e.fascia ? ' ' + e.fascia : ''); }).join(' · ');
      return corto ? (k || 'nessun corso') : k ? n + ': ' + k : n + ' non è iscritta a nessun corso';
    }
    return '';
  }

  /** Il compito del manuale che risponde alla domanda (null se nessuno è abbastanza vicino). */
  function dalManuale(q, opz, minimo) {
    if (!opz.manuale || !opz.manuale.length) return null;
    // whole words of at least five letters, compared by their beginning ("registro" finds "registrare"): a short or common word must not find a page by chance
    var parole = q.split(' ').filter(function (w) { return w.length >= 5 && !/^(faccio|posso|fanno|quando|perche|della|delle|degli|nelle|nella|sulla|dalla|dello|questo|questa|vorrei|voglio|quale|quali|quanto|quanti|quante|molto|tutto|tutti|tutte|sempre|ancora|anche|senza|oggi|funziona)$/.test(w); });
    var migliore = null, punteggio = 0;
    opz.manuale.forEach(function (x) {
      var tit = C.norm(x.t).split(' '), txt = C.norm(x.passi.join(' ') + ' ' + (x.consiglio || '')).split(' '), p = 0;
      parole.forEach(function (w) {
        var radice = w.slice(0, Math.max(5, w.length - 2)), inizia = function (t) { return t.indexOf(radice) === 0; };
        if (tit.some(inizia)) p += 3; else if (txt.some(inizia)) p += 1;
      });
      if (p > punteggio) { punteggio = p; migliore = x; }
    });
    if (!migliore || punteggio < (minimo || 3)) return null;
    return risposta(migliore.t, migliore.passi.map(function (t, i) { return { t: (i + 1) + '. ' + t }; }).concat(migliore.consiglio ? [{ t: 'Consiglio: ' + migliore.consiglio }] : []), [{ etichetta: 'Apri il manuale', vai: 'guida' }]);
  }
  /** The month named in the question (1–12) and its first day, in the past for incomes or in the future for what falls due (avanti). */
  function meseCitato(q, today, avanti) {
    var m = MESI.filter(function (x) { return q.indexOf(x) >= 0; })[0];
    if (!m) return null;
    var mi = MESI.indexOf(m) + 1, anno = +today.slice(0, 4), cur = +today.slice(5, 7);
    if (avanti ? mi < cur : mi > cur) anno += avanti ? 1 : -1;
    return { nome: m, n: mi, anno: anno, da: anno + '-' + (mi < 10 ? '0' : '') + mi + '-01' };
  }

  /**
   * Risponde a una domanda in italiano. opz = { ora, manuale: [{ t, passi, consiglio }], copie2, persona, prima }:
   * persona = the id of the student of the answer before, prima = the question before (1.29.0: «e il certificato?», «e Bianchi?»).
   * Restituisce { titolo, righe: [{ t, vai? }], azioni, messaggi, suggerimenti }. Se non capisce lo dice e propone qualche domanda.
   */
  /** Who must pay, nothing paid, only a deposit (1.29.0; 1.31.0: shared by the answer about payments and by the questions with more conditions). */
  var NIENTE = /\bnon (ha|hanno) (ancora )?(pagato|versato|dato) (niente|nulla)|\b(niente|nulla)\b.*\b(pagat|versat)|\bnessun (pagamento|versamento)|\bzero\b.*\bpagat/;
  var ACCONTO = /\bacconto|\bacconti|\b(pagato|versato|dato) (solo )?(una )?parte|\bin parte\b|\bparzial/;
  var DEBITO = /\b(deve|devono|dovrebbe|dovrebbero)\b.*\b(pagar|saldar|versar)|\b(ancora|anche) da pagare|\bnon (ha|hanno) (ancora )?(pagat|saldat)|\b(da incassare|debit|residu|moros|in sospeso|insolut|devo incassare)/;
  var TIPI_DOMANDA = [{ nome: 'Mensile', re: /\bmensil/ }, { nome: 'Trimestrale', re: /\btrimestral/ }, { nome: 'Semestrale', re: /\bsemestral/ }, { nome: 'Annuale', re: /\bannual/ }];
  function esc(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function nomeGiorno(g) { return g[0].replace(/i$/, 'ì'); }

  /** The age said in the question (1.30.0; a function since 1.31.0): «più di 15 anni», «meno di 8», «tra 6 e 8 anni», «di 10 anni», «nate nel 2015». { anno, lo, hi, d1, d2 } (d1 for one student) or null. */
  function etaCitata(q) {
    var natiA = /\bnat[aei] nel (\d{4})\b/.exec(q);
    if (natiA) return { anno: natiA[1], lo: 0, hi: 200, d1: 'nata nel ' + natiA[1], d2: 'nate nel ' + natiA[1] };
    if (/\banni (di|da) (iscrizion|cors|frequen|abbonament|palestra)/.test(q)) return null; // «2 anni di iscrizione» is not an age
    var mm = /\bpiu di (\d{1,2}) e meno di (\d{1,2}) anni\b/.exec(q);
    var m = mm ? [0, mm[1]] : /\bpiu di (\d{1,2}) anni\b/.exec(q), l = mm ? [0, mm[2]] : /\bmeno di (\d{1,2}) anni\b/.exec(q), t = /\b(?:tra|fra) (\d{1,2}) e (\d{1,2}) anni\b/.exec(q);
    var e = /\b(chi|quali|quante|allieve|bambine|ragazze|atlete|iscritte)\b/.test(q) && /\b(?:di|ha|hanno) (\d{1,2}) anni\b/.exec(q), d;
    if (t) { var lo = Math.min(+t[1], +t[2]), hi = Math.max(+t[1], +t[2]); d = 'tra ' + lo + ' e ' + hi + ' anni'; return { lo: lo, hi: hi, d1: d, d2: d }; }
    if (m || l) { d = (m ? 'con più di ' + m[1] + ' anni' : '') + (m && l ? ' e ' : '') + (l ? (m ? '' : 'con ') + 'meno di ' + l[1] + ' anni' : ''); return { lo: m ? +m[1] + 1 : 0, hi: l ? +l[1] - 1 : 200, d1: d, d2: d }; }
    if (e) { d = 'di ' + e[1] + ' anni'; return { lo: +e[1], hi: +e[1], d1: d, d2: d }; }
    return null;
  }
  function etaGiusta(et, a, today) {
    if (!C.isIso(a.nascita)) return false;
    if (et.anno) return a.nascita.slice(0, 4) === et.anno;
    var x = C.ageOn(a.nascita, today); return x >= et.lo && x <= et.hi;
  }

  /** The data that may be missing in a card (1.31.0): [key, words of the question, what is missing, is it missing?]. */
  var DATI_MANCANTI = [['cf', '(?:codice fiscale|codici fiscali|cf)\\b', 'il codice fiscale', function (a) { return !a.cf; }],
    ['genitore', '(?:genitor|tutor)', 'il genitore o il suo telefono', function (a, today) { return L.mancaGenitore(a, today).length > 0; }],
    ['telefono', '(?:telefon|cellular|numero)', 'un telefono valido', function (a) { return !tel(a); }],
    ['privacy', '(?:privacy|consens)', 'il consenso privacy', function (a) { return !a.privacy; }],
    ['nascita', '(?:data di nascita|nascita)', 'la data di nascita', function (a) { return !C.isIso(a.nascita); }],
    ['email', '(?:email|mail)\\b', 'l\'email', function (a) { return !a.email; }]];

  /**
   * The conditions of a question about a group of students (1.31.0), to be put together: «minorenni senza certificato»,
   * «chi del corso Agonismo ha il certificato scaduto?», «allieve di Celano che devono pagare», «chi è iscritta a Base e Agonismo?».
   * [{ k, … }] in the order of the sentence that describes them: gruppo, eta, citta, corso, giorni, tipo, debito, certTipo, cert, abb, senza, regola.
   */
  function condizioni(db, q, today) {
    var out = [], periodo = periodoCitato(q, today), conCert = /\bcertific/.test(q);
    var mi = /\bminorenn/.test(q), ma = /\bmaggiorenn/.test(q);
    if (mi !== ma) out.push({ k: 'gruppo', min: mi, d: mi ? ['minorenne', 'minorenni'] : ['maggiorenne', 'maggiorenni'] });
    var et = etaCitata(q);
    if (et) out.push({ k: 'eta', eta: et, d: [et.d1, et.d2] });
    // the town written in the cards, after «di», «a», «ad», «in» («allieve di Celano», «chi abita a Celano»)
    var citta = Object.create(null);
    db.allieve.forEach(function (a) { var c = C.str(a.citta), k = C.norm(c); if (k && !a.archiviata) citta[k] = c; });
    var ck = Object.keys(citta).filter(function (k) { return new RegExp('\\b(di|da|a|ad|in) ' + esc(k) + '\\b').test(q); }).sort(function (x, y) { return y.length - x.length; })[0];
    if (ck) out.push({ k: 'citta', v: ck, d: ['di ' + citta[ck], 'di ' + citta[ck]] });
    // the courses named (the longest name first: «Base/Avanzato» before «Base»), in the order of the question
    var resto = ' ' + q + ' ', corsi = [];
    ((db.liste && db.liste.corsi) || []).map(function (c) { return { c: c, n: C.norm(c) }; }).filter(function (x) { return x.n; })
      .sort(function (x, y) { return y.n.length - x.n.length; }).forEach(function (x) {
        var mt = new RegExp('\\b' + esc(x.n) + '\\b').exec(resto);
        if (mt) { corsi.push({ c: x.c, at: mt.index }); resto = resto.slice(0, mt.index) + new Array(x.n.length + 1).join(' ') + resto.slice(mt.index + x.n.length); }
      });
    corsi.sort(function (x, y) { return x.at - y.at; });
    if (corsi.length) out.push({ k: 'corso', corsi: corsi.map(function (x) { return x.c; }), o: corsi.length > 1 && /\b(o|oppure)\b/.test(q) });
    // the days of the lessons (not a date: «scade lunedì»)
    var giorni = GIORNI_PAROLE.filter(function (g) { return new RegExp('\\b' + g[0] + '\\b').test(q); });
    if (giorni.length && !periodo && !/\b(scad|rinnov)/.test(q)) out.push({ k: 'giorni', giorni: giorni, o: giorni.length > 1 && /\b(o|oppure)\b/.test(q), non: /\bnon (viene|vengono|frequenta|frequentano|fa|fanno|c e|ce)\b/.test(q) });
    var tipo = TIPI_DOMANDA.filter(function (t) { return t.re.test(q); })[0];
    if (tipo) out.push({ k: 'tipo', v: tipo.nome });
    if (NIENTE.test(q) || ACCONTO.test(q) || DEBITO.test(q)) out.push({ k: 'debito', v: NIENTE.test(q) ? 'niente' : ACCONTO.test(q) ? 'acconto' : 'debito' });
    // the certificate: its type and its state
    var attesa = /\b(deve|devono|da) (ancora )?(portare|consegnare)\b|\bin attesa\b|\bda consegnare\b/.test(q);
    if (conCert) {
      var tipoC = /\bnon agonist/.test(q) ? 'Non Agonistico' : /\bagonist/.test(q) ? 'Agonistico' : /\bludic/.test(q) ? 'Ludico-motoria' : '';
      if (tipoC) out.push({ k: 'certTipo', v: tipoC });
    }
    if (conCert || attesa) {
      var statoC = /\bscadut/.test(q) ? 'SCADUTO' : !periodo && /\b(in scadenza|scade|scadono|sta per scadere|stanno per scadere)\b/.test(q) ? 'IN SCADENZA' : attesa ? 'IN ATTESA'
        : /\b(mancant\w*|manca|mancano)\b|\bsenza (il |un |nessun )?certific|\bnon (ha|hanno) (ancora )?(portato |consegnato )?(il |un )?certific/.test(q) ? 'MANCANTE' : '';
      if (statoC) out.push({ k: 'cert', v: statoC, senza: /\bsenza\b/.test(q) });
    }
    // the subscription: expired, ending, to renew (not in a period: «chi rinnova a dicembre?» has its own answer)
    if (!periodo && (/\babbonament/.test(q) || !conCert)) {
      var abb = /\bscadut/.test(q) ? 'SCADUTO' : /\b(in scadenza|scade|scadono|sta per scadere|stanno per scadere)\b/.test(q) ? 'IN SCADENZA' : /\b(da rinnovare|deve rinnovare|devono rinnovare|rinnovo|rinnovi)\b/.test(q) ? 'RINNOVARE' : '';
      if (abb && (/\babbonament/.test(q) || out.some(function (c) { return c.k !== 'tipo'; }))) out.push({ k: 'abb', v: abb });
    }
    var senza = DATI_MANCANTI.filter(function (d) { return new RegExp('\\b(?:senza|non ha|non hanno|manca|mancano|priv[aeio])\\b(?: \\w+){0,3}? ' + d[1]).test(q) || new RegExp('\\b' + d[1] + '\\w*(?: \\w+)? (?:mancant|vuot)').test(q); })[0];
    if (senza) out.push({ k: 'senza', dato: senza });
    if (/\bnon (e |sono |siano |risulta |risultano )?in regola\b|\birregolar/.test(q)) out.push({ k: 'regola', ok: false }); else if (/\bin regola\b/.test(q)) out.push({ k: 'regola', ok: true });
    return out;
  }
  /** Two conditions that an answer of before already puts together: a course and who must pay, an age, a type, one day. */
  function coppiaGiaNota(cc) {
    if (cc.length !== 2) return false;
    var corso = cc.filter(function (c) { return c.k === 'corso' && c.corsi.length === 1; })[0], altra = cc.filter(function (c) { return c.k !== 'corso'; })[0];
    return !!corso && !!altra && (altra.k === 'debito' || altra.k === 'eta' || altra.k === 'tipo' || (altra.k === 'giorni' && altra.giorni.length === 1 && !altra.non));
  }
  /** The words for the students that meet the conditions: «minorenni del corso Base con qualcosa da pagare». n = 1 for one student. */
  function descrizione(per, n) {
    var i = n === 1 ? 0 : 1, parti = [];
    if (per.gruppo) parti.push(per.gruppo.d[i]);
    if (per.eta) parti.push(per.eta.d[i]);
    if (per.citta) parti.push(per.citta.d[i]);
    if (per.corso) {
      var cs = per.corso.corsi;
      parti.push(cs.length === 1 ? 'del corso ' + cs[0] : per.corso.o ? 'del corso ' + cs.slice(0, -1).join(', ') + ' o ' + cs[cs.length - 1]
        : (n === 1 ? 'iscritta ' : 'iscritte ') + cs.map(function (c) { return 'sia ' + (/^[aeiou]/i.test(c) ? 'ad ' : 'a ') + c; }).join(' '));
    }
    if (per.giorni) parti.push('che ' + (per.giorni.non ? 'non ' : '') + (n === 1 ? 'viene ' : 'vengono ') + per.giorni.giorni.map(function (g) { return 'il ' + nomeGiorno(g); }).join(per.giorni.o ? ' o ' : ' e '));
    if (per.tipo && !per.abb) parti.push('con l\'abbonamento ' + per.tipo.v.toLowerCase());
    if (per.debito) parti.push(per.debito.v === 'niente' ? 'senza nessun pagamento' : per.debito.v === 'acconto' ? (n === 1 ? 'che ha pagato solo una parte' : 'che hanno pagato solo una parte') : 'con qualcosa da pagare');
    if (per.cert || per.certTipo) {
      var st = per.cert ? per.cert.v : '', tc = per.certTipo ? ' ' + { 'Agonistico': 'agonistico', 'Non Agonistico': 'non agonistico', 'Ludico-motoria': 'ludico-motorio' }[per.certTipo.v] : '';
      parti.push(st === 'IN ATTESA' ? (n === 1 ? 'che deve portare il certificato' : 'che devono portare il certificato') : st === 'MANCANTE' ? (per.cert.senza ? 'senza certificato' : 'con il certificato mancante')
        : 'con il certificato' + tc + (st === 'SCADUTO' ? ' scaduto' : st === 'IN SCADENZA' ? ' in scadenza' : ''));
    }
    if (per.abb) parti.push('con l\'abbonamento ' + (per.tipo ? per.tipo.v.toLowerCase() + ' ' : '') + { 'SCADUTO': 'scaduto', 'IN SCADENZA': 'in scadenza', 'RINNOVARE': 'da rinnovare' }[per.abb.v]);
    if (per.senza) parti.push('senza ' + per.senza.dato[2]);
    if (per.regola) parti.push(per.regola.ok ? 'in regola' : 'non in regola');
    // «con l'abbonamento mensile e qualcosa da pagare», «con qualcosa da pagare e senza un telefono valido»
    return parti.reduce(function (t, p, j) {
      if (!j) return p;
      var w = p.split(' ')[0], pr = parti[j - 1].split(' ')[0];
      if (w === pr && (w === 'con' || w === 'che')) return t + ' e ' + p.slice(w.length + 1);
      if (/^(con|senza)$/.test(w) && /^(con|senza)$/.test(pr)) return t + ' e ' + p;
      return t + ' ' + p;
    }, '');
  }
  function testoCertificato(cs) {
    if (cs.stato === 'SCADUTO') return 'certificato scaduto il ' + C.isoToIt(cs.scadenza);
    if (cs.stato === 'IN SCADENZA') return 'certificato scade il ' + C.isoToIt(cs.scadenza);
    if (cs.stato === 'IN ATTESA') return 'certificato da portare entro il ' + C.isoToIt(cs.consegna);
    if (cs.stato === 'MANCANTE') return 'certificato mancante';
    return cs.scadenza ? 'certificato valido fino al ' + C.isoToIt(cs.scadenza) : '';
  }
  /** The open enrollments of students who are not archived, with no days written (filtered by course): the questions about the days cannot count them. */
  function senzaGiorni(db, corso) {
    var ix = L.indice(db), n = 0;
    db.iscrizioni.forEach(function (e) { var a = ix.allieve[e.allievaId]; if (!e.annullata && !e.storica && a && !a.archiviata && !(e.giorni || []).length && (!corso || C.norm(e.corso) === C.norm(corso))) n++; });
    return n ? [{ t: 'In ' + (n === 1 ? '1 iscrizione aperta i giorni non sono scritti: non l\'ho contata.' : n + ' iscrizioni aperte i giorni non sono scritti: non le ho contate.') }] : [];
  }
  /** The students that meet all the conditions, one line each with what the conditions are about (1.31.0). */
  function combinata(db, today, cc) {
    var per = {}; cc.forEach(function (c) { per[c.k] = c; });
    var unCorso = per.corso && per.corso.corsi.length === 1 ? C.norm(per.corso.corsi[0]) : '', piuCorsi = !!per.corso && per.corso.corsi.length > 1;
    function trova(per) {
      var suIscrizione = !!(unCorso || per.tipo || per.abb || per.debito), out = [];
      db.allieve.forEach(function (a) {
        if (a.archiviata) return;
        if (per.gruppo && (per.gruppo.min ? !L.minorenne(a, today) : !C.isIso(a.nascita) || L.minorenne(a, today))) return;
        if (per.eta && !etaGiusta(per.eta.eta, a, today)) return;
        if (per.citta && C.norm(a.citta) !== per.citta.v) return;
        if (per.senza && !per.senza.dato[3](a, today)) return;
        var tutte = L.iscrizioniDi(db, a.id).filter(function (e) { return !e.annullata; }), aperte = tutte.filter(function (e) { return !e.storica; });
        var rg = null, cs = null;
        if (per.regola) { rg = inRegola(db, a, today); if ((!rg.aperte && !rg.problemi.length) || rg.ok !== per.regola.ok) return; }
        if (per.cert || per.certTipo) {
          if (!aperte.length) return;
          cs = L.statoCertificato(db, a, today);
          if (per.cert && cs.stato !== per.cert.v) return;
          if (per.certTipo && a.certTipo !== per.certTipo.v) return;
        }
        if (piuCorsi) {
          var ha = per.corso.corsi.map(function (c) { return aperte.some(function (e) { return C.norm(e.corso) === C.norm(c); }); });
          if (per.corso.o ? ha.indexOf(true) < 0 : ha.indexOf(false) >= 0) return;
        }
        // what one enrollment must meet: the course, the type, the subscription, something to pay (an old season counts only for what is to pay)
        var dentro = (per.debito ? tutte : aperte).filter(function (e) {
          if (unCorso && C.norm(e.corso) !== unCorso) return false;
          if (per.tipo && (e.storica || e.tipo !== per.tipo.v)) return false;
          if (per.abb) { if (e.storica) return false; var s = L.statoIscrizione(db, e, today).stato; if (per.abb.v === 'RINNOVARE' ? s !== 'SCADUTO' && s !== 'IN SCADENZA' : s !== per.abb.v) return false; }
          if (per.debito) { var k = L.conto(db, e); if (k.residuo === null || k.residuo <= 0.005 || (per.debito.v === 'niente' && k.pagato > 0.005) || (per.debito.v === 'acconto' && k.pagato <= 0.005)) return false; }
          return true;
        });
        if (suIscrizione && !dentro.length) return;
        var gg = {};
        (suIscrizione ? dentro : aperte).forEach(function (e) { if (!e.storica) (e.giorni || []).forEach(function (g) { gg[g] = 1; }); });
        if (per.giorni) {
          var dg = per.giorni.giorni;
          if (per.giorni.non ? !Object.keys(gg).length || dg.some(function (g) { return gg[g[1]]; }) : per.giorni.o ? !dg.some(function (g) { return gg[g[1]]; }) : !dg.every(function (g) { return gg[g[1]]; })) return;
        }
        var res = 0, pag = 0;
        if (per.debito) dentro.forEach(function (e) { var k = L.conto(db, e); res += k.residuo; pag += k.pagato; });
        out.push({ a: a, aperte: aperte, dentro: dentro, cs: cs, rg: rg, gg: gg, residuo: Math.round(res * 100) / 100, pagato: Math.round(pag * 100) / 100 });
      });
      return out.sort(function (x, y) { return (per.debito ? y.residuo - x.residuo : 0) || (C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1); });
    }
    var lista = trova(per), n = lista.length, tot = Math.round(lista.reduce(function (t, x) { return t + x.residuo; }, 0) * 100) / 100;
    var suIscr = !!(unCorso || per.tipo || per.abb || per.debito);
    var righe = elenco(lista, 20, function (x) {
      var det = [];
      if (per.gruppo || per.eta) det.push(C.isIso(x.a.nascita) ? C.ageOn(x.a.nascita, today) + ' anni' : '');
      if (piuCorsi) det.push(per.corso.corsi.filter(function (c) { return x.aperte.some(function (e) { return C.norm(e.corso) === C.norm(c); }); }).join(', '));
      else if (suIscr && !unCorso) det.push(x.dentro.map(function (e) { return e.corso || 'corso da definire'; }).filter(function (c, j, l) { return l.indexOf(c) === j; }).join(', '));
      if (per.giorni && (per.giorni.giorni.length > 1 || per.giorni.non)) det.push(GIORNI_PAROLE.filter(function (g) { return x.gg[g[1]]; }).map(function (g) { return g[1]; }).join(', '));
      if (per.debito) det.push('deve ' + euro(x.residuo) + (per.debito.v === 'acconto' ? ' (ha dato ' + euro(x.pagato) + ')' : ''));
      if (x.cs) det.push(testoCertificato(x.cs));
      if (per.abb) { var s = x.dentro.map(function (e) { return L.statoIscrizione(db, e, today); }).sort(function (p, r) { return p.scadenza < r.scadenza ? -1 : 1; })[0]; det.push('abbonamento ' + (s.stato === 'SCADUTO' ? 'scaduto il ' : 'scade il ') + C.isoToIt(s.scadenza)); }
      if (per.regola && !per.regola.ok) det.push(x.rg.problemi.join(', '));
      return { t: [x.a.name].concat(det.filter(Boolean)).join(' · '), vai: 'allieva/' + x.a.id };
    });
    // «senza certificato»: who has still days to bring it is not missing, but has none either
    var att = [];
    if (per.cert && per.cert.v === 'MANCANTE' && per.cert.senza) {
      att = trova(Object.assign({}, per, { cert: { k: 'cert', v: 'IN ATTESA' } })).sort(function (x, y) { return x.cs.consegna < y.cs.consegna ? -1 : x.cs.consegna > y.cs.consegna ? 1 : C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1; });
      if (att.length) righe.push({ t: 'Da portare entro il termine' + (att.length > 1 ? ' (' + att.length + ')' : '') + ': ' + att.slice(0, 5).map(function (x) { return x.a.name + ' (' + C.isoToIt(x.cs.consegna) + ')'; }).join(', ') + (att.length > 5 ? ' e altre ' + (att.length - 5) : '') });
    }
    if (per.giorni) righe = righe.concat(senzaGiorni(db, unCorso ? per.corso.corsi[0] : ''));
    var azioni = [];
    if (per.debito) azioni.push({ etichetta: 'Apri l\'elenco da incassare', vai: 'pagamenti/da-incassare' });
    if (per.cert || per.certTipo) azioni.push({ etichetta: 'Apri i certificati', vai: per.cert && per.cert.v === 'MANCANTE' ? 'certificati/mancanti' : per.cert && per.cert.v === 'IN ATTESA' ? 'certificati/in-attesa' : 'certificati' });
    if (per.regola && !per.regola.ok) azioni.push({ etichetta: 'Apri «Non in regola»', vai: 'allieve/non-in-regola' });
    if (per.abb) azioni.push({ etichetta: 'Apri le scadenze', vai: 'scadenze' });
    if (unCorso) azioni.push({ etichetta: 'Apri il corso', vai: 'corsi/' + encodeURIComponent(per.corso.corsi[0]) });
    if (!azioni.length) azioni.push({ etichetta: 'Apri le allieve', vai: 'allieve' });
    return risposta((n ? plurale(n, 'allieva', 'allieve') + ' ' + descrizione(per, n) : 'Nessuna allieva ' + descrizione(per, 1)) + (per.debito && n ? ': ' + euro(tot) + ' da incassare' : '')
      + (!n && att.length ? ': ' + (att.length === 1 ? '1 lo deve ancora portare' : att.length + ' lo devono ancora portare') + ', entro il termine' : ''), righe, azioni.slice(0, 2));
  }

  function rispondi(db, domanda, today, opz) {
    opz = opz || {};
    var q = C.norm(domanda);
    if (!q) return risposta('Che cosa vuoi sapere?', [{ t: 'Scrivi una domanda, per esempio: «chi deve portare il certificato?»' }], [], { suggerimenti: ESEMPI });
    function ha(re) { return re.test(q); }
    var attive = function () { return db.allieve.filter(function (a) { return !a.archiviata; }); };
    // 1.29.0: a greeting, a thanks: a short answer (after a thanks the talk about the same person goes on)
    if (/^(ciao|buongiorno|buon giorno|buonasera|buona sera|salve|ehi)( (a te|come stai|come va|assistente))?$/.test(q)) return risposta(/^ciao/.test(q) ? 'Ciao! Che cosa vuoi sapere?' : /^buona ?sera/.test(q) ? 'Buonasera! Che cosa vuoi sapere?' : 'Buongiorno! Che cosa vuoi sapere?', [{ t: 'Chiedimi dei dati: scadenze, certificati, pagamenti, una persona per nome o per cognome.' }], [], { suggerimenti: ESEMPI });
    if (/^(grazie|grazie mille|ok|okay|perfetto|va bene|ottimo|benissimo|bene)( grazie)?$/.test(q)) return risposta('Prego!', [{ t: 'Se ti serve altro, chiedi pure.' }], [], { persona: opz.persona || undefined });
    // 1.29.0: «come registro un certificato?» is a question for the manual, not about the certificates
    if (ha(/^come\b|\bcome (si|faccio|posso|devo|fare|funziona)\b/)) { var man0 = dalManuale(q, opz, 6); if (man0) return man0; } // only a page that matches two words: else the topics below, and the manual again at the end
    // 1.29.0: «quanto costa», «fare i conti»: words of the question that are also surnames (Costa, Conti) do not look for a person
    var pers = personeCitate(db, q.replace(/\bquanto (costa|costano|viene|vengono)\b/g, ' ').replace(/\b(i|il|dei|del|fare i|fammi i|fai i) (conti|conto)\b/g, ' '));
    // 1.29.0: a question that goes on from an answer about a person and names nobody («e il certificato?», «quanto deve?», «quando scade?») is about her
    if (!pers.length && opz.persona) {
      var prec = L.indice(db).allieve[opz.persona];
      if (prec && seguito(db, q) && rispostaSu(db, prec, q, today)) pers = [{ a: prec, punti: 2 }];
    }
    var forte = /\b(certific|incass|bonific|verific|rinnov|scadenz|scadut|scade|complean|auguri|corso|copia|copie|backup|quant[eio]|priorita|consigli|oggi|adesso|da fare|soldi|debit|moros|abbonament|dicembre|marzo)/.test(q);
    var vuoleMessaggio = ha(/\b(messagg|scriv|avvis|whatsapp|mandare|manda|inviare|invia)/);
    // una persona (da sola, o con "messaggio per...")
    // a question about something of a person (to pay, certificate, phone, parent, course) needs only the surname (1.28.0)
    var suPersona = pers.length >= 1 && pers.length <= 8 && !ELENCO.test(q) && !!rispostaSu(db, pers[0].a, q, today); // «certificati mancanti rossi» is a list, «certificato di rossi» is about her
    if (pers.length === 1 && (pers[0].punti >= 2 || !forte || suPersona)) {
      var s = schedaPersona(db, pers[0].a, today, opz), a1 = pers[0].a;
      if (vuoleMessaggio && !s.messaggi.length) s.righe.unshift({ t: 'Per ' + a1.name + ' non c\'è niente da ricordare adesso: nessun messaggio pronto.' });
      // 1.27.0: the answer to what was asked comes first, the card of the person under it
      var su = rispostaSu(db, a1, q, today);
      // 1.29.0: «e Bianchi?» after «quanto deve Rossi?» asks the same thing of another person
      if (!su && opz.prima && /^(e|ed|anche|invece|e per|e di|e la|e il)\b/.test(q) && q.split(' ').length <= 5) su = rispostaSu(db, a1, C.norm(opz.prima), today);
      if (su) s.titolo = su;
      return s;
    }
    if (pers.length > 1 && pers.length <= 8 && (pers[0].punti >= 2 || !forte || suPersona)) {
      var omonime = pers[0].punti >= 2 && pers.every(function (x) { return C.norm(x.a.name) === C.norm(pers[0].a.name); });
      return risposta(omonime ? 'Ci sono ' + pers.length + ' allieve che si chiamano ' + pers[0].a.name : 'Ho trovato ' + pers.length + ' persone',
        pers.map(function (x) { var su = rispostaSu(db, x.a, q, today, true), et = C.isIso(x.a.nascita) ? C.ageOn(x.a.nascita, today) + ' anni' : ''; return { t: x.a.name + ' (n. ' + x.a.id + (et ? ', ' + et : '') + ')' + (su ? ': ' + su : ''), vai: 'allieva/' + x.a.id }; }),
        [], { suggerimenti: omonime ? [] : ['Scrivi nome e cognome per vedere una persona sola'] });
    }
    // 1.31.0: more conditions together («minorenni senza certificato», «chi del corso Agonismo ha il certificato scaduto?», «allieve di Celano che devono pagare»): one list of the students that meet all of them.
    // Not for a price, the takings, birthdays, notes, messages, families or the forecast (they have their own answer), nor for two conditions that an answer below already puts together.
    if (!ha(/\b(costa|costano|costo|costi|prezz\w*|tariff\w*|listino|incassat\w*|incasso|incassi|entrate|ricevut[ae]|cassa|complean\w*|auguri|note|nota|appunti|messagg\w*|avvis\w*|whatsapp|scriver\w*|sollecit\w*|sorell\w*|fratell\w*|famigli\w*|figli\w*|previsione|prossimi mesi)\b/)
      && !(ha(/\bquot[ae]\b/) && ha(/\b(media|medie|piu alta|piu alte|piu bassa|piu basse|massima|minima)\b/))) {
      var cc = condizioni(db, q, today);
      if ((cc.length >= 2 && !coppiaGiaNota(cc)) || cc.some(function (c) { return c.k === 'corso' && c.corsi.length > 1; })) return combinata(db, today, cc);
    }
    // 1.30.0: the picture of the season, in a few lines: «riepilogo», «come va la stagione?», «situazione»
    if (ha(/\b(riepilogo|riassunto|situazione|come va|come vanno|come stiamo|come andiamo|andamento|panoramica|resoconto|quadro generale|in generale)\b/) && !ha(/\b(certific|incass|pagament|soldi|scad|rinnov|bonific|abbonament|iscrizion|corso|corsi|copi|backup|complean|note|nota)/)) {
      var rp = L.riepilogo(db, today), stR = L.stagioneDi(today), daR = stR.slice(0, 4) + '-08-01', pgR = db.pagamenti.filter(function (p) { return p.data >= daR && p.data <= today; });
      var totR = Math.round(pgR.reduce(function (t, p) { return t + p.importo; }, 0) * 100) / 100, mR = today.slice(0, 7), meseR = Math.round(pgR.filter(function (p) { return p.data.slice(0, 7) === mR; }).reduce(function (t, p) { return t + p.importo; }, 0) * 100) / 100;
      var incR = L.daIncassare(db), ceR = L.scadenzeCertificati(db, today), scR = L.scadenze(db, today), pcR = L.pianoCompleta(db), nonR = attive().filter(function (a) { return !inRegola(db, a, today).ok; }).length;
      return risposta('La stagione ' + stR + ' in breve', [
        { t: plurale(rp.allieve, 'allieva', 'allieve') + ', ' + plurale(rp.correnti, 'iscrizione aperta', 'iscrizioni aperte') + (pcR.totale ? ' (' + pcR.totale + ' da completare)' : ''), vai: 'allieve' },
        { t: 'Incassati nella stagione: ' + euro(totR) + ' (' + plurale(pgR.length, 'pagamento', 'pagamenti') + '), di cui questo mese ' + euro(meseR), vai: 'pagamenti' },
        { t: 'Da incassare: ' + euro(incR.totale) + ' (' + plurale(incR.righe.length, 'iscrizione', 'iscrizioni') + ')', vai: 'pagamenti/da-incassare' },
        { t: 'Certificati: ' + [plurale(ceR.scaduti.length, 'scaduto', 'scaduti'), plurale(ceR.mancanti.length, 'mancante', 'mancanti'), ceR.inAttesa.length + ' da portare', ceR.inScadenza.length + ' in scadenza'].join(' · '), vai: 'certificati' },
        { t: 'Abbonamenti: ' + plurale(scR.scadute.length, 'scaduto', 'scaduti') + ' · ' + scR.inScadenza.length + ' in scadenza', vai: 'scadenze' },
        { t: nonR ? plurale(nonR, 'allieva non è in regola', 'allieve non sono in regola') + ': chiedi «chi non è in regola?»' : 'Tutte le allieve sono in regola' }
      ], [{ etichetta: 'Chi non è in regola?', domanda: 'chi non è in regola?' }, { etichetta: 'Apri i grafici', vai: 'analisi' }]);
    }
    // 1.30.0: who is not «in regola» (subscription expired, certificate expired or missing, something to pay, a minor without the parent), with why
    if ((ha(/\b(in regola|irregolar\w*)\b/) || (ha(/\b(a posto|in ordine)\b/) && ha(/\b(chi|quali|quante|allieve|tutte)\b/))) && !ALTRO_ARGOMENTO.test(q) && !ha(/\b(date|data)\b/)) {
      var tutteR = attive().map(function (a) { return { a: a, r: inRegola(db, a, today) }; }).filter(function (x) { return x.r.aperte || x.r.problemi.length; });
      var noR = tutteR.filter(function (x) { return !x.r.ok; }).sort(function (x, y) { return y.r.problemi.length - x.r.problemi.length || (C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1); });
      if (ha(/\bchi (e|sono) in regola\b/) && !ha(/\bnon\b/)) return risposta(plurale(tutteR.length - noR.length, 'allieva è in regola', 'allieve sono in regola') + ' su ' + tutteR.length, [{ t: noR.length ? plurale(noR.length, 'non lo è', 'non lo sono') + ': chiedi «chi non è in regola?»' : 'Tutte.' }], noR.length ? [{ etichetta: 'Chi non è in regola?', domanda: 'chi non è in regola?' }] : []);
      return risposta(noR.length ? plurale(noR.length, 'allieva non è in regola', 'allieve non sono in regola') + ' (su ' + tutteR.length + ')' : 'Tutte le allieve sono in regola',
        elenco(noR, 15, function (x) { return { t: x.a.name + ' · ' + x.r.problemi.join(', '), vai: 'allieva/' + x.a.id }; }),
        noR.length ? [{ etichetta: 'Apri l\'elenco completo', vai: 'allieve/non-in-regola' }, { etichetta: 'Apri le scadenze', vai: 'scadenze' }] : []);
    }
    // 1.30.0: where the students live («chi abita ad Avezzano?»): by the town written in their card
    if (ha(/\b(abita|abitano|vive|vivono|residen\w*|di dove|che citta|quale citta|paese|paesi)\b/) && ha(/\b(chi|quali|quante|quanti|allieve|allieva|iscritte|bambine|ragazze|atlete|elenco)\b/)) {
      var perCitta = Object.create(null), citta = [];
      attive().forEach(function (a) { var c = C.str(a.citta); if (!c) return; var k = C.norm(c); if (!perCitta[k]) { perCitta[k] = { nome: c, allieve: [] }; citta.push(k); } perCitta[k].allieve.push(a); });
      var cit = citta.filter(function (k) { return k && new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(q); })[0];
      if (cit) return risposta(plurale(perCitta[cit].allieve.length, 'allieva abita', 'allieve abitano') + (/^a/i.test(perCitta[cit].nome) ? ' ad ' : ' a ') + perCitta[cit].nome, elenco(perCitta[cit].allieve, 20, function (a) { return { t: a.name, vai: 'allieva/' + a.id }; }));
      var nomina = /\b(?:abita|abitano|vive|vivono|residenti?)\s+(?:a|ad|in)\s+([a-z][a-z' ]{1,30}?)\s*$/.exec(q); // a town no student lives in
      if (nomina && !/^(casa|scuola)$/.test(nomina[1])) { var cn = C.titleCase(nomina[1]); return risposta('Nessuna allieva abita ' + (/^a/i.test(cn) ? 'ad ' : 'a ') + cn, [{ t: 'La città è quella scritta nella scheda di ogni allieva («Città»).' }]); }
      citta.sort(function (x, y) { return perCitta[y].allieve.length - perCitta[x].allieve.length; });
      return risposta(citta.length ? 'Dove abitano le allieve' : 'Nelle schede non è scritta la città', citta.slice(0, 10).map(function (k) { return { t: perCitta[k].nome + ': ' + perCitta[k].allieve.length }; }));
    }
    // le note
    if (ha(/\b(note|nota|appunti)\b/)) {
      var en = L.elencoNote(db, today, {}), cn = en.conteggi;
      return risposta(cn.daFare ? plurale(cn.daFare, 'nota da fare', 'note da fare') + (cn.scadute ? ', ' + cn.scadute + ' in ritardo' : '') : 'Non hai note da fare',
        en.righe.slice(0, 6).map(function (x) { return { t: L.anteprimaNota(x.nota.testo, 80) + (x.nota.data ? ' · ' + C.isoToIt(x.nota.data) : '') + (x.stato === 'SCADUTA' ? ' (in ritardo)' : ''), vai: 'calendario/note' }; }),
        [{ etichetta: 'Apri le note', vai: 'calendario/note' }, { etichetta: 'Apri il calendario', vai: 'calendario' }]);
    }
    // 1.27.0: chi viene in un giorno (e in un corso)
    var giorniD = GIORNI_PAROLE.filter(function (g) { return q.indexOf(g[0]) >= 0; }), giorno = giorniD[0];
    var corsoQ = (db.liste.corsi || []).filter(function (c) { return c && q.indexOf(C.norm(c)) >= 0; })[0];
    // 1.31.0: more days («il lunedì e il mercoledì», «il lunedì o il venerdì») or not a day («chi non viene il venerdì?»): one line for each student, with her courses and days
    var nonViene = ha(/\bnon (viene|vengono|frequenta|frequentano|fa|fanno|c e|ce)\b/);
    if (giorno && (giorniD.length > 1 || nonViene) && ha(/\b(chi|quant|quali|iscritt|viene|vengono|c e|ce|lezion|allena|elenco|cors|orari)/)) {
      var oG = giorniD.length > 1 && ha(/\b(o|oppure)\b/);
      var chiG = attive().map(function (a) {
        var ap = L.iscrizioniDi(db, a.id).filter(function (e) { return !e.annullata && !e.storica && (e.giorni || []).length && (!corsoQ || e.corso === corsoQ); }), gg = {};
        ap.forEach(function (e) { e.giorni.forEach(function (g) { gg[g] = 1; }); });
        return { a: a, ap: ap, gg: gg };
      }).filter(function (x) { return x.ap.length && (nonViene ? !giorniD.some(function (g) { return x.gg[g[1]]; }) : oG ? giorniD.some(function (g) { return x.gg[g[1]]; }) : giorniD.every(function (g) { return x.gg[g[1]]; })); })
        .sort(function (x, y) { return C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1; });
      return risposta(plurale(chiG.length, 'allieva', 'allieve') + ' ' + (nonViene ? 'non ' : '') + (chiG.length === 1 ? 'viene' : 'vengono') + ' ' + giorniD.map(function (g) { return 'il ' + nomeGiorno(g); }).join(oG ? ' o ' : ' e ') + (corsoQ ? ' al corso ' + corsoQ : ''),
        elenco(chiG, 20, function (x) { return { t: x.a.name + ' · ' + x.ap.map(function (e) { return e.corso || 'corso da definire'; }).filter(function (c, j, l) { return l.indexOf(c) === j; }).join(', ') + ' · ' + GIORNI_PAROLE.filter(function (g) { return x.gg[g[1]]; }).map(function (g) { return g[1]; }).join(', '), vai: 'allieva/' + x.a.id }; }).concat(senzaGiorni(db, corsoQ)),
        corsoQ ? [{ etichetta: 'Apri il corso', vai: 'corsi/' + encodeURIComponent(corsoQ) }] : [{ etichetta: 'Apri i corsi', vai: 'corsi' }]);
    }
    if (giorno && ha(/\b(chi|quant|quali|iscritt|viene|vengono|c e|ce|lezion|allena|elenco|cors|orari)/)) {
      var gi = L.iscritte(db, { giorno: giorno[1], corso: corsoQ || '' }, today), perCorso = {};
      gi.forEach(function (x) { var k = (x.iscrizione.corso || 'corso da definire') + (x.iscrizione.fascia ? ' ' + x.iscrizione.fascia : ''); perCorso[k] = (perCorso[k] || 0) + 1; });
      var corsiG = Object.keys(perCorso).sort().map(function (k) { return k + ' (' + perCorso[k] + ')'; });
      return risposta(plurale(gi.length, 'allieva', 'allieve') + ' ' + (gi.length === 1 ? 'viene' : 'vengono') + ' il ' + giorno[0].replace(/i$/, 'ì') + (corsoQ ? ' al corso ' + corsoQ : ''),
        (corsiG.length > 1 || ha(/\b(cors|orari)/) ? [{ t: 'Corsi: ' + (corsiG.join(', ') || 'nessuno') }] : []).concat(elenco(gi, 20, function (x) { return { t: x.allieva.name + ' · ' + (x.iscrizione.corso || 'corso da definire') + (x.iscrizione.fascia ? ' · ' + x.iscrizione.fascia : ''), vai: 'allieva/' + x.allieva.id }; })).concat(senzaGiorni(db, corsoQ)),
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
    // 1.29.0: le date dei pagamenti che non possono essere giuste
    if ((ha(/\b(date|data)\b.*\b(stran|sbagliat|errat|controll|futur|assurd|impossibil)/) || ha(/\b(controll|verific|corregg|sistem)\w*\b.*\b(date|data)\b/) || ha(/\bpagament\w*\b.*\b(futur|stran|sbagliat)/))
      && !ha(/\b(certific|scadenz|scade|nascit|compleann|inizio)/)) { // «data di inizio sbagliata» or «controlla la scadenza» are about something else
      var dc = L.dateDaControllare(db, today);
      return risposta(dc.n ? plurale(dc.n, 'pagamento con una data da controllare', 'pagamenti con una data da controllare') : 'Le date dei pagamenti sono tutte credibili',
        elenco(dc.righe, 10, function (x) { return { t: nome(x) + ' · ' + euro(x.pagamento.importo) + ' · ' + C.isoToIt(x.pagamento.data) + (x.proposta ? ' → forse il ' + C.isoToIt(x.proposta) + ' (' + x.perche + ')' : x.motivo === 'futuro' ? ' (nel futuro)' : ' (mesi prima della stagione)'), vai: x.allieva ? 'allieva/' + x.allieva.id : 'pagamenti' }; }),
        dc.n ? [{ etichetta: 'Controlla e correggi', fai: 'date' }] : [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // 1.29.0: il corso nominato (il nome più lungo vince: «Base/Avanzato» prima di «Base»)
    var corsoD = (db.liste.corsi || []).filter(function (c) { return c && q.indexOf(C.norm(c)) >= 0; }).sort(function (x, y) { return y.length - x.length; })[0];
    var perNome = function (x, y) { return C.norm(x.name) < C.norm(y.name) ? -1 : 1; };
    // 1.29.0: gli ultimi pagamenti registrati (non quelli con una data nel futuro: sono da controllare)
    if (ha(/\bultim[aioe]\b.*\b(pagament|incass|versament|ricevut)/)) {
      var ixu = L.indice(db), ult = db.pagamenti.filter(function (p) { return p.data <= today; }).sort(function (x, y) { return x.data < y.data ? 1 : x.data > y.data ? -1 : x.id < y.id ? 1 : -1; });
      var conRic = ha(/\bricevut[ae]\b/); // 1.30.0: «l'ultima ricevuta»: with the numbers
      return risposta(ult.length ? (conRic ? 'Ultime ricevute' : 'Ultimi pagamenti') : 'Nessun pagamento registrato', elenco(ult, 10, function (p) { var e = ixu.perId[p.iscrizioneId], al = e ? ixu.allieve[e.allievaId] : null; return { t: (conRic && p.ricevuta ? 'n. ' + p.ricevuta + ' · ' : '') + C.isoToIt(p.data) + ' · ' + (al ? al.name : '?') + ' · ' + euro(p.importo) + ' · ' + p.metodo, vai: al ? 'allieva/' + al.id : 'pagamenti' }; }),
        [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // 1.29.0: chi deve pagare, chi non ha pagato niente, chi ha dato solo un acconto; anche per un corso
    var niente = ha(NIENTE), acconto = ha(ACCONTO), debito = ha(DEBITO);
    if (niente || acconto || debito) {
      var incC = L.daIncassare(db).righe.filter(function (x) { return !corsoD || C.norm(x.iscrizione.corso) === C.norm(corsoD); });
      var quali = niente ? incC.filter(function (x) { return x.conto.pagato <= 0.005; }) : acconto ? incC.filter(function (x) { return x.conto.pagato > 0.005; }) : incC;
      var totQ = Math.round(quali.reduce(function (t, x) { return t + x.conto.residuo; }, 0) * 100) / 100, nelCorso = corsoD ? ' nel corso ' + corsoD : '';
      var sollN = corsoD || niente || acconto ? 0 : L.elencoSolleciti(db, today, { contatto: 'fare' }).conTelefono; // the messages for everyone, one at a time (a course or a part: from the list)
      var cosa = niente ? (quali.length === 1 ? 'iscrizione senza nessun pagamento' : 'iscrizioni senza nessun pagamento') : acconto ? (quali.length === 1 ? 'iscrizione pagata in parte' : 'iscrizioni pagate in parte') : quali.length === 1 ? 'iscrizione con qualcosa da pagare' : 'iscrizioni con qualcosa da pagare';
      return risposta(quali.length ? quali.length + ' ' + cosa + nelCorso + ': ' + euro(totQ) + ' da incassare' : (niente ? 'Nessuna iscrizione senza pagamenti' : acconto ? 'Nessuna iscrizione pagata in parte' : 'Non c\'è niente da incassare') + nelCorso,
        elenco(quali.slice().sort(function (x, y) { return y.conto.residuo - x.conto.residuo; }), 12, function (x) { return { t: nome(x) + ' · ' + (x.iscrizione.corso || 'corso da definire') + ' · deve ' + euro(x.conto.residuo) + (x.conto.pagato > 0.005 ? ' (ha dato ' + euro(x.conto.pagato) + ')' : ''), vai: 'iscrizione/' + x.iscrizione.id }; }),
        [{ etichetta: 'Apri l\'elenco', vai: 'pagamenti/da-incassare' }].concat(sollN ? [{ etichetta: 'Avvisa per la quota (' + sollN + ')', avvisa: 'pagamento' }] : []));
    }
    // 1.29.0: minorenni e maggiorenni (senza il genitore: la domanda «chi non ha…» qui sopra)
    if (ha(/\b(minorenn|maggiorenn)/) && !ha(/\b(sorell|fratell|famigli|figli|stesso genitore|stessa famiglia|stesso telefono|stessa mamma|stesso papa)/)) { // 1.31.0: «sorelle minorenni» is about the families
      var att = attive(), magg = ha(/\bmaggiorenn/) && !ha(/\bminorenn/);
      var lista = att.filter(function (a) { return magg ? C.isIso(a.nascita) && !L.minorenne(a, today) : L.minorenne(a, today); }).sort(perNome);
      return risposta(plurale(lista.length, magg ? 'allieva maggiorenne' : 'allieva minorenne', magg ? 'allieve maggiorenni' : 'allieve minorenni') + ' su ' + att.length,
        elenco(lista, 15, function (a) { return { t: a.name + (C.isIso(a.nascita) ? ' · ' + C.ageOn(a.nascita, today) + ' anni' : ''), vai: 'allieva/' + a.id }; }), [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // 1.29.0: le iscrizioni da completare (senza tipo o data di inizio), con il lavoro pronto
    if (ha(/\b(da completare|incomplet|senza (il )?tipo|senza (la )?data di inizio|complet\w* le iscrizioni)/)) {
      var pcq = L.pianoCompleta(db);
      return risposta(pcq.totale ? plurale(pcq.totale, 'iscrizione da completare', 'iscrizioni da completare') + ' (senza tipo o data di inizio)' : 'Tutte le iscrizioni aperte hanno tipo e data di inizio',
        pcq.gruppi.map(function (g) { return { t: (g.corso || 'senza corso') + ': ' + g.n + (g.tipo ? ' · propongo ' + g.tipo.toLowerCase() : ''), vai: 'iscrizioni' }; }),
        pcq.totale ? [{ etichetta: 'Completale ora', fai: 'completa' }, { etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }] : [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
    }
    // 1.29.0: chi c'è da avvisare, con i messaggi pronti
    if (ha(/\b(chi|a chi|quali|quante|quanti)\b.*\b(avvis|scriver|chiamar|contattar|sollecit|ricordar)/) || ha(/\bmessaggi (da|per)\b/)) {
      var pr = L.elencoPromemoria(db, today, { contatto: 'fare', ora: opz.ora }).righe, STATO_BREVE = { 'SCADUTO': 'scaduto', 'IN SCADENZA': 'in scadenza', 'MANCANTE': 'mancante', 'IN ATTESA': 'da consegnare' };
      var abbN = pr.filter(function (x) { return x.tipo === 'abbonamento' && x.tel; }).length, cerN = pr.filter(function (x) { return x.tipo === 'certificato' && x.tel; }).length;
      return risposta(pr.length ? plurale(pr.length, 'avviso da mandare', 'avvisi da mandare') : 'Non c\'è nessuno da avvisare adesso',
        elenco(pr, 12, function (x) { return { t: x.allieva.name + ' · ' + x.tipo + ' ' + (STATO_BREVE[x.stato] || '') + (x.tel ? '' : ' · senza telefono'), vai: 'allieva/' + x.allieva.id }; }),
        [abbN ? { etichetta: 'Abbonamenti (' + abbN + ')', avvisa: 'abbonamento' } : null, cerN ? { etichetta: 'Certificati (' + cerN + ')', avvisa: 'certificato' } : null, { etichetta: 'Apri i promemoria', vai: 'promemoria' }].filter(Boolean),
        { messaggi: pr.filter(function (x) { return x.tel; }).slice(0, 3).map(function (x) { return { chi: x.allieva.name, tel: x.tel, testo: x.testo, tipo: x.tipo, rif: x.rif }; }) });
    }
    // 1.29.0: le iscritte nuove (da quando sono nell'archivio); 1.30.0: anche di un mese per nome («chi si è iscritta a novembre?»)
    var mcI = meseCitato(q, today, false), iscrMese = mcI && ha(/\b(iscritt\w*|arrivat\w*|nuov[ae])\b/) && !ha(/\b(scad|rinnov|certific|complean|pagat|incass|corso)/);
    if (iscrMese || ha(/\b(nuov[ae]|da poco|appena|ultim[ae])\b.*\b(allieve|allieva|iscritt|arrivat)/) || ha(/\b(allieve|allieva|iscritt\w*|arrivat\w*)\b.*\b(nuov[ae]|da poco|di recente)\b/)) {
      var daQ = iscrMese ? mcI.da : ha(/\bsettimana\b/) ? L.piuGiorni(today, -7) : ha(/\bmese\b/) ? today.slice(0, 7) + '-01' : L.piuGiorni(today, -30);
      var aQ = iscrMese ? L.piuGiorni(C.addMonths(mcI.da, 1), -1) : today;
      var nuove = attive().filter(function (a) { var c = C.str(a.creata).slice(0, 10); return c >= daQ && c <= aQ; }).sort(function (x, y) { return x.creata < y.creata ? 1 : -1; });
      if (iscrMese) return risposta(nuove.length ? plurale(nuove.length, 'allieva inserita', 'allieve inserite') + ' a ' + mcI.nome + ' ' + mcI.anno : 'Nessuna allieva inserita a ' + mcI.nome + ' ' + mcI.anno,
        elenco(nuove, 15, function (a) { return { t: a.name + ' · inserita il ' + C.isoToIt(C.str(a.creata).slice(0, 10)), vai: 'allieva/' + a.id }; }), [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
      var unGiorno = nuove.length > 15 && nuove.every(function (a) { return C.str(a.creata).slice(0, 10) === C.str(nuove[0].creata).slice(0, 10); });
      return risposta(nuove.length ? plurale(nuove.length, 'allieva nuova', 'allieve nuove') + ' dal ' + C.isoToIt(daQ) : 'Nessuna allieva nuova dal ' + C.isoToIt(daQ),
        (unGiorno ? [{ t: 'Sono state inserite tutte il ' + C.isoToIt(C.str(nuove[0].creata).slice(0, 10)) + ': è il giorno dell\'importazione.' }] : []).concat(elenco(nuove, 12, function (a) { return { t: a.name + ' · inserita il ' + C.isoToIt(C.str(a.creata).slice(0, 10)), vai: 'allieva/' + a.id }; })),
        [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // 1.29.0: chi ha più di un'iscrizione aperta
    if (ha(/\b(due|2|piu) (iscrizion|cors)/) || ha(/\bpiu di un(a)? (corso|iscrizione)/)) {
      var piu = attive().map(function (a) { return { a: a, ap: L.iscrizioniDi(db, a.id).filter(function (e) { return !e.annullata && !e.storica; }) }; }).filter(function (x) { return x.ap.length >= 2; });
      return risposta(piu.length ? plurale(piu.length, 'allieva con più iscrizioni aperte', 'allieve con più iscrizioni aperte') : 'Nessuna allieva ha più di un\'iscrizione aperta',
        elenco(piu, 15, function (x) { return { t: x.a.name + ' · ' + x.ap.map(function (e) { return e.corso || 'corso da definire'; }).join(', '), vai: 'allieva/' + x.a.id }; }), [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
    }
    // 1.29.0: le famiglie con più allieve (stesso genitore, o lo stesso telefono): sorelle, «Pacchetto Family»
    if (ha(/\b(sorell|fratell|famigli|figli|stesso genitore|stessa famiglia|stesso telefono|stessa mamma|stesso papa)/)) {
      var gr = {}, ord = [];
      attive().forEach(function (a) { var k = a.genitore ? 'g:' + C.norm(a.genitore) : tel(a) ? 't:' + String(tel(a)).replace(/\D/g, '') : ''; if (!k) return; if (!gr[k]) { gr[k] = []; ord.push(k); } gr[k].push(a); });
      var fam = ord.map(function (k) { return gr[k]; }).filter(function (g) { return g.length >= 2; });
      return risposta(fam.length ? plurale(fam.length, 'famiglia con più allieve', 'famiglie con più allieve') : 'Nessuna famiglia ha più di un\'allieva',
        elenco(fam, 15, function (g) { return { t: (g[0].genitore || 'tel. ' + tel(g[0])) + ': ' + g.map(function (a) { return a.name; }).join(', '), vai: 'allieva/' + g[0].id }; }), [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // 1.29.0: la versione del programma, e dove sono i dati
    if (ha(/\b(versione|aggiornat\w*)\b/) && !ha(/\b(iscrizion|allieva|certific|pagament)/)) {
      return risposta('Versione ' + (opz.versione || 'sconosciuta'), [{ t: opz.aggiornamento ? 'C\'è la versione ' + opz.aggiornamento.versione + '.' : 'Le versioni nuove si installano aprendo il file nuovo: il programma chiede se aggiornare quello installato.' }, { t: 'Che cosa c\'è di nuovo: Altro › Aggiornamenti e novità.' }],
        [{ etichetta: 'Aggiornamenti e novità', vai: 'aggiornamenti' }]);
    }
    if (ha(/\bdove\b.*\b(dati|archivio|cartella)\b/) || ha(/\bcartella (dei|del) (dati|programma)\b/)) {
      return risposta('I dati sono su questo computer', [{ t: opz.cartella ? 'Cartella: ' + opz.cartella : 'Nella cartella «Gym Art Segreteria» dentro Documenti.' }, { t: 'Lì ci sono l\'archivio, il registro delle modifiche e le copie automatiche; il programma non manda niente su internet.' }],
        [{ etichetta: 'Dati su questo computer', vai: 'impostazioni/dati' }]);
    }
    // 1.29.0: what a course costs (the price list of Settings), for the parent on the phone: «quanto costa il corso Base?», «prezzi», «tariffa trimestrale»
    if (ha(/\b(quanto costa|quanto costano|quanto viene|costo|costi|prezzo|prezzi|tariff\w*|listino)\b/)) {
      var tar = db.tariffario || [], pkT = corsoD ? L.pacchettiDelCorso(db, corsoD) : tar.filter(function (t) { var n = C.norm(t.pacchetto); return q.split(' ').some(function (w) { return w.length >= 6 && n.split(' ').some(function (x) { return x.length >= 6 && x.slice(0, 6) === w.slice(0, 6) && x !== 'giorni'; }); }); });
      var tipiT = L.TIPI.filter(function (t) { return ({ Mensile: /\b(mensil\w*|un mese|al mese|ogni mese)\b/, Trimestrale: /\b(trimest\w*|tre mesi|3 mesi)\b/, Annuale: /\b(annual\w*|un anno|all anno|tutto l anno|intero anno)\b/ }[t.nome] || /$^/).test(q); });
      var mostra = pkT.length ? pkT : tar;
      if (!mostra.length) return risposta('Il tariffario è vuoto', [{ t: 'I prezzi si scrivono in Altro, Impostazioni, «Stagione, corsi e tariffe».' }], [{ etichetta: 'Apri le tariffe', vai: 'impostazioni/tariffe' }]);
      return risposta(pkT.length ? 'Prezzi ' + (corsoD ? 'del corso ' + corsoD : 'del corso') : 'Prezzi dei corsi', mostra.map(function (t) {
        var prezzi = (tipiT.length ? tipiT : L.TIPI).filter(function (x) { return typeof t[x.nome] === 'number'; }).map(function (x) { return x.nome.toLowerCase() + ' ' + euro(t[x.nome]); });
        return { t: t.pacchetto + ' · ' + t.frequenza + ': ' + (prezzi.join(', ') || 'prezzo non scritto') + (t.iscrizione ? ' · quota di iscrizione ' + euro(t.iscrizione) : '') };
      }), [{ etichetta: 'Apri le tariffe', vai: 'impostazioni/tariffe' }]);
    }
    // 1.29.0: the fees of the enrollments: the average (in all and by course), the highest and the lowest
    if (ha(/\bquot[ae]\b/) && ha(/\b(media|medie|piu alta|piu alte|piu bassa|piu basse|massima|minima|alta|alte|bassa|basse)\b/)) {
      var qq = db.iscrizioni.filter(function (e) { return !e.annullata && !e.storica && (!corsoD || C.norm(e.corso) === C.norm(corsoD)); }).map(function (e) { return { e: e, q: L.quotaDovuta(db, e) }; }).filter(function (x) { return typeof x.q === 'number' && x.q > 0; });
      if (!qq.length) return risposta('Nessuna quota scritta' + (corsoD ? ' nel corso ' + corsoD : ''), [], [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
      var ixQ = L.indice(db);
      if (ha(/\b(media|medie)\b/)) {
        var perC = {}; qq.forEach(function (x) { var k = x.e.corso || 'corso da definire'; (perC[k] = perC[k] || []).push(x.q); });
        var med = function (l) { return Math.round(l.reduce(function (a, b) { return a + b; }, 0) / l.length * 100) / 100; };
        return risposta('Quota media' + (corsoD ? ' del corso ' + corsoD : '') + ': ' + euro(med(qq.map(function (x) { return x.q; }))) + ' (' + plurale(qq.length, 'iscrizione', 'iscrizioni') + ')',
          corsoD ? [] : Object.keys(perC).sort().map(function (k) { return { t: k + ': ' + euro(med(perC[k])) + ' (' + perC[k].length + ')' }; }), [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
      }
      var bassa = ha(/\b(piu bassa|piu basse|minima|bassa|basse)\b/);
      qq.sort(function (x, y) { return bassa ? x.q - y.q : y.q - x.q; });
      return risposta('Le quote più ' + (bassa ? 'basse' : 'alte') + (corsoD ? ' del corso ' + corsoD : ''), elenco(qq, 8, function (x) { var al = ixQ.allieve[x.e.allievaId]; return { t: (al ? al.name : '?') + ' · ' + (x.e.corso || 'corso da definire') + (x.e.tipo ? ' ' + x.e.tipo.toLowerCase() : '') + ' · ' + euro(x.q), vai: 'iscrizione/' + x.e.id }; }),
        [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
    }
    // 1.27.0: incassi di un periodo (oggi, questa settimana, questo mese, il mese scorso, un mese per nome); 1.29.0: della stagione, e con un metodo («in contanti», «con il POS»)
    var mesePar = MESI.filter(function (m) { return q.indexOf(m) >= 0; })[0], metodoP = metodoCitato(db, q);
    // 1.30.0: «ho incassato con i rinnovi a ottobre» is about the past (the takings); «quanto incasso a dicembre con i rinnovi» about what is coming
    var passato = ha(/\b(incassat\w*|preso|presi|entrat[oi]|pagat[oi]|ricevut[oi]|ho incassato|abbiamo incassato)\b/);
    var periodoP = mesePar || ha(/\b(oggi|ieri|settimana|questo mese|mese scorso|mese passato|stagione|da settembre)\b/);
    // «chiusura di cassa», «quanto c'è in cassa»: the cash, of today unless another period is said
    var cassa = ha(/\bcassa\b/) && !metodoP;
    if (cassa) metodoP = ((db.liste && db.liste.metodi) || []).filter(function (m) { return /^contant/i.test(m); })[0] || '';
    if (!(ha(/\brinnov/) && !passato) && (cassa || (ha(/\b(incass|incasso|entrate|pagament|pagato|pagati|preso|presi|soldi|ricevut[ae]\b)/) && (periodoP || metodoP)) || (ha(/\b(paga|pagano)\b/) && metodoP) || (metodoP && periodoP && !ha(/\bverific/)))) { // «bonifici di ottobre», «contanti di oggi», «chi paga con bonifico»
      var da = '', a2 = today, nomeP = '';
      if (ha(/\b(stagione|da settembre)\b/) || (metodoP && !cassa && !mesePar && !ha(/\b(oggi|ieri|settimana|mese)\b/))) { var st = L.stagioneDi(today); da = st.slice(0, 4) + '-08-01'; nomeP = 'nella stagione ' + st; }
      else if (ha(/\boggi\b/) || (cassa && !periodoP)) { da = today; nomeP = 'oggi'; }
      else if (ha(/\bieri\b/)) { da = a2 = L.piuGiorni(today, -1); nomeP = 'ieri'; }
      else if (ha(/\bsettimana\b/)) { da = L.piuGiorni(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7)); nomeP = 'questa settimana'; }
      else if (ha(/\b(mese scorso|mese passato)\b/)) { var pm = C.addMonths(today.slice(0, 7) + '-01', -1); da = pm; a2 = L.piuGiorni(today.slice(0, 7) + '-01', -1); nomeP = 'a ' + MESI[+pm.slice(5, 7) - 1]; }
      else if (mesePar) { var mi = MESI.indexOf(mesePar) + 1, anno = +today.slice(0, 4); if (mi > +today.slice(5, 7)) anno--; da = anno + '-' + (mi < 10 ? '0' : '') + mi + '-01'; a2 = L.piuGiorni(C.addMonths(da, 1), -1); nomeP = 'a ' + mesePar + ' ' + anno; }
      else { da = today.slice(0, 7) + '-01'; nomeP = 'questo mese'; }
      var pg = db.pagamenti.filter(function (p) { return p.data >= da && p.data <= a2 && (!metodoP || p.metodo === metodoP); }), tot = 0, perMetodo = {};
      pg.forEach(function (p) { tot += p.importo; perMetodo[p.metodo] = (perMetodo[p.metodo] || 0) + p.importo; });
      var ix = L.indice(db), conMetodo = metodoP ? ' ' + (/^contant/i.test(metodoP) ? 'in contanti' : 'con ' + (/^pos$/i.test(metodoP) ? 'il POS' : metodoP.toLowerCase())) : '';
      if (ha(/\bricevut[ae]\b/)) return risposta(plurale(pg.length, 'ricevuta', 'ricevute') + ' ' + nomeP + conMetodo + ' (' + euro(Math.round(tot * 100) / 100) + ')', // 1.30.0: one receipt for each payment
        elenco(pg.slice().sort(function (x, y) { return x.data < y.data ? 1 : -1; }), 12, function (p) { var e = ix.perId[p.iscrizioneId], al = e ? ix.allieve[e.allievaId] : null; return { t: (p.ricevuta ? 'n. ' + p.ricevuta + ' · ' : '') + C.isoToIt(p.data) + ' · ' + (al ? al.name : '?') + ' · ' + euro(p.importo), vai: al ? 'allieva/' + al.id : 'pagamenti' }; }),
        [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
      return risposta('Incassati ' + nomeP + conMetodo + ': ' + euro(Math.round(tot * 100) / 100) + ' (' + plurale(pg.length, 'pagamento', 'pagamenti') + ')',
        (metodoP ? [] : Object.keys(perMetodo).map(function (m) { return { t: m + ': ' + euro(Math.round(perMetodo[m] * 100) / 100) }; })).concat(elenco(pg.slice().sort(function (x, y) { return x.data < y.data ? 1 : -1; }), metodoP ? 15 : 8, function (p) { var e = ix.perId[p.iscrizioneId], al = e ? ix.allieve[e.allievaId] : null; return { t: C.isoToIt(p.data) + ' · ' + (al ? al.name : '?') + ' · ' + euro(p.importo) + (metodoP ? '' : ' · ' + p.metodo), vai: al ? 'allieva/' + al.id : undefined }; })),
        [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // che cosa fare
    if ((ha(/\b(cosa|che cosa|che)\b.*\b(fare|faccio|devo|controllare)\b/) || ha(/\b(priorita|consigli|consigliami|oggi|adesso|da fare|urgent)/)) && !ha(/\b(complean|auguri|compi|scad|rinnov|certific)/)) {
      var cons = consigli(db, today, opz);
      return risposta('Consigli per oggi', cons.slice(0, 5).map(function (c) { return { t: c.etichetta + ': ' + c.titolo, vai: (c.azioni[0] || {}).vai }; }), [{ etichetta: 'Apri l\'assistente', vai: 'assistente' }]);
    }
    // certificati
    if (ha(/\bcertific/) || ha(/\b(portare|portano|consegnare|consegnano)\b/) || /^(mancanti|mancante|i mancanti)$/.test(q)) {
      var ce = L.scadenzeCertificati(db, today), righe = [], azioni = [];
      var tutti = ha(/\bagonist|non agonist|ludic/);
      var mcC = periodoCitato(q, today); // 1.29.0: «certificati che scadono a dicembre»; 1.30.0: anche questo mese, questa settimana, la prossima…
      if (mcC && ha(/\b(scad|rinnov)/)) {
        var nelMese = L.elencoCertificati(db, today, {}).righe.filter(function (x) { var d = x.stato.scadenza; return d && d >= mcC.da && d <= mcC.a; })
          .sort(function (x, y) { return x.stato.scadenza < y.stato.scadenza ? -1 : 1; });
        return risposta(nelMese.length ? plurale(nelMese.length, 'certificato scade', 'certificati scadono') + ' ' + mcC.nome : 'Nessun certificato scade ' + mcC.nome,
          elenco(nelMese, 15, function (x) { return { t: nome(x) + ' · ' + C.isoToIt(x.stato.scadenza), vai: 'allieva/' + x.allieva.id }; }), [{ etichetta: 'Apri i certificati', vai: 'certificati' }]);
      }
      if (tutti && ha(/\b(chi|quali|elenco)\b/)) { // 1.29.0: «chi ha il certificato agonistico?»
        var tipoC = ha(/\bnon agonist/) ? 'Non Agonistico' : ha(/\bludic/) ? 'Ludico-motoria' : 'Agonistico', filtroC = { 'Agonistico': 'agonistico', 'Non Agonistico': 'non-agonistico', 'Ludico-motoria': 'ludico' }[tipoC];
        var conTipo = L.elencoCertificati(db, today, { tipo: tipoC }).righe;
        return risposta(plurale(conTipo.length, 'allieva', 'allieve') + ' con il certificato ' + tipoC.toLowerCase(), elenco(conTipo, 15, function (x) { return { t: nome(x) + (x.stato.scadenza ? ' · scade il ' + C.isoToIt(x.stato.scadenza) : ''), vai: 'allieva/' + x.allieva.id }; }),
          [{ etichetta: 'Apri l\'elenco', vai: 'certificati/' + filtroC }]);
      }
      if (ha(/\b(attesa|portare|portano|consegn)/) || ha(/\bdeve portare/)) {
        righe = elenco(ce.inAttesa, 10, function (x) { return { t: nome(x) + ' · entro il ' + C.isoToIt(x.stato.consegna) + ' (' + giorniTesto(x.stato.giorni) + ')', vai: 'allieva/' + x.allieva.id }; });
        azioni.push({ etichetta: 'Apri l\'elenco', vai: 'certificati/in-attesa' });
        return risposta(ce.inAttesa.length ? plurale(ce.inAttesa.length, 'allieva deve ancora portare il certificato', 'allieve devono ancora portare il certificato') : 'Nessuno deve portare il certificato adesso', righe, azioni);
      }
      if (ha(/\b(mancant|manca|mancano|senza)/) || /^(mancanti|mancante|i mancanti)$/.test(q)) {
        righe = elenco(ce.mancanti, 10, function (x) { return { t: nome(x) + (x.stato.ritardo ? ' · in ritardo di ' + plurale(x.stato.ritardo, 'giorno', 'giorni') : ''), vai: 'allieva/' + x.allieva.id }; });
        return risposta(ce.mancanti.length ? plurale(ce.mancanti.length, 'allieva senza certificato', 'allieve senza certificato') : 'Nessun certificato mancante', righe, [{ etichetta: 'Apri l\'elenco', vai: 'certificati/mancanti' }]);
      }
      // 1.29.0: «chi ha il certificato scaduto?»: only the expired ones
      if (ha(/\bscadut/) && !ha(/\b(in scadenza|scade|scadono|rinnov|tutti|tutte)\b/)) {
        righe = elenco(ce.scaduti, 15, function (x) { return { t: nome(x) + ' · scaduto ' + giorniTesto(x.stato.giorni) + (x.allieva && tel(x.allieva) ? '' : ' · senza telefono'), vai: 'allieva/' + x.allieva.id }; });
        return risposta(ce.scaduti.length ? plurale(ce.scaduti.length, 'certificato scaduto', 'certificati scaduti') : 'Nessun certificato scaduto', righe,
          ce.scaduti.length ? [{ etichetta: 'Apri «Da rinnovare»', vai: 'certificati/da-rinnovare' }] : []);
      }
      if (ha(/\b(scadut|scadenza|scade|scadono|rinnov)/) || !tutti) {
        var rin = ce.scaduti.concat(ce.inScadenza);
        righe = elenco(rin, 10, function (x) { return { t: nome(x) + ' · ' + (x.stato.giorni < 0 ? 'scaduto ' : 'scade ') + giorniTesto(x.stato.giorni), vai: 'allieva/' + x.allieva.id }; });
        var riep = [plurale(ce.scaduti.length, 'scaduto', 'scaduti'), plurale(ce.inScadenza.length, 'in scadenza', 'in scadenza'), plurale(ce.inAttesa.length, 'in attesa', 'in attesa'), plurale(ce.mancanti.length, 'mancante', 'mancanti')].join(' · ');
        return risposta('Certificati: ' + riep, righe, [{ etichetta: 'Da rinnovare', vai: 'certificati/da-rinnovare' }, { etichetta: 'Tutti i certificati', vai: 'certificati' }]);
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
    if (ha(/\bbonific/) && ha(/\b(ricevut|arrivat|quanti|quante|totale|incassat|fatti)\b/) && !ha(/\bverific/)) { // 1.29.0: the transfers received, not only those to check
      var ist = L.inizioStagione(db.impostazioni.stagione) || '', bon = db.pagamenti.filter(function (p) { return C.norm(p.metodo) === 'bonifico' && p.data >= ist && p.data <= today; });
      var bonM = bon.filter(function (p) { return p.data.slice(0, 7) === today.slice(0, 7); }), somma = function (l) { return Math.round(l.reduce(function (t, p) { return t + p.importo; }, 0) * 100) / 100; }, v0 = L.daVerificare(db);
      return risposta(plurale(bon.length, 'bonifico ricevuto', 'bonifici ricevuti') + (ist ? ' nella stagione' : '') + ': ' + euro(somma(bon)), [{ t: 'Questo mese: ' + bonM.length + ' (' + euro(somma(bonM)) + ')' }, { t: v0.n ? plurale(v0.n, 'da verificare sull\'estratto conto', 'da verificare sull\'estratto conto') + ' (' + euro(v0.totale) + ')' : 'Nessuno da verificare.' }],
        [{ etichetta: 'Apri i pagamenti', vai: 'pagamenti' }].concat(v0.n ? [{ etichetta: 'Bonifici da verificare', vai: 'pagamenti/verifica' }] : []));
    }
    if (ha(/\b(bonific|verific)/)) {
      var v = L.daVerificare(db);
      return risposta(v.n ? plurale(v.n, 'bonifico da verificare', 'bonifici da verificare') + ' (' + euro(v.totale) + ')' : 'Nessun bonifico da verificare',
        elenco(v.righe, 8, function (x) { return { t: (x.allieva ? x.allieva.name : '?') + ' · ' + euro(x.pagamento.importo) + ' · ' + C.isoToIt(x.pagamento.data), vai: 'pagamenti/verifica' }; }), [{ etichetta: 'Apri i bonifici', vai: 'pagamenti/verifica' }]);
    }
    if (ha(/\b(incass|incasso|soldi|entrate|guadagn|quanto abbiamo|fatturat)/) && !(ha(/\brinnov/) && periodoCitato(q, today) && !passato)) {
      var an = L.analisi(db, today, 'stagione'), inc2 = L.daIncassare(db), meseEur = Math.round(db.pagamenti.reduce(function (t, p) { return t + (p.data.slice(0, 7) === today.slice(0, 7) && p.data <= today ? p.importo : 0); }, 0) * 100) / 100; // 1.29.0: the month of today (the last of the season was August, still to come)
      return risposta('Incassi', [{ t: 'Questo mese: ' + euro(meseEur) }, { t: 'Nella stagione: ' + euro(an.incassiTot) + ' (' + plurale(an.incassiN, 'pagamento', 'pagamenti') + ')' }, { t: 'Ancora da incassare: ' + euro(inc2.totale) }],
        [{ etichetta: 'Apri i grafici', vai: 'analisi' }, { etichetta: 'Apri i pagamenti', vai: 'pagamenti' }]);
    }
    // compleanni (1.29.0: anche di un mese: prima «compleanni di dicembre» rispondeva sui rinnovi di dicembre)
    if (ha(/\b(complean|auguri)/) || (ha(/\banni\b/) && ha(/\b(compie|compiono)\b/))) {
      var mcB = meseCitato(q, today, true);
      if (mcB) {
        var nati = attive().filter(function (a) { return C.isIso(a.nascita) && +a.nascita.slice(5, 7) === mcB.n; }).sort(function (x, y) { return x.nascita.slice(8) < y.nascita.slice(8) ? -1 : 1; });
        return risposta(nati.length ? plurale(nati.length, 'compleanno', 'compleanni') + ' a ' + mcB.nome : 'Nessun compleanno a ' + mcB.nome, elenco(nati, 20, function (a) { return { t: a.name + ' · ' + (+a.nascita.slice(8)) + ' ' + mcB.nome + ' · compie ' + (mcB.anno - +a.nascita.slice(0, 4)) + ' anni', vai: 'allieva/' + a.id }; }));
      }
      if (ha(/\b(oggi|domani)\b/)) { // 1.30.0
        var dom = ha(/\bdomani\b/), cpO = L.compleanni(db, today, dom ? 1 : 0).filter(function (x) { return x.giorni === (dom ? 1 : 0); });
        return risposta(cpO.length ? plurale(cpO.length, 'compleanno', 'compleanni') + (dom ? ' domani' : ' oggi') : 'Nessun compleanno' + (dom ? ' domani' : ' oggi'), cpO.map(function (x) { return { t: x.allieva.name + ' · compie ' + x.eta + ' anni', vai: 'allieva/' + x.allieva.id }; }));
      }
      var giorniB = ha(/\bsettimana\b/) ? 7 : 14, cpB = L.compleanni(db, today, giorniB);
      return risposta(cpB.length ? 'Compleanni nei prossimi ' + giorniB + ' giorni' : 'Nessun compleanno nei prossimi ' + giorniB + ' giorni', cpB.map(function (x) { return { t: x.allieva.name + ' · ' + (x.giorni === 0 ? 'oggi' : 'tra ' + x.giorni + ' giorni') + ' · ' + x.eta + ' anni', vai: 'allieva/' + x.allieva.id }; }));
    }
    // 1.30.0: by age: «chi ha più di 15 anni?», «meno di 8 anni», «tra 6 e 8 anni», «di 10 anni», «nate nel 2015» (the gym's categories)
    var etaQ = etaCitata(q);
    if (etaQ) {
      var perEta = attive().filter(function (a) { return etaGiusta(etaQ, a, today); })
        .filter(function (a) { return !corsoD || L.iscrizioniDi(db, a.id).some(function (e) { return !e.annullata && !e.storica && C.norm(e.corso) === C.norm(corsoD); }); })
        .sort(function (x, y) { return x.nascita < y.nascita ? 1 : -1; });
      return risposta(perEta.length ? plurale(perEta.length, 'allieva', 'allieve') + ' ' + (perEta.length === 1 ? etaQ.d1 : etaQ.d2) + (corsoD ? ' nel corso ' + corsoD : '') : 'Nessuna allieva ' + etaQ.d1 + (corsoD ? ' nel corso ' + corsoD : ''),
        elenco(perEta, 20, function (a) { var ap = L.iscrizioniDi(db, a.id).filter(function (e) { return !e.annullata && !e.storica; }).map(function (e) { return e.corso; }).filter(Boolean); return { t: a.name + ' · ' + C.ageOn(a.nascita, today) + ' anni' + (ap.length ? ' · ' + ap.join(', ') : ''), vai: 'allieva/' + a.id }; }),
        [{ etichetta: 'Apri le allieve', vai: 'allieve' }]);
    }
    // 1.30.0: by type of subscription: «chi ha l'abbonamento annuale?», «quante trimestrali ci sono?»
    var tipoQ = TIPI_DOMANDA.filter(function (t) { return t.re.test(q); })[0];
    if (tipoQ && !ha(/\b(costa|costano|prezz|tariff|scad|rinnov|quota|quote)/)) {
      var conTipo = db.iscrizioni.filter(function (e) { return !e.annullata && !e.storica && e.tipo === tipoQ.nome && (!corsoD || C.norm(e.corso) === C.norm(corsoD)); }).map(function (e) { return { e: e, a: L.indice(db).allieve[e.allievaId] }; }).filter(function (x) { return x.a && !x.a.archiviata; })
        .sort(function (x, y) { return C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1; });
      var plur = tipoQ.nome.toLowerCase().replace(/e$/, 'i');
      return risposta(conTipo.length ? plurale(conTipo.length, 'abbonamento ' + tipoQ.nome.toLowerCase(), 'abbonamenti ' + plur) + (corsoD ? ' nel corso ' + corsoD : '') : 'Nessun abbonamento ' + tipoQ.nome.toLowerCase() + (corsoD ? ' nel corso ' + corsoD : ''),
        elenco(conTipo, 20, function (x) { var s1 = L.statoIscrizione(db, x.e, today); return { t: x.a.name + ' · ' + (x.e.corso || 'corso da definire') + (s1.scadenza ? ' · scade il ' + C.isoToIt(s1.scadenza) : ''), vai: 'iscrizione/' + x.e.id }; }),
        [{ etichetta: 'Apri le iscrizioni', vai: 'iscrizioni' }]);
    }
    // 1.30.0: the subscriptions that end in a period («chi rinnova a dicembre?», «abbonamenti che scadono la prossima settimana»), with what the renewals bring
    var perS = periodoCitato(q, today);
    if (perS && ha(/\b(rinnov|scad|abbonament|finisc)/) && !ha(/\bcertific/) && !passato) {
      var ixS = L.indice(db), finS = db.iscrizioni.filter(function (e) { return !e.annullata && !e.storica && ixS.allieve[e.allievaId] && !ixS.allieve[e.allievaId].archiviata && (!tipoQ || e.tipo === tipoQ.nome) && (!corsoD || C.norm(e.corso) === C.norm(corsoD)); })
        .map(function (e) { return { e: e, a: ixS.allieve[e.allievaId], s: L.statoIscrizione(db, e, today) }; }).filter(function (x) { return x.s.scadenza && x.s.scadenza >= perS.da && x.s.scadenza <= perS.a; })
        .sort(function (x, y) { return x.s.scadenza < y.s.scadenza ? -1 : x.s.scadenza > y.s.scadenza ? 1 : C.norm(x.a.name) < C.norm(y.a.name) ? -1 : 1; });
      var euroS = Math.round(finS.reduce(function (t, x) { return t + (L.quotaDovuta(db, x.e) || 0); }, 0) * 100) / 100;
      return risposta(finS.length ? plurale(finS.length, 'abbonamento scade', 'abbonamenti scadono') + ' ' + perS.nome + (euroS ? ': se rinnovano tutte, ' + euro(euroS) : '') : 'Nessun abbonamento scade ' + perS.nome,
        elenco(finS, 15, function (x) { return { t: x.a.name + ' · ' + (x.e.corso || 'corso da definire') + ' · ' + (x.e.tipo || '').toLowerCase() + ' · ' + C.isoToIt(x.s.scadenza), vai: 'iscrizione/' + x.e.id }; }),
        [{ etichetta: 'Apri le scadenze', vai: 'scadenze' }]);
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
    var man = dalManuale(q, opz);
    if (man) return man;
    return risposta('Non ho capito la domanda', [{ t: 'Conosco scadenze, certificati, incassi (di oggi, di un mese, della stagione, in contanti o con bonifico, la cassa), chi deve pagare (anche solo un acconto o niente), i prezzi dei corsi, chi viene in un giorno, chi non ha un dato, minorenni, famiglie, compleanni, i corsi e le singole persone (quanto devono pagare, il certificato, l\'abbonamento, il telefono, il genitore, l\'età), e le istruzioni del manuale. Dopo una domanda su una persona puoi continuare: «e il certificato?».' }, { t: 'Prova con una di queste domande, oppure scrivi il nome di una persona.' }],
      [{ etichetta: 'Apri il manuale', vai: 'guida' }], { tipo: 'non-capito', suggerimenti: ESEMPI });
  }

  var Assistente = { consigli: consigli, lavori: lavori, rispondi: rispondi, ESEMPI: ESEMPI, URGENZA: URGENZA, ETICHETTA_URGENZA: ETICHETTA_URGENZA };
  if (typeof module !== 'undefined' && module.exports) module.exports = Assistente; else root.Assistente = Assistente;
})(typeof window !== 'undefined' ? window : this);
