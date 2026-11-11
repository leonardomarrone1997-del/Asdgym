# Piano di lavoro (da eseguire in ordine)

Prima leggi CLAUDE.md. Scrivi sempre in italiano, in modo breve. Tieni una lista attività e aggiornala.
Regola fissa: sul foglio Google si legge liberamente, ma prima di OGNI scrittura mostra cosa cambierà e aspetta il sì del responsabile. Nessun dato reale nei file del progetto.

## Fase 1 - Da solo, senza scrivere sul foglio
1. `node --test test/core.test.js` (attesi 53 test) e `node test/pdf.test.js`.
2. `node build.js` e `node build_gas.js`: devono generare dist/index.html e gas/Pagina.html senza errori.
3. Leggi con il connettore Google Sheets (solo lettura) le intestazioni di ANAGRAFICA, ISCRIZIONI, PAGAMENTI, REGISTRO SCANSIONI, LISTE, TARIFFARIO e controlla che i nomi colonna coincidano con quelli che il codice cerca (core.js, parseStudents/parseEnrollments/parsePayments/parseRegistro/parseListe/parseTariffario).
4. Fai una revisione indipendente del codice con un agente separato (che non ha scritto il codice): logica di scrittura, rilettura di verifica, codici fiscali, date, importi, registro. Correggi i difetti, aggiungi test, rilancia tutto.
5. Limiti noti: resta da risolvere quello delle omonime. Già risolti con test: telefoni esteri, maiuscole negli indirizzi ("Via XX Settembre"), giorni del codice fiscale impossibili (00, 32-40).
6. Prova nel browser con foglio simulato (mock/): crea un data.json con dati FINTI nella forma attesa da mock/mock.js e lancia mock/run.py e mock/run_gas.py.

## Fase 2 - Due pendenze sul foglio (chiedi i dati al responsabile)
I nomi delle due allieve non si scrivono in questo file: chiedili al responsabile.
- Prima allieva: registrare il pagamento. Chiedi importo, metodo e data; poi usa il flusso pagamenti con preverifica e registro.
- Seconda allieva: completare tipo abbonamento e data di inizio. Chiedili al responsabile.
Per entrambe: cerca la riga per nome, mostra la preverifica, scrivi solo dopo il sì, rileggi e confronta con il registro.

## Fase 3 - Collaudo sul foglio vero
Con il responsabile: tre inserimenti di prova (allieva nuova, certificato, pagamento) da foto vere. Dopo ognuno rileggi la riga, confronta il registro e riferisci. Se c'è qualcosa di diverso dal previsto, fermati e segnala.

## Fase 4 - Versione senza Claude (collega)
Mai eseguita dentro Google. Guida il responsabile passo passo con gas/Guida_installazione.txt (creazione progetto Apps Script, servizio Sheets avanzato, distribuzione, condivisione come editor alla collega). Poi collaudo con un inserimento di prova.

## Fase 5 - Decisioni da chiedere
Abbonamento Semestrale "da confermare" nel TARIFFARIO: chiedi la tariffa corretta prima di usarlo.

## Alla fine
Rapporto breve: cosa è stato fatto, cosa è stato verificato, cosa resta. Ricorda che la pagina pubblicata su Claude va ripubblicata con la nuova dist/index.html se il codice è cambiato.
