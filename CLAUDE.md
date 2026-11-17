# Gym Art Segreteria

Strumento di segreteria per A.S.D. Gym Art Avezzano (ginnastica artistica). Inserisce moduli di iscrizione,
certificati medici e pagamenti nel gestionale su Google Sheets, sempre con preverifica e registro.
Lingua dell'interfaccia e dei messaggi: italiano.

## Dove sono i dati
- Gestionale: Google Sheets, ID `1QSztBzW-HojdXPCUbSGWqihCD8XD9dntB0m_hNJB5cU`
- Fogli usati: ANAGRAFICA, ISCRIZIONI, PAGAMENTI, REGISTRO SCANSIONI, LISTE, TARIFFARIO (più DASHBOARD, SCHEDA ALLIEVA, CONTROLLI, MESSAGGI, GUIDA, solo formule)
- Le colonne si trovano SEMPRE dal titolo (riga 2), mai dalla posizione. Non rinominare fogli o intestazioni.
- Dati personali di minori: non copiare mai dati reali nel repository (niente export del foglio, niente foto).

## Struttura
- `src/core.js`  logica pura: codici fiscali, date, importi, lettura dei fogli, confronti, controlli, prompt di lettura foto
- `src/plan.js`  costruisce il "piano" di scrittura (cosa cambia, errori, avvisi) per modulo, certificato, pagamento
- `src/pdf.js`   genera i PDF A4: modulo di iscrizione e richiesta di certificato medico (nessuna dipendenza)
- `src/app1.js`, `src/app2.js`  interfaccia, collegamenti, scritture con rilettura di verifica
- `src/index.html`, `src/style.css`  pagina e stile (colori sociali: blu #1B2F6A, azzurro #1C95D0, oro #E2BE1D, bordeaux #7B1E43, verde #1C6B47)
- `build.js`      -> `dist/index.html`  versione per Claude (artifact con connettore Google Sheets, lettura foto, download)
- `build_gas.js`  -> `gas/Pagina.html`  versione senza Claude (Google Apps Script, inserimento a mano); server in `gas/Codice.gs`
- `test/core.test.js`, `test/pdf.test.js`  test (`node --test test/core.test.js`, `node test/pdf.test.js`)
- `win/`  programma per Windows (Go, nessuna dipendenza): anagrafica e iscrizioni in un archivio sul PC, senza Google.
  `main.go` avvio e finestra, `store.go` archivio JSON con copie e registro, `server.go` route e stato, `access.go` guardia (avvio monouso + cookie in locale, login e sessioni da rete),
  `rete.go` accesso di rete (password, HTTPS, certificato, limite tentativi, ascolto), `crypto.go` cifratura (non attivabile dall'interfaccia), `mirror.go` seconda copia,
  `web/logic.js` logica dell'archivio, `web/app.js` interfaccia. `web/core.js` e `web/style.css` sono copie di `src/` (non modificarle lì).
- `build_win.js`  -> `win/build/GymArtSegreteria.exe` (non è nel repository). `--solo-copia` aggiorna solo le copie in `win/web/`.
- Test del programma Windows: `node --test test/win.test.js`, `cd win && go test ./...`, `node test/win.e2e.js` (prova completa nel browser),
  `node test/win.perf.js` (tempi con 1.500 allieve inventate). Go: `cd win && go test -race ./...` (include cifratura e seconda copia). Per vedere le schermate con dati inventati: vedi `test/win.perf.js` (archivio finto) e Playwright. Versione in `win/main.go` e `win/winres/winres.json` (poi `go-winres make --arch amd64`).
- `mock/`  prova nel browser con foglio simulato (Playwright). `mock/data.json` NON è incluso: conteneva dati reali.
  Per usarla, crea un `data.json` con dati finti con la stessa forma (chiave = nome foglio, valore = righe a partire dall'intestazione).

## Regole di dominio (decise dal responsabile)
- "P" sul modulo (cerchiata o no) = pagato. Un pagamento si registra solo con importo, metodo e data espliciti.
- TRIM/MENS/SEM/ANN = tipo abbonamento; mono/bi/tri = giorni a settimana; una data vicino alle sigle = data di INIZIO.
- Consensi privacy e foto in bianco -> "Sì" per regola della palestra, con nota nel registro.
- "Artistica Baby" del modulo = corso Propedeutico.
- Certificati: validità un anno dal rilascio; se la scadenza è stampata vale quella. "Ludico-motoria" va segnalato.
- Anno di nascita impossibile -> blocco e richiesta di correzione. Note sanitarie e IBAN non si copiano mai.
- Allieva già presente: si completano solo i campi vuoti; i valori diversi si sostituiscono solo su scelta esplicita.

## Regole di scrittura sul foglio
- Ogni scrittura: una riga, un intervallo contiguo, `null` dove non si tocca, testo con apostrofo iniziale, date ISO, numeri come numeri (USER_ENTERED).
- Dopo ogni scrittura si rilegge la riga e si confronta. Ogni dato scritto produce una riga in REGISTRO SCANSIONI con il valore precedente.
- Non scrivere mai nelle colonne calcolate (ID, stati, totali, N. ricevuta, chiavi).

## Stato e cose da fare
- Stato completo e prossimi passi: vedi `PROJECT_STATUS.md` (da aggiornare dopo ogni intervento importante).
- Programma Windows (`win/`): avviato e provato dal responsabile su un PC Windows l'11/11/2026 (funziona). Non ancora confermati uno per uno:
  chiusura automatica alla chiusura della finestra, download dei file, messaggi di errore all'avvio.
  Versione 1.4.0: anagrafica, iscrizioni, certificati, pagamenti con ricevute, moduli PDF, accesso dal telefono (password, HTTPS), layout mobile, pagina Analisi (grafici SVG in `app.js`,
  numeri in `logic.js` `analisi()`), vista "Dettaglio" (classe `det`, colonne `det: true`), grafica in `win/web/apple.css`,
  seconda copia su cartella a scelta (`win/mirror.go`). Password: motore (`win/crypto.go`) e pagina di sblocco restano, ma
  l'attivazione NON è più nell'interfaccia (scelta del responsabile: da riaggiungere a lavoro finito). Prova su Windows reale fatta solo per la 1.0.0: la 1.4.0 va collaudata
  (seconda copia, finestra scelta cartella via PowerShell, avvio con Windows, accesso da iPhone). Rimandati dal responsabile: corsi veri (gruppi, istruttori) e rimborsi.
- Provata solo su foglio simulato; da collaudare sul foglio vero e con foto vere.
- Versione Apps Script mai eseguita dentro Google.
- Limiti noti dello strumento per il foglio Google: omonime non distinte, due inserimenti contemporanei da dispositivi diversi
  possono finire sulla stessa riga. Risolti in `src/core.js` (con test): telefoni esteri, numeri romani negli indirizzi,
  giorni impossibili nel codice fiscale. La pagina pubblicata su Claude li riceve solo ripubblicando `dist/index.html`.
- Revisione indipendente del codice non ancora fatta.
