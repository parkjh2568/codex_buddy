const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');

class ConnectionSetup extends EventEmitter {
  constructor(connection,{openExternal}={}){
    super();this.connection=connection;this.openExternal=openExternal;this.attempt=null;this.checking=null;
    this.diagnostics={cliVersion:null,versionStatus:'unknown',checkedAt:null,features:{auth:'unknown',plan:'unknown',review:'unknown',skills:'unknown',rateLimits:'unknown'}};
    this.usage={status:'idle',checkedAt:null,buckets:[]};this.usageWork=null;this.usageRevision=0;
    this.state={phase:'idle',message:'Codex 연결을 확인해주세요.',authMode:null};
    this.notification=message=>{
      if(message.method==='account/rateLimits/updated')this.updateUsage(message.params,true);
      if(message.method==='account/updated'){this.usageRevision++;this.usage={status:'idle',checkedAt:null,buckets:[]};this.emit('change');}
      if(message.method==='account/login/completed'&&this.attempt){
        if(this.attempt.id===null)this.attempt.early={loginId:message.params.loginId,success:message.params.success};
        else if(message.params.loginId===this.attempt.id)void this.completeLogin(this.attempt,message.params);
      }
      if(message.method==='account/updated'&&message.params.authMode===null&&!this.attempt){this.state={phase:'login-required',message:'ChatGPT 로그인이 필요해요.',authMode:null};this.emit('change');}
    };
    this.disconnected=()=>{clearTimeout(this.attempt?.timer);this.attempt=null;this.usageRevision++;this.usage={...this.usage,status:'stale'};this.state={phase:'error',message:'연결이 끊겼어요. 다시 연결을 눌러주세요.',authMode:null};this.emit('change');};
    connection.on('notification',this.notification);connection.on('disconnected',this.disconnected);
  }
  updateUsage(payload,merge=false){
    this.usageRevision++;
    const source=payload?.rateLimitsByLimitId&&typeof payload.rateLimitsByLimitId==='object'&&!Array.isArray(payload.rateLimitsByLimitId)?Object.entries(payload.rateLimitsByLimitId).slice(0,16):payload?.rateLimits?[['codex',payload.rateLimits]]:[];
    const buckets=[];
    for(const [key,value]of source){
      if(!value||typeof value!=='object')continue;const bucket={id:typeof value.limitId==='string'?value.limitId.slice(0,80):key.slice(0,80),name:typeof value.limitName==='string'?value.limitName.slice(0,100):key.slice(0,80)};
      for(const slot of ['primary','secondary']){const window=value[slot];bucket[slot]=window&&Number.isFinite(window.usedPercent)&&window.usedPercent>=0?{usedPercent:Math.min(100,window.usedPercent),windowDurationMins:Number.isSafeInteger(window.windowDurationMins)&&window.windowDurationMins>0?window.windowDurationMins:null,resetsAt:Number.isSafeInteger(window.resetsAt)&&window.resetsAt>0&&window.resetsAt<=8640000000000?window.resetsAt:null}:null;}
      if(bucket.primary||bucket.secondary)buckets.push(bucket);
    }
    if(merge&&!buckets.length){this.usage={...this.usage,status:'stale'};this.emit('change');return this.usage;}
    this.usage={status:buckets.length?'ready':'unavailable',checkedAt:Date.now(),buckets:merge?[...this.usage.buckets.filter(old=>!buckets.some(item=>item.id===old.id)),...buckets].slice(-16):buckets};this.emit('change');return this.usage;
  }
  async readUsage(){
    if(this.usageWork)return this.usageWork;const process=this.connection.process,revision=this.usageRevision;
    this.usage={...this.usage,status:'loading'};this.emit('change');
    this.usageWork=(async()=>{
      try{
        const payload=await this.connection.request('account/rateLimits/read',{},10000);
        if(process!==this.connection.process||revision!==this.usageRevision)return this.usage;
        this.diagnostics.features.rateLimits='supported';return this.updateUsage(payload);
      }catch(error){
        if(process===this.connection.process&&revision===this.usageRevision){
          this.diagnostics.features.rateLimits=error.code===-32601?'unsupported':'unknown';
          this.usage={...this.usage,status:error.code===-32601?'unsupported':'unavailable'};this.emit('change');
        }
        return this.usage;
      }
    })();try{return await this.usageWork;}finally{this.usageWork=null;}
  }
  async probeVersion(executable,cwd){
    let identity;try{const stat=fs.statSync(executable);identity=`${executable}:${stat.size}:${stat.mtimeMs}`;}catch{return;}
    if(identity===this.versionIdentity)return this.versionWork;this.versionIdentity=identity;
    this.versionChild?.kill();for(const key of Object.keys(this.diagnostics.features))this.diagnostics.features[key]='unknown';this.diagnostics.cliVersion=null;this.diagnostics.versionStatus='checking';
    this.versionWork=new Promise(resolve=>{
      const script=/\.(cjs|mjs|js)$/i.test(executable),child=spawn(script?process.execPath:executable,[...(script?[executable]:[]),'--version'],{cwd,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true,...(script&&process.versions.electron?{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}}:{})});
      this.versionChild=child;let output='',bytes=0,finished=false;
      const finish=code=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();if(this.versionChild===child){this.versionChild=null;this.diagnostics.cliVersion=code===0&&/^codex(?:-cli)? [0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?\s*$/.test(output)?output.trim().split(' ')[1]:null;this.diagnostics.versionStatus=this.diagnostics.cliVersion?'ready':'unknown';this.diagnostics.checkedAt=Date.now();this.emit('change');}resolve(this.diagnostics);};
      const timer=setTimeout(()=>finish(null),3000);
      child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)finish(null);else output+=chunk.toString('utf8');});child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)finish(null);});child.once('error',()=>finish(null));child.once('close',finish);
    });return this.versionWork;
  }
  static findExecutable(configured){
    const name=process.platform==='win32'?'codex.exe':'codex';
    const candidates=[...(configured?[configured]:[]),...(process.env.PATH?.split(path.delimiter).map(p=>path.join(p,name))??[])];
    if(process.platform==='win32')candidates.push(path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData','Local'),'Programs','OpenAI','Codex','bin','codex.exe'));
    else candidates.push(path.join(os.homedir(),'.local/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex','/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
    for(const candidate of candidates){
      try{
        if(!fs.statSync(candidate).isFile())continue;
        if(candidate===configured&&/\.(cjs|mjs|js)$/i.test(candidate))return path.resolve(candidate);
        if(process.platform==='win32'&&!/\.exe$/i.test(candidate))continue;
        fs.accessSync(candidate,fs.constants.X_OK);return path.resolve(candidate);
      }catch{}
    }
    return null;
  }
  async check(){
    if(this.checking)return this.checking;
    if(this.attempt)return this.state;
    const process=this.connection.process;
    this.state={...this.state,phase:'checking',message:'로그인 상태를 확인하고 있어요.'};this.emit('change');
    this.checking=(async()=>{
      try{
        const response=await this.connection.request('account/read',{refreshToken:false},10000);
        if(this.connection.process!==process)throw Error('연결이 변경됐습니다.');
        if(typeof response?.requiresOpenaiAuth!=='boolean'||response.account!=null&&(typeof response.account!=='object'||Array.isArray(response.account)||typeof response.account.type!=='string'||!response.account.type||response.account.type.length>80))throw Error('인증 응답 형식이 올바르지 않습니다.');
        const required=response.requiresOpenaiAuth&&!response.account;
        this.diagnostics.features.auth='supported';
        this.state={phase:required?'login-required':'ready',message:required?'ChatGPT로 로그인하면 대화를 시작할 수 있어요.':response.account?'로그인 상태를 확인했어요.':'이 연결은 별도 OpenAI 로그인이 필요하지 않아요.',authMode:response.account?.type??'external'};
      }catch(error){
        if(this.connection.process===process&&error.code===-32601){this.diagnostics.features.auth='unsupported';this.state={phase:'unknown',message:'이 CLI는 로그인 확인을 지원하지 않아요. 연결 후 응답에서 확인합니다.',authMode:null};}
        else{this.state={phase:'error',message:'로그인 상태를 확인하지 못했어요. 다시 연결해주세요.',authMode:null};throw Error(this.state.message);}
      }finally{this.emit('change');}
      return this.state;
    })();
    try{return await this.checking;}finally{this.checking=null;}
  }
  async startLogin(){
    if(this.attempt)return{ok:true,pending:true};
    const state=await this.check();if(this.attempt)return{ok:true,pending:true};if(state.phase==='ready')return{ok:true,alreadyAuthenticated:true};
    const attempt={id:null,process:this.connection.process,early:null};this.attempt=attempt;
    this.state={phase:'login-pending',message:'브라우저에서 로그인을 완료해주세요.',authMode:null};this.emit('change');
    attempt.timer=setTimeout(()=>{if(this.attempt===attempt)void this.cancelLogin('로그인 시간이 지났어요. 다시 로그인해주세요.');},300000);
    try{
      const response=await this.connection.request('account/login/start',{type:'chatgpt'},10000);
      if(response?.type!=='chatgpt'||typeof response.loginId!=='string'||!response.loginId||response.loginId.length>200)throw Error('로그인 응답이 올바르지 않습니다.');
      attempt.id=response.loginId;
      if(this.attempt!==attempt){if(this.connection.process===attempt.process)await this.connection.request('account/login/cancel',{loginId:attempt.id},5000).catch(()=>{});return{ok:false};}
      if(attempt.early?.loginId===attempt.id){await this.completeLogin(attempt,attempt.early);return{ok:true};}
      const url=new URL(response.authUrl);
      if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.port&&url.port!=='443'||url.username||url.password)throw Error('공식 로그인 주소가 아닙니다.');
      await this.openExternal(url.href);return{ok:true,pending:true};
    }catch{
      if(this.attempt===attempt)await this.cancelLogin('브라우저 로그인을 시작하지 못했어요. 기본 브라우저와 CLI를 확인해주세요.');
      throw Error('브라우저 로그인을 시작하지 못했어요. 다시 연결한 뒤 시도해주세요.');
    }
  }
  async completeLogin(attempt,result){
    if(this.attempt!==attempt||result.loginId!==attempt.id)return;
    clearTimeout(attempt.timer);this.attempt=null;
    if(result.success!==true){this.state={phase:'login-required',message:'로그인을 완료하지 못했어요. 다시 시도해주세요.',authMode:null};this.emit('change');return;}
    try{const state=await this.check();if(state.phase==='ready')this.emit('authenticated');}catch{}
  }
  async cancelLogin(message='로그인을 취소했어요. 다시 로그인할 수 있어요.'){
    const attempt=this.attempt;clearTimeout(attempt?.timer);this.attempt=null;
    this.state={phase:'login-required',message,authMode:null};this.emit('change');
    if(attempt?.id&&this.connection.process===attempt.process)await this.connection.request('account/login/cancel',{loginId:attempt.id},5000).catch(()=>{});
    return{ok:true};
  }
  dispose(){this.usageRevision++;clearTimeout(this.attempt?.timer);this.attempt=null;this.versionChild?.kill();this.versionChild=null;this.connection.off('notification',this.notification);this.connection.off('disconnected',this.disconnected);}
}
module.exports={ConnectionSetup};
