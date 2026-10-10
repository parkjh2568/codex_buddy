const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({app,pet,panel,store,output}) => {
  const phaseMs = Number(process.env.ONGGI_RESOURCE_PHASE_MS ?? 600000), phases = [];
  if (!Number.isFinite(phaseMs) || phaseMs < 1000 || phaseMs > 3600000) { console.error('Invalid resource phase duration');app.exit(1);return; }
  const file = output??path.join(__dirname,'../artifacts/resource-smoke.json'), startedAt = new Date().toISOString();
  try {
    panel.hide();pet.setPosition(100,100);pet.setAlwaysOnTop(false);
    if(process.env.ONGGI_RESOURCE_CHARACTER)await pet.webContents.executeJavaScript(`(async()=>{await window.onggi.action('select-character',{id:${JSON.stringify(process.env.ONGGI_RESOURCE_CHARACTER)}});await window.onggi.action('settings',{appearanceProfile:'lively'});})()`);
    for (const name of ['visible-motion','visible-reduced-motion','hidden']) {
      await pet.webContents.executeJavaScript(`window.onggi.action('settings',{reducedMotion:${name!=='visible-motion'}})`);
      if(name==='hidden')pet.hide();else pet.showInactive();
      app.getAppMetrics();const samples=[],start=Date.now();
      while(Date.now()-start<phaseMs) {
        await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(100,phaseMs/10))));
        const renderer=await pet.webContents.executeJavaScript(`({hidden:document.hidden,reduced:document.body.classList.contains('reduced-motion'),osReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,animating:document.querySelector('#pet-image').dataset.animating,changes:Number(document.querySelector('#pet-image').dataset.frameChanges??0)})`);
        samples.push({at:Date.now(),petVisible:pet.isVisible(),panelVisible:panel.isVisible(),renderer,processes:app.getAppMetrics().map(p=>({type:p.type,pid:p.pid,cpu:p.cpu,memory:p.memory}))});
      }
      const totals=samples.map(s=>s.processes.reduce((sum,p)=>sum+(p.cpu?.percentCPUUsage??0),0)).sort((a,b)=>a-b);
      phases.push({name,elapsedMs:Date.now()-start,samples,cpuMedian:totals[Math.floor(totals.length/2)],cpuP95:totals[Math.min(totals.length-1,Math.ceil(totals.length*.95)-1)]});
      fs.writeFileSync(file,JSON.stringify({startedAt,verifiedAt:new Date().toISOString(),status:'running',phaseMs,phases,realModel:false},null,2));
      console.log('RESOURCE_PHASE_COMPLETE',name,JSON.stringify({samples:samples.length,cpuMedian:phases.at(-1).cpuMedian,cpuP95:phases.at(-1).cpuP95}));
    }
    fs.writeFileSync(file,JSON.stringify({startedAt,verifiedAt:new Date().toISOString(),status:'passed',phaseMs,phases,realModel:false,messages:store.data.messages.length,note:'Own Electron process CPU samples; shared memory is not unique RAM. No battery measurement or baseline speedup claim. Other desktop activity was not controlled.'},null,2));
    console.log('RESOURCE_IDLE_PHASES_COMPLETE');app.quit();
  } catch(error) {console.error(error);app.exit(1);}
};
