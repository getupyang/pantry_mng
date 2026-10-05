// Explicit live smoke: uploads the supplied image and persists one item in a new test family.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-photo-live.cjs /path/to/image
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
(async()=>{
  if(!process.argv[2])throw new Error('Image path required');
  const baseURL=process.env.PANTRY_BASE_URL||'http://127.0.0.1:8031';
  const proxy=baseURL.startsWith('https:')&&process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined;
  const browser=await chromium.launch({headless:true,proxy});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[],responses=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.url().includes('/api/'))responses.push({path:new URL(r.url()).pathname,status:r.status()});});
    await page.route('https://fonts.googleapis.com/**',r=>r.abort());
    await page.goto(baseURL+'/pantry.html?from=codex-live-test');
    await page.waitForFunction(()=>cloudReady,{},{timeout:60000});
    console.log('Cloud initialized in isolated browser');
    await page.evaluate(()=>nav('scr-add'));
    await page.locator('.add-method').first().click();
    const chooserPromise=page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'同意并继续'}).click();
    await (await chooserPromise).setFiles(process.argv[2]);
    await page.locator('#recog-result').waitFor({state:'visible',timeout:180000});
    const recognized=await page.evaluate(()=>({name:document.getElementById('fi-name').value,brand:document.getElementById('fi-brand').value,size:document.getElementById('fi-size').value,expiry:document.getElementById('fi-exp').value,packageType:document.getElementById('fi-package-type').value}));
    console.log('Recognized:',JSON.stringify(recognized));
    assert.equal(recognized.size,'12');
    assert.equal(recognized.packageType,'','type remains user-controlled');
    await page.locator('#fi-package-type').selectOption('travel');
    const savedPromise=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().includes('/api/families/')&&r.status()===200,{timeout:60000});
    await page.getByRole('button',{name:'确认录入 →',exact:true}).click();
    await savedPromise;
    const evidence=await page.evaluate(async()=>{
      const response=await fetch('/api/families/'+pantryFamilyId,{headers:{'X-Client-Id':getOrCreateClientId()}});
      const server=await response.json();
      return {status:response.status,server,clientId:getOrCreateClientId(),familyId:pantryFamilyId,local:JSON.parse(localStorage.getItem(PANTRY_ITEMS_KEY))};
    });
    assert.equal(evidence.status,200);
    const saved=evidence.server.data.items[0];
    assert.equal(saved.packageType,'travel');assert.equal(saved.packageSize,12);
    assert.equal(evidence.local[0].packageType,'travel');
    await page.evaluate(()=>switchTab(1));
    await page.getByRole('button',{name:'旅行装',exact:true}).click();
    assert.equal(await page.locator('.gcard').count(),1);
    await page.reload();await page.waitForFunction(()=>cloudReady);
    await page.evaluate(()=>switchTab(1));
    assert.equal(await page.locator('.gcard').count(),1);
    assert.equal(await page.getByRole('button',{name:'旅行装',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'正装',exact:true}).click();
    assert.equal(await page.locator('.gcard').count(),0);
    await page.getByRole('button',{name:'旅行装',exact:true}).click();
    await page.screenshot({path:'/tmp/pantry-live-travel.png',animations:'disabled'});
    assert.deepEqual(errors,[]);
    await fs.writeFile('/tmp/pantry-live-evidence.json',JSON.stringify({recognized,...evidence,responses,errors},null,2));
    console.log('PASS real upload, recognition, manual travel selection, PUT save, independent GET, local storage, reload and filters; evidence /tmp/pantry-live-evidence.json');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
