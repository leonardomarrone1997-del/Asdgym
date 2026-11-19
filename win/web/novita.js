/* Gym Art Segreteria - le novità di ogni versione.
   Si vedono: nella finestra "Novità" che compare dopo un aggiornamento, nella pagina "Aggiornamenti e novità" e, prima di aggiornare, nell'avviso della versione nuova
   (il file di pubblicazione prende da qui le novità della versione che pubblica: tools/pubblica.js).
   Ogni voce dice che cosa si può fare da oggi: t = titolo, d = spiegazione, vai = la pagina del programma in cui provarlo (facoltativa).
   Si scrive in italiano semplice, per chi lavora in segreteria: niente parole tecniche. Si aggiunge in cima una versione nuova a ogni rilascio. */
(function (root) {
  'use strict';
  var NOVITA = [
    { v: '1.17.0', data: '2026-11-19', titolo: 'Il logo si muove, aggiornamenti automatici e un assistente', voci: [
      { t: 'Il logo della palestra, nitido e animato', d: 'Il logo ASD Gym Art è stato ridisegnato in vettoriale: resta nitido a ogni misura. Si muove al passaggio del mouse, quando il programma si apre, mentre salvi e quando lo chiudi. Con il movimento «Spento» sta fermo.', vai: 'impostazioni/aspetto' },
      { t: 'Chiudi il programma', d: 'In fondo al menu c\'è «Chiudi il programma»: salva l\'ultima copia dei dati, saluta e si ferma.' },
      { t: 'Aggiornamenti automatici', d: 'Quando c\'è una versione nuova il programma te lo dice e ti fa scegliere: aggiornare adesso, più tardi o saltarla. I dati non si toccano.', vai: 'aggiornamenti' },
      { t: 'L\'assistente', d: 'Ti dice che cosa fare adesso, che cosa controllare e quali messaggi mandare. Puoi anche chiedergli cose in italiano. Lavora sul computer, senza internet.', vai: 'assistente' },
      { t: 'Questa finestra delle novità', d: 'Dopo ogni aggiornamento vedi qui che cosa è cambiato e puoi provarlo subito. Le trovi sempre in «Aggiornamenti e novità».', vai: 'aggiornamenti' }
    ], correzioni: [] },
    { v: '1.16.0', data: '2026-11-19', titolo: 'Certificato in attesa, visita guidata e manuale', voci: [
      { t: 'Il certificato può arrivare dopo', d: 'Per ogni iscrizione serve il certificato medico, ma spesso lo si porta dopo qualche giorno: chi si iscrive senza risulta «in attesa» (15 giorni, si cambiano in Impostazioni) e poi «manca». Nel modulo di iscrizione scegli «Lo porta dopo» o «Lo ha portato adesso».', vai: 'scadenze/cert-attesa' },
      { t: 'Visita guidata e manuale', d: 'Il punto interrogativo in alto apre il manuale con i passi di ogni compito. La visita guidata ti porta nelle pagine principali e si può rifare quando vuoi.', vai: 'tutorial' },
      { t: 'Grafici e rinnovi dei prossimi mesi', d: 'Una pagina con i grafici e la tabella dei rinnovi in arrivo, per essere pronti ai trimestrali di dicembre e di marzo e alla nuova stagione di settembre.', vai: 'analisi' },
      { t: 'Più dettagli fermando il mouse', d: 'Se fermi il mouse su una riga, una tessera o una voce del menu compaiono più dettagli e le azioni rapide.' },
      { t: 'I numeri nel menu', d: 'Accanto a Scadenze, Certificati e Pagamenti vedi quante cose aspettano.' }
    ], correzioni: ['Registra certificato: dalla lista delle scadenze si scrive tipo e date senza dover caricare il documento.'] },
    { v: '1.15.0', data: '', titolo: 'Certificati con scanner, WhatsApp e logo', voci: [
      { t: 'Certificato medico con il documento', d: 'Dalla scheda dell\'allieva scansioni il certificato con lo scanner, allega un file o lo fotografi dal telefono. Il tipo (agonistico o non agonistico) è sempre in vista.', vai: 'certificati' },
      { t: 'Avvisi ai genitori su WhatsApp', d: 'Un messaggio pronto per ogni situazione (abbonamento in scadenza o scaduto, certificato in scadenza, scaduto o mancante), da controllare e cambiare prima di inviare.', vai: 'scadenze' },
      { t: 'Il logo della palestra', d: 'Il logo si può mostrare nel menu e come sfondo sfocato, scegliendo in Impostazioni.', vai: 'impostazioni/aspetto' }
    ], correzioni: [] },
    { v: '1.14.0', data: '', titolo: 'Ricerca veloce e un solo pulsante per iscrivere', voci: [
      { t: 'Una sola «Nuova iscrizione»', d: 'Allieva nuova o già presente: un solo modulo in alto, che salva allieva e iscrizione insieme.' },
      { t: 'Ricerca veloce con le sezioni', d: 'La casella in alto a sinistra (Ctrl + K) trova anche le pagine e le loro parti, per esempio «verifica» o «copie».' },
      { t: 'Scadenze in schede', d: 'Le liste delle scadenze sono raccolte in schede: una alla volta, con il numero accanto.', vai: 'scadenze' }
    ], correzioni: [] }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = NOVITA; else root.NOVITA = NOVITA;
})(typeof window !== 'undefined' ? window : this);
