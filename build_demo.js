// node build_demo.js [out.html]  -> one HTML file with the page of the Windows program, a fake "program" inside it and invented data.
// For looking at the program from a device that cannot run the .exe (a tablet, a phone). Nothing in it is saved.
const fs = require('fs'), path = require('path');
const w = (f) => fs.readFileSync(path.join(__dirname, 'win', 'web', f), 'utf8');
const css = ['style.css', 'win.css', 'apple.css'].map(w).join('\n');
const index = w('index.html');
let body = index.slice(index.indexOf('<body>') + 6, index.indexOf('<script src="core.js">')).replace(/<link[^>]*>/g, '');
const js = ['core.js', 'pdf.js', 'logic.js'].map(w).concat([fs.readFileSync(path.join(__dirname, 'win', 'demo', 'shim.js'), 'utf8'), w('app.js')]);
js.forEach((s, i) => { if (/<\/script/i.test(s)) throw new Error('script close tag inside JS #' + i); });
const demoCss = `
.demo-banner{background:var(--accent-soft);color:var(--ink);text-align:center;font-size:12.5px;font-weight:600;padding:7px 14px;letter-spacing:-.005em}
.top{top:env(safe-area-inset-top,0px)}
`;
const out = `<title>Gym Art Segreteria</title>
<style>
${css}
${demoCss}
</style>
<meta name="gymart-token" content="demo">
<div class="demo-banner">Anteprima: dati inventati, le modifiche restano solo in questa pagina</div>
${body}
<script>
${js.map((s) => s).join('\n;\n')}
</script>
`;
const dest = process.argv[2] || path.join(__dirname, 'dist-demo.html');
fs.writeFileSync(dest, out);
console.log('built', dest, out.length);
