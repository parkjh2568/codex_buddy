const path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),args=process.argv.slice(2),target=args.shift(),targets={app:root,assets:path.join(__dirname,'asset-validation-smoke.cjs'),package:path.join(__dirname,'verify-package.cjs'),'packaged-resources':path.join(__dirname,'packaged-resource-smoke.cjs'),inputs:path.join(__dirname,'real-input-smoke.cjs')};
if(!Object.hasOwn(targets,target))throw Error('Unknown UI verification target: '+target);
if(!args.includes('--interactive')){
  console.error('UI 검사는 작업 중인 창·입력 포커스에 영향을 줄 수 있어 실행하지 않았습니다. 화면 검증 시간을 확보한 뒤 명령 끝에 -- --interactive를 붙여주세요. 화면을 열지 않는 검사는 npm run verify입니다.');
  process.exitCode=2;
}else{
  const result=spawnSync(require('electron'),[targets[target],...args.filter(arg=>arg!=='--interactive'),...(target==='app'?['--interactive']:[])],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  if(result.error||result.signal)console.error(result.error?.message??result.signal);
  process.exitCode=result.status??1;
}
