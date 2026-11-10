const fs=require('fs'),p=f=>fs.readFileSync(__dirname+'/src/'+f,'utf8');
const shim=`window.claude={use:function(n){
 if(n==='mcp')return Promise.resolve({callTool:function(server,tool,input){return new Promise(function(ok,ko){
   google.script.run.withSuccessHandler(function(s){try{ok({payload:JSON.parse(s)});}catch(e){ko({code:'tool_error',message:'risposta non valida'});}})
    .withFailureHandler(function(e){ko({code:'tool_error',message:(e&&e.message)||String(e)});}).gs(tool,JSON.stringify(input));});}});
 if(n==='downloads')return Promise.resolve({save:function(r){try{var a=document.createElement('a');a.href=URL.createObjectURL(r.data);a.download=r.filename;document.body.appendChild(a);a.click();a.remove();return Promise.resolve({status:'saved'});}catch(e){return Promise.reject({code:'unavailable',message:String(e)});}}});
 return Promise.resolve(null);}};`;
const tail=`TABS[1][1]='Inserisci';
document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('a[href^="#"]'):null;if(!a)return;e.preventDefault();var v=a.getAttribute('href').slice(1);if(TABS.some(function(x){return x[0]===v;})){S.view=v;render();window.scrollTo(0,0);}});
render();`;
let app=[p('app1.js'),p('app2.js')].join('\n;\n');
const rep=[["'Scansiona un modulo o un certificato'","'Inserisci un modulo o un certificato'"],["'Scansiona documenti'","'Inserisci documenti'"],
 ["'Scegli le foto dei moduli di iscrizione o dei certificati medici. Ogni foto viene letta, poi controlli i dati e confermi.'","'Inserisci a mano i dati di un modulo di iscrizione o di un certificato medico. Puoi anche caricare la foto per tenerla accanto mentre scrivi.'"],
 ["'La lettura automatica delle foto non è disponibile in questa finestra: puoi comunque inserire i dati a mano.'","'Questa versione non legge le foto da sola: i dati si scrivono a mano, con gli stessi controlli.'"],
 ["'Scegli o scatta le foto'","'Carica una foto da tenere accanto'"],
 ["'Da qui non posso far leggere le foto a Claude. Puoi inserire i dati a mano guardando la foto.'","'Scegli se è un modulo o un certificato e scrivi i dati guardando la foto.'"],["'Lettura non riuscita'","'Foto caricata'"]];
rep.forEach(([a,b])=>{ if(!app.includes(a)) throw new Error('missing '+a); app=app.split(a).join(b); });
const js=[shim,p('core.js'),p('plan.js'),p('pdf.js'),app,tail].join('\n;\n');
if(/<\/script/i.test(js)) throw new Error('script close tag');
let h=p('index.html').replace('/*CSS*/',()=>p('style.css')).replace('/*JS*/',()=>js);
fs.writeFileSync(__dirname+'/gas/Pagina.html',h); console.log('built gas',h.length);
