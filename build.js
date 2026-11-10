const fs=require('fs'),p=f=>fs.readFileSync(__dirname+'/src/'+f,'utf8');
const js=['core.js','plan.js','pdf.js','app1.js','app2.js'].map(p).join('\n;\n');
if(/<\/script/i.test(js)) throw new Error('script close tag inside JS');
let h=p('index.html').replace('/*CSS*/',()=>p('style.css')).replace('/*JS*/',()=>js);
fs.writeFileSync(__dirname+'/dist/index.html',h); console.log('built',h.length);
