(function(){
  var D=window.__DATA, log=window.__LOG=[], saves=window.__SAVES=[];
  function col(s){var n=0;for(var i=0;i<s.length;i++)n=n*26+s.charCodeAt(i)-64;return n-1;}
  function parse(r){var m=/^'?([^'!]+)'?!(.+)$/.exec(r),sh=m[1],a=m[2],p=a.split(':'),x=/^([A-Z]*)(\d*)$/.exec(p[0]),y=/^([A-Z]*)(\d*)$/.exec(p[1]||p[0]);
    return {sh:sh,c0:x[1]?col(x[1]):0,r0:x[2]?+x[2]:1,c1:y[1]?col(y[1]):null,r1:y[2]?+y[2]:null};}
  function grid(sh){var g=D[sh]; if(!g) throw {code:'tool_error',message:'no sheet '+sh}; return g;}
  var OFF={ANAGRAFICA:2,ISCRIZIONI:2,PAGAMENTI:2,'REGISTRO SCANSIONI':2,LISTE:3,TARIFFARIO:3};
  function disp(v,sh){ if(v===null||v===undefined) return undefined; if(typeof v==='number') return sh==='REGISTRO SCANSIONI'?(v>40000?'10/11/2026 21:00':String(v)):v.toFixed(2).replace('.',',')+' €';
    v=String(v); if(v.charAt(0)==="'") return v.slice(1); var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return m?m[3]+'/'+m[2]+'/'+m[1]:v; }
  function rowOf(sh,r){var g=grid(sh),i=r-OFF[sh]; while(g.length<=i) g.push([]); return g[i];}
  function derive(sh,r){ var row=rowOf(sh,r);
    if(sh==='ISCRIZIONI'&&row[1]){ row[27]=(row[0]||'')+' · '+row[1]+' · '+(row[2]||'')+(row[3]?' '+row[3]:''); for(var i=0;i<27;i++) if(row[i]===undefined) row[i]=''; }
    if(sh==='PAGAMENTI'&&row[1]){ row[4]='RIC-'+('000'+(r-2)).slice(-4); row[7]=row[1].slice(0,4); var e=D.ISCRIZIONI.filter(function(x){return x[0]===row[7];})[0]; row[8]=e?e[1]:'?'; for(var j=0;j<9;j++) if(row[j]===undefined) row[j]=''; } }
  var mcp={ callTool:function(server,tool,input){ return new Promise(function(ok,ko){ setTimeout(function(){ try{
      if(window.__FAIL&&window.__FAIL(tool,input)) throw {code:'server_unavailable',message:'simulated'};
      if(tool==='get_values'){ var p=parse(input.range),g=grid(p.sh),out=[],last=p.r1||(g.length+OFF[p.sh]-1);
        for(var r=p.r0;r<=last;r++){ var row=(g[r-OFF[p.sh]]||[]).map(function(x){return x===undefined?'':x;}); out.push(row); }
        while(out.length&&!out[out.length-1].some(function(x){return x!=='';})) out.pop();
        ok({payload:{range:input.range,values:out}}); }
      else if(tool==='update_values'){ log.push({tool:tool,range:input.range,values:input.values}); var q=parse(input.range);
        input.values.forEach(function(vals,ri){ var row=rowOf(q.sh,q.r0+ri); vals.forEach(function(v,ci){ var d=disp(v,q.sh); if(d!==undefined) row[q.c0+ci]=d; }); for(var k=0;k<row.length;k++) if(row[k]===undefined) row[k]=''; derive(q.sh,q.r0+ri); });
        ok({payload:{status:'success'}}); }
      else if(tool==='append_values'){ log.push({tool:tool,range:input.range,n:input.values.length,first:input.values[0]}); var sh=parse(input.range).sh,gg=grid(sh); input.values.forEach(function(v){ gg.push(v.map(function(x){return disp(x,sh)||'';})); }); ok({payload:{status:'success'}}); }
      else ko({code:'not_in_manifest',message:tool});
    }catch(e){ko(e);} },5); }); } };
  function sample(){ return Promise.reject({code:'invalid_request'}); }
  sample.json=function(prompt,opts){ window.__SAMPLE={promptLen:prompt.length,images:(opts.images||[]).map(function(b){return b.size;}),tier:opts.modelTier}; return new Promise(function(ok){ setTimeout(function(){ ok(window.__AI.shift()); },30); }); };
  sample.limits=function(){ return Promise.resolve({maxPromptBytes:262144,images:{maxCount:5,maxInputBytes:2e7,mediaTypes:['image/jpeg','image/png']}}); };
  var downloads={ save:function(r){ saves.push({filename:r.filename,size:r.data.size}); return Promise.resolve({status:'saved'}); } };
  window.claude={ use:function(n){ return Promise.resolve({mcp:mcp,sample:sample,downloads:downloads}[n]||null); } };
})();
