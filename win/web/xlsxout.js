/* Scrittura di un file Excel (.xlsx) sul computer, senza librerie e senza internet: il file nasce nel browser e non passa da nessun'altra parte.
   Un .xlsx è un archivio zip di file XML. Qui si scrive quello che serve a una segreteria: fogli con una riga di titoli (blu, fissa in alto, con i filtri),
   testi, date vere e importi veri (così Excel ordina, filtra e somma come deve). Compatibile con Excel, LibreOffice e Fogli Google.

   fogli = [{ nome, colonne: [{ t: titolo, tipo: 'testo' | 'data' | 'euro' | 'numero', larghezza? }], righe: [[valori]] }]
   tipo 'data': il valore è 'AAAA-MM-GG' (se non lo è resta un testo); 'euro' e 'numero': un numero (se non lo è resta un testo). */
(function (root) {
  'use strict';

  var MAX_CELLA = 32767; // characters in a cell of Excel
  var enc = new TextEncoder();

  /* ---------- zip (the files are small: they are compressed with the browser's deflate when there is one, else stored) ---------- */
  var tavola = null;
  function crc32(b) {
    var i, n, k, c;
    if (!tavola) { tavola = new Uint32Array(256); for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tavola[n] = c >>> 0; } }
    c = 0xFFFFFFFF;
    for (i = 0; i < b.length; i++) c = tavola[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function comprimi(b) {
    if (typeof CompressionStream !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') return Promise.resolve(null);
    return new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer().then(function (x) { return new Uint8Array(x); }, function () { return null; });
  }
  function w16(a, v) { a.push(v & 255, (v >>> 8) & 255); }
  function w32(a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
  /** files: [{ nome, dati: Uint8Array }] -> Promise of the bytes of the zip. */
  function zip(files, quando) {
    var d = quando || new Date(), ora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), data = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return Promise.all(files.map(function (f) {
      return comprimi(f.dati).then(function (c) {
        var usa = c && c.length < f.dati.length;
        return { nome: enc.encode(f.nome), dati: usa ? c : f.dati, metodo: usa ? 8 : 0, size: f.dati.length, crc: crc32(f.dati) };
      });
    })).then(function (p) {
      var parti = [], cd = [], pos = 0, cdLen = 0, tot = 0;
      p.forEach(function (f) {
        var h = [], c = [];
        w32(h, 0x04034b50); w16(h, 20); w16(h, 0x0800); w16(h, f.metodo); w16(h, ora); w16(h, data); w32(h, f.crc); w32(h, f.dati.length); w32(h, f.size); w16(h, f.nome.length); w16(h, 0);
        var testa = new Uint8Array(h);
        parti.push(testa, f.nome, f.dati);
        w32(c, 0x02014b50); w16(c, 20); w16(c, 20); w16(c, 0x0800); w16(c, f.metodo); w16(c, ora); w16(c, data); w32(c, f.crc); w32(c, f.dati.length); w32(c, f.size);
        w16(c, f.nome.length); w16(c, 0); w16(c, 0); w16(c, 0); w16(c, 0); w32(c, 0); w32(c, pos); // extra field, comment, disk, internal and external attributes, offset of the local header
        cd.push(new Uint8Array(c), f.nome);
        pos += testa.length + f.nome.length + f.dati.length;
      });
      cd.forEach(function (x) { cdLen += x.length; });
      var fine = [];
      w32(fine, 0x06054b50); w16(fine, 0); w16(fine, 0); w16(fine, p.length); w16(fine, p.length); w32(fine, cdLen); w32(fine, pos); w16(fine, 0);
      var tutti = parti.concat(cd, [new Uint8Array(fine)]);
      tutti.forEach(function (x) { tot += x.length; });
      var out = new Uint8Array(tot), o = 0;
      tutti.forEach(function (x) { out.set(x, o); o += x.length; });
      return out;
    });
  }

  /* ---------- the XML of the workbook ---------- */
  /** A cell of Excel holds 32,767 characters at most: a longer text makes the whole file "unreadable" for Excel, so it is cut (the program does not let such texts in, but an old archive or an import might have one). */
  var CELLA_MAX = 32000;
  function esc(s) {
    s = String(s);
    if (s.length > CELLA_MAX) s = s.slice(0, CELLA_MAX - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
    return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** 1 -> A, 27 -> AA. */
  function lettera(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
  /** 'AAAA-MM-GG' -> the number of days since 30/12/1899 (what Excel calls a date); null when it is not a date Excel can show. */
  function seriale(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (new Date(t).getUTCDate() !== +m[3]) return null; // 31 February and the like
    var n = Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
    return n >= 61 ? n : null; // before March 1900 Excel's calendar has a day that never existed: those dates stay text
  }
  /** Styles of the cells: 0 plain, 1 titles, 2 date, 3 amount, 4 whole number. */
  var STILI = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B2F6A"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function cella(rif, v, tipo) {
    if (v === null || v === undefined || v === '') return '';
    if (tipo === 'data') { var n = seriale(String(v)); if (n !== null) return '<c r="' + rif + '" s="2"><v>' + n + '</v></c>'; }
    else if ((tipo === 'euro' || tipo === 'numero') && typeof v === 'number' && isFinite(v)) return '<c r="' + rif + '" s="' + (tipo === 'euro' ? 3 : 4) + '"><v>' + v + '</v></c>';
    var t = String(v);
    if (t.length > MAX_CELLA) t = t.slice(0, MAX_CELLA - 1) + '…';
    return '<c r="' + rif + '" t="inlineStr"><is><t xml:space="preserve">' + esc(t) + '</t></is></c>';
  }
  /** The width of a column, in characters: what is written in it (the first rows are enough), within sensible limits. */
  function larghezza(col, righe, k) {
    if (col.larghezza) return col.larghezza;
    var max = String(col.t).length * 1.15, i, v, l;
    for (i = 0; i < righe.length && i < 400; i++) {
      v = righe[i][k]; if (v === null || v === undefined || v === '') continue;
      l = col.tipo === 'data' ? 11 : col.tipo === 'euro' ? 12 : String(v).split('\n')[0].length;
      if (l > max) max = l;
    }
    return Math.max(8, Math.min(60, Math.ceil(max) + 2));
  }
  function xmlFoglio(f) {
    var nc = f.colonne.length, nr = f.righe.length, k, i, rows = [];
    var cols = f.colonne.map(function (c, j) { var w = larghezza(c, f.righe, j); return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('');
    rows.push('<row r="1" ht="30" customHeight="1">' + f.colonne.map(function (c, j) { return '<c r="' + lettera(j + 1) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + esc(c.t) + '</t></is></c>'; }).join('') + '</row>');
    for (i = 0; i < nr; i++) {
      var r = f.righe[i], cs = '';
      for (k = 0; k < nc; k++) cs += cella(lettera(k + 1) + (i + 2), r[k], f.colonne[k].tipo);
      rows.push('<row r="' + (i + 2) + '">' + cs + '</row>');
    }
    var fine = lettera(nc) + (nr + 1);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:' + fine + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/><cols>' + cols + '</cols><sheetData>' + rows.join('') + '</sheetData>' +
      '<autoFilter ref="A1:' + fine + '"/><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
  }
  /** A name for a sheet that Excel accepts: at most 31 characters, none of  : \ / ? * [ ]  and different from the others. */
  function nomeFoglio(nome, usati) {
    var n = String(nome || 'Foglio').replace(/[:\\\/?*\[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31).trim() || 'Foglio', base = n, i = 2;
    while (usati[n.toLowerCase()]) { var suff = ' ' + i++; n = base.slice(0, 31 - suff.length) + suff; }
    usati[n.toLowerCase()] = 1;
    return n;
  }

  /** Il file: Promise of a Uint8Array. opz = { data: Date of the file (the tests give a fixed one) }. */
  function crea(fogli, opz) {
    if (!Array.isArray(fogli) || !fogli.length) return Promise.reject(new Error('Non c\'è niente da scrivere nel file Excel.'));
    var usati = {}, nomi = fogli.map(function (f) { return nomeFoglio(f.nome, usati); });
    var T = function (s) { return enc.encode(s); };
    var tipi = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      fogli.map(function (f, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
    var libro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>' +
      nomi.map(function (n, i) { return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' +
      // printed, the row of the titles is repeated on every page
      '<definedNames>' + nomi.map(function (n, i) { return '<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">\'' + esc(n.replace(/'/g, "''")) + '\'!$1:$1</definedName>'; }).join('') + '</definedNames></workbook>';
    var relsLibro = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      fogli.map(function (f, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (fogli.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var files = [{ nome: '[Content_Types].xml', dati: T(tipi) }, { nome: '_rels/.rels', dati: T(rels) }, { nome: 'xl/workbook.xml', dati: T(libro) }, { nome: 'xl/_rels/workbook.xml.rels', dati: T(relsLibro) }, { nome: 'xl/styles.xml', dati: T(STILI) }]
      .concat(fogli.map(function (f, i) { return { nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', dati: T(xmlFoglio(f)) }; }));
    return zip(files, opz && opz.data);
  }

  var XlsxOut = { crea: crea, seriale: seriale, lettera: lettera, crc32: crc32, nomeFoglio: nomeFoglio };
  if (typeof module !== 'undefined' && module.exports) module.exports = XlsxOut; else root.XlsxOut = XlsxOut;
})(typeof window !== 'undefined' ? window : this);
