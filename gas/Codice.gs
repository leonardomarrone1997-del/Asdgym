/**
 * Gym Art Segreteria - versione senza Claude (inserimento a mano).
 * Va incollato in Estensioni > Apps Script del gestionale, insieme al file "Pagina".
 * Richiede il servizio avanzato "Google Sheets API" (menu Servizi > +).
 */
var SHEET_ID = '1QSztBzW-HojdXPCUbSGWqihCD8XD9dntB0m_hNJB5cU';
var FOGLI = ['ANAGRAFICA', 'ISCRIZIONI', 'PAGAMENTI', 'REGISTRO SCANSIONI', 'LISTE', 'TARIFFARIO'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Pagina')
    .setTitle('Gym Art Segreteria')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Unico punto di ingresso della pagina: legge o scrive un intervallo del gestionale. */
function gs(tool, json) {
  var input = JSON.parse(json);
  if (input.spreadsheetId !== SHEET_ID) throw new Error('Foglio non previsto.');
  var nome = String(input.range).split('!')[0].replace(/^'|'$/g, '').replace(/''/g, "'");
  if (FOGLI.indexOf(nome) < 0) throw new Error('Foglio non consentito: ' + nome);
  var V = Sheets.Spreadsheets.Values, out;
  if (tool === 'get_values') {
    var r = V.get(SHEET_ID, input.range);
    out = { range: r.range, values: r.values || [] };
  } else if (tool === 'update_values' || tool === 'append_values') {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (tool === 'update_values') V.update({ values: input.values }, SHEET_ID, input.range, { valueInputOption: 'USER_ENTERED' });
      else V.append({ values: input.values }, SHEET_ID, input.range, { valueInputOption: 'USER_ENTERED' });
    } finally { lock.releaseLock(); }
    out = { status: 'success' };
  } else throw new Error('Operazione non prevista: ' + tool);
  return JSON.stringify(out);
}
