// Explicit opt-in: creates a fresh test family; optionally makes ONE billed model request
// using a synthetic label. Clears only that family's test inventory in finally.
// PANTRY_LIVE_TEST=yes PANTRY_LIVE_RECOGNITION=yes PLAYWRIGHT_MODULE=/path/to/playwright \
// PANTRY_TEST_BASE_URL=http://127.0.0.1:8039/pantry.html node scripts/test-opened-expiry-live.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
if(process.env.PANTRY_LIVE_TEST!=='yes')throw new Error('Explicit PANTRY_LIVE_TEST=yes required; creates cloud test data.');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const baseURL=process.env.PANTRY_TEST_BASE_URL||'https://pantry-mng.vercel.app/pantry.html';
const recognize=process.env.PANTRY_LIVE_RECOGNITION==='yes';
async function screen(page,id){await page.waitForFunction(id=>document.querySelectorAll('.screen.active').length===1&&document.getElementById(id).classList.contains('active'),id);}
(async()=>{
  const browser=await chromium.launch({headless:true});
  let page,ownedFamily=null;
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
    page=await context.newPage();
    const clientId=randomUUID();
    await page.addInitScript(id=>{
      localStorage.setItem('pantry_client_id',id);
      localStorage.setItem('pantry_deduct_v4',String(Date.now()));
    },clientId);
    await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:204,body:''}));
    await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({status:204,body:''}));
    // Keep synthetic UI telemetry out of the product funnel; family/model APIs are real.
    await page.route('**/api/usage-event',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
    // Pre-release only: serve the candidate HTML on the real origin; all backend calls remain live.
    if(process.env.PANTRY_LIVE_LOCAL_HTML==='yes')await page.route('**/pantry.html',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('pantry.html','utf8')}));
    const apiResults=[];
    page.on('response',r=>{if(/\/api\/(families|openrouter)/.test(r.url()))apiResults.push({path:new URL(r.url()).pathname,method:r.request().method(),status:r.status()});});
    await page.goto(baseURL);await page.waitForFunction(()=>cloudReady||cloudState==='error',{},{timeout:30000});
    assert.equal(await page.evaluate(()=>cloudReady),true,`cloud connection: ${JSON.stringify(apiResults)}`);
    const initial=await page.evaluate(()=>({id:pantryFamilyId,count:items.length}));
    assert.equal(initial.count,0,'fresh UUID must own an empty family');ownedFamily=initial.id;
    await page.evaluate(()=>nav('scr-add'));await screen(page,'scr-add');
    let prefix='mf';
    if(recognize){
      const label=await context.newPage();
      await label.setViewportSize({width:900,height:650});
      await label.setContent('<html><body style="margin:0;padding:50px;background:white;color:black;font:38px Arial"><h1>LAB CREAM</h1><p>TEST BRAND · 50 ml</p><p>EXP 2028-12-31</p><p>After opening, use within 6 months.</p><small>Synthetic test label</small></body></html>');
      const bytes=await label.screenshot({type:'jpeg',quality:95});await label.close();
      const result=await page.evaluate(async b64=>{
        const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'synthetic-label.jpg',{type:'image/jpeg'});
        const result=await recognizePhoto([file]);fillRecognitionResult(result);
        return {life:result.openedShelfLife,expiry:result.expiryDate,evidence:result.openedShelfLifeEvidence};
      },bytes.toString('base64'));
      assert.deepEqual(result.life,{value:6,unit:'month'});
      assert.equal(result.expiry,'2028-12-31');
      console.log('Real recognition:',JSON.stringify(result));prefix='fi';
    }else{
      await page.locator('#mf-name').fill('隔离验收测试面霜');
      await page.locator('#mf-size').fill('50');
      await page.locator('#mf-open-life').fill('6');
      await page.locator('#mf-exp').fill('2028-12-31');
    }
    await page.locator(`#${prefix}-package-type`).selectOption('regular');
    await page.locator('#confirm-btn').click();await screen(page,'scr-home');
    await page.evaluate(async()=>{clearTimeout(cloudSyncTimer);await pushCloudNow();});
    await page.evaluate(()=>openDetail(items[0].id));await screen(page,'scr-detail');
    await page.getByRole('button',{name:'开封使用',exact:true}).click();await page.locator('#sh-ok').click();
    await page.evaluate(async()=>{clearTimeout(cloudSyncTimer);await pushCloudNow();});
    const saved=await page.evaluate(async()=>{
      const response=await fetch(`/api/families/${pantryFamilyId}`,{headers:{'X-Client-Id':getOrCreateClientId()}});
      if(!response.ok)throw new Error(`Cloud GET ${response.status}`);
      const body=await response.json();
      return {item:body.data.items[0],date:today(),days:getExpInfo(items[0]).days,exportLife:buildExportPayload().items[0].openedShelfLife};
    });
    assert.deepEqual(saved.item.openedShelfLife,{value:6,unit:'month'});
    assert.deepEqual(saved.exportLife,{value:6,unit:'month'});
    assert.equal(saved.item.openedDates[0],saved.date);
    assert.equal(saved.days,180);
    await page.evaluate(()=>localStorage.removeItem(PANTRY_ITEMS_KEY));
    await page.reload();await page.waitForFunction(()=>cloudReady);
    const reloaded=await page.evaluate(()=>({life:items[0].openedShelfLife,days:getExpInfo(items[0]).days}));
    assert.deepEqual(reloaded,{life:{value:6,unit:'month'},days:180});
    assert.equal(apiResults.filter(r=>r.path==='/api/openrouter').length,recognize?1:0);
    assert.ok(apiResults.every(r=>r.status===200),JSON.stringify(apiResults));
    console.log('PASS: real isolated family create → save → open → GET → export → clear local → cloud reload; 180 days; HTTP 200; model calls='+Number(recognize));
  }finally{
    try{
      if(page&&ownedFamily){
        const cleaned=await page.evaluate(async familyId=>{
          clearTimeout(cloudSyncTimer);cloudReady=false;
          if(pantryFamilyId!==familyId)throw new Error('Refusing cleanup: test family changed');
          const headers={'X-Client-Id':getOrCreateClientId(),'Content-Type':'application/json'};
          const current=await fetch(`/api/families/${familyId}`,{headers});
          if(!current.ok)throw new Error('Cleanup GET failed');
          const data=await current.json();
          const result=await fetch(`/api/families/${familyId}`,{method:'PUT',headers,body:JSON.stringify({baseVersion:data.version,data:{items:[],locations:[]}})});
          if(!result.ok)throw new Error(`Cleanup PUT ${result.status}`);
          const checked=await fetch(`/api/families/${familyId}`,{headers});
          if(!checked.ok)throw new Error('Cleanup verify GET failed');
          return (await checked.json()).data.items.length===0;
        },ownedFamily);
        assert.equal(cleaned,true);console.log('Cleanup verified: isolated test family inventory empty.');
      }
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
