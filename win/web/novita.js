/* Gym Art Segreteria - le novità di ogni versione.
   Si vedono: nella finestra "Novità" che compare dopo un aggiornamento, nella pagina "Aggiornamenti e novità" e, prima di aggiornare, nell'avviso della versione nuova
   (il file di pubblicazione prende da qui le novità della versione che pubblica: tools/pubblica.js).
   Ogni voce dice che cosa si può fare da oggi: t = titolo, d = spiegazione, vai = la pagina del programma in cui provarlo (facoltativa).
   Si scrive in italiano semplice, per chi lavora in segreteria: niente parole tecniche. Si aggiunge in cima una versione nuova a ogni rilascio. */
(function (root) {
  'use strict';
  var NOVITA = [
    { v: '1.25.1', data: '2026-11-25', titolo: 'Meno da scrivere, meno da leggere', voci: [
      { t: 'La nuova iscrizione si compila quasi da sola', d: 'Scelto il corso, il programma mette i giorni, l\'orario e l\'abbonamento che hanno quasi tutte le allieve di quel corso, e lo scrive sotto. Si cambiano con un clic. La tabella degli orari nelle Preferenze non serve più: resta solo per chi vuole proporre altro.', vai: 'iscrizione/nuova' },
      { t: 'La scheda dell\'allieva è più corta', d: 'Tolte le righe che ripetevano le stesse cose: quanto resta da pagare si legge in «Da fare per lei» e nelle iscrizioni, senza una riga in più. Le note hanno solo il titolo e «Aggiungi una nota» finché non ne scrivi una.', vai: 'allieve' },
      { t: 'Impostazioni più corte', d: 'La visita guidata si ricomincia dal Manuale (il pulsante «?» in alto); la nuova stagione sta in «Altro».', vai: 'impostazioni' }
    ], correzioni: ['Controllate tutte le pagine a cinque larghezze di schermo, in tutti gli stili e con il testo grande: nelle tessere di Home il numero non finisce più sotto l\'icona.', 'I giorni della settimana nella nuova iscrizione stanno su una riga.', 'Alt + P con una finestra già aperta non ne apre un\'altra sopra.'] },
    { v: '1.25.0', data: '2026-11-25', titolo: 'Più ordinato e più semplice: la scheda dell\'allieva al centro', voci: [
      { t: 'La barra in alto: Indietro, Home e dove sei', d: 'In alto a sinistra ci sono «Indietro» (torna alla pagina di prima) e «Home», e accanto il percorso, per esempio «Allieve › Rossi Giulia»: un clic su «Allieve» torna all\'elenco. A destra, sempre a portata, «Registra pagamento» e «Nuova iscrizione».', vai: 'inizio' },
      { t: 'La scheda dell\'allieva fa tutto', d: 'Sotto il nome: «Iscrivi a un corso», «Registra pagamento», «Registra certificato», «WhatsApp». Poi «Da fare per lei»: il certificato che manca o scade, l\'abbonamento da rinnovare, quanto resta da pagare, ognuno con il suo pulsante.', vai: 'allieve' },
      { t: 'Un pagamento senza cambiare pagina', d: '«Registra pagamento» apre una finestra da qualunque pagina: scegli l\'allieva (prima chi deve ancora pagare), l\'importo che resta e la data sono già scritti, il metodo è quello che usa di solito la famiglia. Dopo, «Scarica la ricevuta».' },
      { t: 'Il programma propone', d: 'Iscrivi di nuovo un\'allieva che conosce: corso, giorni, orario e abbonamento arrivano dall\'ultima iscrizione. Per i corsi agonistici il certificato proposto è «agonistico».' },
      { t: 'Un programma, non una pagina internet', d: 'L\'icona è il logo che vedi all\'avvio. La finestra è tutta sua: niente menu del browser con il tasto destro, F5 aggiorna i dati, Ctrl + F cerca un\'allieva, Ctrl + e Ctrl − cambiano la grandezza del testo, Alt + N apre una nuova iscrizione, Alt + P un pagamento.' },
      { t: 'Il menu: prima l\'essenziale', d: 'In cima Home, Allieve, Iscrizioni, Pagamenti e Certificati; sotto Scadenze, Calendario e Grafici; il resto in «Altro» (anche l\'assistente).' },
      { t: 'Home: un solo elenco «Da fare»', d: 'Scadenze, certificati, incassi e copie di sicurezza in un elenco, il più urgente per primo, con «Avvisa» accanto agli abbonamenti e ai certificati. Gli stati sono scritti come testo con un pallino: il colore resta solo per quello che non va.', vai: 'inizio' },
      { t: 'Preferenze', d: 'In Impostazioni, «Preferenze»: la pagina all\'apertura, il testo più grande, gli elenchi compatti, «Mostra tutto» (prima era «Dettaglio» in alto), il corso, l\'abbonamento e il metodo già scelti nei moduli, i giorni e l\'orario di ogni corso, ogni quanto ricordarti la copia.', vai: 'impostazioni/preferenze' }
    ], correzioni: ['Prima di eliminare, rinnovare o uscire senza salvare risponde una finestra del programma con pulsanti chiari; archiviare un\'allieva non chiede più niente: l\'avviso ha «Annulla».', 'I messaggi ai genitori sono più diretti. Chi ha cambiato un testo tiene il suo.', 'La prima volta la finestra si apre «nuova»: lo stile scelto e la visita guidata vanno rifatti una volta.'] },
    { v: '1.24.2', data: '2026-11-24', titolo: 'Revisione del codice: più sicuro e più solido', voci: [
      { t: 'Accesso dal telefono più difficile da forzare', d: 'Chi prova tante password nello stesso momento viene fermato dopo cinque tentativi, come chi le prova una alla volta.', vai: 'impostazioni/telefono' }
    ], correzioni: [
      'Se il cambio del logo non riesce, resta quello di prima (prima potevano sparire tutti e due).',
      'Il numero dei dispositivi collegati dal telefono non conta più quelli scaduti.',
      'Un errore imprevisto durante un aggiornamento, una chiusura o la prova dei suoni non chiude più il programma: finisce nel diario tecnico.',
      'Una pagina di un altro sito non può far aprire finestre al programma.'
    ] },
    { v: '1.24.1', data: '2026-11-24', titolo: 'Più comodo sul telefono, errori più chiari', voci: [
      { t: 'Sul telefono si tocca meglio', d: 'Pulsanti, campi e link sono alti almeno 44 punti e il testo corrente è di 16: non serve più ingrandire la pagina per colpire il pulsante giusto.' },
      { t: 'Un modulo sbagliato ti porta al campo da correggere', d: 'Se provi a salvare con qualcosa che non va, il cursore salta sul primo campo da correggere e il campo si segna. Il messaggio resta sotto, e sparisce appena correggi.' },
      { t: 'I pulsanti ripetuti dicono per chi sono', d: 'Chi usa un lettore di schermo sente «Avvisa Giulia Rossi» e «Togli la riga 3: Base» invece di una fila di «Avvisa» e «Togli» tutti uguali.' }
    ], correzioni: ['Le righe di testo lunghe (Impostazioni, Aggiornamenti) non attraversano più tutto lo schermo: al massimo 68 caratteri.'] },
    { v: '1.24.0', data: '2026-11-24', titolo: 'Movimenti più rapidi e più curati', voci: [
      { t: 'Avvisi, finestre e anteprime entrano e escono con delicatezza', d: 'L\'avviso «Salvato» compare e scompare con una dissolvenza (con il movimento «Pieno» anche con un piccolo scivolamento). Le finestre si aprono e si chiudono con una dissolvenza, e le anteprime al passaggio del mouse crescono dal punto in cui si trova il puntatore. Tutto dura al massimo un quarto di secondo.', vai: 'impostazioni/aspetto' },
      { t: 'Ogni pulsante risponde quando lo premi', d: 'Premendo un pulsante si rimpicciolisce di pochissimo, come un tasto vero, e torna com\'era quando lo lasci. Con il movimento «Spento» sta fermo.', vai: 'impostazioni/aspetto' },
      { t: 'Le pagine si aprono più in fretta', d: 'Cambiando pagina il contenuto compare subito, con una dissolvenza di un decimo di secondo: non si aspetta più che finisca un\'animazione per leggere. Le cifre dell\'Inizio scorrono soltanto la prima volta che si apre il programma (con il movimento «Pieno»), non a ogni pagina; niente sfocature mentre si legge.' }
    ], correzioni: ['Se un avviso arriva mentre il precedente sta ancora uscendo, non ricomincia da capo: riparte da dov\'era.', 'I grafici della pagina Analisi si disegnano in meno di mezzo secondo, senza rimbalzi.', 'Sul telefono una riga di dettagli molto lunga (per esempio «28 iscrizioni con un residuo · totale: …») va a capo invece di far scorrere la pagina di lato; gli importi non si spezzano mai.'] },
    { v: '1.23.0', data: '2026-11-20', titolo: 'Controlla questo computer', voci: [
      { t: 'Il pulsante «Controlla questo computer»', d: 'In Impostazioni, «Assistenza», il programma prova da solo l\'orologio, lo spazio sul disco, le copie e la seconda copia, la cartella del programma e gli aggiornamenti, la finestra, lo scanner, i suoni e l\'accesso dal telefono. Per ogni cosa dice se è a posto o che cosa fare, in parole semplici.', vai: 'impostazioni/assistenza' },
      { t: 'Lo stesso elenco nel file per l\'assistenza', d: 'Il file da mandare a chi cura il programma ora dice anche com\'è il computer, così non serve chiederlo a voce.', vai: 'impostazioni/assistenza' }
    ], correzioni: ['Le etichette «info» (per esempio «In attesa · entro 05/12») restano leggibili anche negli stili Liquid Glass e Sole, qualunque macchia colorata passi dietro.', 'Se una prova si blocca (lo scanner che non risponde) il programma la interrompe dopo venti secondi.'] },
    { v: '1.22.0', data: '2026-11-20', titolo: 'Se qualcosa non funziona: il file per l\'assistenza', voci: [
      { t: 'Il file per l\'assistenza', d: 'In Impostazioni, «Assistenza», con un pulsante crei un file di testo da mandare a chi cura il programma: dice la versione, com\'è il computer, quante allieve ci sono, come vanno le copie e gli aggiornamenti, e gli ultimi errori. Niente nomi, codici fiscali, telefoni, importi o note: puoi leggerlo prima di mandarlo.', vai: 'impostazioni/assistenza' },
      { t: 'Il diario tecnico', d: 'Il programma annota da solo quando si apre e si chiude, le copie, gli aggiornamenti e ogni errore, con l\'ora. Così, se qualcosa va storto in palestra, chi cura il programma può capire che cosa è successo anche senza essere lì.', vai: 'impostazioni/assistenza' },
      { t: 'Errori che non fermano il lavoro', d: 'Se una parte del programma si rompe all\'improvviso, il programma lo scrive nel diario e va avanti, invece di fermarsi senza dire niente.' }
    ], correzioni: ['Se lo scanner non parte, ora il diario dice anche il motivo che Windows dà.'] },
    { v: '1.21.1', data: '2026-11-20', titolo: 'Controllo completo: più sicurezza e meno errori', voci: [
      { t: 'Importi controllati', d: 'Se per sbaglio scrivi una cifra assurda (per esempio un numero di telefono nella casella dell\'importo) il programma la rifiuta: il massimo è 100.000 €. Rifiuta anche gli importi sotto il centesimo e i testi lunghissimi incollati per errore.' },
      { t: 'File Excel e CSV a prova di tutto', d: 'Il file Excel che scarichi si apre sempre, anche se in un campo c\'è un testo lunghissimo, e nei file CSV le celle che Excel scambierebbe per formule sono rese innocue. Se scegli per l\'importazione un file Excel rovinato, il programma lo dice con parole chiare.', vai: 'impostazioni/esporta' },
      { t: 'Più accessibile', d: 'Le tabelle, i giorni del calendario e i titoli delle Impostazioni si leggono meglio con i lettori di schermo.' }
    ], correzioni: ['Un pagamento di meno di un centesimo non finisce più nell\'archivio come 0,00 €.', 'Lo scanner funziona anche se il nome dell\'utente di Windows ha un apostrofo.', 'Il programma è costruito con una versione più recente del compilatore, con le correzioni di sicurezza.'] },
    { v: '1.21.0', data: '2026-11-19', titolo: 'Tre nuovi stili grafici da scegliere', voci: [
      { t: 'Squadra', d: 'Barra laterale blu a sfumatura, schede bianche su fondo azzurrino, numeri grandi con l\'icona in un quadrato tenue. Pensato come un gestionale per società sportive.', vai: 'impostazioni/aspetto' },
      { t: 'Minimale', d: 'Tutto bianco, righe sottili, etichette a pillola con il bordo e un solo colore (viola). Tabelle pulite e molta aria.', vai: 'impostazioni/aspetto' },
      { t: 'Sole', d: 'Sfondo arancio sfumato, pannelli di vetro, schede color pastello e accenti dorati. Come Liquid Glass, ma caldo.', vai: 'impostazioni/aspetto' },
      { t: 'Tutti gli stili in vista', d: 'In Impostazioni, Aspetto, i sette stili sono tutti nell\'elenco, ognuno con la sua anteprima e ognuno in chiaro e in scuro. La scelta vale per il dispositivo che usi.', vai: 'impostazioni/aspetto' }
    ], correzioni: ['Il numero accanto a una voce del menu si legge anche quando la voce è quella attiva.'] },
    { v: '1.20.0', data: '2026-11-19', titolo: 'Piccoli suoni all\'avvio e alla chiusura', voci: [
      { t: 'Un suono quando il programma si apre e uno quando si chiude', d: 'Due piccoli suoni, fatti dal programma stesso: uno con il logo che si anima all\'apertura, uno con il saluto «A presto!» (anche se chiudi la finestra con la X). Escono dalle casse del computer, con il volume di Windows.', vai: 'impostazioni/aspetto' },
      { t: 'Si spengono o si abbassano quando vuoi', d: 'In Impostazioni, Aspetto, «Suoni»: Spenti, Piano o Normale. «Prova i suoni» te li fa sentire subito. La scelta vale per questo computer.', vai: 'impostazioni/aspetto' }
    ], correzioni: [] },
    { v: '1.19.0', data: '2026-11-19', titolo: 'File Excel e programma più scorrevole', voci: [
      { t: 'Esporta in Excel', d: 'In Impostazioni, «Esporta per Excel», scarichi un solo file con cinque fogli: Allieve, Iscrizioni, Pagamenti, Certificati e Note. Date e importi sono veri: in Excel si ordina, si filtra e si somma. Il file serve per guardare e stampare.', vai: 'impostazioni/esporta' },
      { t: 'Più scorrevole', d: 'Le pagine si aprono e si ridisegnano più in fretta, anche con molte allieve, e il programma usa meno memoria.' },
      { t: 'Più leggero', d: 'Tolte parti vecchie che non servivano più: il programma è un po\' più piccolo.' }
    ], correzioni: ['Dopo un salvataggio o un filtro la pagina resta dov\'eri, senza tornare in cima e senza rifare l\'animazione.', 'La pagina Certificati si apre subito anche con moltissime allieve (mostra le prime righe, le altre con «mostra tutte»).'] },
    { v: '1.18.0', data: '2026-11-19', titolo: 'Calendario e note', voci: [
      { t: 'Il calendario', d: 'Un mese alla volta, con i segni di quello che succede in ogni giorno: abbonamenti che scadono, certificati, compleanni e le tue note. Premi un giorno per vedere i dettagli.', vai: 'calendario' },
      { t: 'Le note e i promemoria', d: 'Scrivi un appunto, con una data se vuoi ricordartelo (anche per più giorni, come una chiusura) e con un\'allieva se la riguarda. Quando arriva il giorno compare in Inizio.', vai: 'calendario/note' },
      { t: 'Le note nella scheda dell\'allieva', d: 'In ogni scheda c\'è «Promemoria e note»: per esempio «preferisce essere chiamata la sera».' },
      { t: 'L\'assistente conosce le note', d: 'Ti avvisa delle note in ritardo e rispondi alla domanda «che note ho?».', vai: 'assistente' }
    ], correzioni: [] },
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
