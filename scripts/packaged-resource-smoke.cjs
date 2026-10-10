const {app,BrowserWindow}=require('electron');
const path=require('node:path'),fs=require('node:fs');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(root,'artifacts/packaged-resource-smoke'));
const args=process.argv.slice(2);if(args.length>1)throw Error('Pass at most one app.asar path.');
const archive=args.length?path.resolve(args[0]):path.join(root,'dist/staging',`OnggiBot-${process.platform}-${process.arch}`,...(process.platform==='darwin'?['OnggiBot.app','Contents','Resources']:['resources']),'app.asar');
if(!fs.existsSync(archive))throw Error('Build the staging app before measuring its ASAR.');
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'));
process.argv.push('--demo');let running=false;
app.on('browser-window-created',(_event,window)=>window.webContents.on('did-finish-load',()=>{
  const windows=BrowserWindow.getAllWindows(),pet=windows.find(w=>w.webContents.getURL().endsWith('?surface=pet')),panel=windows.find(w=>w.webContents.getURL().endsWith('?surface=panel'));
  if(running||!pet||!panel)return;running=true;
  setTimeout(()=>void require('./resource-smoke.cjs')({app,pet,panel,store:{data:{messages:[]}},output:path.join(output,'resource-smoke.json')}),500);
}));
require(path.join(archive,'src/main.cjs'));
