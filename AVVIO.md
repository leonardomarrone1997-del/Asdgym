# Avvio su Claude Code

## 1. Preparazione (una volta sola)
1. Installa Claude Code (guida ufficiale: https://docs.claude.com/en/docs/claude-code/overview) e accedi con lo stesso account di Claude.
2. Installa Node.js 18 o superiore (serve per costruire la pagina e lanciare i test).
3. Scompatta lo zip in una cartella tua, per esempio `Documenti/gym-art-segreteria`.
4. Collega Google Sheets a Claude Code (connettore "Google Sheets", stesso account Google del foglio), così Claude può leggere e scrivere sul gestionale.

## 2. Primo avvio
Apri il terminale nella cartella e scrivi `claude`. Claude legge da solo `CLAUDE.md`.
Controllo iniziale: `node --test test/core.test.js` deve dare 53 test passati.

## 3. Primo messaggio da incollare
"Leggi CLAUDE.md e PIANO.md ed esegui il piano in ordine, partendo dalla Fase 1. Chiedimi i dati che mancano e non scrivere nel foglio senza il mio permesso."

## 4. Regole da ricordare
- Nel codice e nella cartella non vanno mai dati reali di allieve (nomi, codici fiscali, foto, esportazioni del foglio). I dati veri stanno solo nel foglio Google.
- Prima di ogni scrittura sul foglio Claude mostra cosa cambierà; dopo la scrittura rilegge e controlla il registro.
- Non scrivere dal foglio da due dispositivi nello stesso momento.

## 5. Cose ancora da fare
- Prova con tre inserimenti (allieva nuova, certificato, pagamento) e verifica sul foglio.
- Collaudo della versione Apps Script (`gas/`) dentro Google e condivisione con la collega.
- Revisione indipendente del codice.
- Limiti noti: telefoni esteri, omonime, maiuscole negli indirizzi, abbonamento Semestrale "da confermare".

## 6. Nota
La pagina già pubblicata su Claude resta com'è. Le modifiche fatte in Claude Code cambiano il codice in `src/` e i file generati in `dist/` e `gas/`; per vederle nella pagina pubblicata va ripubblicata la nuova `dist/index.html`.
