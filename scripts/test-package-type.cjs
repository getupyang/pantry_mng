// Run: PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-package-type.cjs
// Serve the repository on port 8031 first. All API calls are mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('pantry.html', 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**', route=>route.abort());
    await page.route('**/api/**', route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
    await page.goto('http://127.0.0.1:8031/pantry.html');
    await page.evaluate(()=>localStorage.setItem('pantry_deduct_v4',String(Date.now())));
    await page.evaluate(()=>nav('scr-add'));
    await page.locator('#mf-name').fill('旅行洗发水');
    await page.locator('#mf-size').fill('30');
    await page.getByRole('button',{name:'确认录入 →',exact:true}).click();
    assert.equal(await page.evaluate(()=>items.length),0,'missing type blocks save');
    await page.locator('#mf-package-type').selectOption('travel');
    await page.getByRole('button',{name:'确认录入 →',exact:true}).click();
    assert.equal(await page.evaluate(()=>items[0].packageType),'travel');
    assert.equal(await page.locator('#mf-package-type').inputValue(),'');
    await page.evaluate(()=>{
      const base=items[0];
      items.push({...base,id:'regular',name:'正装精华',packageSize:30,packageType:'regular'});
      items.push({...base,id:'refill',name:'补充洗发水',packageType:'refill'});
      const legacy={...base,id:'legacy',name:'旧物品'};delete legacy.packageType;items.push(legacy);
      save();switchTab(1);
    });
    assert.equal(await page.locator('.gcard').count(),4);
    await page.getByRole('button',{name:'旅行装',exact:true}).click();
    assert.equal(await page.locator('.gcard').count(),1);
    await page.locator('.gcard').click();
    await page.evaluate(()=>nav('scr-home'));
    assert.equal(await page.locator('.gcard').count(),1);
    await page.reload();
    await page.evaluate(()=>switchTab(1));
    assert.equal(await page.locator('.gcard').count(),1,'reload preserves data and filter');
    assert.equal(await page.getByRole('button',{name:'旅行装',exact:true}).getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>{switchTab(0);switchTab(1);});
    assert.equal(await page.locator('.gcard').count(),1);
    await page.getByRole('button',{name:'全部',exact:true}).click();
    await page.evaluate(()=>openDetail('legacy'));
    await page.getByRole('button',{name:'未设置 · 修改'}).click();
    await page.locator('#edit-package-type').selectOption('travel');
    await page.locator('#sh-ok').click();
    assert.equal(await page.evaluate(()=>items.find(x=>x.id==='legacy').packageType),'travel');
    assert.equal(await page.evaluate(()=>buildExportPayload().items.find(x=>x.id==='legacy').packageType),'travel');
    await page.evaluate(()=>{nav('scr-home');setPackageFilter('travel');});
    assert.equal(await page.locator('.gcard').count(),2);
    await page.locator('#scr-detail').waitFor({state:'attached'});
    await page.waitForFunction(()=>!document.getElementById('scr-detail').classList.contains('active'));
    await page.screenshot({path:'/tmp/pantry-package-filter-mobile.png',animations:'disabled'});
    await page.evaluate(()=>{items=items.filter(x=>x.packageType!=='refill');setPackageFilter('refill');});
    assert.match(await page.locator('.package-empty').innerText(),/暂无标记为补充装/);
    await page.getByRole('button',{name:'查看全部'}).click();
    assert.equal(await page.locator('.gcard').count(),3);
    await page.evaluate(()=>{
      nav('scr-add');document.getElementById('manual-form').style.display='none';
      document.getElementById('recog-result').style.display='block';
      window._orderItems=[{name:'订单旅行装',packageSize:50},{name:'订单正装',packageSize:30}];
      window._currentOrderIndex=0;fillFormFields(window._orderItems[0]);
    });
    await page.locator('#fi-package-type').selectOption('travel');
    await page.getByRole('button',{name:'确认录入 →',exact:true}).click();
    assert.equal(await page.locator('#fi-package-type').inputValue(),'','next order item must not inherit type');
    await page.locator('#fi-package-type').selectOption('regular');
    await page.getByRole('button',{name:'确认录入 →',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>items.slice(-2).map(x=>x.packageType)),['travel','regular']);
    for(const width of [320,390,1280]){
      await page.setViewportSize({width,height:844});
      await page.evaluate(()=>{switchTab(1);setPackageFilter('all');});
      assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.package-filters button,.gcard')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),'visible cards and filters fit viewport');
    }
    assert.deepEqual(errors,[],'no browser runtime errors');
    console.log('PASS: syntax, required choice, manual save, filter, reload, legacy edit, export, empty state, order reset, 320/390/1280 layouts');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
