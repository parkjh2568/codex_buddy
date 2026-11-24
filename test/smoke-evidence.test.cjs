const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('native pointer evidence requires a click within the recorded transparent pet window',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/pet-pointer-smoke.cjs'),'utf8'),predicate=source.match(/if\((click\?\.ignoring[^\n]+)\)\{/)[1];
  for(const [x,y,ignoring,expected]of [[1,50,true,true],[17,142,true,true],[1,-1,true,false],[1,143,true,false],[-1,50,true,false],[18,50,true,false],[1,50,false,false]]){
    assert.equal(vm.runInNewContext(predicate,{click:{relative:{x,y},bounds:{width:120,height:143},ignoring}}),expected,JSON.stringify({x,y,ignoring}));
  }
  assert.equal(vm.runInNewContext(predicate,{click:undefined}),undefined);
});

test('synthetic floating and lifecycle checks do not claim physical native verification',()=>{
  for(const name of ['floating-ui-smoke.cjs','buddy-lifecycle-smoke.cjs']){
    const source=fs.readFileSync(path.join(__dirname,'../scripts',name),'utf8');
    assert.match(source,/windowsNativeVerified:false/);assert.doesNotMatch(source,/windowsNativeVerified:process\.platform/);
    if(name==='floating-ui-smoke.cjs')assert.match(source,/nativePointerVerified:false/);else assert.match(source,/physicalLockSuspendBatteryVerified:false/);
  }
});
