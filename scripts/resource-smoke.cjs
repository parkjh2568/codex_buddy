const fs = require('node:fs');
const path = require('node:path');
const {powerMonitor}=require('electron');
module.exports = async ({app,pet,panel,store,output,projectVersion=require('../package.json').version}) => {
  const phaseMs = Number(process.env.ONGGI_RESOURCE_PHASE_MS ?? 600000), phases = [];
  if (!Number.isFinite(phaseMs) || phaseMs < 1000 || phaseMs > 3600000) { console.error('Invalid resource phase duration');app.exit(1);return; }
  const file=output??path.join(process.env.ONGGI_SMOKE_ROOT?path.resolve(process.env.ONGGI_SMOKE_ROOT):path.join(__dirname,'../artifacts'),'resource-smoke.json'),startedAt=new Date().toISOString();
  const powerEvents=[],powerListeners=[];
  for(const name of ['lock-screen','unlock-screen','suspend','resume','on-battery','on-ac']){const listener=()=>powerEvents.push({name,at:Date.now()});powerMonitor.on(name,listener);powerListeners.push([name,listener]);}
  try {
    fs.mkdirSync(path.dirname(file),{recursive:true});
    panel.hide();pet.setPosition(100,100);pet.setAlwaysOnTop(false);
    if(process.env.ONGGI_RESOURCE_CHARACTER)await pet.webContents.executeJavaScript(`(async()=>{await window.onggi.action('select-character',{id:${JSON.stringify(process.env.ONGGI_RESOURCE_CHARACTER)}});await window.onggi.action('settings',{appearanceProfile:'lively'});})()`);
    for (const name of ['visible-motion','visible-reduced-motion',...(process.env.ONGGI_RESOURCE_BUDDY_PROFILES==='1'?['visible-quiet','visible-daily']:[]),'hidden']) {
      const appearanceProfile=name==='visible-quiet'?'quiet':name==='visible-daily'?'daily':'lively';
      await pet.webContents.executeJavaScript(`window.onggi.action('settings',{appearanceProfile:${JSON.stringify(appearanceProfile)},reducedMotion:${name==='visible-reduced-motion'||name==='hidden'}})`);
      if(name==='hidden')pet.hide();else pet.showInactive();
      app.getAppMetrics();const samples=[],start=Date.now();
      while(Date.now()-start<phaseMs) {
        await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(100,phaseMs/10))));
        const renderer=await pet.webContents.executeJavaScript(`({hidden:document.hidden,reduced:document.body.classList.contains('reduced-motion'),osReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animating:document.querySelector('#pet-image').dataset.animating,changes:Number(document.querySelector('#pet-image').dataset.frameChanges??0)})`);
        samples.push({at:Date.now(),petVisible:pet.isVisible(),panelVisible:panel.isVisible(),renderer,power:{onBattery:powerMonitor.isOnBatteryPower(),idleState:powerMonitor.getSystemIdleState(60)},processes:app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,cpu:p.cpu,memory:p.memory}))});
      }
      const totals=samples.map(s=>s.processes.reduce((sum,p)=>sum+(p.cpu?.percentCPUUsage??0),0)).sort((a,b)=>a-b);
      phases.push({name,appearanceProfile,elapsedMs:Date.now()-start,samples,cpuMedian:totals[Math.floor(totals.length/2)],cpuP95:totals[Math.min(totals.length-1,Math.ceil(totals.length*.95)-1)]});
      fs.writeFileSync(file,JSON.stringify({startedAt,verifiedAt:new Date().toISOString(),status:'running',phaseMs,phases,powerEvents,realModel:false},null,2));
      console.log('RESOURCE_PHASE_COMPLETE',name,JSON.stringify({samples:samples.length,cpuMedian:phases.at(-1).cpuMedian,cpuP95:phases.at(-1).cpuP95}));
    }
    fs.writeFileSync(file,JSON.stringify({startedAt,verifiedAt:new Date().toISOString(),status:'passed',phaseMs,phases,powerEvents,realModel:false,messages:store.data.messages.length,environment:{platform:process.platform,arch:process.arch,versions:process.versions,projectVersion,character:store.data.settings?.characterId??process.env.ONGGI_RESOURCE_CHARACTER??null},note:'Own Electron process CPU samples; shared memory is not unique RAM. Power source, idle state and transition events are observed; battery discharge, CLI subprocess and OS-wide memory are not measured. No baseline speedup claim. Other desktop activity was not controlled.'},null,2));
    console.log('RESOURCE_IDLE_PHASES_COMPLETE');app.quit();
  } catch(error) {console.error(error);app.exit(1);}finally{for(const [name,listener]of powerListeners)powerMonitor.removeListener(name,listener);}
};
