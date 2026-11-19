'use strict';
// Prepara la cartella "aggiornamenti" del repository: il programma nuovo e il file aggiornamento.json che i computer della palestra leggono
// per sapere che c'è una versione più nuova. Si usa dopo aver costruito il programma:
//   node build_win.js && node tools/pubblica.js
// poi si fa il commit e il push della cartella "aggiornamenti" (lo fa chi pubblica, mai il programma).
// Il file aggiornamento.json dice versione, data, novità (da win/web/novita.js), nome del file, dimensione e impronta SHA-256: il programma sul computer
// scarica il file solo se la persona lo chiede, e lo installa solo se l'impronta combacia.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RE_VERSIONE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MIN = 1 << 20, MAX = 150 << 20; // gli stessi limiti del programma (win/aggiorna.go)

/** La versione scritta in win/main.go. */
function versioneDelProgramma(root) {
  const m = /var version = "(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(path.join(root || ROOT, 'win', 'main.go'), 'utf8'));
  if (!m) throw new Error('Non trovo la versione in win/main.go.');
  return m[1];
}

/**
 * opz = { exe: percorso del programma costruito, versione, uscita: cartella "aggiornamenti", novita: l'elenco di win/web/novita.js, oggi: 'AAAA-MM-GG' }.
 * Restituisce il manifesto scritto.
 */
function pubblica(opz) {
  const { exe, versione, uscita, novita } = opz;
  if (!RE_VERSIONE.test(versione)) throw new Error('Versione non valida: ' + versione);
  const b = fs.readFileSync(exe);
  if (b.length < MIN || b.length > MAX) throw new Error('Il programma ha una dimensione che non è credibile: ' + b.length + ' byte.');
  if (b[0] !== 0x4d || b[1] !== 0x5a) throw new Error('Il file non è un programma per Windows (manca "MZ" all\'inizio): è quello giusto?');
  const voce = (novita || []).find((n) => n.v === versione);
  if (!voce) throw new Error('Manca la voce della versione ' + versione + ' in win/web/novita.js: scrivi che cosa c\'è di nuovo prima di pubblicare.');
  if (!voce.titolo || !voce.voci || !voce.voci.length) throw new Error('La voce ' + versione + ' di novita.js non ha titolo o novità.');
  fs.mkdirSync(uscita, { recursive: true });
  const file = 'GymArtSegreteria-' + versione + '.exe';
  // resta solo l'ultima versione: le vecchie non servono (nella storia del repository ci sono ancora)
  for (const f of fs.readdirSync(uscita)) if (/^GymArtSegreteria-\d+\.\d+\.\d+\.exe$/.test(f) && f !== file) fs.unlinkSync(path.join(uscita, f));
  fs.writeFileSync(path.join(uscita, file), b);
  const manifesto = {
    versione, data: opz.oggi || new Date().toISOString().slice(0, 10), titolo: voce.titolo,
    novita: voce.voci.map((x) => Object.assign({ titolo: x.t, testo: x.d }, x.vai ? { vai: x.vai } : {})),
    correzioni: voce.correzioni || [], file, sha256: crypto.createHash('sha256').update(b).digest('hex'), dimensione: b.length,
  };
  fs.writeFileSync(path.join(uscita, 'aggiornamento.json'), JSON.stringify(manifesto, null, 2) + '\n');
  return manifesto;
}

if (require.main === module) {
  try {
    const versione = versioneDelProgramma();
    const exe = path.join(ROOT, 'win', 'build', 'GymArtSegreteria.exe');
    if (!fs.existsSync(exe)) throw new Error('Non c\'è ' + exe + ': costruisci prima il programma con "node build_win.js".');
    const m = pubblica({ exe, versione, uscita: path.join(ROOT, 'aggiornamenti'), novita: require(path.join(ROOT, 'win', 'web', 'novita.js')) });
    console.log('Pubblicata la versione ' + m.versione + ' in aggiornamenti/ (' + (m.dimensione / 1048576).toFixed(1) + ' MB, SHA-256 ' + m.sha256.slice(0, 16) + '…).');
    console.log('Ora: git add aggiornamenti && git commit && git push. I computer della palestra la vedono al prossimo controllo.');
  } catch (e) { console.error('Non pubblicato: ' + e.message); process.exit(1); }
}

module.exports = { pubblica, versioneDelProgramma };
