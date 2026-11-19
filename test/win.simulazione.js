'use strict';
// Simulazione a lungo termine della logica dell'archivio: migliaia di operazioni casuali (come mesi di lavoro della segreteria)
// su un archivio partito dal file Excel finto o da zero, con controlli di coerenza dopo ogni operazione.
// Uso: node test/win.simulazione.js [semi=8] [operazioni=2500]      (ogni persona è inventata)
process.env.GYMART_AGGIORNAMENTI_NO_AUTO = '1'; // the tests never go on the internet to look for an update
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../win/web/logic.js');
const C = require('../win/web/core.js');
const X = require('../win/web/xlsx.js');
const { controlla } = require('./invarianti.js');

const SEMI = parseInt(process.argv[2], 10) || 8, OPS = parseInt(process.argv[3], 10) || 2500;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cent = (n) => Math.round(n * 100) / 100;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
function addDays(iso, n) { const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)); return d.toISOString().slice(0, 10); }

const COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Russo', 'Ferrari', 'Esposito', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', "D'Angelo", 'De Luca', 'Dell\'Orso', 'Marrone'];
const NOMI = ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma', 'Giorgia', 'Greta', 'Beatrice', 'Anna', 'Maria Luisa', 'Noemi', 'Francesca'];
const METODI = ['Contanti', 'Bonifico', 'POS', 'bonifico', 'CONTANTI'];

async function archivioIniziale(daExcel, today, adesso) {
  let db = L.nuovoArchivio(today);
  if (!daExcel) return db;
  const sheets = await X.leggiXlsx(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/gestionale-finto.xlsx'))));
  const get = (n) => L.riconosciFoglio(sheets.find((s) => s.nome === n).rows).vals;
  db = L.importaAnagrafica(db, get('ANAGRAFICA'), adesso).db;
  db = L.importaIscrizioni(db, get('ISCRIZIONI'), adesso).db;
  db = L.importaPagamenti(db, get('PAGAMENTI'), adesso).db;
  return db;
}

async function simula(seme, daExcel) {
  const r = rng(seme), pick = (a) => a[Math.floor(r() * a.length)], chance = (p) => r() < p, int = (a, b) => a + Math.floor(r() * (b - a + 1));
  let oggi = '2026-11-18', adesso = () => oggi + 'T10:' + String(int(0, 59)).padStart(2, '0') + ':00';
  let db = await archivioIniziale(daExcel, oggi, adesso());
  controlla(db, oggi, 'inizio');
  const stats = {}, errori = {};
  const conta = (k) => { stats[k] = (stats[k] || 0) + 1; };
  const attesi = /Scegli|servono|non trovata|già chiusa|non è più aperta|Stagione|data|nulla da fare|non valid|Tipo di promemoria|non si può eliminare|pagamenti registrati|Inserisci|Allieva|Iscrizione|Scrivi il testo|troppo lung|fino al/i;
  const nuovaAllieva = () => ({ name: pick(COGNOMI) + ' ' + pick(NOMI), nascita: addDays(oggi, -int(2200, 6500)), tel: '3' + String(int(100000000, 999999999)), genitore: pick(COGNOMI) + ' Marco', citta: 'Avezzano', privacy: 'Sì' });
  const campiRandom = () => pick([{ tel: '3' + int(100000000, 999999999) }, { email: 'a' + int(1, 99) + '@example.com' }, { certTipo: pick(['Agonistico', 'Non Agonistico', 'Ludico-motoria']), certRilascio: addDays(oggi, -int(1, 400)) }, { note: 'nota ' + int(1, 99) }, { citta: pick(['Avezzano', 'Celano', 'Magliano dei Marsi']) }]);
  const corrente = () => db.iscrizioni.filter((e) => L.corrente(e));
  const ops = {
    nuovaAllieva() { const f = nuovaAllieva(); const c = L.controllaAllieva(db, f, null, oggi); if (c.errors.length) return conta('allieva rifiutata dai controlli'); return L.salvaAllieva(db, null, f, adesso()); },
    modificaAllieva() { const a = pick(db.allieve); if (!a) return null; const f = Object.assign({}, a, campiRandom()); const c = L.controllaAllieva(db, f, a.id, oggi); if (c.errors.length) return conta('modifica rifiutata dai controlli'); return L.salvaAllieva(db, a.id, f, adesso()); },
    nuovaIscrizione() { const a = pick(db.allieve.filter((x) => !x.archiviata)); if (!a) return null; const [pk] = [pick(db.tariffario)]; const f = { allievaId: a.id, corso: pick(db.liste.corsi), giorni: pick([['Lun', 'Mer'], ['Sab'], ['Mar', 'Gio', 'Sab']]), fascia: pick(['', '16:00-17:00']), pacchetto: pk.chiave, tipo: pick(['Mensile', 'Trimestrale', 'Annuale', '']), inizio: addDays(oggi, int(-40, 20)), quota: chance(0.2) ? String(int(20, 400)) : '' }; const c = L.controllaIscrizione(db, f, null); if (c.errors.length) return conta('iscrizione rifiutata dai controlli'); return L.salvaIscrizione(db, null, f, adesso()); },
    rinnova() { const e = pick(corrente()); return e ? L.rinnova(db, e.id, adesso(), oggi) : null; },
    pagamento() { const e = pick(db.iscrizioni.filter((x) => !x.annullata)); if (!e) return null; const c = L.conto(db, e); const importo = pick([c.residuo > 0 ? c.residuo : 10, int(1, 90), '35,50', '12.25', 0, -5, '', 'abc']); return L.salvaPagamento(db, { iscrizioneId: e.id, data: addDays(oggi, -int(0, 12)), importo, metodo: chance(0.1) ? '' : pick(METODI), note: chance(0.2) ? 'saldo' : '' }, adesso()); },
    verifica() { const p = pick(db.pagamenti.filter((x) => L.richiedeVerifica(x.metodo))); return p ? L.verificaPagamento(db, p.id, chance(0.7), adesso()) : null; },
    eliminaPagamento() { const p = pick(db.pagamenti); return p ? L.eliminaPagamento(db, p.id) : null; },
    annullaIscrizione() { const e = pick(db.iscrizioni); if (!e) return null; return L.salvaIscrizione(db, e.id, Object.assign({}, e, { annullata: !e.annullata, quota: e.quota === null ? '' : e.quota, quotaIscrizione: e.quotaIscrizione === null ? '' : e.quotaIscrizione }), adesso()); },
    archivia() { const a = pick(db.allieve); return a ? L.archiviaAllieva(db, a.id, !a.archiviata, adesso()) : null; },
    eliminaAllieva() { const a = pick(db.allieve); return a ? L.eliminaAllieva(db, a.id) : null; },
    eliminaIscrizione() { const e = pick(db.iscrizioni); return e ? L.eliminaIscrizione(db, e.id) : null; },
    nuovaStagione() {
      if (!chance(0.1)) return null;
      const stag = L.stagioneSuccessiva(db.impostazioni.stagione), piano = L.pianoStagione(db, oggi, L.inizioStagione(stag)), scelte = {};
      piano.righe.forEach((x) => { scelte[x.iscrizione.id] = pick(['rinnova', 'rinnova', 'chiudi', 'lascia']); });
      const o = { stagione: stag, inizio: L.inizioStagione(stag), scelte, quotaIscrizione: chance(0.5), mantieniQuote: chance(0.5) };
      const prima = { pagato: cent(db.pagamenti.reduce((s, p) => s + p.importo, 0)), n: db.iscrizioni.length };
      const res = L.nuovaStagione(db, o, adesso(), oggi);
      assert.equal(cent(res.db.pagamenti.reduce((s, p) => s + p.importo, 0)), prima.pagato, 'la nuova stagione non deve toccare i pagamenti');
      for (const [id, sc] of Object.entries(scelte)) { const dopo = res.db.iscrizioni.find((e) => e.id === id); if (sc !== 'lascia') assert.equal(L.corrente(dopo), false, 'chiusa/rinnovata ma ancora aperta'); else assert.equal(L.corrente(dopo), true); }
      assert.equal(res.db.iscrizioni.length, prima.n + res.riepilogo.rinnovate);
      return res;
    },
    promemoria() { const el = L.elencoPromemoria(db, oggi, { contatto: 'tutte' }); const x = pick(el.righe); return x ? L.segnaPromemoria(db, { tipo: x.tipo, rif: x.rif, scadenza: x.scadenza, on: chance(0.8) }, adesso(), oggi) : null; },
    tariffe() { const f = { stagione: db.impostazioni.stagione, preavvisoAbb: String(int(5, 60)), preavvisoCert: String(int(5, 60)), corsi: db.liste.corsi.join('\n'), fasce: db.liste.fasce.join('\n'), metodi: db.liste.metodi.join('\n'), tariffario: db.tariffario.map((p) => ({ pacchetto: p.pacchetto, frequenza: p.frequenza, Mensile: String(p.Mensile === null ? '' : p.Mensile + int(0, 5)), Trimestrale: String(p.Trimestrale === null ? '' : p.Trimestrale), Annuale: String(p.Annuale === null ? '' : p.Annuale), iscrizione: String(p.iscrizione || '') })) }; if (L.controllaImpostazioni(f).length) return conta('impostazioni rifiutate'); return L.salvaImpostazioni(db, f); },
    nuovaNota() { const f = { testo: pick(['Chiamare il comune', 'Ordinare le tute', 'Pagare l\'affitto', '', 'x'.repeat(1100)]), data: pick(['', addDays(oggi, -int(0, 12)), addDays(oggi, int(0, 40)), '31/02/2026']), dataFine: pick(['', '', addDays(oggi, int(0, 60)), addDays(oggi, -30)]), allievaId: pick(['', '', db.allieve.length ? pick(db.allieve).id : '', '9999']) }; return L.salvaNota(db, null, f, adesso(), oggi); },
    modificaNota() { const n = pick(db.note || []); return n ? L.salvaNota(db, n.id, Object.assign({}, n, { testo: n.testo + ' ' + int(1, 9), data: pick(['', n.data, addDays(oggi, int(-5, 30))]), dataFine: '' }), adesso(), oggi) : null; },
    segnaNota() { const n = pick(db.note || []); return n ? L.segnaNota(db, n.id, chance(0.7), adesso()) : null; },
    eliminaNota() { const n = pick(db.note || []); return n ? L.eliminaNota(db, n.id) : null; },
    giorno() { oggi = addDays(oggi, int(0, 3)); return null; }
  };
  const nomi = Object.keys(ops), peso = { nuovaAllieva: 3, modificaAllieva: 4, nuovaIscrizione: 5, rinnova: 3, pagamento: 8, verifica: 2, eliminaPagamento: 1, annullaIscrizione: 1, archivia: 1, eliminaAllieva: 1, eliminaIscrizione: 1, nuovaStagione: 1, promemoria: 3, tariffe: 1, giorno: 6, nuovaNota: 3, modificaNota: 2, segnaNota: 2, eliminaNota: 1 };
  const bag = nomi.flatMap((n) => Array(peso[n] || 1).fill(n));
  for (let i = 0; i < OPS; i++) {
    const nome = pick(bag), prima = JSON.stringify(db);
    let res;
    try { res = ops[nome](); } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || !attesi.test(e.message)) { throw new Error('operazione "' + nome + '" ha rotto qualcosa (seme ' + seme + ', passo ' + i + '): ' + (e.stack || e.message)); }
      errori[nome] = (errori[nome] || 0) + 1; assert.equal(JSON.stringify(db), prima, 'un\'operazione rifiutata ha cambiato l\'archivio'); continue;
    }
    if (!res || !res.db) { if (nome !== 'giorno') conta('saltata ' + nome); continue; }
    assert.equal(JSON.stringify(db), prima, nome + ' ha modificato l\'archivio di partenza (deve restituirne uno nuovo)');
    if (JSON.stringify(res.db) !== prima) assert.ok(res.registro && res.registro.length >= 1 || nome === 'tariffe' && res.registro.length >= 1, nome + ': cambio senza voce nel registro');
    for (const v of res.registro || []) assert.ok(v.operazione, nome + ': voce senza operazione');
    db = res.db; conta(nome);
    controlla(db, oggi, nome + ' #' + i);
  }
  return { stats, errori, db, oggi };
}

(async () => {
  let tot = 0;
  for (let seme = 1; seme <= SEMI; seme++) {
    const r = await simula(seme * 7919, seme % 2 === 1);
    tot += OPS;
    const eseguite = Object.entries(r.stats).filter(([k]) => !k.includes('rifiutata') && !k.startsWith('saltata')).reduce((s, [, v]) => s + v, 0);
    console.log(`seme ${seme} (${seme % 2 === 1 ? 'da Excel' : 'da zero '}): ${eseguite} operazioni riuscite, ${Object.values(r.errori).reduce((s, v) => s + v, 0)} rifiutate come previsto, archivio finale: ${r.db.allieve.length} allieve, ${r.db.iscrizioni.length} iscrizioni, ${r.db.pagamenti.length} pagamenti, fino al ${r.oggi}`);
    if (seme === 1) console.log('   tipi di operazione eseguiti:', JSON.stringify(r.stats));
  }
  console.log('OK - ' + tot + ' passi simulati, controlli di coerenza dopo ogni operazione riuscita');
})().catch((e) => { console.error('FALLITA:', e.message); process.exit(1); });
