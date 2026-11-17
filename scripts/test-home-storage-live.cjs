// Explicit opt-in. Creates a fresh isolated family, never accesses existing inventory.
// PANTRY_LIVE_TEST=yes [PANTRY_LIVE_LOCAL_HTML=yes] PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-home-storage-live.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
if(process.env.PANTRY_LIVE_TEST!=='yes')throw new Error('PANTRY_LIVE_TEST=yes required: creates isolated cloud test data.');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PANTRY_TEST_BASE_URL||'https://pantry-mng.vercel.app/pantry.html';
async function screen(page,id){await page.waitForFunction(id=>document.querySelectorAll('.screen.active').length===1&&document.getElementById(id).classList.contains('active'),id);}
async function flush(page){await page.evaluate(async()=>{clearTimeout(cloudSyncTimer);await pushCloudNow();});}
(async()=>{
 const browser=await chromium.launch({headless:true});let page,ownedFamily;
 try{
  page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
  await page.addInitScript(id=>{localStorage.setItem('pantry_client_id',id);localStorage.setItem('pantry_deduct_v4',String(Date.now()));},randomUUID());
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:204,body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({status:204,body:''}));
  await page.route('**/api/usage-event',r=>r.fulfill({status:200,body:'{"ok":true}'}));
  if(process.env.PANTRY_LIVE_LOCAL_HTML==='yes')await page.route('**/pantry.html',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('pantry.html','utf8')}));
  const responses=[],errors=[];let modelCalls=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/openrouter')modelCalls++;});
  page.on('response',r=>{if(new URL(r.url()).pathname.startsWith('/api/families'))responses.push(r.status());});
  await page.goto(base);await page.waitForFunction(()=>cloudReady||cloudState==='error',{},{timeout:30000});
  assert.equal(await page.evaluate(()=>cloudReady),true,'real cloud must be ready');
  const initial=await page.evaluate(()=>({id:pantryFamilyId,count:items.length}));
  assert.equal(initial.count,0,'fresh client must get an empty family');ownedFamily=initial.id;
  const dates=await page.evaluate(()=>[21,14,7].map(days=>new Date((dateOrdinal(today())-days)*86400000).toISOString().slice(0,10)));
  await page.evaluate(()=>nav('scr-add'));await screen(page,'scr-add');
  await page.locator('#mf-name').fill('隔离验收防晒');await page.locator('#mf-nickname').fill('旅行防晒测试备注');
  await page.locator('#mf-package-type').selectOption('regular');await page.locator('#mf-size').fill('50');await page.locator('#mf-qty').fill('3');
  await page.locator('#mf-exp').fill('2030-01-01');await page.locator('#mf-open-life').fill('6');
  await page.locator('.intake-option:has(input[name="mf-open-state"][value="open"])').click();
  await page.locator('#mf-opened-date').fill(dates[1]);await page.locator('#confirm-btn').click();await screen(page,'scr-home');await flush(page);
  await page.evaluate(()=>openDetail(items[0].id));await screen(page,'scr-detail');
  await page.getByRole('button',{name:'再开一件',exact:true}).click();await page.locator('#take-opened-date').fill(dates[2]);await page.locator('#sh-ok').click();await flush(page);
  await page.locator('.ob-chip').first().click();
  await page.locator('#d-expiry-section').getByRole('button',{name:'修改',exact:true}).click();
  await page.locator('#edit-opened-date').fill(dates[0]);await page.locator('#sh-ok').click();await flush(page);
  const saved=await page.evaluate(async()=>{
   const response=await fetch(`/api/families/${pantryFamilyId}`,{headers:{'X-Client-Id':getOrCreateClientId()}});
   if(!response.ok)throw new Error('GET '+response.status);
   return {item:(await response.json()).data.items[0],exported:buildExportPayload().items[0],days:getExpInfo(items[0]).days};
  });
  assert.equal(saved.item.nickname,'旅行防晒测试备注');assert.equal(saved.item.name,'隔离验收防晒');
  assert.deepEqual(saved.item.openedDates,[dates[0],dates[2]]);assert.deepEqual(saved.item.openItems,[100,100]);assert.equal(saved.item.stockCount,1);assert.equal(saved.days,159);
  assert.equal(saved.exported.nickname,saved.item.nickname);assert.deepEqual(saved.exported.openedDates,saved.item.openedDates);
  await page.evaluate(()=>localStorage.removeItem(PANTRY_ITEMS_KEY));await page.reload();await page.waitForFunction(()=>cloudReady);
  assert.deepEqual(await page.evaluate(()=>({name:items[0].nickname,dates:items[0].openedDates,count:inventoryCounts(items[0]).total})),{name:'旅行防晒测试备注',dates:[dates[0],dates[2]],count:3});
  await page.evaluate(()=>switchTab(1));
  assert.match(await page.locator('#gallery-body .inventory-group-head').textContent(),/共 3 件.*已开封 2 · 未开封 1/);
  await page.locator('[data-state="stock"]').click();await screen(page,'scr-detail');
  assert.equal(await page.locator('#d-v').textContent(),'未开封');assert.equal(await page.locator('#d-expiry-date').textContent(),'2030-01-01');
  assert.equal(modelCalls,0);assert.ok(responses.every(s=>s===200),JSON.stringify(responses));assert.deepEqual(errors,[]);
  console.log('PASS: real isolated family nickname + backdated intake/opening/edit → cloud GET → export → remove local cache → reload → grouped UI and unopened expiry; HTTP 200; model calls=0');
 }finally{
  try{
   if(page&&ownedFamily){
    const empty=await page.evaluate(async id=>{
     clearTimeout(cloudSyncTimer);cloudReady=false;if(pantryFamilyId!==id)throw new Error('Refuse cleanup of a different family');
     const headers={'X-Client-Id':getOrCreateClientId(),'Content-Type':'application/json'};
     const current=await fetch(`/api/families/${id}`,{headers});if(!current.ok)throw new Error('Cleanup GET failed');
     const state=await current.json();
     const put=await fetch(`/api/families/${id}`,{method:'PUT',headers,body:JSON.stringify({baseVersion:state.version,data:{items:[],locations:[]}})});if(!put.ok)throw new Error('Cleanup PUT '+put.status);
     const check=await fetch(`/api/families/${id}`,{headers});if(!check.ok)throw new Error('Cleanup verify failed');return (await check.json()).data.items.length===0;
    },ownedFamily);
    assert.equal(empty,true);console.log('Cleanup verified: isolated family inventory empty.');
   }
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
