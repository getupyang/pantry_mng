const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const html = fs.readFileSync('pantry.html', 'utf8');
function between(start, end) {
  const at = html.indexOf(start);
  assert.notEqual(at, -1, start);
  return html.slice(at, html.indexOf(end, at));
}
function context() {
  const c = vm.createContext({console: {warn(){}, error(){}}});
  vm.runInContext(between('function normalizeExpiryDate(', '// 验证 API 配置'), c);
  vm.runInContext(between('function ensureOpenState(', '//  ALERT BANNER'), c);
  vm.runInContext(between('function compareByExpiry(', 'function renderGallery('), c);
  return c;
}
const item = (overrides = {}) => ({
  packageSize: 100, stockCount: 0, openCount: 1, openItems: [100],
  openedDates: ['2026-11-15'], expiryDate: '2028-01-01',
  openedShelfLife: {value: 1, unit: 'month'}, ...overrides,
});
test('opening starts a 30-day countdown, earlier than package expiry', () => {
  const c = context();
  const result = c.getExpInfo(item(), null, '2026-11-15');
  assert.equal(result.days, 30);
  assert.equal(result.date, '2026-12-15');
  assert.equal(result.source, 'opened');
});
test('month means exactly 30 days, year exactly 365, not calendar periods', () => {
  const c = context();
  for (const [opened, value, unit, expected] of [
    ['2026-01-31', 1, 'month', '2026-03-02'],
    ['2028-02-01', 1, 'year', '2029-01-31'],
    ['2026-12-31', 2, 'day', '2027-01-02'],
    ['2026-11-15', 6, 'month', '2027-05-14'],
  ]) {
    assert.equal(c.getExpInfo(item({expiryDate:null, openedDates:[opened], openedShelfLife:{value,unit}})).date, expected);
  }
});
test('package expiry caps opening expiry; unopened stock never starts countdown', () => {
  const c = context();
  assert.equal(c.getExpInfo(item({expiryDate:'2026-11-20'})).source, 'package');
  const unopened=item({openItems:[], openCount:0, stockCount:2, openedDates:[]});
  assert.equal(c.getExpInfo(unopened).date,'2028-01-01');
  assert.equal(c.getExpInfo({...unopened,expiryDate:null}),null);
});
test('optional duration and old records retain package date', () => {
  const c=context();
  for(const openedShelfLife of [null,undefined]) {
    assert.equal(c.getExpInfo(item({openedShelfLife})).date,'2028-01-01');
  }
  assert.equal(c.getExpInfo(item({expiryDate:null,openedShelfLife:null})),null);
});
test('each open item gets its own expiry; aggregate ignores empty pieces', () => {
  const c=context();
  const it=item({openCount:3,openItems:[0,60,100],openedDates:['2026-01-01','2026-11-15','2026-11-25'],stockCount:1});
  assert.equal(c.getExpInfo(it).date,'2026-12-15');
  assert.equal(c.getExpInfo(it,2).date,'2026-12-25');
  assert.equal(c.getExpInfo(it,0),null);
  it.openItems=[0,0,0];
  assert.equal(c.getExpInfo(it).date,'2028-01-01');
  it.stockCount=0;
  assert.equal(c.getExpInfo(it),null);
});
test('missing per-piece date does not inherit another piece or today', () => {
  const c=context();
  const it=item({openCount:2,openItems:[100,100],openedDates:['2026-11-15',null],openedDate:'2026-11-15'});
  c.ensureOpenState(it);
  assert.equal(it.openedDates[1],null);
  assert.equal(c.getExpInfo(it,1).source,'package');
  assert.equal(c.getExpirySummary(it,1).missingOpenedDate,true);
  assert.equal(c.getExpInfo({...it,expiryDate:null},1),null);
});
test('legacy scalar opening date still works when per-piece dates never existed', () => {
  const c=context();
  const it=item({openedDates:undefined,openedDate:'2026-11-15'});
  assert.equal(c.getExpInfo(it).date,'2026-12-15');
});
test('sorting and warning thresholds use the same effective date', () => {
  const c=context();
  const a=item({expiryDate:'2028-01-01'});
  const b=item({openedShelfLife:null,expiryDate:'2026-12-25'});
  assert.ok(c.compareByExpiry(a,b)<0);
  assert.ok(c.compareByExpiry(a,item({expiryDate:null,openedShelfLife:null}))<0);
  assert.equal(c.getExpInfo(a,null,'2026-12-15').days,0);
  assert.equal(c.getExpInfo(a,null,'2026-12-16').days,-1);
  assert.equal(c.getExpInfo(a,null,'2026-11-16').cls,'urgent');
  assert.equal(c.getExpInfo(a,null,'2026-11-15').cls,'soon');
});
test('invalid durations and impossible dates never become a countdown', () => {
  const c=context();
  for(const value of [0,-1,1.5,'abc',Infinity,true,{},1e100]) {
    assert.equal(c.normalizeOpenedShelfLife({value,unit:'month'}),null);
  }
  for(const unit of ['week','__proto__','constructor','toString'])assert.equal(c.normalizeOpenedShelfLife({value:2,unit}),null);
  assert.equal(c.getExpInfo(item({expiryDate:'2026-02-30',openedDates:['bad']})),null);
  assert.equal(c.getExpInfo(item({expiryDate:null,openedDates:['2026-02-30']})),null);
});
test('today is local date, while date-only addition survives DST transitions', () => {
  const c=context();
  vm.runInContext(`const RealDate=Date; Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2026-11-15T00:30:00+09:00']));}}`,c);
  // This suite is also run in TZ=Asia/Tokyo and TZ=America/New_York.
  const instant=new Date('2026-11-15T00:30:00+09:00');
  const expected=[instant.getFullYear(),String(instant.getMonth()+1).padStart(2,'0'),String(instant.getDate()).padStart(2,'0')].join('-');
  assert.equal(c.today(),expected);
  assert.equal(c.getExpInfo(item({expiryDate:null,openedDates:['2026-03-07'],openedShelfLife:{value:2,unit:'day'}}),null,'2026-03-07').days,2);
});
test('recognition accepts explicit PAO evidence but never guesses without evidence', () => {
  const c=context();
  for(const [value,unit,evidence] of [[6,'month','开封后6个月内用完'],[6,'month','开封后，请在6个月内用完'],[6,'month','Once opened, use within 6 months'],[6,'month','After opening, use within 6 months.'],[30,'day','Use within 30 days after opening'],[1,'year','开封后一年内使用'],[12,'month','开盖罐标志 12M']]) {
    const parsed=c.postProcessRecognitionResult({openedShelfLife:{value,unit},openedShelfLifeEvidence:evidence});
    assert.equal(parsed.openedShelfLife.value,value);
    assert.equal(parsed.openedShelfLife.unit,unit);
  }
  for(const evidence of ['', '保质期36个月','生产日期2026-11-15','未开封保质期36个月','开封后请冷藏','Use within 30 days after opening','PAO 12M']) {
    assert.equal(c.postProcessRecognitionResult({openedShelfLife:{value:6,unit:'month'},openedShelfLifeEvidence:evidence}).openedShelfLife,null);
  }
  assert.equal(c.postProcessRecognitionResult({openedShelfLife:{value:0,unit:'month'},openedShelfLifeEvidence:'PAO 0M'}).openedShelfLife,null);
  const mixed=c.postProcessRecognitionResult({openedShelfLife:{value:6,unit:'month'},openedShelfLifeEvidence:'未开封保质期36个月，开封后6个月内用完'});
  assert.equal(mixed.openedShelfLife.value,6);
});
test('fast drag release flushes pending frame before saving and refreshing expiry',()=>{
  const c=context(),elementHandlers={},documentHandlers={},frames=new Map();
  const it=item({id:'drag'});c.items=[it];c.DRAG_THRESHOLD=6;c.selectedOpenIndex={drag:0};
  let savedPct,renderedPct;
  c.document={addEventListener:(type,handler)=>documentHandlers[type]=handler,getElementById:()=>null};
  c.requestAnimationFrame=fn=>{frames.set(1,fn);return 1;};
  c.cancelAnimationFrame=id=>frames.delete(id);
  c.updateSVGLevel=()=>{};c.updateAlert=()=>{};
  c.save=()=>savedPct=it.openItems[0];c.refreshDetailPage=()=>renderedPct=it.openItems[0];
  vm.runInContext(between('function setupDrag(', 'function refreshGCard('),c);
  c.setupDrag({addEventListener:(type,handler)=>elementHandlers[type]=handler},'drag',true,0);
  elementHandlers.mousedown({clientX:0,clientY:0,type:'mousedown',preventDefault(){}});
  documentHandlers.mousemove({clientX:0,clientY:100});
  documentHandlers.mouseup({});
  for(const callback of frames.values())callback();
  assert.equal(it.openItems[0],0);
  assert.equal(savedPct,0,'persist final drag value before RAF');
  assert.equal(renderedPct,0,'expiry display must use final drag value');
});
