/* Lettura di un file Excel (.xlsx) sul computer, senza librerie e senza internet: il file non esce mai dal browser.
   Un .xlsx è un archivio zip di file XML. Qui si leggono i fogli e se ne fa, per ogni foglio, una tabella di testi come quella di un file CSV
   (le date diventano gg/mm/aaaa, i numeri si scrivono con la virgola), così l'importazione è la stessa. */
(function (root) {
  'use strict';

  var MAX_BYTES = 60 * 1024 * 1024; // a gym's workbook is a few hundred KB: anything this big is not one
  var MAX_APERTO = 120 * 1024 * 1024; // the most a file may weigh once opened (a "zip bomb" is a small file that opens into gigabytes)

  /* ---------- zip ---------- */
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  /** The entries of a zip file: { name: { method, csize, size, offset } }. */
  function elencoZip(b) {
    var end = -1, i;
    for (i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { end = i; break; }
    if (end < 0) throw new Error('Il file non è un archivio Excel (.xlsx).');
    var n = u16(b, end + 10), off = u32(b, end + 16), out = {};
    for (i = 0; i < n; i++) {
      if (u32(b, off) !== 0x02014b50) throw new Error('Il file Excel è danneggiato.');
      var method = u16(b, off + 10), csize = u32(b, off + 20), size = u32(b, off + 24), nl = u16(b, off + 28), el = u16(b, off + 30), cl = u16(b, off + 32), lo = u32(b, off + 42);
      var name = utf8(b.subarray(off + 46, off + 46 + nl));
      out[name] = { method: method, csize: csize, size: size, offset: lo };
      off += 46 + nl + el + cl;
    }
    return out;
  }
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function inflateRaw(data) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('Questo browser non sa aprire i file Excel: salva i fogli come CSV oppure usa Edge o Chrome aggiornati.'));
    var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), rd = ds.readable.getReader(), parti = [], tot = 0;
    w.write(data).catch(function () {}); w.close().catch(function () {});
    // read piece by piece and stop as soon as the file is too big: the size written in the zip may lie
    return (function pompa() {
      return rd.read().then(function (r) {
        if (r.done) { var out = new Uint8Array(tot), p = 0; parti.forEach(function (c) { out.set(c, p); p += c.length; }); return out; }
        tot += r.value.length;
        if (tot > MAX_APERTO) { rd.cancel().catch(function () {}); throw new Error('Il file Excel è troppo grande una volta aperto: non è un foglio della palestra.'); }
        parti.push(r.value);
        return pompa();
      });
    })().catch(function (e) { throw e instanceof Error && /Il file/.test(e.message) ? e : new Error('Il file Excel è danneggiato.'); }); // a damaged file makes the decompressor fail with no words of its own
  }

  /** The text of one file of the archive, or '' if it is not there. */
  function leggiFile(b, ent, nome) {
    var e = ent[nome];
    if (!e) return Promise.resolve('');
    var o = e.offset;
    if (u32(b, o) !== 0x04034b50) return Promise.reject(new Error('Il file Excel è danneggiato.'));
    var start = o + 30 + u16(b, o + 26) + u16(b, o + 28), data = b.subarray(start, start + e.csize);
    if (e.method === 0) return Promise.resolve(utf8(data));
    if (e.method !== 8) return Promise.reject(new Error('Il file Excel usa una compressione che non conosco.'));
    if (e.size > MAX_APERTO) return Promise.reject(new Error('Il file Excel è troppo grande una volta aperto: non è un foglio della palestra.'));
    return inflateRaw(data).then(utf8);
  }

  /* ---------- xml (the few shapes a workbook uses) ---------- */
  function unesc(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (m, g) {
      if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'quot') return '"'; if (g === 'apos') return "'";
      return String.fromCodePoint(g.charAt(1) === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    });
  }
  function attr(tag, name) { var m = new RegExp('\\b' + name + '="([^"]*)"').exec(tag); return m ? unesc(m[1]) : ''; }
  /** The text inside <t> tags of a string item (rich text has several). */
  function testoT(xml) {
    var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\s*\/>/g, m;
    while ((m = re.exec(xml))) out += m[1] === undefined ? '' : unesc(m[1]);
    return out;
  }
  function stringheCondivise(xml) {
    var out = [], re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g, m;
    while ((m = re.exec(xml))) out.push(m[1] === undefined ? '' : testoT(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, ''))); // phonetic hints are not text
    return out;
  }

  /* ---------- styles: which cells are dates ---------- */
  var DATA_PREDEFINITI = { 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 1, 27: 1, 28: 1, 29: 1, 30: 1, 31: 1, 32: 1, 33: 1, 34: 1, 35: 1, 36: 1, 45: 1, 46: 1, 47: 1, 50: 1, 51: 1, 52: 1, 53: 1, 54: 1, 55: 1, 56: 1, 57: 1, 58: 1 };
  function formatoData(code) {
    var c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    return /[dmyg]/i.test(c) && !/^(general|standard|@)$/i.test(c.trim());
  }
  /** For every cell style (index) whether it shows a date. */
  function stiliData(xml) {
    var custom = {}, re = /<numFmt\s[^>]*>/g, m;
    while ((m = re.exec(xml))) custom[attr(m[0], 'numFmtId')] = formatoData(attr(m[0], 'formatCode'));
    var cx = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(xml), out = [];
    if (cx) {
      var xr = /<xf\s[^>]*?(?:\/>|>)/g;
      while ((m = xr.exec(cx[0]))) { var id = attr(m[0], 'numFmtId'); out.push(custom[id] !== undefined ? custom[id] : !!DATA_PREDEFINITI[id]); }
    }
    return out;
  }

  /* ---------- values ---------- */
  function lettereInColonna(ref) {
    var m = /^([A-Z]+)/.exec(ref), n = 0, i;
    if (!m) return -1;
    for (i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }
  /** Excel date number -> 'gg/mm/aaaa' (the time of the day is dropped). */
  function dataDaSeriale(n, sistema1904) {
    var g = Math.floor(n);
    if (!isFinite(g) || g < 1 || g > 2958465) return null;
    var d = new Date(Date.UTC(1899, 11, 30) + (g + (sistema1904 ? 1462 : 0)) * 86400000);
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  /** A number as a person writes it in Italy: 170 -> "170", 12.5 -> "12,5". No exponent, no float noise. */
  function numeroTesto(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return String(v);
    var s = String(+n.toPrecision(15));
    if (/e/i.test(s)) s = n.toFixed(15).replace(/\.?0+$/, '');
    return s.replace('.', ',');
  }

  /** The cells of a sheet as rows of texts. */
  function righeDelFoglio(xml, condivise, stili, d1904) {
    var rows = [], re = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, m;
    while ((m = re.exec(xml))) {
      var r = parseInt(attr(m[1], 'r'), 10) - 1;
      if (!(r >= 0)) r = rows.length;
      var cells = [], cr = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, c, last = -1;
      while ((c = cr.exec(m[2] || ''))) {
        var col = lettereInColonna(attr(c[1], 'r')); if (col < 0) col = last + 1; last = col;
        var t = attr(c[1], 't'), s = parseInt(attr(c[1], 's'), 10), body = c[2] || '', v = /<v>([\s\S]*?)<\/v>/.exec(body), val = '';
        if (t === 'inlineStr') val = testoT(body);
        else if (v) {
          var raw = unesc(v[1]);
          if (t === 's') val = condivise[parseInt(raw, 10)] || '';
          else if (t === 'str') val = raw;
          else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e') val = '';
          else if (stili[s]) val = dataDaSeriale(parseFloat(raw), d1904) || numeroTesto(raw);
          else val = numeroTesto(raw);
        }
        cells[col] = val;
      }
      for (var i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      rows[r] = cells;
    }
    for (var k = 0; k < rows.length; k++) if (rows[k] === undefined) rows[k] = [];
    return rows;
  }

  /** The sheets of a workbook: Promise of [{ nome, rows }]. bytes: Uint8Array of the .xlsx file. */
  function leggiXlsx(bytes) {
    if (bytes.length > MAX_BYTES) return Promise.reject(new Error('Il file è troppo grande per essere un foglio della palestra.'));
    var ent;
    try { ent = elencoZip(bytes); } catch (e) { return Promise.reject(e); }
    return Promise.all([leggiFile(bytes, ent, 'xl/workbook.xml'), leggiFile(bytes, ent, 'xl/_rels/workbook.xml.rels'), leggiFile(bytes, ent, 'xl/sharedStrings.xml'), leggiFile(bytes, ent, 'xl/styles.xml')]).then(function (p) {
      var wb = p[0], rels = p[1];
      if (!wb) throw new Error('Il file non è un archivio Excel (.xlsx).');
      var d1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wb), condivise = stringheCondivise(p[2]), stili = stiliData(p[3]);
      var target = {}, re = /<Relationship\b[^>]*>/g, m;
      while ((m = re.exec(rels))) target[attr(m[0], 'Id')] = attr(m[0], 'Target');
      var fogli = [], sr = /<sheet\b[^>]*>/g;
      while ((m = sr.exec(wb))) {
        var t = target[attr(m[0], 'r:id')] || '';
        t = t.charAt(0) === '/' ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        fogli.push({ nome: attr(m[0], 'name'), file: t });
      }
      return fogli.reduce(function (chain, f) {
        return chain.then(function (out) {
          return leggiFile(bytes, ent, f.file).then(function (xml) { out.push({ nome: f.nome, rows: righeDelFoglio(xml, condivise, stili, d1904) }); return out; });
        });
      }, Promise.resolve([]));
    });
  }

  var Xlsx = { leggiXlsx: leggiXlsx, dataDaSeriale: dataDaSeriale, numeroTesto: numeroTesto, righeDelFoglio: righeDelFoglio, formatoData: formatoData };
  if (typeof module !== 'undefined' && module.exports) module.exports = Xlsx; else root.Xlsx = Xlsx;
})(typeof self !== 'undefined' ? self : this);
