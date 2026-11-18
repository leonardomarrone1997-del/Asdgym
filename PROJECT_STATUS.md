# PROJECT_STATUS — Gym Art Segreteria

Ultimo aggiornamento: 2026-11-18, versione programma Windows **1.12.0**.
Per ricostruire il contesto leggi anche `CLAUDE.md` (regole e struttura) e `win/LEGGIMI.txt` (note per l'utente).

## Stato attuale
Due prodotti nello stesso repository:
1. **Programma Windows** (`win/`) — quello su cui si lavora. Gestionale locale, senza Claude, dati su un file JSON.
2. **Strumento foglio Google** (`src/`, `dist/`, `gas/`) — inserimento da moduli con Claude o Apps Script. Non più sviluppato attivamente. Non sincronizzato con il programma Windows: si passa i dati con import CSV a senso unico.

## Stack
Go 1.24 (solo libreria standard) + JavaScript vanilla + SVG fatto a mano. La pagina usa componenti già inclusi, senza rete: GSAP 3.15.1 con ScrollTrigger e SplitText, Lenis 1.3.27 (`win/web/vendor/`), font Inter e Instrument Serif (`win/web/fonts/`), icone Lucide (dentro `app.js`). Licenze in `win/web/vendor/LICENZE.txt` (GSAP: licenza "no charge" di GreenSock, testo non letto perché gsap.com era bloccato: va riletto prima di ridistribuire). React Bits (MIT + Commons Clause, licenza riletta il 18/11): le sue idee (cifre che scorrono, luce che segue il puntatore, pulsanti magnetici, testo sfocato) sono riscritte da zero in `movimento.js`, nessun suo codice è copiato. La licenza permette di usare i componenti dentro un'applicazione ma vieta di rivenderli o ridistribuirli da soli, in pacchetto o "portati": se si adatta altro codice suo, tenere l'avviso di copyright (testo in `LICENZE.txt`) e non farne una raccolta. Il programma serve la sua pagina su `127.0.0.1` e la mostra in una finestra Edge/Chrome (`--app`). Archivio: `archivio.json` (+ `registro.jsonl`, cartella `copie`). Test: Node (`node --test`), Go, Playwright.

## Funzionalità complete
- Anagrafica, famiglie, archiviazione, ricerca, ordinamento. Iscrizioni (mensile, trimestrale, annuale; *semestrale tolto*), scadenze, rinnovi.
- Certificati medici, pagamenti parziali/completi con ricevuta PDF numerata, quota di iscrizione, residui.
- **Bonifici da verificare (1.5.0)**: un bonifico nuovo resta `daVerificare` finché una persona non lo conferma (con data e voce nel registro); contanti/POS non richiedono verifica; pagamenti vecchi o importati non sono segnalati. Conta comunque negli incassi e nel pagato, con evidenza separata.
- **Importazione Excel (1.10.0)**: `win/web/xlsx.js` legge un .xlsx in locale (zip + `DecompressionStream`, XML con espressioni regolari, date dagli stili, numeri con la virgola, sistema 1904, testi condivisi/ricchi/inline); ogni foglio passa da `riconosciFoglio` come un CSV. Il file non viene caricato né copiato; la CSP (`default-src 'self'`) impedisce connessioni esterne, provato in `test/win.xlsx.e2e.js` (nessuna richiesta fuori da 127.0.0.1, nessuna contiene il file, fetch e immagini esterne bloccati). Fixture con persone inventate: `test/fixtures/gestionale-finto.xlsx` (44 allieve, 59 iscrizioni, 45 pagamenti, titolo in riga 1, intestazioni in riga 2, date vere, telefoni numerici, omonime). Con questo file: 44 allieve, 51 iscrizioni e 40 pagamenti importati, 8+4 righe saltate per omonimia o iscrizione non trovata (da fare a mano). Non provato con il file Excel vero: la struttura è quella del foglio Google descritta in CLAUDE.md; se è diversa il riepilogo elenca le colonne non trovate.
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

## Ultime modifiche (1.12.0: semplificazione; 1.11.1 e 1.11.0 sotto)
Richiesta del responsabile: "troppi dati da compilare, troppi dettagli in tutto: solo i campi essenziali, in ogni pagina". Fatto (solo interfaccia, la logica e i dati non cambiano):
- Helper `altri(titolo, figli)` e `sezione()` in `app.js`: i campi facoltativi stanno in `<details class="altri">` chiuso; si aprono con "Dettaglio" (`S.det`), con l'interruttore `localStorage gymart-aperto=1` (lo usano i robot di test) e da soli quando un errore riguarda un campo facoltativo (`ESSENZIALI` in `vAllieva`).
- Allieva: visibili Cognome e Nome, Data di nascita, Telefono, Genitore; sotto "Altri dati": anagrafica, contatti, certificato, consensi, note. Lo stato del certificato è un chip nella testata della scheda. Iscrizione: Allieva, Corso, Tipo, Giorni, Inizio; sotto "Altri dettagli": fascia, tariffa, quote, note, annullata/chiusa. Pagamento: Data, Importo, Metodo; la nota è facoltativa.
- Inizio (`vInizio`): saluto, scheda eroe, agenda, 3 tessere (incassi del mese, allieve, iscrizioni aperte), 3 azioni, "Da fare" con le sole tessere diverse da zero; tolti grafico, compleanni, statistiche dell'archivio, chip dei corsi e l'elenco degli abbonamenti (sono in Analisi, Corsi, Scadenze).
- Colonne di default ridotte (le altre con `det: true`): Allieve senza Genitore; Iscrizioni senza Giorni, Fascia, Abbonamento, Inizio; Pagamenti senza Ricevuta n. e Note; debitori senza Abbonamento, Inizio, Dovuto, Pagato.
- Impostazioni: ogni card diventa un gruppo chiuso (`details.gruppo`) con una frase (`SEZIONI_DESCR`).
- Analisi: 3 tessere e le due coppie di grafici principali (incassi per mese e per metodo, residui e prossime 8 settimane); il resto (`soloDet`, classe `solo-det`) compare con "Dettaglio". Promemoria: "Come funziona" e "Altri filtri" chiusi, tessere a zero nascoste. Scheda allieva: "Documenti da stampare" chiuso.
- Test: `win.e2e.js` (finestra con `gymart-aperto`) + un passo nuovo senza interruttore che controlla i quattro campi, il comportamento degli errori, le colonne, la Home e i gruppi chiusi.
- Ancora da fare se serve: semplificare Scadenze, Promemoria, Corsi, Analisi e i messaggi di avviso più lunghi.

## Modifiche della 1.11.1 (Liquid Glass)
Su richiesta del responsabile (esempio "Liquid glass: blur, light edges, depth; per schede, barre e pulsanti") lo stile predefinito, chiave `vetro`, in Impostazioni si chiama **Liquid Glass**. Solo CSS (`gymart.css`, blocco "LIQUID GLASS" dopo la pelle di prima) più il nome in `app.js`: vetro `--glass-bg` (sfumatura chiara con riflesso in alto a sinistra; nel tema scuro con uno strato scuro sotto per tenere i testi leggibili), `backdrop-filter: blur(24px) saturate(180%)`, bordo di luce `--glass-rim` (anello sfumato fatto con `::before` e maschera, dentro `@supports`), ombre colorate `--glass-shadow`, macchie azzurro/arancio/rosa (`.fondo i`) che il vetro rifrange. Per schede, tessere, menu, barra in alto e in basso, pulsanti secondari, interruttori. Senza movimento / poca trasparenza il vetro diventa quasi pieno e il bordo resta. Leggibilità rimisurata sui pixel (desktop e telefono) e prova e2e a 33 passi verde.

## Modifiche della 1.11.0
Dal video "Glassy Dashboard" scelto dal responsabile e dalle librerie GSAP, Lenis, React Bits.
- **Stile "Vetro"** (nuovo predefinito, `data-stile="vetro"`): pannelli di vetro smerigliato (`backdrop-filter`) su sfondo pesca (il gradiente sta in `.fondo`, un livello fisso con tre macchie che si muovono piano), accento mattone, pulsanti neri a pillola, parola in corsivo serif (`.serif`). Gli altri tre stili restano. Token nuovi: `--hero-a/--hero-b/--hero-bg`, `--on-accent`, `--panel`, `--bar-bg`, `--bg-image`.
- **Home** (`vInizio` in `app.js`): saluto, scheda eroe (anello "in regola" = iscrizioni attive / aperte, tre numeri), agenda (settimana + prossimi 7 giorni: scadenze e compleanni, `eventiAgenda`), 4 numeri con confronto sul mese scorso e piccolo grafico (`tile(..., x)`, `sparkline`), azioni rapide, poi i riquadri "Da fare" di prima. Tutti i numeri vengono da `L.riepilogo/analisi/scadenze/compleanni`.
- **Movimento** (`win/web/movimento.js`, `window.Movimento`): ingresso delle pagine, cifre che scorrono (odometro, poi testo normale), grafici che si disegnano, titoli parola per parola (SplitText), luce sul puntatore, pulsanti magnetici, pillola del menu che scivola, scorrimento morbido (Lenis, solo mouse e finestra larga). Tre livelli in Impostazioni > Aspetto > Movimento (`data-movimento`: pieno, ridotto, spento; "Automatico" segue `prefers-reduced-motion`). Spento: niente animazioni e niente `backdrop-filter`. Tutto è un miglioramento: ogni animazione toglie le proprie tracce (`clearProps`), c'è una rete di sicurezza a 7 s, `data-entrata` dice quando l'ingresso è finito.
- Ricerca veloce nel menu (`#cerca`, Ctrl/Cmd+K), bottone per ridurre il menu (`html.rail`, ricordato in `gymart-menu`), icone Lucide, `LICENZE.txt`.
- **Test**: `test/leggibilita.js` misura il contrasto di ogni testo sui pixel (due screenshot, con e senza testo; salta le righe coperte da barre); `test/win.e2e.js` ha passi nuovi (movimento, leggibilità, ricerca/menu) e gli stili con Vetro; `test/win.scimmia.js` usa il movimento pieno, la ricerca, il menu stretto e controlla che dopo 9 s niente resti nascosto.
- **Collaudi 1.11.0 (tutti verdi, su Linux con Chromium)**: `node --test test/core.test.js test/win.test.js` 95/95, `test/pdf.test.js`, `go vet` + `go test -race`, `win.e2e.js` 33 passi (nuovi: movimento a tre livelli con traccia dei residui, leggibilità misurata sui pixel in 4 stili × chiaro/scuro × 5 pagine anche con il puntatore sopra, ricerca veloce e menu stretto, parole lunghissime), `win.xlsx.e2e.js`, `win.simulazione.js` 20.000 passi, `win.scimmia.js` semi 1, 3, 7 (450 passi, con movimento, ricerca, menu stretto e controllo che dopo 9 s niente resti nascosto), `win.perf.js` (salvataggio con 1.500 allieve ≈ 230 ms; la prova gira con il movimento spento: con il movimento acceso il robot Playwright aspetta la fine dell'ingresso prima di cliccare e misura 1,6 s). Audit di leggibilità `test/leggibilita.js` a 1280 e 390 px su 13 pagine: nessun testo sotto 4,5:1 (3:1 se grande). Difetti trovati e corretti lungo la strada: `animaNumeri` rimasto nella pagina Promemoria (errore JS), righe `tr.link` con sfondo bianco al passaggio nel tema scuro, luce del puntatore che schiariva testi bianchi (ora spenta su superfici colorate e debole nel tema scuro), barre e pagine che lasciavano passare il contenuto sotto (ora `--bar-bg`), "Altro" in Morbido chiaro 3,98:1, etichetta della media nei grafici, importi lunghi sotto l'icona nello stile Sobrio sul telefono, parole lunghissime (3.000 caratteri senza spazi) che allargavano la pagina (regola `overflow-wrap` in `gymart.css`, difetto che c'era già).
- **Non provato**: Windows reale (Edge/WebView2, `backdrop-filter`, Lenis, font), iPhone/iPad (Safari), file Excel vero. Se un computer è lento: Impostazioni > Aspetto > Movimento > Spento.

## Modifiche della 1.10.1
Campagna di simulazioni: `test/win.simulazione.js` (8 semi × 2.500 operazioni casuali, invarianti dopo ogni operazione), `test/win.scimmia.js` (robot sul programma vero, 11 semi × 500–700 passi con valori malevoli e form validi), importazione Excel da 1.500 allieve (2,4 s di lettura, 0,2 s di scrittura), date in 6 fusi orari, 20 salvataggi concorrenti (ne vince uno). Difetti trovati e corretti: pulsante "Esci" visibile sul computer (regressione della 1.8: mancava `[hidden]`), modifica impossibile per allieve con codice fiscale sbagliato già in archivio, `segnaPromemoria` che restituiva un archivio diverso senza voce nel registro. Limite noto confermato: le iscrizioni e i pagamenti di allieve omonime non si importano (elencati).

## Modifiche della 1.9.0
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
0000. Provare la 1.11.0 su un PC Windows (Edge) e su iPhone/iPad: aspetto del vetro sfocato, fluidità con 1.500 allieve, scorrimento morbido con il mouse, font. Se pesa: movimento Ridotto o Spento (valgono per dispositivo).
000. Importare il file Excel vero sul PC della palestra (mai caricarlo in rete) con la seconda cartella già impostata; leggere il riepilogo; confrontare i totali con l'Excel.
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
