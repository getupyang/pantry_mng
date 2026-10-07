const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync('pantry.html','utf8');

function between(start,end){
  const startIndex=html.indexOf(start);
  return html.slice(startIndex,html.indexOf(end,startIndex));
}

function visionContext(){
  const context=vm.createContext({
    TextEncoder,
    OPENROUTER_CONFIG:{models:['vision-primary','vision-fallback']}
  });
  vm.runInContext(between('// 图片预处理：压缩和格式转换','function getOpenRouterHeaders('),context);
  return context;
}

test('buildVisionRequest keeps two image URLs exactly once and in order',()=>{
  const body=visionContext().buildVisionRequest('inspect',['urlA','urlB'],700);
  assert.deepEqual(JSON.parse(JSON.stringify(body.messages[0].content)),[
    {type:'text',text:'inspect'},
    {type:'image_url',image_url:{url:'urlA'}},
    {type:'image_url',image_url:{url:'urlB'}}
  ]);
});

test('buildVisionRequest supports a one-image array',()=>{
  const body=visionContext().buildVisionRequest('inspect',['only-url'],700);
  assert.equal(body.messages[0].content.length,2);
  assert.equal(body.messages[0].content[1].image_url.url,'only-url');
});

test('buildVisionRequest rejects empty and non-array image input',()=>{
  const {buildVisionRequest}=visionContext();
  assert.throws(()=>buildVisionRequest('inspect',[],700),/image/i);
  assert.throws(()=>buildVisionRequest('inspect','not-an-array',700),/image/i);
});

test('request budget counts UTF-8 encoded bytes against 6.5 MiB',()=>{
  const context=visionContext();
  const budget=Math.floor(6.5*1024*1024);
  const under={payload:'食'.repeat(Math.floor((budget-32)/3))};
  assert.ok(new TextEncoder().encode(JSON.stringify(under)).byteLength<budget);
  assert.equal(context.isVisionRequestWithinBudget(under),true);

  const over={payload:'食'.repeat(Math.ceil(budget/3))};
  assert.ok(new TextEncoder().encode(JSON.stringify(over)).byteLength>budget);
  assert.equal(context.isVisionRequestWithinBudget(over),false);
});

test('image compression and request budget constants are stable',()=>{
  const context=visionContext();
  const values=vm.runInContext(`[
    IMAGE_MAX_WIDTH,
    IMAGE_MAX_HEIGHT,
    IMAGE_INITIAL_QUALITY,
    IMAGE_MIN_QUALITY,
    IMAGE_TARGET_BYTES,
    VISION_REQUEST_BUDGET_BYTES
  ]`,context);
  assert.deepEqual(Array.from(values),[
    1280,
    1280,
    0.7,
    0.4,
    300*1024,
    Math.floor(6.5*1024*1024)
  ]);
});
