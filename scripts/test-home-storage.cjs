const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const html=fs.readFileSync('pantry.html','utf8');
function part(a,b){const start=html.indexOf(a);assert.ok(start>=0);return html.slice(start,html.indexOf(b,start));}
const c=vm.createContext({detectItem:()=>null});
vm.runInContext(part('function normalizeExpiryDate(', '// 验证 API 配置'),c);
vm.runInContext(part('function escapeHTML(', '//  ALERT BANNER'),c);
const it=(x={})=>({name:'防晒',cat:'防晒',packageSize:50,unit:'ml',stockCount:2,openItems:[0,60,100],openedDates:['2026-01-01','2026-11-01',null],expiryDate:'2028-01-01',openedShelfLife:{value:1,unit:'month'},...x});
const plain=x=>JSON.parse(JSON.stringify(x));
test('counts sum pieces not records, exclude empties, include legacy supplements',()=>{
 assert.deepEqual(plain(c.inventoryCounts(it({supplement:{stockCount:3}}))),{opened:2,stock:5,empty:1,total:7});
 const groups=plain(c.groupInventory([it(),it({openItems:[],stockCount:1}),it({cat:'洁面',stockCount:0})]));
 assert.equal(groups[0].total,5);assert.equal(groups[0].opened,2);assert.equal(groups[0].stock,3);assert.equal(groups[0].empty,1);
 assert.equal(groups[1].cat,'洁面');
});
test('coarse cleaning categories subdivide same kind without using nicknames',()=>{
 const a=it({cat:'清洁',name:'品牌A洗衣液',nickname:'洗洁精'}),b=it({cat:'清洁',name:'品牌B洗衣液'}),d=it({cat:'清洁',name:'洗洁精'});
 assert.deepEqual(plain(c.groupInventory([a,b,d])).map(g=>[g.cat,g.items.length]),[['洗衣液',2],['洗洁精',1]]);
 assert.equal(c.inventoryGroupLabel({...a,cat:'其他'}),'其他','explicit category is retained');
});
test('state views keep dates paired and never make opened expiry apply to stock',()=>{
 const original=it(),snapshot=JSON.stringify(original);
 const open=c.inventoryView(original,'open'),stock=c.inventoryView(original,'stock');
 assert.deepEqual(plain(open.openedDates),['2026-11-01',null]);
 assert.equal(c.getExpInfo(open,null,'2026-11-17').date,'2026-12-01');
 assert.equal(c.getExpInfo(stock,null,'2026-11-17').date,'2028-01-01');
 assert.equal(c.inventoryCounts(stock).total,2);
 assert.deepEqual(plain(original.openItems),[0,60,100]);
 assert.deepEqual(plain(original.openedDates),['2026-01-01','2026-11-01',null]);
 assert.equal(c.getExpInfo(c.inventoryView(original,'empty')),null);
 const supplement=c.inventoryView(it({supplement:{stockCount:3,size:500,unit:'ml'}}),'supplement');
 assert.equal(supplement.packageSize,500);assert.equal(supplement.stockCount,3);assert.equal(supplement.openCount,0);
});
test('nickname fallback and HTML escaping preserve literal user text',()=>{
 assert.equal(c.displayName(it({nickname:'  我的通勤防晒  '})),'我的通勤防晒');
 assert.equal(c.displayName(it({nickname:'  '})),'防晒');
 assert.equal(c.escapeHTML('<img src=x onerror="boom"> & \'x\''),'&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; &#39;x&#39;');
});
test('opening dates reject impossible/future dates; empty allowed only when explicitly unknown',()=>{
 for(const date of ['2026-11-18','2026-02-29','2026-13-01','garbage',''])assert.equal(!!c.validOpeningDate(date,false,'2026-11-17'),false,date);
 for(const date of ['2026-11-17','2020-02-29','2000-01-01'])assert.equal(c.validOpeningDate(date,false,'2026-11-17'),true,date);
 assert.equal(c.validOpeningDate('',true,'2026-11-17'),true);
});
