'use strict';
// The assistant of the Windows program (win/web/assistente.js): a battery of questions, each one must reach its own answer.
// The rules grow with every version: a new rule must not take the questions of another one (1.31.0: «cosa devo controllare?»
// looked for the students called Costa, «chi non ha il certificato?» gave the summary, «chi viene oggi?» gave the advice of the day).
// Every topic is asked in more ways («mi dici…», «per favore…», «…grazie»). The archive is invented: 120 students, no real data.
// Run: node --test test/win.assistente.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');
const A = require('../win/web/assistente.js');

const OGGI = '2026-11-27'; // a Friday
const COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo'];
const NOMI = ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma'];

function archivio() {
  const ora = OGGI + 'T09:00:00', db = L.nuovoArchivio(OGGI);
  const corsi = ['Base', 'Avanzato', 'Propedeutico', 'Preagonismo', 'Agonismo'];
  let e = 0, pg = 0;
  for (let i = 0; i < 120; i++) {
    const id = String(i + 1).padStart(4, '0'), cg = COGNOMI[i % 20], nm = NOMI[Math.floor(i / 20) % 6];
    const anno = i % 15 === 0 ? 1998 + (i % 7) : 2010 + (i % 11), cert = i % 10;
    const a = { id, name: cg + ' ' + nm, nascita: anno + '-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0'), luogo: 'Avezzano', cf: i % 3 ? '' : 'XXXXXX00X00X000X',
      indirizzo: 'Via Roma ' + (i + 1), citta: ['Avezzano', 'Celano', 'Luco dei Marsi'][i % 3], cap: '67051', genitore: i % 17 === 0 ? '' : cg + ' ' + ['Paolo', 'Luca', 'Marco', 'Anna'][i % 4], cfGenitore: '',
      tel: i % 23 === 0 ? '' : '3' + String(330000000 + i * 7919).slice(0, 9), tel2: '', email: i % 4 ? '' : 'prova' + i + '@esempio.it', privacy: 'Sì', liberatoria: 'Sì', dataModulo: '', tessera: '', note: '',
      archiviata: false, creata: ora, modificata: ora };
    if (cert < 4) Object.assign(a, { certTipo: i % 3 ? 'Non Agonistico' : 'Agonistico', certRilascio: '2026-0' + (1 + cert) + '-10', certScadenza: '2027-0' + (1 + cert) + '-10' });
    else if (cert === 4) Object.assign(a, { certTipo: 'Non Agonistico', certRilascio: '2025-12-05', certScadenza: '2026-12-05' });
    else if (cert === 5) Object.assign(a, { certTipo: 'Agonistico', certRilascio: '2025-10-01', certScadenza: '2026-10-01' });
    db.allieve.push(a);
    const isc = { id: String(++e).padStart(4, '0'), allievaId: id, corso: corsi[i % 5], giorni: [['Lun', 'Mer'], ['Mar', 'Gio'], ['Ven'], ['Lun', 'Ven'], []][i % 5], fascia: i % 7 === 0 ? '18:30' : '', pacchetto: '',
      tipo: ['Mensile', 'Trimestrale', 'Annuale', ''][i % 4], inizio: i % 4 === 3 ? '' : '2026-' + ['09', '10', '11'][i % 3] + '-15', quota: [170, 170, 195, 200, 255][i % 5], annullata: false, storica: false, note: '', creata: ora, modificata: ora };
    db.iscrizioni.push(isc);
    if (i % 2 === 0) { pg++; db.pagamenti.push({ id: String(pg).padStart(4, '0'), iscrizioneId: isc.id, data: '2026-' + ['09', '10', '11'][i % 3] + '-' + String(1 + (i % 25)).padStart(2, '0'), importo: i % 4 === 0 ? isc.quota : 105, metodo: i % 5 === 0 ? 'Bonifico' : 'Contanti', ricevuta: 'RIC-' + isc.id + '-1', note: '', creata: ora }); isc.ricevute = 1; }
  }
  db.pagamenti.push({ id: String(++pg).padStart(4, '0'), iscrizioneId: '0002', data: OGGI, importo: 50, metodo: 'Contanti', ricevuta: 'RIC-0002-2', note: '', creata: ora }); // the cash of today
  db.prossimi = { allieva: 121, iscrizione: e + 1, pagamento: pg + 1 };
  const err = L.validaArchivio(db); if (err) throw new Error(err);
  return db;
}

// [what the title of the right answer looks like, the questions]
const ARGOMENTI = [
  // certificates
  [/certificat[oi] scadut|Nessun certificato scaduto/, ['certificati scaduti', 'chi ha il certificato scaduto', 'quali certificati sono scaduti', 'elenco dei certificati scaduti']],
  [/^Certificati: /, ['certificati in scadenza', 'chi ha il certificato in scadenza', 'certificati da rinnovare']],
  [/senza certificato|Nessun certificato mancante/, ['certificati mancanti', 'chi non ha il certificato', 'chi è senza certificato', 'chi non ha ancora portato il certificato']],
  [/portare il certificato/, ['chi deve portare il certificato', 'chi deve ancora consegnare il certificato', 'certificati in attesa']],
  [/certificat[oi] scad[eo]|Nessun certificato scade/, ['certificati che scadono a dicembre', 'certificati che scadono questo mese', 'quali certificati scadono la prossima settimana']],
  [/certificato agonistico/, ['chi ha il certificato agonistico', 'quali allieve hanno il certificato agonistico']],
  // payments
  [/iscrizion[ei] con qualcosa da pagare|niente da incassare/, ['chi deve pagare', 'chi deve ancora pagare', 'chi non ha pagato', 'chi deve ancora saldare', 'morosi', 'chi deve pagare adesso', 'chi deve pagare oggi']],
  [/senza nessun pagamento/, ['chi non ha pagato niente', 'chi non ha versato nulla', 'iscrizioni senza nessun pagamento']],
  [/pagate in parte/, ['chi ha dato un acconto', 'chi ha pagato solo una parte', 'acconti']],
  [/^Incassati oggi/, ['incassi di oggi', 'quanto ho incassato oggi', 'pagamenti di oggi']],
  [/^Incassati questa settimana/, ['incassi di questa settimana', 'quanto ho incassato questa settimana']],
  [/^Incassati a ottobre/, ['incassi di ottobre', 'quanto ho incassato a ottobre', 'pagamenti di ottobre']],
  [/^Incassati questo mese/, ['incassi di questo mese', 'quanto ho incassato questo mese']],
  [/^Incassati nella stagione/, ['incassi della stagione', 'quanto ho incassato nella stagione']],
  [/nel corso Base/, ['quanto ho incassato nel corso Base', 'quanto manca da incassare nel corso Base', 'certificati che scadono a dicembre nel corso Base']],
  [/in contanti/, ['chiusura di cassa', 'quanto c è in cassa', 'pagamenti in contanti di oggi']],
  [/bonific/, ['bonifici da verificare', 'quanti bonifici ho ricevuto', 'bonifici di ottobre']],
  [/^Ultim[ei] (pagamenti|ricevute)/, ['ultimi pagamenti', 'gli ultimi pagamenti registrati', 'ultima ricevuta']],
  [/^Prezzi/, ['quanto costa il corso Base', 'prezzi', 'listino', 'tariffe del corso Agonismo']],
  [/^(Quota media|Le quote più)/, ['quota media', 'quota media del corso Base', 'quote più alte']],
  // subscriptions
  [/abbonament[oi] scad|Nessun abbonamento scade/, ['chi rinnova a dicembre', 'abbonamenti che scadono la prossima settimana', 'chi scade questo mese']],
  [/abbonament[oi] scadut|in scadenza|Nessun abbonamento scaduto/, ['abbonamenti scaduti', 'chi ha l abbonamento scaduto', 'rinnovi', 'chi deve rinnovare']],
  [/abbonament[oi] mensil/, ['chi ha l abbonamento mensile', 'quanti abbonamenti mensili ci sono']],
  [/da completare|hanno tipo e data/, ['iscrizioni da completare', 'iscrizioni senza tipo', 'quante iscrizioni sono incomplete']],
  // students
  [/allieve, \d+ iscrizion[ei] apert[ae]/, ['quante allieve ci sono', 'quante sono le iscritte', 'numero di allieve']],
  [/minorenni su/, ['quante minorenni ci sono', 'chi è minorenne', 'elenco delle minorenni']],
  [/con più di 15 anni/, ['chi ha più di 15 anni', 'allieve con più di 15 anni']],
  [/vengono il lunedì|viene il lunedì/, ['chi viene il lunedì', 'chi c è il lunedì', 'lezioni del lunedì', 'quante vengono il lunedì']],
  [/vengono il lunedì e il mercoledì|viene il lunedì e il mercoledì/, ['chi viene il lunedì e il mercoledì']],
  [/non vengono il venerdì|non viene il venerdì/, ['chi non viene il venerdì']],
  [/vengono (oggi, venerdì|domani, sabato)|viene (oggi, venerdì|domani, sabato)/, ['chi viene oggi', 'chi c è oggi', 'chi viene domani', 'lezioni di oggi']],
  [/^Corso Base: /, ['chi fa il corso Base', 'elenco del corso Base', 'iscritte al corso Base']],
  [/senza un telefono valido|hanno un telefono valido/, ['chi non ha il telefono', 'allieve senza telefono', 'chi non ha il numero di telefono']],
  [/senza il codice fiscale|hanno il codice fiscale/, ['chi non ha il codice fiscale', 'allieve senza codice fiscale']],
  [/famigli/, ['sorelle', 'famiglie con più allieve', 'chi ha lo stesso genitore', 'sorelle minorenni']],
  [/più iscrizioni aperte|più di un'iscrizione/, ['chi ha due iscrizioni', 'chi fa più di un corso']],
  [/in regola/, ['chi non è in regola', 'chi è in regola', 'allieve non in regola']],
  [/in breve/, ['riepilogo', 'come va la stagione', 'situazione generale']],
  [/abita|abitano|Dove abitano/, ['chi abita ad Avezzano', 'dove abitano le allieve']],
  [/ompleann/, ['compleanni', 'chi compie gli anni questa settimana', 'compleanni di dicembre', 'compleanni di oggi']],
  [/allieve? (nuov|inserit)|Nessuna allieva (nuova|inserita)/, ['allieve nuove', 'chi si è iscritta da poco', 'chi si è iscritta a novembre']],
  // more conditions together (1.31.0)
  [/^(\d+ alliev[ae]|Nessuna allieva) minorenn[ei] senza certificato/, ['minorenni senza certificato', 'allieve minorenni senza certificato']],
  [/^(\d+ alliev[ae]|Nessuna allieva) del corso Agonismo con il certificato scaduto/, ['chi del corso Agonismo ha il certificato scaduto']],
  [/^(\d+ alliev[ae]|Nessuna allieva) di Celano con qualcosa da pagare/, ['allieve di Celano che devono pagare', 'chi abita a Celano e deve pagare']],
  [/^(\d+ alliev[ae]|Nessuna allieva) maggiorenn[ei] senza un telefono valido/, ['maggiorenni senza telefono']],
  [/^(\d+ certificat[oi] scad(e|ono)|Nessun certificato scade) a dicembre 2026 \(minorenni\)/, ['certificati delle minorenni che scadono a dicembre']],
  [/^(\d+ certificat[oi] scad(e|ono)|Nessun certificato scade) a dicembre 2026 \(maggiorenni\)/, ['certificati delle maggiorenni che scadono a dicembre']], // «maggiorenni» is not May
  [/^(\d+ abbonament[oi] scad(e|ono)|Nessun abbonamento scade) a dicembre 2026 \(minorenni\)/, ['abbonamenti delle minorenni che scadono a dicembre']],
  [/^Incassati a ottobre 2026 \(minorenni\)/, ['quanto ho incassato dalle minorenni a ottobre']],
  // one person (the surname alone is enough)
  [/Rossi Giulia/, ['quanto deve Rossi Giulia', 'Rossi Giulia ha pagato', 'il certificato di Rossi Giulia', 'telefono di Rossi Giulia', 'quanti anni ha Rossi Giulia', 'Rossi Giulia è in regola', 'che corso fa Rossi Giulia']],
  // the program
  [/^Versione/, ['che versione è', 'il programma è aggiornato']],
  [/I dati sono/, ['dove sono i dati', 'cartella dei dati']],
  [/^Copie di sicurezza/, ['copie di sicurezza', 'backup', 'le copie sono a posto']],
  [/note|nota/, ['note', 'note da fare']],
  [/^Consigli per oggi/, ['che cosa devo fare oggi', 'consigli', 'priorità', 'cosa devo controllare']],
  [/avvis/, ['chi devo avvisare', 'a chi devo scrivere', 'messaggi da mandare']],
  [/date|data/, ['date sbagliate', 'controlla le date dei pagamenti', 'pagamenti con date strane']],
  [/programma non funziona/, ['il programma non funziona', 'mi dà errore', 'non si apre']],
];
const PRIMA = ['', 'mi dici ', 'per favore ', 'scusa, '], DOPO = ['', '?', ' grazie'];

test('assistant battery: every question reaches its own answer, however it is asked', () => {
  const db = archivio(), sbagliate = [];
  let n = 0;
  for (const [re, domande] of ARGOMENTI) for (const d of domande) for (const p of PRIMA) for (const s of DOPO) {
    const q = p + d + s, r = A.rispondi(db, q, OGGI, { ora: 10, versione: '9.9.9', cartella: 'C:\\Prova' });
    n++;
    if (!re.test(r.titolo)) sbagliate.push(q + ' → ' + r.titolo);
  }
  assert.ok(n > 1500, n + ' questions');
  assert.deepEqual(sbagliate.slice(0, 20), [], sbagliate.length + ' of ' + n + ' questions reached another answer');
});

test('assistant battery: a common word is not taken for a surname written a bit wrong, a surname with a letter wrong is found', () => {
  const db = archivio();
  const t = (q) => A.rispondi(db, q, OGGI, {}).titolo;
  for (const q of ['cosa devo controllare?', 'come faccio il conto?', 'cosa manca?', 'dove sono le copie?']) assert.ok(!/Costa|Conti|Ho trovato/.test(t(q)), q + ' → ' + t(q));
  assert.match(t('quanto deve Rosi Giulia?'), /Rossi Giulia/, 'a letter missing');
  assert.match(t('quanto deve Rsosi Giulia?'), /Rossi Giulia/, 'two letters swapped');
});
