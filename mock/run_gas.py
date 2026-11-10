import json
from playwright.sync_api import sync_playwright
A='/home/claude/work/app/'
data=open(A+'mock/data.json',encoding='utf-8').read(); mock=open(A+'mock/mock.js',encoding='utf-8').read()
G="""(function(){var m=null;window.claude.use('mcp').then(function(x){m=x;});
function R(ok,ko){return {withSuccessHandler:function(f){return R(f,ko);},withFailureHandler:function(f){return R(ok,f);},gs:function(tool,js){m.callTool('Google Sheets',tool,JSON.parse(js)).then(function(r){ok(JSON.stringify(r.payload));},function(e){ko(new Error(e.message||e.code));});}};}
window.google={script:{run:R(null,null)}};})();"""
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':820,'height':1100}); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.add_init_script('window.__DATA='+data+';window.__AI=[];'+mock+G); pg.goto('file://'+A+'gas/Pagina.html'); pg.wait_for_selector('.tile',timeout=15000)
    print('tabs',pg.inner_text('#tabs').replace('\n',' '))
    pg.click('#tabs a >> text=Inserisci'); pg.click('text=Modulo a mano'); pg.wait_for_selector('#plan-box')
    def setf(label,val,i=0):
        f=pg.locator('.field',has=pg.locator('label',has_text=label)).nth(i).locator('input'); f.fill(val); f.dispatch_event('change'); pg.wait_for_timeout(80)
    setf('Cognome e nome','Bianchi Sara'); setf('Data di nascita','2016-02-10'); setf('Codice fiscale atleta','DLBGLI13R52A345X'); setf('Telefono','3339998877')
    print('err',[n.inner_text().replace('\n',' | ')[:300] for n in pg.query_selector_all('#plan-box .note-bad')])
    setf('Codice fiscale atleta','')
    pg.locator('.field',has=pg.locator('label',has_text='Corso')).locator('select').select_option('Base'); pg.wait_for_timeout(100)
    pg.check('.days label:has-text("Lun") input'); pg.wait_for_timeout(100); pg.check('.days label:has-text("Gio") input'); pg.wait_for_timeout(100)
    print('pac',pg.locator('.field',has=pg.locator('label',has_text='Tariffa')).locator('select').input_value())
    print('notes',[n.inner_text().replace('\n',' | ')[:300] for n in pg.query_selector_all('#plan-box .note')])
    pg.evaluate("var a=document.querySelector('#plan-box input[id^=ack]'); if(a) a.click();"); pg.wait_for_timeout(80)
    pg.click('#plan-box .btn-primary'); pg.wait_for_function("document.querySelectorAll('.card .note li').length>0 && !document.querySelector('.spin')",timeout=20000)
    print('RESULT',[n.inner_text() for n in pg.query_selector_all('.card .note li')])
    pg.screenshot(path=A+'out/gas.png'); b.close()
print('ERRORS',errs)
