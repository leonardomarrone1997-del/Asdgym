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
- Provata solo su foglio simulato; da collaudare sul foglio vero e con foto vere.
- Versione Apps Script mai eseguita dentro Google.
- Limiti noti: telefoni esteri rifiutati, omonime non distinte, "Via XX Settembre" -> "Via Xx Settembre",
  due inserimenti contemporanei da dispositivi diversi possono finire sulla stessa riga.
- Revisione indipendente del codice non ancora fatta.
