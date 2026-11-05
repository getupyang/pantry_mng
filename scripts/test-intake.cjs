const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const html=fs.readFileSync('pantry.html','utf8');
function between(start,end){return html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));}
function parser(){const c=vm.createContext({console:{warn(){},error(){}}});vm.runInContext(between('function normalizeExpiryDate(', '// 验证 API 配置'),c);return c;}
test('EXP wins over MFG in either order',()=>{
 for(const evidence of ['MFG. 11/2025 EXP. 10/2028','EXP. 10/2028 MFG. 11/2025','生产日期 2025年11月 有效期至 2028年10月']){
  const r=parser().postProcessRecognitionResult({expiryDate:'2028-10-01',expiryEvidence:evidence});
  assert.equal(r.expiryDate,'2028-10-01');
 }
});
test('production-only evidence cannot override model-calculated expiry',()=>{
 assert.equal(parser().postProcessRecognitionResult({expiryDate:'2028-11-01',expiryEvidence:'MFG 11/2025; shelf life 36 months'}).expiryDate,'2028-11-01');
});
test('unlabelled ambiguous evidence cannot override structured expiry',()=>{
 assert.equal(parser().postProcessRecognitionResult({expiryDate:'2028-10-01',expiryEvidence:'11/2025 10/2028'}).expiryDate,'2028-10-01');
});
test('standalone date and invalid calendar dates',()=>{
 const c=parser();assert.equal(c.normalizeExpiryDate('EXP 10/2028'),'2028-10-01');assert.equal(c.normalizeExpiryDate('2028-02-30'),null);
});
test('error feedback is outside hidden screens',()=>{
 const banner=html.indexOf('id="app-message"');
 assert.ok(banner>html.indexOf('<!-- deduct toast -->'),'global live message must exist after screens');
});
test('home photo shortcut keeps synchronous user gesture',()=>{
 assert.ok(!between('function nav(', '// INIT').includes('setTimeout(()=>doScan'));
});
test('failed cloud init can be retried and first local upload occurs after ready',async()=>{
 const c=vm.createContext({console:{error(){}},document:{getElementById:()=>null},setTimeout,clearTimeout,
  cloudReady:false,cloudInitPromise:null,cloudState:'connecting',pantryFamilyId:null,activeTab:0,items:[{id:'local'}],
  getCurrentPayload:()=>({items:[{id:'local'}],locations:[]}),setFamilyMeta:(id)=>{c.pantryFamilyId=id;},
  applyCloudData(){},renderDashboard(){},renderGallery(){},updateAlert(){},trackEvent(){},loadLocations:()=>[],
  ensureFamily:async()=>{throw new Error('offline');},pushCloudNow:async()=>{assert.equal(c.cloudReady,true);c.pushed=true;}});
 vm.runInContext(between('function renderCloudStatus(', 'async function pushCloudNow('),c);
 assert.equal(typeof c.connectCloud,'function');
 await c.connectCloud();assert.equal(c.cloudReady,false);assert.equal(c.cloudState,'error');
 c.ensureFamily=async()=>({familyId:'test',version:1,data:{items:[],locations:[]}});
 await c.connectCloud();assert.equal(c.cloudReady,true);assert.equal(c.pushed,true);
});
