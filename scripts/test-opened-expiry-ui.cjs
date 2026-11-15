// Mocked APIs even against production: never writes to a real user's family.
// PLAYWRIGHT_MODULE=/path/to/playwright PANTRY_TEST_BASE_URL=http://127.0.0.1:8039/pantry.html node scripts/test-opened-expiry-ui.cjs
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
for(const match of fs.readFileSync('pantry.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const baseURL=process.env.PANTRY_TEST_BASE_URL||'http://127.0.0.1:8039/pantry.html';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
async function screen(page,id){await page.waitForFunction(id=>document.getElementById(id)?.classList.contains('active')&&[...document.querySelectorAll('.screen')].every(s=>s.id===id||!s.classList.contains('active')),id);}
async function noOverflow(page,selector){
  const errors=await page.locator(selector).evaluateAll(els=>els.filter(el=>el.getClientRects().length&&el.scrollWidth>el.clientWidth+2).map(el=>({class:el.className,width:el.clientWidth,scroll:el.scrollWidth})));
  assert.deepEqual(errors,[],`overflow: ${selector}`);
}
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PANTRY_CHROMIUM_PATH?{executablePath:process.env.PANTRY_CHROMIUM_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
    await page.clock.setFixedTime(new Date('2026-11-15T00:30:00+09:00'));
    await page.addInitScript(()=>localStorage.setItem('pantry_deduct_v4',String(Date.now())));
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let serverData={items:[],locations:[]},version=1,recognitionCalls=0;
    const prompts=[];
    await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:204,body:''}));
    await page.route('https://fonts.gstatic.com/**',r=>r.fulfill({status:204,body:''}));
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      let result={ok:true};
      if(path==='/api/families/ensure')result={familyId:'opened-expiry-test',version,data:serverData};
      else if(path==='/api/families/opened-expiry-test'){
        if(req.method()==='PUT'){serverData=req.postDataJSON().data;version++;}
        result={familyId:'opened-expiry-test',version,data:serverData};
      }else if(path==='/api/openrouter'){
        recognitionCalls++;
        prompts.push(req.postDataJSON().messages[0].content[0].text);
        const recognized={sameProduct:true,name:'识别测试面霜',packageSize:50,unit:'g',qty:1,expiryDate:null,openedShelfLife:{value:6,unit:'month'},openedShelfLifeEvidence:'开封后6个月内用完'};
        const data=req.headers()['x-recognition-type']==='order'?[recognized,{name:'订单第二件',packageSize:100,unit:'ml',qty:1,openedShelfLife:null}]:recognized;
        result={choices:[{message:{content:JSON.stringify(data)}}]};
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto(baseURL);await page.waitForFunction(()=>cloudReady);
    await page.evaluate(()=>nav('scr-add'));await screen(page,'scr-add');
    assert.equal(await page.locator('#mf-open-life').count(),1,'optional opening shelf-life input exists');
    assert.equal(await page.locator('#mf-open-life').inputValue(),'');
    assert.equal(await page.locator('#mf-open-life-unit').inputValue(),'month');
    await page.locator('#mf-name').fill('防晒测试');
    await page.locator('#mf-size').fill('100');
    await page.locator('#mf-qty').fill('3');
    await page.locator('#mf-package-type').selectOption('regular');
    await page.locator('#mf-exp').fill('2028-01-01');
    await page.locator('#mf-open-life').fill('1');
    await noOverflow(page,'.shelf-life-row, .expiry-fields');
    await page.locator('#manual-form').screenshot({path:'/tmp/pantry-opened-expiry-form.png'});
    await page.locator('#confirm-btn').click();await screen(page,'scr-home');
    const id=await page.evaluate(()=>items[0].id);
    assert.deepEqual(await page.evaluate(()=>items[0].openedShelfLife),{value:1,unit:'month'});
    assert.equal(await page.evaluate(()=>getExpInfo(items[0]).date),'2028-01-01');
    await page.evaluate(id=>openDetail(id),id);await screen(page,'scr-detail');
    await page.getByRole('button',{name:'开封使用',exact:true}).click();
    await page.locator('.s-btn.ok').click();
    assert.equal(await page.evaluate(()=>items[0].openedDates[0]),'2026-11-15','opening stores local date, not UTC previous day');
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2026-12-15');
    assert.match(await page.locator('#d-expiry-countdown').textContent(),/30 天/);
    assert.match(await page.locator('#d-expiry-source').textContent(),/开封期限/);
    assert.equal(recognitionCalls,0,'opening is deterministic and makes no model request');
    // Revert a mistaken opening: the countdown disappears, package expiry stays.
    await page.getByRole('button',{name:'放回库存',exact:true}).click();await page.locator('.s-btn.ok').click();
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2028-01-01');
    await page.getByRole('button',{name:'开封使用',exact:true}).click();await page.locator('.s-btn.ok').click();
    await page.locator('.d-edit-btn').click();await screen(page,'scr-add');
    assert.equal(await page.locator('#mf-open-life').inputValue(),'1');
    await page.locator('#mf-open-life-unit').selectOption('day');
    await page.locator('#mf-open-life').fill('0');
    await page.locator('#confirm-btn').click();
    assert.equal(await page.evaluate(()=>_curScr),'scr-add','invalid duration blocks save');
    await page.locator('#mf-open-life').fill('7');
    await page.locator('#confirm-btn').click();await screen(page,'scr-detail');
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2026-11-22');
    assert.equal(await page.evaluate(()=>items[0].stockCount),2);
    await page.evaluate(async()=>{clearTimeout(cloudSyncTimer);await pushCloudNow();});
    assert.deepEqual(serverData.items[0].openedShelfLife,{value:7,unit:'day'},'cloud JSON contains duration and unit');
    // Restore from the simulated cloud, with local item storage deliberately absent.
    await page.evaluate(()=>localStorage.removeItem(PANTRY_ITEMS_KEY));
    await page.reload();await page.waitForFunction(()=>cloudReady);
    await page.evaluate(id=>openDetail(id),id);await screen(page,'scr-detail');
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2026-11-22');
    await page.locator('.d-edit-btn').click();await screen(page,'scr-add');
    await page.locator('#mf-open-life').fill('');await page.locator('#confirm-btn').click();await screen(page,'scr-detail');
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2028-01-01','clearing duration restores package expiry');
    await page.locator('.d-edit-btn').click();await screen(page,'scr-add');
    await page.locator('#mf-open-life').fill('1');await page.locator('#mf-open-life-unit').selectOption('year');
    await page.locator('#confirm-btn').click();await screen(page,'scr-detail');
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2027-11-15');
    // Actual intake recognition request + parser + editable confirmation, using a mock model.
    await page.evaluate(()=>nav('scr-add'));await screen(page,'scr-add');
    assert.equal(await page.locator('#mf-open-life').inputValue(),'');
    assert.equal(await page.locator('#mf-open-life-unit').inputValue(),'month');
    await page.evaluate(async b64=>{
      const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'test.png',{type:'image/png'});
      fillRecognitionResult(await recognizePhoto([file]));
    },png.toString('base64'));
    assert.equal(await page.locator('#fi-open-life').inputValue(),'6');
    assert.equal(await page.locator('#fi-open-life-unit').inputValue(),'month');
    assert.match(prompts[0],/openedShelfLifeEvidence/);
    await page.locator('#fi-open-life').fill('30');await page.locator('#fi-open-life-unit').selectOption('day');
    await page.locator('.intake-option:has(input[name="fi-open-state"][value="open"])').click();
    await page.locator('#fi-package-type').selectOption('regular');await page.locator('#confirm-btn').click();await screen(page,'scr-home');
    assert.deepEqual(await page.evaluate(()=>items.at(-1).openedShelfLife),{value:30,unit:'day'});
    assert.equal(await page.evaluate(()=>getExpInfo(items.at(-1)).date),'2026-12-15');
    assert.equal(await page.evaluate(()=>items.at(-1).openedDates[0]),'2026-11-15');
    // Batch order: neither duration nor open-state leaks from previous item.
    await page.evaluate(()=>nav('scr-add'));await screen(page,'scr-add');
    await page.evaluate(async b64=>{
      const file=new File([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],'order.png',{type:'image/png'});
      window._orderItems=await recognizeOrder(file);window._currentOrderIndex=0;
      fillOrderRecognitionResult(window._orderItems[0],2);
    },png.toString('base64'));
    assert.match(prompts[1],/openedShelfLifeEvidence/);
    await page.locator('.intake-option:has(input[name="fi-open-state"][value="open"])').click();
    await page.locator('#fi-package-type').selectOption('regular');await page.locator('#confirm-btn').click();
    assert.equal(await page.locator('#fi-open-life').inputValue(),'');
    assert.equal(await page.locator('#fi-open-life-unit').inputValue(),'month');
    assert.equal(await page.locator('input[name="fi-open-state"][value="stock"]').isChecked(),true);
    await page.locator('#fi-package-type').selectOption('regular');await page.locator('#confirm-btn').click();await screen(page,'scr-home');
    assert.equal(await page.evaluate(()=>items.at(-1).openedShelfLife),null);
    assert.equal(await page.evaluate(()=>items.at(-1).openCount),0);
    // Multi-piece selection and null date survive normalization, display, saving.
    await page.evaluate(id=>{
      const it=items.find(i=>i.id===id);it.openedShelfLife={value:1,unit:'month'};
      it.openItems=[100,70,0];it.openCount=3;it.openedDates=[null,'2026-11-01','2026-01-01'];it.openedDate='2026-11-01';
      ensureOpenState(it);save();openDetail(id);
    },id);await screen(page,'scr-detail');
    assert.match(await page.locator('#d-expiry-note').textContent(),/开封日期/);
    assert.equal(await page.evaluate(()=>items[0].openedDates[0]),null);
    await page.locator('.ob-chip').nth(1).click();
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2026-12-01');
    await noOverflow(page,'#d-expiry-section, #d-expiry-section .d-row');
    await page.locator('#d-expiry-section').screenshot({path:'/tmp/pantry-opened-expiry-detail.png'});
    await page.locator('.d-illus').scrollIntoViewIfNeeded();
    const bottle=await page.locator('.d-illus').boundingBox();
    await page.mouse.move(bottle.x+bottle.width/2,bottle.y+30);await page.mouse.down();
    await page.mouse.move(bottle.x+bottle.width/2,bottle.y+125,{steps:5});
    await page.waitForFunction(()=>items[0].openItems[1]===0);await page.mouse.up();
    assert.equal(await page.locator('#d-expiry-countdown').textContent(),'已用完，不参与到期提醒','dragging to zero immediately clears current expiry warning');
    await page.mouse.move(bottle.x+bottle.width/2,bottle.y+125);await page.mouse.down();
    await page.mouse.move(bottle.x+bottle.width/2,bottle.y+30,{steps:5});
    await page.waitForFunction(()=>items[0].openItems[1]>0);await page.mouse.up();
    assert.equal(await page.locator('#d-expiry-date').textContent(),'2026-12-01');
    await page.locator('.ob-chip').nth(2).click();
    assert.equal(await page.locator('#d-expiry-countdown').textContent(),'已用完，不参与到期提醒');
    await page.evaluate(()=>{nav('scr-home');switchTab(1);});await screen(page,'scr-home');
    assert.match(await page.locator('.gcard').first().textContent(),/防晒测试/);
    assert.match(await page.locator('.gcard').first().textContent(),/16 天/);
    assert.equal(await page.evaluate(()=>getStatus(items[0]).exp),'urgent');
    await page.evaluate(()=>switchTab(0));
    assert.match(await page.locator('#dash-body').textContent(),/2026-12-01/);
    assert.equal(recognitionCalls,2,'only two explicit intake recognition calls');
    // New form controls remain contained on narrow screens and larger font settings.
    await page.setViewportSize({width:320,height:844});
    await page.evaluate(()=>{applyFontSize('large');nav('scr-add');});await screen(page,'scr-add');
    await noOverflow(page,'.shelf-life-row, .expiry-fields');
    await page.locator('.expiry-fields').last().screenshot({path:'/tmp/pantry-opened-expiry-narrow.png'});
    assert.deepEqual(errors,[],'no browser runtime errors');
    console.log('PASS: optional month/day/year; opening/local date; revert/edit/clear; cloud roundtrip; photo/order intake; no later AI; per-piece dates; empty exclusion; warnings/sort; mobile layout');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
