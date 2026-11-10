'use strict';
/*
 * Smoke tests for src/pdf.js. Run with:  node test/pdf.test.js
 * Generates the sample PDFs into out/ and checks them with the poppler tools
 * (pdfinfo, pdftotext), which must be on the PATH.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src', 'pdf.js');
const OUT = path.join(__dirname, '..', 'out');
const GymPdf = require(SRC);

const atleta = {
  nome: 'Rossi Maria Giovanna', nascita: '05/04/2015', luogo: "L'Aquila", cf: 'RSSMGV15D45A345X',
  indirizzo: 'Via dei Mille 76', citta: 'Magliano dei Marsi', cap: '67062'
};
const genitore = {
  nome: 'Rossi Antonio', cf: 'RSSNTN80A01A515Z', tel: '3331234567',
  email: 'antonio.rossi@example.it', tel2: '3337654321'
};
const societa = { legale: 'Mario Bianchi', ente: 'CSEN', codice: '12345' };

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });

// Structural checks that need no external tool.
function checkStructure(name, bytes) {
  ok(bytes instanceof Uint8Array, name + ': result is a Uint8Array');
  const s = latin1(bytes);
  ok(s.startsWith('%PDF-1.4'), name + ': starts with %PDF-1.4');
  ok(s.endsWith('%%EOF'), name + ': ends with %%EOF');
  // startxref must point at the xref table, and every entry at its "N 0 obj".
  const sx = /startxref\n(\d+)\n%%EOF$/.exec(s);
  ok(sx, name + ': has startxref');
  const xrefAt = +sx[1];
  ok(s.substr(xrefAt, 5) === 'xref\n', name + ': startxref offset is correct');
  const head = /^xref\n0 (\d+)\n/.exec(s.slice(xrefAt));
  const count = +head[1];
  const entries = s.slice(xrefAt + head[0].length).split('\n').slice(0, count);
  ok(entries[0] === '0000000000 65535 f ', name + ': free entry');
  for (let i = 1; i < count; i++) {
    ok(/^\d{10} 00000 n $/.test(entries[i]), name + ': xref entry ' + i + ' is well formed');
    const off = parseInt(entries[i], 10);
    ok(s.substr(off, (i + ' 0 obj\n').length) === i + ' 0 obj\n', name + ': xref offset of object ' + i);
  }
  // /Length of the content stream must match the real byte count.
  const st = /\/Length (\d+) >>\nstream\n/.exec(s);
  const start = st.index + st[0].length;
  ok(s.substr(start + (+st[1]), 10) === '\nendstream', name + ': stream /Length is correct');
  // Every line, rectangle and text origin must stay inside the 36 pt margins
  // (PDF space, origin bottom-left; the header band starts 30 pt from the top).
  const content = s.substr(start, +st[1]);
  const inside = (x, y) => x >= 35.99 && x <= 559.29 && y >= 36 && y <= 811.9;
  let m, shapes = 0;
  const lineRe = /(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g;
  while ((m = lineRe.exec(content))) { shapes++; ok(inside(+m[1], +m[2]) && inside(+m[3], +m[4]), name + ': line inside margins: ' + m[0]); }
  const rectRe = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re [fSB]/g;
  while ((m = rectRe.exec(content))) {
    shapes++;
    ok(inside(+m[1], +m[2]) && inside(+m[1] + (+m[3]), +m[2] + (+m[4])), name + ': rectangle inside margins: ' + m[0]);
  }
  const tmRe = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/g;
  while ((m = tmRe.exec(content))) { shapes++; ok(inside(+m[1], +m[2]), name + ': text origin inside margins: ' + m[0]); }
  ok(shapes > 40, name + ': drawing operators found');
  ok(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/.test(s), name + ': Helvetica, WinAnsi');
  ok(/\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/.test(s), name + ': Helvetica-Bold, WinAnsi');
  ok(!/\/FontFile/.test(s), name + ': fonts are not embedded');
}

// Writes the file, then checks it with pdfinfo / pdftotext. Returns the text.
function checkFile(name, bytes, strings) {
  checkStructure(name, bytes);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, bytes);

  const info = run('pdfinfo', [file]);
  ok(/^Pages:\s+1$/m.test(info), name + ': exactly 1 page');
  const size = /^Page size:\s+([\d.]+) x ([\d.]+) pts(.*)$/m.exec(info);
  ok(size, name + ': page size reported');
  ok(Math.abs(+size[1] - 595.28) < 0.05 && Math.abs(+size[2] - 841.89) < 0.05 && /A4/.test(size[3]), name + ': A4 size');
  ok(/^PDF version:\s+1\.4$/m.test(info), name + ': PDF version 1.4');

  // -layout keeps each form row in reading order; collapse all spacing (including the
  // line breaks of wrapped paragraphs) so that phrases can be matched as plain text.
  const text = run('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-']).replace(/\s+/g, ' ');
  strings.forEach((str) => ok(text.includes(str), name + ': text contains "' + str + '"'));

  // Nothing may leave the printable area: every word must sit inside the margins.
  const bbox = run('pdftotext', ['-bbox', file, '-']);
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g;
  let m, words = 0;
  while ((m = re.exec(bbox))) {
    words++;
    ok(+m[1] >= 35 && +m[3] <= 560.3 && +m[2] >= 28 && +m[4] <= 812, name + ': word "' + m[5] + '" inside the margins');
  }
  ok(words > 50, name + ': words found by pdftotext -bbox');
  return text;
}

fs.mkdirSync(OUT, { recursive: true });

// ---- API shape and module hygiene
assert.deepStrictEqual(Object.keys(GymPdf).sort(), ['moduloIscrizione', 'richiestaCertificato']);
const source = fs.readFileSync(SRC, 'utf8');
ok(fs.statSync(SRC).size < 35 * 1024, 'pdf.js is under 35 KB');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments stripped (crude but enough)
ok(!/\bBuffer\b|\brequire\s*\(|\bimport\s|\bprocess\.|\bwindow\.|\bdocument\./.test(code),
  'pdf.js uses no Buffer / require / import / Node or DOM globals');

// Browser-style loading: no `module`, the API lands on `self`.
const sandbox = { self: {}, Uint8Array: Uint8Array };
vm.runInNewContext(source, sandbox);
ok(typeof sandbox.self.GymPdf.moduloIscrizione === 'function' && typeof sandbox.self.GymPdf.richiestaCertificato === 'function',
  'global GymPdf is exposed when there is no module system');
ok(latin1(sandbox.self.GymPdf.moduloIscrizione()).startsWith('%PDF-1.4'), 'global build produces a PDF');

// ---- document 1: empty
const MODULO = [
  'A.S.D. GYM ART AVEZZANO', 'Via Ezio Tarantelli n.1 - 67051 Avezzano (AQ) - Ginnastica Artistica Femminile',
  'Email: gymartavezzano@gmail.com | IG: @gymart_avezzano', 'MODULO DI ISCRIZIONE - STAGIONE 2026/2027',
  'DATI ATLETA', 'Cognome e Nome Atleta:', 'Data di nascita:', 'Luogo:', 'C.F.:', 'Indirizzo:', 'Città:', 'CAP:',
  'Certificato Medico:', 'Non Agonistico', 'Scadenza:', 'Note sanitarie/Allergie:',
  'DATI GENITORE / TUTORE (per minorenni)', 'Secondo recapito Tel:',
  'SCELTA CORSO ARTISTICA - STAGIONE 2026/2027 (barrare)', 'ARTISTICA BABY (3-5 anni) - Avviamento al movimento',
  'CORSO BASE - Avviamento Ginnastica Artistica', 'CORSO AVANZATO - Perfezionamento Tecnico',
  'PRE-AGONISMO - Avvio percorso agonistico', 'AGONISMO - Squadra Agonistica', 'Giorni scelti:', 'Orario:',
  'Quota Iscrizione Annuale + Tesseramento €', 'Quota Mensile €', 'Sconto Fratelli:', 'Modalità pagamento:', 'IBAN:',
  'Carta/Bancomat', 'REGOLAMENTO SINTETICO',
  '1. Iscrizione valida Settembre 2026 - Giugno 2027. Obbligatorio certificato medico valido.',
  "Assenze dell'allieva non rimborsabili/recuperabili.", 'La palestra declina responsabilità per oggetti smarriti.',
  'CONSENSI OBBLIGATORI', 'Privacy GDPR - Autorizzo ASD Gym Art Avezzano', 'NON ACCONSENTO', 'Liberatoria Immagini',
  'NON AUTORIZZO', 'Avezzano, lì', 'Firma Genitore / Atleta maggiorenne leggibile',
  'Firma Legale Rappresentante ASD Gym Art', 'RISERVATO ALLA SEGRETERIA', 'Pagato:', 'Sì', 'Importo €', 'Metodo:',
  'POS', 'Data pagamento:', 'Abbonamento:', 'Trimestrale', 'Frequenza:', 'giorni/settimana', 'Data inizio:'
];
// The X mark of a ticked box is the only thing drawn with 1.2 pt strokes (two per box).
const tickStrokes = (bytes) => (latin1(bytes).match(/ 1\.2 w /g) || []).length;
const emptyModulo = GymPdf.moduloIscrizione();
checkFile('modulo_vuoto.pdf', emptyModulo, MODULO);
ok(tickStrokes(emptyModulo) === 0, 'modulo_vuoto: no box is ticked');

// ---- document 1: prefilled
const fullModulo = GymPdf.moduloIscrizione({
  stagione: '2026/2027', atleta: atleta, genitore: genitore, corso: 'base', giorni: ['Lun', 'Mer'], orario: '17:00'
});
checkFile('modulo_precompilato.pdf', fullModulo, MODULO.concat([
  'Rossi Maria Giovanna', '05/04/2015', "L'Aquila", 'RSSMGV15D45A345X', 'Via dei Mille 76',
  'Magliano dei Marsi', '67062', 'Rossi Antonio', 'RSSNTN80A01A515Z', '3331234567', 'antonio.rossi@example.it',
  '3337654321', '17:00'
]));
// corso 'base' + Lun + Mer = 3 ticked boxes = 6 strokes of the X mark; consent boxes stay empty.
ok(tickStrokes(fullModulo) === 6, 'modulo_precompilato: exactly 3 boxes are ticked');

// ---- document 2: competitive, prefilled
const RICHIESTA = [
  'A.S.D. GYM ART AVEZZANO', 'Al Medico certificatore /', 'Centro di Medicina dello Sport', 'Il/La sottoscritto/a',
  'legale rappresentante della A.S.D. Gym Art Avezzano', 'Via Ezio Tarantelli n. 1 - 67051', 'affiliata a',
  '(codice di affiliazione', 'CHIEDE', 'stagione sportiva 2026/2027', 'GINNASTICA ARTISTICA', "DATI DELL'ATLETA",
  'Cognome e Nome:', 'Nato/a a:', 'il:', 'Codice Fiscale:', 'Residente a:', 'CAP:', 'Indirizzo:',
  'GENITORE / TUTORE (per minorenni)', 'Telefono:',
  'Il certificato va consegnato in segreteria in originale o in copia leggibile.',
  "per l'attività agonistica, la data di scadenza.", 'Avezzano, lì', 'Timbro e firma del legale rappresentante',
  'Firma del genitore / tutore'
];
const ago = checkFile('richiesta_agonistico.pdf', GymPdf.richiestaCertificato({
  tipo: 'agonistico', stagione: '2026/2027', atleta: atleta, genitore: genitore, societa: societa, data: '10/11/2026'
}), RICHIESTA.concat([
  "L'IDONEITÀ", 'PRATICA SPORTIVA AGONISTICA', '(D.M. 18/02/1982)', "che l'atleta sotto indicato/a, tesserato/a",
  "dell'idoneità alla pratica sportiva agonistica per la disciplina:", 'Mario Bianchi', 'CSEN', '12345',
  'Rossi Maria Giovanna', "L'Aquila", '05/04/2015', 'RSSMGV15D45A345X', 'Magliano dei Marsi', '67062',
  'Via dei Mille 76', 'Rossi Antonio', '3331234567', '10/11/2026'
]));
ok(!ago.includes('NON AGONISTICA'), 'richiesta_agonistico: no non-competitive title');

// ---- document 2: non competitive (default), empty
const non = checkFile('richiesta_non_agonistico_vuota.pdf', GymPdf.richiestaCertificato(), RICHIESTA.concat([
  'RICHIESTA DI CERTIFICATO MEDICO', 'ATTIVITÀ SPORTIVA NON AGONISTICA', "che all'atleta sotto indicato/a, iscritto/a",
  "il certificato medico per l'attività sportiva non agonistica per la disciplina:"
]));
ok(!non.includes('D.M. 18/02/1982'), 'richiesta_non_agonistico: no decree line');

// ---- robustness (written to out/ as well, handy for a visual check)
const weird = {
  stagione: '2027/28', corso: 'Pre-Agonismo', giorni: 'Martedì, Sab', orario: 1730,
  atleta: {
    nome: 'Zoë Müller (detta "Zo\\è") Łódź 日本 ' + 'Lunghissimo '.repeat(30), nascita: null, luogo: 'Avezzano'.repeat(20),
    cf: undefined, indirizzo: 'Via Roma 1 '.repeat(20), citta: 'Città Sant’Angelo', cap: 65013
  },
  genitore: { nome: 'De Sanctis Niccolò', email: 'x'.repeat(200) + '@example.it', tel: '+39 333 1234567', tel2: '' }
};
const weirdText = checkFile('modulo_robustezza.pdf', GymPdf.moduloIscrizione(weird), [
  'MODULO DI ISCRIZIONE - STAGIONE 2027/28', 'Settembre 2027 - Giugno 2028', 'Zoë Müller (detta "Zo\\è") ?ód? ??',
  'Città Sant’Angelo', 'De Sanctis Niccolò', '65013', '1730'
]);
ok(!weirdText.includes('@example.it'), 'over-long values are cut, not overflowed');
checkFile('richiesta_robustezza.pdf', GymPdf.richiestaCertificato({
  tipo: 'AGONISTICO', atleta: weird.atleta, genitore: weird.genitore,
  societa: { legale: 'Nome Lunghissimo '.repeat(12), ente: 'Federazione Ginnastica d’Italia', codice: 'AQ-000123' }
}), ["L'IDONEITÀ", 'Federazione Ginnastica d’Italia', 'AQ-000123']);
[null, {}, { atleta: null, genitore: null, giorni: null, corso: null }].forEach((arg) => {
  ok(GymPdf.moduloIscrizione(arg).length > 1000 && GymPdf.richiestaCertificato(arg).length > 1000, 'tolerates sparse input');
});

console.log('OK - ' + checks + ' checks passed. PDFs written to ' + OUT);
