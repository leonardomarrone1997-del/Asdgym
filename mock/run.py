import json,sys
from playwright.sync_api import sync_playwright
A='/home/claude/work/app/'
data=open(A+'mock/data.json',encoding='utf-8').read(); mock=open(A+'mock/mock.js',encoding='utf-8').read()
AI=[{"tipo_documento":"modulo_iscrizione","atleta":{"cognome_nome":"MARIA ROSSI","data_nascita":"2026-04-05","data_nascita_come_scritta":"05.04.2026","luogo_nascita":"L'AQUILA","codice_fiscale":None,"indirizzo":"VIA DEI MILLE 3","citta":"AVEZZANO","cap":"67051"},
 "genitore":{"cognome_nome":"ROSSI ANTONIO","codice_fiscale":"DLCNNL75C48H501H","telefono":"333 1234567","email":"a.rossi@example.it","secondo_telefono":None},
 "iscrizione":{"corso":"base","giorni":["Lun","Mer"],"orario":"17-18.30","quota_iscrizione":None,"quota_mensile":None,"sconto_fratelli":None,"modalita_pagamento":None,"certificato_tipo":None,"certificato_scadenza":None,"note_sanitarie_presenti":False},
 "consensi":{"privacy":None,"liberatoria":True,"data_modulo":"2026-11-03","firma_genitore":True,"firma_societa":False},
 "segreteria":{"pagato":True,"importo":None,"metodo":None,"data_pagamento":None,"tipo_abbonamento":"Trimestrale","giorni_settimana":2,"data_inizio":"2026-11-02","annotazioni":"P TRIM 2/11/26"},
 "certificato":{"tipo":None},"dubbi":[{"campo":"telefono","motivo":"ultime cifre poco chiare"}]},
 {"tipo_documento":"certificato_medico","atleta":{"cognome_nome":"DEL BOSCO ANNA","data_nascita":"2012-05-06","luogo_nascita":"AVEZZANO, AQ","codice_fiscale":"DLBGLI13R52A345D","citta":"MAGLIANO DEI MARSI"},
 "certificato":{"tipo":"agonistico","titolo":"CERTIFICATO DI IDONEITÀ ALLA PRATICA SPORTIVA AGONISTICA","data_rilascio":"2026-10-27","data_rilascio_a_penna":False,"data_scadenza":"2027-10-26","validita_testo":"11 mesi e 29 giorni"},"dubbi":[]}]
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    def page(w,h):
        pg=b.new_page(viewport={'width':w,'height':h}); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'fonts' not in m.text and 'ERR_' not in m.text else None); pg.on('pageerror',lambda e: errs.append('PAGEERROR '+str(e)))
        pg.add_init_script('window.__DATA='+data+';window.__AI='+json.dumps(AI)+';'+mock); pg.goto('file://'+A+'dist/index.html'); pg.wait_for_selector('.tile',timeout=15000); return pg
    pg=page(1200,900); pg.screenshot(path=A+'out/s_inizio.png')
    print('tiles',[t.inner_text().replace('\n',' ') for t in pg.query_selector_all('.tile')])
    # --- scan modulo
    pg.goto('file://'+A+'dist/index.html#scansiona'); pg.wait_for_selector('#scan-file',state='attached')
    pg.set_input_files('#scan-file','/mnt/user-data/uploads/2940094d-image.jpg'); pg.wait_for_selector('#plan-box',timeout=20000)
    print('sample',pg.evaluate('window.__SAMPLE'))
    def notes(): return [n.inner_text().replace('\n',' | ')[:600] for n in pg.query_selector_all('#plan-box .note')]
    print('PLAN1',notes()); print('btn disabled',pg.eval_on_selector('#plan-box .btn-primary','b=>b.disabled'))
    pg.screenshot(path=A+'out/s_scan1.png',full_page=True)
    def setf(label,val):
        f=pg.locator('.field',has=pg.locator('label',has_text=label)).first.locator('input'); f.fill(val); f.dispatch_event('change')
    setf('Data di nascita','2015-04-05'); pg.wait_for_timeout(100)
    setf('Importo pagato','170'); pg.locator('.field',has=pg.locator('label',has_text='Metodo')).locator('select').select_option('POS'); pg.wait_for_timeout(100)
    print('PLAN2',notes())
    rows=pg.eval_on_selector_all('#plan-box tbody tr','rs=>rs.map(r=>r.innerText.replace(/\\t/g," | "))'); print('LINES',len(rows)); [print('  ',r) for r in rows]
    pg.check('#plan-box input[type=checkbox][id^=ack]'); pg.wait_for_timeout(50)
    pg.click('#plan-box .btn-primary'); pg.wait_for_selector('.note-ok, .note-bad',timeout=20000); pg.wait_for_timeout(300)
    print('RESULT1',[n.inner_text() for n in pg.query_selector_all('.card .note li')])
    pg.screenshot(path=A+'out/s_done1.png',full_page=True)
    # --- scan certificate
    pg.set_input_files('#scan-file','/mnt/user-data/uploads/ecaed4c4-image.jpg'); pg.wait_for_selector('#plan-box',timeout=20000)
    print('CERT plan',notes(),'chips',[c.inner_text() for c in pg.query_selector_all('#plan-box .chip')])
    rows=pg.eval_on_selector_all('#plan-box tbody tr','rs=>rs.map(r=>r.innerText.replace(/\\t/g," | "))'); [print('  ',r) for r in rows]
    setf('Codice fiscale',''); pg.wait_for_timeout(100); print('CERT plan2',notes())
    a=pg.query_selector('#plan-box input[id^=ack]'); 
    if a: a.check()
    pg.wait_for_timeout(50); pg.click('#plan-box .btn-primary'); pg.wait_for_function("document.querySelectorAll('.card .note li').length>0 && !document.querySelector('.spin')",timeout=20000)
    print('RESULT2',[n.inner_text() for n in pg.query_selector_all('.card .note li')])
    # --- payment
    pg.goto('file://'+A+'dist/index.html#pagamenti'); pg.wait_for_selector('#pay-allieva'); pg.fill('#pay-allieva','Verdi Camilla'); pg.dispatch_event('#pay-allieva','change'); pg.wait_for_selector('#pay-box')
    setf('Importo','45'); pg.locator('.field',has=pg.locator('label',has_text='Metodo')).locator('select').select_option('Contanti'); pg.wait_for_timeout(100)
    print('PAY plan',[n.inner_text().replace('\n',' | ') for n in pg.query_selector_all('#pay-box .note')], pg.inner_text('#pay-box .btn-primary'))
    pg.screenshot(path=A+'out/s_pay.png',full_page=True)
    a=pg.query_selector('#pay-ack'); 
    if a: a.check()
    pg.click('#pay-box .btn-primary'); pg.wait_for_selector('.card > .note li',timeout=20000); print('RESULT3',[n.inner_text() for n in pg.query_selector_all('.card > .note li')])
    # --- stampa
    pg.goto('file://'+A+'dist/index.html#stampa'); pg.wait_for_selector('#stampa-allieva'); pg.fill('#stampa-allieva','Rossi Maria'); pg.dispatch_event('#stampa-allieva','change'); pg.wait_for_timeout(100)
    pg.click('text=Scarica il PDF'); pg.wait_for_timeout(300); print('SAVES',pg.evaluate('window.__SAVES'))
    for v in ['scadenze','registro','guida']:
        pg.goto('file://'+A+'dist/index.html#'+v); pg.wait_for_timeout(200); pg.screenshot(path=A+'out/s_'+v+'.png')
    print('LOG'); [print('  ',json.dumps(l,ensure_ascii=False)[:700]) for l in pg.evaluate('window.__LOG')]
    m=page(390,800); m.screenshot(path=A+'out/m_inizio.png'); m.goto('file://'+A+'dist/index.html#scansiona'); m.wait_for_timeout(200); m.click('text=Modulo a mano'); m.wait_for_selector('#plan-box'); m.screenshot(path=A+'out/m_scan.png',full_page=True)
    print('mobile overflow', m.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth'))
    b.close()
print('ERRORS',errs)
