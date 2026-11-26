// Exercise the real sandboxed preload, authorized-XML parsing, QR rendering
// and receipt height in Chromium. Keep every print job inside this test.
const {app,BrowserWindow,ipcMain,session}=require('electron');
const {measuredBox}=require('../driver-print');
const {fiscalDocument}=require('../fiscal-document');
const assert=require('node:assert/strict'), path=require('node:path'),os=require('node:os'),fs=require('node:fs');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'md-fiscal-smoke-')));
const key='1'.repeat(44), store='https://mydeliveryfood.com.br', api='https://api.mydeliveryfood.com.br';
const fixture={id:42,chave:key,protocolo:'123',qrCodeUrl:'https://example.org/consulta?p=teste'};
const xml='<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe'+key+'"><ide><mod>65</mod><tpAmb>1</tpAmb><nNF>42</nNF><serie>1</serie></ide><emit><xNome>Loja de teste</xNome></emit><det><prod><xProd>Pizza</xProd><qCom>1</qCom><vProd>25.00</vProd></prod></det><total><ICMSTot><vNF>25.00</vNF></ICMSTot></total><pag><detPag><tPag>17</tPag><vPag>25</vPag></detPag></pag></infNFe></NFe>';
const watchdog=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
  session.defaultSession.protocol.handle('https',req=>{
    const url=new URL(req.url), headers={'Access-Control-Allow-Origin':store,'Access-Control-Allow-Headers':'Authorization','Access-Control-Allow-Methods':'GET, OPTIONS'};
    if(url.origin===store) return new Response('<script>localStorage.setItem("token","test");</script>',{headers:{'Content-Type':'text/html'}});
    assert.equal(url.origin,api);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    assert.equal(req.headers.get('Authorization'),'Bearer test');
    const content=url.pathname.endsWith('/xml')?xml:url.pathname.endsWith('/dados-fiscais')?JSON.stringify({...fixture,chaveAcesso:key,temNota:true}):JSON.stringify([fixture]);
    return new Response(content,{headers});
  });
  ipcMain.handle('md:fiscal-estado',()=>Date.now());
  let receive;
  const got=new Promise(resolve=>{receive=resolve;});
  ipcMain.handle('md:fiscal-imprimir',(_e,p)=>{receive(p);return {ok:true};});
  const owner=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'../preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  await owner.loadURL(store+'/pedidos.html');
  const payload=await got;
  assert.equal(payload.manual,false);assert.equal(payload.id,42);assert.equal(payload.note.payments[0].type,'17');
  assert.equal(payload.note.total,'25.00');
  const result=await owner.webContents.executeJavaScript('window.myDeliveryDesktop.imprimirNotaFiscal(123)');
  assert.equal(result.ok,true);assert.equal(result.configurada,true);
  const paper=new BrowserWindow({show:false,webPreferences:{sandbox:true,javascript:false}});
  for(const width of [58,80]){
    const html=fiscalDocument(payload.note,width);
    await paper.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const metrics=await measuredBox(paper.webContents,'main');
    const expectedWidth = (width === 58 ? 48 : 68) * 96 / 25.4;
    assert.ok(metrics.width <= Math.ceil(expectedWidth));
    assert.ok(metrics.border[0] < 1, 'start at the printable origin');
    const amount=await measuredBox(paper.webContents,'.row strong');
    assert.ok(amount.border[2] <= expectedWidth, 'show the complete price inside the printable width');
    metrics.qr=(await measuredBox(paper.webContents,'svg')).width;
    assert.ok(metrics.height>50 && metrics.height<900);assert.ok(metrics.qr>110);
    const pdf=await paper.webContents.printToPDF({pageSize:{width:width/25.4,height:(Math.ceil(metrics.height*25.4/96)+4)/25.4},margins:{top:0,bottom:0,left:0,right:0}});
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
  }
  clearTimeout(watchdog);console.log('Fiscal preload, QR and single-page thermal PDF passed.');app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(watchdog);app.exit(1);});
