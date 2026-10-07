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
    console:{warn(){},error(){}},
    TextEncoder,
    OPENROUTER_CONFIG:{models:['vision-primary','vision-fallback']}
  });
  vm.runInContext(between('// 图片预处理：压缩和格式转换','function getOpenRouterHeaders('),context);
  return context;
}

function recognitionContext(options={}){
  const fetchCalls=[];
  const preprocessEvents=[];
  const imageToBase64=options.imageToBase64||(async file=>{
    preprocessEvents.push(`start:${file.name}`);
    await new Promise(resolve=>setImmediate(resolve));
    preprocessEvents.push(`end:${file.name}`);
    return file.base64;
  });
  const context=vm.createContext({
    console:{warn(){},error(){}},
    TextEncoder,
    AbortController,
    setTimeout,
    clearTimeout,
    OPENROUTER_CONFIG:{
      models:['vision-primary','vision-fallback'],
      apiUrl:'https://example.test/vision',
      timeout:1000
    },
    verifyApiConfig(){},
    imageToBase64,
    getOpenRouterHeaders:()=>({'Content-Type':'application/json'}),
    fetch:async(...args)=>{
      fetchCalls.push(args);
      return {ok:true,json:async()=>({choices:[]})};
    },
    parseRecognitionResult:()=>({sameProduct:true,name:'test'}),
    updateRecognitionReview(){},
    _currentRecognitionReviewId:null,
    _currentRecognitionReviewType:null,
    _currentRecognitionParsedResult:null,
    _acceptedRecognitionItems:[]
  });
  vm.runInContext(between('// 图片预处理：压缩和格式转换','function getOpenRouterHeaders('),context);
  context.imageToBase64=imageToBase64;
  vm.runInContext(between('async function recognizePhoto(','// 订单截图识别（批量）'),context);
  return {context,fetchCalls,preprocessEvents};
}

const urlA='data:image/jpeg;base64,QQ==';
const urlB='data:image/jpeg;base64,Qg==';
const urlC='data:image/jpeg;base64,Qw==';
const urlD='data:image/jpeg;base64,RA==';

test('buildVisionRequest keeps two image URLs exactly once and in order',()=>{
  const body=visionContext().buildVisionRequest('inspect',[urlA,urlB],700);
  assert.deepEqual(JSON.parse(JSON.stringify(body.messages[0].content)),[
    {type:'text',text:'inspect'},
    {type:'image_url',image_url:{url:urlA}},
    {type:'image_url',image_url:{url:urlB}}
  ]);
});

test('buildVisionRequest supports a one-image array',()=>{
  const body=visionContext().buildVisionRequest('inspect',[urlA],700);
  assert.equal(body.messages[0].content.length,2);
  assert.equal(body.messages[0].content[1].image_url.url,urlA);
});

test('buildVisionRequest accepts only one to three non-empty image data URLs',()=>{
  const {buildVisionRequest}=visionContext();
  assert.throws(()=>buildVisionRequest('inspect',[],700),/image/i);
  assert.throws(()=>buildVisionRequest('inspect','not-an-array',700),/image/i);
  assert.throws(()=>buildVisionRequest('inspect',[urlA,urlB,urlC,urlD],700),/image/i);
  for(const invalid of ['',null,42,'https://example.test/image.jpg','data:image/jpeg;base64,']){
    assert.throws(()=>buildVisionRequest('inspect',[invalid],700),/image/i);
  }
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

test('postProcessRecognitionResult normalizes sameProduct safely and bounds conflictReason',()=>{
  const {postProcessRecognitionResult}=visionContext();
  assert.equal(postProcessRecognitionResult({sameProduct:true}).sameProduct,true);
  assert.equal(postProcessRecognitionResult({sameProduct:' TRUE '}).sameProduct,true);
  assert.equal(postProcessRecognitionResult({sameProduct:false}).sameProduct,false);
  const stringFalse=postProcessRecognitionResult({sameProduct:' false '});
  assert.equal(stringFalse.sameProduct,false);
  assert.equal(stringFalse.sameProduct===false,true,'string false must trigger a future strict false guard');
  assert.equal(postProcessRecognitionResult({}).sameProduct,true,'missing field keeps one-photo compatibility');
  assert.equal(postProcessRecognitionResult({sameProduct:'unknown'}).sameProduct,false);
  assert.equal(postProcessRecognitionResult({sameProduct:null}).sameProduct,false);

  const conflict=postProcessRecognitionResult({conflictReason:`  ${'x'.repeat(700)}  `});
  assert.equal(typeof conflict.conflictReason,'string');
  assert.equal(conflict.conflictReason.length,500);
  assert.equal(conflict.conflictReason,conflict.conflictReason.trim());
});

test('recognizePhoto preprocesses two photos sequentially and fetches one ordered request',async()=>{
  const {context,fetchCalls,preprocessEvents}=recognitionContext();
  await context.recognizePhoto([
    {name:'front',base64:'QQ=='},
    {name:'back',base64:'Qg=='}
  ]);
  assert.deepEqual(preprocessEvents,['start:front','end:front','start:back','end:back']);
  assert.equal(fetchCalls.length,1);
  const body=JSON.parse(fetchCalls[0][1].body);
  const urls=body.messages[0].content.filter(item=>item.type==='image_url').map(item=>item.image_url.url);
  assert.deepEqual(urls,[urlA,urlB]);
  assert.equal(fetchCalls[0][1].body.split(urlA).length-1,1);
  assert.equal(fetchCalls[0][1].body.split(urlB).length-1,1);
});

test('recognizePhoto rejects zero or four photos before fetch',async()=>{
  const zero=recognitionContext();
  await assert.rejects(zero.context.recognizePhoto([]),/1.*3/);
  assert.equal(zero.fetchCalls.length,0);

  const four=recognitionContext();
  await assert.rejects(four.context.recognizePhoto([
    {name:'a'},{name:'b'},{name:'c'},{name:'d'}
  ]),/1.*3/);
  assert.equal(four.fetchCalls.length,0);
});

test('recognizePhoto rejects an over-budget encoded request without fetching',async()=>{
  const harness=recognitionContext({imageToBase64:async()=>`A`.repeat(Math.floor(6.5*1024*1024))});
  await assert.rejects(harness.context.recognizePhoto([{name:'large'}]),/过大|限制/);
  assert.equal(harness.fetchCalls.length,0);
});

test('recognizePhoto keeps one-photo request compatibility',async()=>{
  const {context,fetchCalls}=recognitionContext();
  await context.recognizePhoto([{name:'front',base64:'QQ=='}]);
  assert.equal(fetchCalls.length,1);
  const body=JSON.parse(fetchCalls[0][1].body);
  const images=body.messages[0].content.filter(item=>item.type==='image_url');
  assert.deepEqual(images.map(item=>item.image_url.url),[urlA]);
});
