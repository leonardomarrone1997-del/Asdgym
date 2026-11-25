// node tools/anteprima/costruisci.js [out.html] -> one HTML file with the page of the Windows program, a fake "program" inside it (shim.js) and invented data.
// For looking at the program from a device that cannot run the .exe (a phone, a tablet, a browser). Nothing in it is saved: a reload starts again.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), WEB = path.join(ROOT, 'win', 'web');
const w = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const dati = (f, tipo) => 'data:' + tipo + ';base64,' + fs.readFileSync(path.join(WEB, f)).toString('base64');
// the fonts are embedded in the stylesheet: the preview is a single file
const css = w('gymart.css').replace(/url\("fonts\/([^"]+)"\)/g, (m, f) => 'url("' + dati('fonts/' + f, 'font/woff2') + '")');
if (/url\("fonts\//.test(css)) throw new Error('a font was not embedded');
const index = w('index.html');
const body = index.slice(index.indexOf('<body>') + 6, index.indexOf('<script src="core.js">')).replace(/<link[^>]*>/g, '');
const versione = (/var version = "(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(path.join(ROOT, 'win', 'main.go'), 'utf8')) || [])[1];
if (!versione) throw new Error('the version is not in win/main.go');
const shim = fs.readFileSync(path.join(__dirname, 'shim.js'), 'utf8').split('@VERSIONE@').join(versione);
// the scripts in the order of index.html: the head first, then the body; the fake program goes just before app.js
const ordine = [...index.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = ordine.map((f) => (f === 'app.js' ? shim + '\n;\n' : '') + w(f));
const svg = (f) => dati(f, 'image/svg+xml');
js.forEach((s, i, a) => { a[i] = s.split("'logo-scuro.svg'").join("'" + svg('logo-scuro.svg') + "'").split("'logo-chiaro.svg'").join("'" + svg('logo-chiaro.svg') + "'").split("'icon.svg'").join("'" + svg('icon.svg') + "'"); });
js.forEach((s, i) => { if (/<\/script/i.test(s)) throw new Error('a closing script tag inside ' + ordine[i]); });
const out = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="gymart-token" content="anteprima">
<title>Gym Art Segreteria</title>
<link rel="icon" href="${svg('icon.svg')}" type="image/svg+xml">
<style>
${css}
.anteprima-banner{background:var(--accent-soft);color:var(--ink);text-align:center;font-size:12.5px;font-weight:600;padding:7px 14px}
</style>
</head>
<body>
<div class="anteprima-banner">Anteprima ${versione}: dati inventati, le modifiche restano solo in questa pagina</div>
${body}
<script>
${js.join('\n;\n')}
</script>
</body>
</html>
`;
const dest = process.argv[2] || path.join(ROOT, 'out', 'anteprima.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('anteprima', versione, dest, Math.round(out.length / 1024) + ' KB');
