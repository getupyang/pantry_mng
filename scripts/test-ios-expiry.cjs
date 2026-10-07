const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');

const html=fs.readFileSync('pantry.html','utf8');

function between(start,end){
  const from=html.indexOf(start);
  const to=html.indexOf(end,from);
  assert.notEqual(from,-1,`missing start marker: ${start}`);
  assert.notEqual(to,-1,`missing end marker: ${end}`);
  return html.slice(from,to);
}

function fakeInput(){
  const attrs={type:'date'};
  const listeners={};
  return {
    value:'',
    getAttribute(name){return attrs[name]||null;},
    setAttribute(name,value){attrs[name]=value;},
    addEventListener(name,handler){listeners[name]=handler;},
    blur(){listeners.blur?.();},
  };
}

test('iOS numeric date entry keeps and formats YYYYMMDD on blur',()=>{
  const manual=fakeInput();
  const recognized=fakeInput();
  const inputs={'mf-exp':manual,'fi-exp':recognized};
  const context=vm.createContext({
    console:{warn(){},error(){}},
    navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'},
    document:{getElementById:id=>inputs[id]||null},
  });

  vm.runInContext(
    between('function normalizeExpiryDate(', 'function normalizeRecognitionUnit(')+
    between('function ensureExpiryInputsVisible(', '// iPhone 风格：从左侧边缘右滑返回上一页'),
    context,
  );

  context.ensureExpiryInputsVisible();
  assert.equal(manual.getAttribute('placeholder'),'YYYYMMDD（如 20281124）');
  manual.value='20281124';
  manual.blur();

  assert.equal(manual.value,'2028-11-24');
});
