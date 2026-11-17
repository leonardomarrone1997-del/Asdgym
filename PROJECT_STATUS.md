# PROJECT_STATUS — Gym Art Segreteria

Ultimo aggiornamento: 2026-11-17, versione programma Windows **1.4.0**.
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
- Stato "verificato" per i bonifici: non c'è.
- Le copie automatiche stanno sullo stesso disco (la seconda cartella è facoltativa).
- Le sessioni dei telefoni stanno in memoria: dopo un riavvio del programma rientrano con la password.
- L'indirizzo numerico del PC può cambiare (DHCP): usare l'IP fisso nel router o Tailscale.
- Exe senza firma: SmartScreen avvisa.

## Ultime modifiche (1.4.0)
Semestrale tolto dalle scelte; avvio sicuro (C1 dell'audit); accesso di rete con login/HTTPS/sessioni; layout mobile; modalità sempre attiva e avvio con Windows; correzione: i telefoni non tengono aperto il programma.

## Prossimi interventi (in ordine)
1. Collaudo su Windows reale della 1.4 e su iPhone (elenco di controllo in `win/GUIDA_TELEFONO.txt`).
2. Import: verificare la regola della quota di iscrizione con un CSV reale (tenuto fuori dal repository).
3. Stato "verificato" sui pagamenti.
4. Esportazione `.xlsx` e PDF di report.
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
