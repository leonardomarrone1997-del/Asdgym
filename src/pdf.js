/*
 * GymPdf - tiny dependency-free PDF generator for the ASD Gym Art Avezzano forms.
 *
 * Public API (both return a Uint8Array holding a complete one-page A4 PDF 1.4 file):
 *   GymPdf.moduloIscrizione(data?)     -> enrolment form
 *   GymPdf.richiestaCertificato(data?) -> request for a sports medical certificate
 *   GymPdf.ricevuta(data?)             -> receipt of a payment
 *
 * No imports, no Buffer/fs/DOM: the file is assembled as a Latin-1 "byte string"
 * (one char = one byte) and converted to a Uint8Array at the very end.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ geometry
  const PW = 595.28, PH = 841.89;       // A4 portrait, in points
  const M = 36;                         // left / right margin
  const CW = PW - 2 * M;                // content width
  const RX = PW - M;                    // right edge of the content area
  const NAVY = '#1B2F6A';
  const LBL = 9.5;                      // field label size
  const BOX = 8.5;                      // check box side

  // -------------------------------------------------------------- font metrics
  // Glyph widths (1/1000 em) for WinAnsi codes 32..255, taken from the Adobe AFM
  // files of the base-14 fonts (extracted with reportlab's pdfmetrics).
  const WIDTHS = {
    F1: ('278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,' +
      '1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,' +
      '333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,350,' +
      '556,350,222,556,333,1000,556,556,333,1000,667,333,1000,350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,' +
      '278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,' +
      '667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,' +
      '556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500')
      .split(',').map(Number),
    F2: ('278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,' +
      '975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,' +
      '333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,350,' +
      '556,350,278,556,500,1000,556,556,333,1000,667,333,1000,350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,' +
      '278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,' +
      '722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,' +
      '556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556')
      .split(',').map(Number)
  };

  // ------------------------------------------------------------ text encoding
  // Unicode code points that cp1252 stores in the 0x80..0x9F range.
  const CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
    0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
    0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F
  };

  // Unicode string -> string whose chars are WinAnsi (cp1252) byte values.
  // Anything outside cp1252 becomes '?'; tabs and line breaks become spaces.
  function toWinAnsi(str) {
    let s = String(str == null ? '' : str);
    if (s.normalize) s = s.normalize('NFC');   // "e" + combining accent -> "è"
    let out = '';
    for (const ch of s) {                       // iterates by code point
      const cp = ch.codePointAt(0);
      let b;
      if (cp === 9 || cp === 10 || cp === 13) b = 32;
      else if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) b = cp;
      else b = CP1252[cp] || 63;
      out += String.fromCharCode(b);
    }
    return out;
  }

  // Encodes and escapes a string for use inside a PDF literal string "( ... )".
  function pdfStr(str) {
    return toWinAnsi(str).replace(/[\\()]/g, '\\$&');
  }

  // Width in points of `str` set in font 'F1' (Helvetica) or 'F2' (Helvetica-Bold).
  function textWidth(str, font, size) {
    const w = WIDTHS[font] || WIDTHS.F1, b = toWinAnsi(str);
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += w[b.charCodeAt(i) - 32] || 0;
    return sum * size / 1000;
  }

  // Cuts `str` (no ellipsis) so that it is never wider than `maxW`.
  function fit(str, font, size, maxW) {
    let s = String(str);
    while (s.length && textWidth(s, font, size) > maxW) s = s.slice(0, -1);
    return s.replace(/\s+$/, '');
  }

  // Greedy word wrap; returns an array of lines.
  function wrap(str, width, font, size) {
    const lines = [];
    let cur = '';
    String(str).split(/\s+/).filter(Boolean).forEach((word) => {
      const next = cur ? cur + ' ' + word : word;
      if (cur && textWidth(next, font, size) > width) { lines.push(cur); cur = word; } else cur = next;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // Same number of lines as wrap(), but with lines of similar length (for titles).
  function wrapBalanced(str, width, font, size) {
    let lines = wrap(str, width, font, size);
    const n = lines.length;
    for (let w = width - 8; n > 1 && w > width / 3; w -= 8) {
      const t = wrap(str, w, font, size);
      if (t.length > n) break;
      lines = t;
    }
    return lines;
  }

  // ------------------------------------------------------------ number / color
  function num(v, digits) {
    return (+v).toFixed(digits || 2).replace(/0+$/, '').replace(/\.$/, '').replace(/^-0$/, '0');
  }

  // color: gray level 0..1, [r, g, b] in 0..1, or '#RRGGBB'. Returns the PDF operator.
  function colorOp(c, stroke) {
    if (c == null) c = 0;
    if (typeof c === 'number') return num(c, 3) + (stroke ? ' G' : ' g');
    if (typeof c === 'string') {
      const v = parseInt(c.replace('#', ''), 16);
      c = [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
    }
    return num(c[0], 3) + ' ' + num(c[1], 3) + ' ' + num(c[2], 3) + (stroke ? ' RG' : ' rg');
  }

  // ------------------------------------------------------------------ document
  // One-page document. All coordinates are in points with a TOP-LEFT origin;
  // for text, `y` is always the baseline. Conversion to PDF space happens here.
  function Doc() { this.ops = []; }

  // Text at (x, y). o: { font, size, color, align: 'left'|'center'|'right' }.
  // Returns the x coordinate right after the text.
  Doc.prototype.text = function (str, x, y, o) {
    o = o || {};
    const font = o.font || 'F1', size = o.size || LBL, w = textWidth(str, font, size);
    if (o.align === 'center') x -= w / 2; else if (o.align === 'right') x -= w;
    this.ops.push('BT /' + font + ' ' + num(size) + ' Tf ' + colorOp(o.color) + ' 1 0 0 1 ' +
      num(x) + ' ' + num(PH - y) + ' Tm (' + pdfStr(str) + ') Tj ET');
    return x + w;
  };

  // Wrapped paragraph inside [x, x + width]. o adds { leading, balance }.
  // Returns the baseline y of the line that would follow the paragraph.
  Doc.prototype.paragraph = function (str, x, y, width, o) {
    o = o || {};
    const font = o.font || 'F1', size = o.size || LBL, leading = o.leading || size * 1.3;
    const ax = o.align === 'center' ? x + width / 2 : o.align === 'right' ? x + width : x;
    (o.balance ? wrapBalanced : wrap)(str, width, font, size).forEach((line) => {
      this.text(line, ax, y, o);
      y += leading;
    });
    return y;
  };

  // Straight line between two points.
  Doc.prototype.line = function (x1, y1, x2, y2, lw, color) {
    this.ops.push(colorOp(color, true) + ' ' + num(lw || 0.5) + ' w ' + num(x1) + ' ' + num(PH - y1) + ' m ' +
      num(x2) + ' ' + num(PH - y2) + ' l S');
  };

  // Horizontal line with configurable width.
  Doc.prototype.hline = function (x1, x2, y, lw, color) { this.line(x1, y, x2, y, lw, color); };

  // Filled rectangle; (x, y) is its top-left corner.
  Doc.prototype.fillRect = function (x, y, w, h, color) {
    this.ops.push(colorOp(color) + ' ' + num(x) + ' ' + num(PH - y - h) + ' ' + num(w) + ' ' + num(h) + ' re f');
  };

  // Stroked rectangle; optionally filled first when `fill` is given.
  Doc.prototype.strokeRect = function (x, y, w, h, lw, color, fill) {
    this.ops.push((fill != null ? colorOp(fill) + ' ' : '') + colorOp(color, true) + ' ' + num(lw || 0.8) + ' w ' +
      num(x) + ' ' + num(PH - y - h) + ' ' + num(w) + ' ' + num(h) + ' re ' + (fill != null ? 'B' : 'S'));
  };

  // Check box followed by its label. `x` is the left edge of the box and `y` the
  // label baseline; the box is centred on the cap height of the label.
  // o: { size (label size), box (side), font }. Returns the x after the label.
  Doc.prototype.check = function (label, x, y, ticked, o) {
    o = o || {};
    const size = o.size || LBL, side = o.box || BOX;
    const top = y - size * 0.359 - side / 2;        // 0.718 em = Helvetica cap height
    this.strokeRect(x, top, side, side, 0.8);
    if (ticked) {                                    // "X" mark
      const i = side * 0.2;
      this.line(x + i, top + i, x + side - i, top + side - i, 1.2);
      this.line(x + i, top + side - i, x + side - i, top + i, 1.2);
    }
    x += side + 3.2;
    return label ? this.text(label, x, y, { size: size, font: o.font }) : x;
  };

  // Fill-in line: label at (x, y), then a thin rule up to xEnd. When `value` is
  // given it is printed in Helvetica 10 just above the rule, cut to fit.
  // Returns xEnd.
  Doc.prototype.field = function (label, x, y, xEnd, value, o) {
    const lx = label ? this.text(label, x, y, o) + 3 : x;
    this.blank(lx, y, xEnd, value);
    return xEnd;
  };

  // The rule (and optional value) part of a fill-in line, from x to xEnd.
  // The value starts at the left end of the rule, or is centred on it.
  Doc.prototype.blank = function (x, y, xEnd, value, centred) {
    this.hline(x, xEnd, y + 2.2, 0.5);
    const v = fit(value == null ? '' : value, 'F1', 10, xEnd - x - 4);
    if (!v) return;
    if (centred) this.text(v, (x + xEnd) / 2, y - 0.4, { size: 10, align: 'center' });
    else this.text(v, x + 2, y - 0.4, { size: 10 });
  };

  // Inline flow of words and fill-in blanks, wrapped inside [x, x + width].
  // parts: strings, or { blank: defaultWidth, value } objects. A string that does
  // not start with a space sticks to whatever precedes it (e.g. ", legale ...").
  // Returns the baseline y of the line that would follow.
  Doc.prototype.flow = function (parts, x, y, width, o) {
    const size = o.size || LBL, leading = o.leading || size * 1.9;
    const sp = textWidth(' ', 'F1', size), units = [];
    // 1) Unbreakable units: a word, a blank, or a blank with the text glued to it.
    parts.forEach((p) => {
      if (typeof p === 'string') {
        const glued = units.length > 0 && !/^\s/.test(p);
        p.split(/\s+/).filter(Boolean).forEach((word, i) => {
          const it = { s: word, w: textWidth(word, 'F1', size) };
          if (i === 0 && glued) { const u = units[units.length - 1]; u.items.push(it); u.w += it.w; }
          else units.push({ items: [it], w: it.w });
        });
      } else {
        // A prefilled blank is sized on its value; an empty one keeps its default width.
        const w = p.value ? Math.max(48, textWidth(p.value, 'F1', 10) + 18) : p.blank;
        units.push({ items: [{ w: w, value: p.value || '' }], w: w });
      }
    });
    units.forEach((u) => {                           // unit wider than the column: shorten its blank
      const over = u.w - width;
      if (over > 0 && u.items[0].s == null) { u.items[0].w -= over; u.w -= over; }
    });
    // 2) Greedy line breaking.
    const lines = [];
    let line = null;
    units.forEach((u) => {
      if (!line || line.w + sp + u.w > width) { line = { units: [], w: -sp }; lines.push(line); }
      line.units.push(u);
      line.w += sp + u.w;
    });
    // 3) Draw. On every line but the last, the last empty blank grows to fill the
    //    slack, so that hand-written fields are as long as the line allows.
    lines.forEach((ln, li) => {
      const items = [].concat.apply([], ln.units.map((u) => u.items));
      const empty = items.filter((it) => it.s == null && !it.value);
      if (li < lines.length - 1 && empty.length) empty[empty.length - 1].w += Math.max(0, width - ln.w);
      let cx = x;
      ln.units.forEach((u, ui) => {
        if (ui) cx += sp;
        u.items.forEach((it) => {
          if (it.s != null) this.text(it.s, cx, y, { size: size });
          else this.blank(cx + 1, y, cx + it.w - 1, it.value, true);
          cx += it.w;
        });
      });
      y += leading;
    });
    return y;
  };

  // Serialises the page into a complete PDF 1.4 file.
  Doc.prototype.build = function (title) {
    const stream = this.ops.join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] ' +
        '/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
      '<< /Title (' + pdfStr(title) + ') /Producer (GymPdf) >>'
    ];
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';        // second line marks the file as binary
    const offsets = [];
    objs.forEach((body, i) => {
      offsets.push(pdf.length);                      // 1 char = 1 byte, so length = byte offset
      pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach((off) => { pdf += ('0000000000' + off).slice(-10) + ' 00000 n \n'; });
    pdf += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    const out = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) out[i] = pdf.charCodeAt(i) & 255;
    return out;
  };

  // ------------------------------------------------------------ shared pieces
  // Trimmed string, '' for null / undefined.
  function str(v) { return v == null ? '' : String(v).trim(); }

  // Navy header band with the club details. Returns the y of its bottom edge.
  function header(d) {
    const top = 30, h = 62, cx = PW / 2;
    d.fillRect(M, top, CW, h, NAVY);
    d.text('A.S.D. GYM ART AVEZZANO', cx, top + 25, { font: 'F2', size: 17, color: 1, align: 'center' });
    d.text('Via Ezio Tarantelli n.1 - 67051 Avezzano (AQ) - Ginnastica Artistica Femminile', cx, top + 40,
      { size: 9, color: 1, align: 'center' });
    d.text('Email: gymartavezzano@gmail.com | IG: @gymart_avezzano', cx, top + 52.5, { size: 9, color: 1, align: 'center' });
    return top + h;
  }

  // Bold uppercase section heading with a 0.9 pt rule. Returns the y of the rule.
  function section(d, title, y) {
    d.text(title, M, y, { font: 'F2', size: 10.5 });
    d.hline(M, RX, y + 4.5, 0.9);
    return y + 4.5;
  }

  // Two signature lines side by side, captions centred underneath.
  function signatures(d, y, left, right) {
    const w = 228;
    d.hline(M, M + w, y, 0.6);
    d.hline(RX - w, RX, y, 0.6);
    d.text(left, M + w / 2, y + 10.5, { size: 8, align: 'center' });
    d.text(right, RX - w / 2, y + 10.5, { size: 8, align: 'center' });
  }

  // ------------------------------------------------- document 1: enrolment form
  function moduloIscrizione(data) {
    data = data || {};
    const a = data.atleta || {}, g = data.genitore || {};
    const stagione = str(data.stagione) || '2026/2027';
    const corso = str(data.corso).toLowerCase().replace(/[^a-z]/g, '');      // 'Pre-Agonismo' -> 'preagonismo'
    const giorni = (Array.isArray(data.giorni) ? data.giorni : str(data.giorni).split(/[\s,;/]+/))
      .map((s) => str(s).toLowerCase().slice(0, 3));                         // 'Lunedì' -> 'lun'
    // Season years for the rules text: '2026/2027', '2026/27' or '2026'.
    const ym = /(\d{4})(?:\D+(\d{2,4}))?/.exec(stagione);
    const y1 = ym ? ym[1] : '2026';
    const y2 = ym && ym[2] && ym[2].length === 4 ? ym[2] : String(+y1 + 1);

    const d = new Doc();
    const ROW = 23;                                   // pitch of handwriting rows
    let y = header(d), x;

    y += 21;
    d.text('MODULO DI ISCRIZIONE - STAGIONE ' + stagione, PW / 2, y, { font: 'F2', size: 13, align: 'center' });

    // --- athlete
    y = section(d, 'DATI ATLETA', y + 22);
    y += 21.5;
    d.field('Cognome e Nome Atleta:', M, y, RX, str(a.nome));
    y += ROW;
    d.field('Data di nascita:', M, y, 196, str(a.nascita));
    d.field('Luogo:', 206, y, 372, str(a.luogo));
    d.field('C.F.:', 382, y, RX, str(a.cf));
    y += ROW;
    d.field('Indirizzo:', M, y, 300, str(a.indirizzo));
    d.field('Città:', 310, y, 478, str(a.citta));
    d.field('CAP:', 488, y, RX, str(a.cap));
    y += ROW;
    x = d.text('Certificato Medico:', M, y) + 6;
    x = d.check('Non Agonistico', x, y) + 9;
    x = d.check('Agonistico', x, y) + 12;
    x = d.field('Scadenza:', x, y, x + 104) + 9;
    d.field('Note sanitarie/Allergie:', x, y, RX);

    // --- parent / guardian
    y = section(d, 'DATI GENITORE / TUTORE (per minorenni)', y + 24);
    y += 21.5;
    d.field('Cognome e Nome:', M, y, 268, str(g.nome));
    d.field('C.F.:', 278, y, 424, str(g.cf));
    d.field('Tel:', 434, y, RX, str(g.tel));
    y += ROW;
    d.field('Email:', M, y, 318, str(g.email));
    d.field('Secondo recapito Tel:', 328, y, RX, str(g.tel2));

    // --- course
    y = section(d, 'SCELTA CORSO ARTISTICA - STAGIONE ' + stagione + ' (barrare)', y + 24);
    y += 0.5;
    [['baby', 'ARTISTICA BABY (3-5 anni) - Avviamento al movimento'],
      ['base', 'CORSO BASE - Avviamento Ginnastica Artistica'],
      ['avanzato', 'CORSO AVANZATO - Perfezionamento Tecnico'],
      ['preagonismo', 'PRE-AGONISMO - Avvio percorso agonistico'],
      ['agonismo', 'AGONISMO - Squadra Agonistica']].forEach((c) => {
      y += 17.5;
      d.check(c[1], M + 2, y, corso === c[0]);
    });
    y += ROW;
    x = d.text('Giorni scelti:', M, y) + 8;
    ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'].forEach((day) => {
      x = d.check(day, x, y, giorni.indexOf(day.toLowerCase()) >= 0) + 11;
    });
    d.field('Orario:', x + 6, y, RX, str(data.orario));
    y += ROW;
    // The two amount lines share whatever width is left once the fixed parts are measured.
    const q1 = 'Quota Iscrizione Annuale + Tesseramento €', q2 = 'Quota Mensile €', q3 = 'Sconto Fratelli:';
    const tw = (s) => textWidth(s, 'F1', LBL);
    const fixed = tw(q1) + 3 + 9 + tw(q2) + 3 + 10 + tw(q3) + 6 + 2 * (BOX + 3.2) + tw('SI') + 9 + tw('NO');
    const lineW = (CW - fixed) / 2;
    x = d.field(q1, M, y, M + tw(q1) + 3 + lineW) + 9;
    x = d.field(q2, x, y, x + tw(q2) + 3 + lineW) + 10;
    x = d.text(q3, x, y) + 6;
    x = d.check('SI', x, y) + 9;
    d.check('NO', x, y);
    y += ROW;
    x = d.text('Modalità pagamento:', M, y) + 6;
    x = d.check('Contanti', x, y) + 9;
    x = d.check('Bonifico', x, y) + 10;
    const cardX = RX - (BOX + 3.2 + tw('Carta/Bancomat'));
    d.field('IBAN:', x, y, cardX - 10);
    d.check('Carta/Bancomat', cardX, y);

    // --- rules
    y = section(d, 'REGOLAMENTO SINTETICO', y + 24) + 12;
    ['Iscrizione valida Settembre ' + y1 + ' - Giugno ' + y2 + '. Obbligatorio certificato medico valido.',
      'Pagamento mensile entro il 5 del mese. Assenze dell\'allieva non rimborsabili/recuperabili.',
      'Obbligatorio body societario. I genitori non possono sostare in palestra durante le lezioni per motivi ' +
        'didattici e di sicurezza.',
      'La palestra declina responsabilità per oggetti smarriti. Chiusure festive/forza maggiore non rimborsabili.'
    ].forEach((rule, i) => {
      d.text((i + 1) + '.', M, y, { size: 8 });
      y = d.paragraph(rule, M + 10, y, CW - 10, { size: 8, leading: 10.5 });
    });

    // --- mandatory consents (boxes are never pre-ticked)
    y = section(d, 'CONSENSI OBBLIGATORI', y + 10) + 13;
    y = d.paragraph('Privacy GDPR - Autorizzo ASD Gym Art Avezzano al trattamento dati per tesseramento, ' +
      'assicurazione, comunicazioni:', M, y, CW, { size: 8.5, leading: 10.5 }) + 4;
    x = d.check('ACCONSENTO', M + 2, y) + 24;
    d.check('NON ACCONSENTO', x, y);
    y += 16;
    y = d.paragraph('Liberatoria Immagini - Autorizzo uso gratuito foto/video per social @gymart_avezzano e ' +
      'promozioni ASD:', M, y, CW, { size: 8.5, leading: 10.5 }) + 4;
    x = d.check('AUTORIZZO', M + 2, y) + 24;
    d.check('NON AUTORIZZO', x, y);

    // --- place, date and signatures
    y += 27;
    d.field('Avezzano, lì', M, y, M + 215);
    y += 41;
    signatures(d, y, 'Firma Genitore / Atleta maggiorenne leggibile', 'Firma Legale Rappresentante ASD Gym Art');

    // --- office-only block
    y += 23;
    const S = { size: 8.5, box: 7.5 }, px = M + 9, pr = RX - 9;
    d.strokeRect(M, y, CW, 64, 0.8, 0, '#EEF3FA');
    d.text('RISERVATO ALLA SEGRETERIA', px, y + 13.5, { font: 'F2', size: 8.5 });
    let ry = y + 32.5;
    x = d.text('Pagato:', px, ry, S) + 5;
    x = d.check('Sì', x, ry, false, S) + 12;
    x = d.field('Importo €', x, ry, x + 98, '', S) + 12;
    x = d.text('Metodo:', x, ry, S) + 5;
    x = d.check('Contanti', x, ry, false, S) + 7;
    x = d.check('Bonifico', x, ry, false, S) + 7;
    x = d.check('POS', x, ry, false, S) + 12;
    d.field('Data pagamento:', x, ry, pr, '', S);
    ry += 20;
    x = d.text('Abbonamento:', px, ry, S) + 5;
    x = d.check('Mensile', x, ry, false, S) + 6;
    x = d.check('Trimestrale', x, ry, false, S) + 6;
    x = d.check('Annuale', x, ry, false, S) + 10;
    x = d.text('Frequenza:', x, ry, S) + 5;
    x = d.check('1', x, ry, false, S) + 6;
    x = d.check('2', x, ry, false, S) + 6;
    x = d.check('3 giorni/settimana', x, ry, false, S) + 10;
    d.field('Data inizio:', x, ry, pr, '', S);

    return d.build('Modulo di iscrizione ' + stagione + ' - ASD Gym Art Avezzano');
  }

  // ------------------------------- document 2: medical certificate request
  function richiestaCertificato(data) {
    data = data || {};
    const a = data.atleta || {}, g = data.genitore || {}, s = data.societa || {};
    const ago = str(data.tipo).toLowerCase() === 'agonistico';
    const stagione = str(data.stagione) || '2026/2027';
    const d = new Doc();
    const ROW = 28, P = { size: 10.5 };
    let y = header(d);

    // --- addressee
    y += 26;
    d.text('Al Medico certificatore /', RX, y, { align: 'right' });
    d.text('Centro di Medicina dello Sport', RX, y + 12.5, { align: 'right' });

    // --- title
    y += 48;
    y = d.paragraph(ago ? 'RICHIESTA DI VISITA MEDICA PER L\'IDONEITÀ ALLA PRATICA SPORTIVA AGONISTICA'
      : 'RICHIESTA DI CERTIFICATO MEDICO PER ATTIVITÀ SPORTIVA NON AGONISTICA',
    M + 30, y, CW - 60, { font: 'F2', size: 12.5, leading: 16, align: 'center', balance: true });
    if (ago) { d.text('(D.M. 18/02/1982)', PW / 2, y - 1, { size: 9, align: 'center' }); y += 12; }

    // --- applicant (club legal representative)
    y += 20;
    y = d.flow(['Il/La sottoscritto/a', { blank: 175, value: str(s.legale) },
      ', legale rappresentante della A.S.D. Gym Art Avezzano, con sede in Via Ezio Tarantelli n. 1 - 67051 ' +
      'Avezzano (AQ), affiliata a', { blank: 150, value: str(s.ente) },
      ' (codice di affiliazione', { blank: 95, value: str(s.codice) }, '),'],
    M, y, CW, { size: 10.5, leading: 22 });

    y += 8;
    d.text('CHIEDE', PW / 2, y, { font: 'F2', size: 11, align: 'center' });
    y += 24;
    y = d.paragraph(ago
      ? 'che l\'atleta sotto indicato/a, tesserato/a per la stagione sportiva ' + stagione + ', sia sottoposto/a ' +
        'a visita medica per l\'accertamento dell\'idoneità alla pratica sportiva agonistica per la disciplina:'
      : 'che all\'atleta sotto indicato/a, iscritto/a per la stagione sportiva ' + stagione + ', sia rilasciato ' +
        'il certificato medico per l\'attività sportiva non agonistica per la disciplina:',
    M, y, CW, { size: 10.5, leading: 15 });
    y += 10;
    d.text('GINNASTICA ARTISTICA', PW / 2, y, { font: 'F2', size: 11, align: 'center' });

    // --- athlete
    y = section(d, 'DATI DELL\'ATLETA', y + 34);
    y += 26;
    d.field('Cognome e Nome:', M, y, RX, str(a.nome), P);
    y += ROW;
    d.field('Nato/a a:', M, y, 372, str(a.luogo), P);
    d.field('il:', 384, y, RX, str(a.nascita), P);
    y += ROW;
    d.field('Codice Fiscale:', M, y, RX, str(a.cf), P);
    y += ROW;
    d.field('Residente a:', M, y, 420, str(a.citta), P);
    d.field('CAP:', 432, y, RX, str(a.cap), P);
    y += ROW;
    d.field('Indirizzo:', M, y, RX, str(a.indirizzo), P);

    // --- parent / guardian
    y = section(d, 'GENITORE / TUTORE (per minorenni)', y + 34);
    y += 26;
    d.field('Cognome e Nome:', M, y, 372, str(g.nome), P);
    d.field('Telefono:', 384, y, RX, str(g.tel), P);

    // --- note, date and signatures
    y += 32;
    y = d.paragraph('Il certificato va consegnato in segreteria in originale o in copia leggibile. Sul certificato ' +
      'devono comparire la data di rilascio e, per l\'attività agonistica, la data di scadenza.',
    M, y, CW, { size: 8.5, leading: 11 });
    y += 28;
    d.field('Avezzano, lì', M, y, M + 215, str(data.data), P);
    y += 72;
    signatures(d, y, 'Timbro e firma del legale rappresentante', 'Firma del genitore / tutore');

    return d.build('Richiesta certificato medico ' + (ago ? 'agonistico' : 'non agonistico') + ' - ASD Gym Art Avezzano');
  }

  // ------------------------------------------------------ document 3: receipt
  // data: { numero, data, stagione, pagante: { nome, cf }, atleta: { nome, nascita, cf }, causale,
  //         importo ("170,00 €"), lettere ("centosettanta/00"), metodo, note, residuo, societa: { cf } }
  function ricevuta(data) {
    data = data || {};
    const p = data.pagante || {}, a = data.atleta || {}, s = data.societa || {};
    const d = new Doc();
    const ROW = 27, P = { size: 10.5 };
    let y = header(d);

    y += 30;
    d.text('RICEVUTA DI PAGAMENTO', PW / 2, y, { font: 'F2', size: 14, align: 'center' });
    y += 30;
    d.field('Ricevuta n.:', M, y, 250, str(data.numero), P);
    d.field('Data:', 270, y, 400, str(data.data), P);
    d.field('Stagione:', 420, y, RX, str(data.stagione), P);

    y = section(d, 'RICEVIAMO DA', y + 34);
    y += 26;
    d.field('Cognome e Nome:', M, y, RX, str(p.nome), P);
    y += ROW;
    d.field('Codice Fiscale:', M, y, RX, str(p.cf), P);

    y = section(d, 'PER L\'ATLETA', y + 34);
    y += 26;
    d.field('Cognome e Nome:', M, y, RX, str(a.nome), P);
    y += ROW;
    d.field('Nato/a il:', M, y, 250, str(a.nascita), P);
    d.field('Codice Fiscale:', 270, y, RX, str(a.cf), P);

    y = section(d, 'CAUSALE', y + 34);
    y += 22;
    // At most three lines: a longer text is cut, never pushed down the page.
    wrap(str(data.causale) || 'Quota di frequenza ai corsi di ginnastica artistica', CW, 'F1', 10.5).slice(0, 3)
      .forEach((line) => { d.text(line, M, y, P); y += 15; });
    if (str(data.note)) { d.text(fit('Note: ' + str(data.note), 'F1', 9.5, CW), M, y + 2); y += 15; }

    y = section(d, 'IMPORTO', y + 22);
    y += 16;
    d.strokeRect(M, y, CW, 58, 0.8);
    d.text('Euro', M + 14, y + 25, { font: 'F2', size: 12 });
    d.text(fit(str(data.importo), 'F2', 18, 190), M + 52, y + 26, { font: 'F2', size: 18 });
    d.text('in lettere:', M + 258, y + 25, P);
    d.text(fit(str(data.lettere), 'F1', 10.5, CW - 326), M + 312, y + 25, P);
    d.text('Pagamento:', M + 14, y + 46, P);
    d.text(fit(str(data.metodo), 'F2', 10.5, 170), M + 74, y + 46, { font: 'F2', size: 10.5 });
    if (str(data.residuo)) d.text(fit('Resta da versare: ' + str(data.residuo), 'F1', 10.5, CW - 272), M + 258, y + 46, P);
    y += 58;

    y += 46;
    d.field('Avezzano, lì', M, y, M + 215, str(data.data), P);
    y += 70;
    d.hline(RX - 228, RX, y, 0.6);
    d.text('Timbro e firma', RX - 114, y + 10.5, { size: 8, align: 'center' });
    y += 44;
    d.paragraph('A.S.D. Gym Art Avezzano - Via Ezio Tarantelli n. 1 - 67051 Avezzano (AQ)' + (str(s.cf) ? ' - Codice fiscale ' + str(s.cf) : ''),
      M, y, CW, { size: 8.5, leading: 11 });

    return d.build('Ricevuta ' + str(data.numero) + ' - ASD Gym Art Avezzano');
  }

  const GymPdf = { moduloIscrizione, richiestaCertificato, ricevuta };
  if (typeof module !== 'undefined' && module.exports) module.exports = GymPdf; else root.GymPdf = GymPdf;
})(typeof self !== 'undefined' ? self : this);
