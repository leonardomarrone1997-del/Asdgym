# PROJECT_STATUS — Gym Art Segreteria

Ultimo aggiornamento: 2026-11-17, versione programma Windows **1.9.0**.
Per ricostruire il contesto leggi anche `CLAUDE.md` (regole e struttura) e `win/LEGGIMI.txt` (note per l'utente).

## Stato attuale
Due prodotti nello stesso repository:
1. **Programma Windows** (`win/`) — quello su cui si lavora. Gestionale locale, senza Claude, dati su un file JSON.
2. **Strumento foglio Google** (`src/`, `dist/`, `gas/`) — inserimento da moduli con Claude o Apps Script. Non più sviluppato attivamente. Non sincronizzato con il programma Windows: si passa i dati con import CSV a senso unico.

## Stack
Go 1.24 (solo libreria standard) + JavaScript vanilla + SVG fatto a mano. Nessuna libreria esterna. Il programma serve la sua pagina su `127.0.0.1` e la mostra in una finestra Edge/Chrome (`--app`). Archivio: `archivio.json` (+ `registro.jsonl`, cartella `copie`). Test: Node (`node --test`), Go, Playwright.

## Funzionalità complete
- Anagrafica, famiglie, archiviazione, ricerca, ordinamento. Iscrizioni (mensile, trimestrale, annuale; *semestrale tolto*), scadenze, rinnovi.
- Certificati medici, pagamenti parziali/completi con ricevuta PDF numerata, quota di iscrizione, residui.
- **Bonifici da verificare (1.5.0)**: un bonifico nuovo resta `daVerificare` finché una persona non lo conferma (con data e voce nel registro); contanti/POS non richiedono verifica; pagamenti vecchi o importati non sono segnalati. Conta comunque negli incassi e nel pagato, con evidenza separata.
- **Sicurezza dei dati (1.9.0)**: `win/backup.go`. Livelli: archivio riletto dopo ogni scrittura; copie prima delle modifiche (≥10 min, ultime 200); copia giornaliera `giornaliere/<data>/` (archivio + registro + MANIFEST con sha256, scritta in cartella temporanea, riletta e solo poi rinominata) fatta al primo salvataggio della giornata (prima della modifica, o dopo se è il primo di sempre), all'avvio e ogni 5 min (`Server.Maintain`); ritenzione 60 giorni tutte, poi 1/settimana per 364 giorni, poi 1/mese; seconda cartella: `ultima/` (stato più recente, archivio+registro) e `giornaliere/` con stesse regole, verificate; recupero automatico all'avvio (archivio danneggiato → messo da parte come `archivio.json.danneggiato-<ora>`, ripristino dalla copia più recente valida tra copie/giornaliere/seconda cartella; archivio mancante idem; registro mancante ripristinato); `guardShrink` rifiuta un salvataggio che perde >30% di allieve/iscrizioni/pagamenti o azzera, salvo `copia: true`; avviso rosso in Inizio se manca la seconda cartella; Impostazioni > Sicurezza dei dati (copia ora, controlla tutte, elenco e ripristino). Test: 12 sequenze casuali di guasti (taglio, spazzatura, vuoto, cancellato, byte cambiato) senza perdere più di 8 salvataggi (con la seconda cartella 0), `-race`. Limite: copie prima del salvataggio ogni ≥10 min, quindi senza seconda cartella un archivio rotto può far perdere fino a 10 minuti di inserimenti; il registro non permette di ricostruire un archivio.
- **Grafica 1.8.0**: un solo foglio `win/web/gymart.css` (token + 3 stili `data-stile` club|morbido|sobrio + `data-scheme` light|dark), `tema.js` applica la scelta (localStorage `gymart-stile`/`gymart-tema`, per dispositivo) prima del disegno. Guscio: barra laterale a gruppi (≥1100 px), barra stretta con icone (701–1099), barra in basso su telefono (≤700). Inizio riordinato per priorità; tessere con icona (non solo colore). Staccato da `src/style.css` (resta solo per lo strumento Google). Test: contrasto di 37 coppie di colori × 3 stili × 2 temi, matrice 3 stili × 3 larghezze × 13 pagine senza scroll orizzontale.
- **Promemoria in blocco (1.7.0)**: pagina `#promemoria` (da Scadenze). Elenco unico di abbonamenti scaduti/in scadenza e certificati scaduti/in scadenza/mancanti (allieve non archiviate), filtri per tipo/stato/corso/nome, WhatsApp con testo pronto (numero 1 o, se vuoto/non valido, numero 2), copia testo, stampa. "Contattata" si segna all'apertura della chat o con "Fatto"; il programma non sa se il messaggio è partito: c'è "Annulla". Dopo 7 giorni ancora da sollecitare → "Da ricontattare". Dati in `db.promemoria` ([{tipo, rif, scadenza, quando}], 14 mesi), voci nel registro. Logica: `elencoPromemoria`, `segnaPromemoria`.
- **Nuova stagione (1.6.0)**: pagina `#stagione` (da Impostazioni e dal richiamo in Inizio quando la stagione di oggi è oltre quella impostata). Per ogni iscrizione aperta: rinnova / chiudi / lascia, con proposta (lascia se incompleta, archiviata o già rinnovata; chiudi se scaduta da oltre 180 giorni; altrimenti rinnova). Opzioni: mantieni quote concordate, riaddebita quota di iscrizione. Anteprima, copia forzata prima di scrivere, un solo salvataggio, voci nel registro. I residui restano sul periodo vecchio. Logica in `logic.js` (`pianoStagione`, `controllaStagione`, `nuovaStagione`).
- Pagine: Inizio, Allieve, Iscrizioni, Corsi (elenchi e fogli presenze stampabili), Pagamenti, Analisi (grafici), Scadenze, Registro, Impostazioni, Guida.
- Moduli PDF (iscrizione, richiesta certificato, ricevuta). Import CSV dei fogli ANAGRAFICA/ISCRIZIONI/PAGAMENTI. Export CSV.
- Copie: automatiche prima di modificare (max 1 ogni 30 min, sempre prima di import/ripristino/eliminazione), 100 conservate; seconda cartella giornaliera; copia scaricabile e ripristino.
- Vista "Dettaglio", grafica in stile Apple (chiaro/scuro), animazioni.
- **Accesso dal telefono (1.4.0)**: password di rete, HTTPS (certificato autofirmato o fornito, es. Tailscale), sessioni, limite tentativi, host ammessi, funzioni solo-PC bloccate da remoto, layout mobile (barra in basso, elenchi a schede), manifest/icona per la Home.
- Avvio sicuro in locale: la pagina si apre solo con un indirizzo monouso del programma (cookie).

## Parziali / non attive
- **Password sui dati (cifratura a riposo)**: motore in `win/crypto.go` con test, pagina di sblocco e "Togli la protezione" presenti, ma l'attivazione NON è nell'interfaccia (scelta del responsabile: da riaggiungere a lavoro finito). Un archivio già protetto si apre ancora.
- Esportazione `.xlsx` vera e PDF di report: non fatti (solo CSV).

## Problemi noti
- **Non verificato su Windows reale** dalla 1.1 in poi (finestra, chiusura, download, stampa dei fogli presenze, finestra "Scegli cartella" via PowerShell, avvio con Windows, firewall). Provata dall'utente solo la 1.0.0.
- **Non verificato su iPhone/iPad**: installazione del certificato, Safari, icona Home. Nei test il telefono è un browser Chromium con layout iPhone attraverso un tunnel TCP.
- L'import deduce la quota di iscrizione dalla differenza con "Totale dovuto" (`importaIscrizioni`): ipotesi mai confrontata con dati reali.
- Le copie automatiche stanno sullo stesso disco (la seconda cartella è facoltativa).
- Le sessioni dei telefoni stanno in memoria: dopo un riavvio del programma rientrano con la password.
- L'indirizzo numerico del PC può cambiare (DHCP): usare l'IP fisso nel router o Tailscale.
- Exe senza firma: SmartScreen avvisa.

## Ultime modifiche (1.9.0)
Sicurezza dei dati. Test: Go (con prove di guasto casuali, `-race`), e2e 29 passi.

## Modifiche della 1.8.0
Redesign grafico con tre stili e tema chiaro/scuro.

## Modifiche della 1.7.0
Promemoria in blocco.

## Modifiche della 1.6.0
Nuova stagione (procedura guidata di rinnovo/chiusura). Prova con 1.500 allieve: apertura pagina ~0,6 s.

## Modifiche della 1.5.0
Bonifici da verificare (conferma manuale, mai automatica).

## Modifiche della 1.4.0
Semestrale tolto dalle scelte; avvio sicuro (C1 dell'audit); accesso di rete con login/HTTPS/sessioni; layout mobile; modalità sempre attiva e avvio con Windows; correzione: i telefoni non tengono aperto il programma.

## Riservatezza (da fare, rimandato dal responsabile il 2026-11-17)
Controllo del repository fatto il 2026-11-17 contro lo zip originale: nessun dato personale vero di allieve o genitori (codici fiscali, telefoni ed email sono inventati; nessun IBAN). Restano da sistemare:
- Il repository GitHub è **pubblico**: renderlo privato (Settings → Change visibility → Private, lo fa il responsabile).
- L'ID del foglio Google è nel codice e nella cronologia (`CLAUDE.md`, `src/core.js`, `win/web/core.js`, `gas/Codice.gs`, `gas/Pagina.html`, `dist/index.html`): controllare che il foglio sia condiviso come "Limitato", non "Chiunque abbia il link". Il programma Windows non usa l'ID.
- L'email dell'associazione compare nei moduli PDF e nei test (`test/pdf.test.js`): sostituirla se non deve essere pubblica.
- Togliere l'ID dai file di oggi solo su richiesta. Riscrivere la cronologia git (push forzato, non annullabile) solo su ordine esplicito: di solito non serve se il repository è privato e il foglio è limitato.
- Consigliato: copia del foglio Google (File → Crea una copia) e scollegare il connettore Google Sheets da Claude.

## Prossimi interventi (in ordine)
00. Impostare la seconda cartella sul PC vero (chiavetta o OneDrive/Google Drive) e provare il ripristino da un'elenco di copie. Non verificati su Windows reale: rinomina di cartelle con antivirus attivo, cartelle OneDrive.
0b. Provare la grafica su un PC Windows (Edge) e su iPhone/iPad (Safari): i font di sistema e `backdrop`/`color-mix` non sono stati visti su dispositivi veri. Rimasto della proposta grafica: finestre di conferma proprie al posto di `confirm()` (29 usi), ricerca globale nell'intestazione, skeleton di caricamento.
0. Provare la Nuova stagione su una copia dei dati veri prima di usarla (mai provata con dati reali; scelte proposte da verificare).
1. Collaudo su Windows reale della 1.4 e su iPhone (elenco di controllo in `win/GUIDA_TELEFONO.txt`).
2. Import: verificare la regola della quota di iscrizione con un CSV reale (tenuto fuori dal repository).
3. Esportazione `.xlsx` e PDF di report.
4. Accesso di sola lettura (istruttrici), sconto fratelli, presenze.
5. Riattivare la password sui dati; elenco anomalie in home.

## Rimandati su decisione del responsabile (non servono al momento)
- Corsi veri (gruppi, orari, capienza, istruttori): i corsi restano un elenco di nomi.
- Rimborsi / importi negativi: un pagamento sbagliato si elimina e si registra di nuovo.

## Decisioni tecniche importanti
- Niente database relazionale: file JSON unico scritto in modo atomico, con revisione per rilevare due finestre in conflitto (`409`).
- Nessun dato reale nel repository, mai (minori). Test e prove usano persone inventate.
- Logica pura in `win/web/logic.js` (testata in Node) e in `src/core.js` (condivisa; `win/web/core.js` è una copia verificata da test).
- Sicurezza locale: token + indirizzo di avvio monouso + cookie. Rete: solo HTTPS, password con PBKDF2, limite tentativi per indirizzo, nomi host ammessi, endpoint del solo PC rifiutati da remoto.
- CSP con stili inline ammessi (grafici); script solo dalla stessa origine.
- Aggiornamenti: si sostituisce l'exe, i dati non si toccano; archivi vecchi si completano in `completa()`.

## Come verificare
`node --test test/core.test.js test/win.test.js` · `node test/pdf.test.js` · `cd win && go vet ./... && go test -race ./...` · `node test/win.e2e.js` (prova completa in browser, include l'accesso da "telefono") · `node test/win.perf.js` (tempi con 1.500 allieve).
