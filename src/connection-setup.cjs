const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');

class ConnectionSetup extends EventEmitter {
  constructor(connection,{openExternal}={}){
    super();this.connection=connection;this.openExternal=openExternal;this.attempt=null;this.checking=null;
    this.state={phase:'idle',message:'Codex 연결을 확인해주세요.',authMode:null};
    this.notification=message=>{
      if(message.method==='account/login/completed'&&this.attempt){
        if(this.attempt.id===null)this.attempt.early={loginId:message.params.loginId,success:message.params.success};
        else if(message.params.loginId===this.attempt.id)void this.completeLogin(this.attempt,message.params);
      }
      if(message.method==='account/updated'&&message.params.authMode===null&&!this.attempt){this.state={phase:'login-required',message:'ChatGPT 로그인이 필요해요.',authMode:null};this.emit('change');}
    };
    this.disconnected=()=>{clearTimeout(this.attempt?.timer);this.attempt=null;this.state={phase:'error',message:'연결이 끊겼어요. 다시 연결을 눌러주세요.',authMode:null};this.emit('change');};
    connection.on('notification',this.notification);connection.on('disconnected',this.disconnected);
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
        this.state={phase:required?'login-required':'ready',message:required?'ChatGPT로 로그인하면 대화를 시작할 수 있어요.':response.account?'로그인 상태를 확인했어요.':'이 연결은 별도 OpenAI 로그인이 필요하지 않아요.',authMode:response.account?.type??'external'};
      }catch(error){
        if(this.connection.process===process&&error.code===-32601)this.state={phase:'unknown',message:'이 CLI는 로그인 확인을 지원하지 않아요. 연결 후 응답에서 확인합니다.',authMode:null};
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
  dispose(){clearTimeout(this.attempt?.timer);this.attempt=null;this.connection.off('notification',this.notification);this.connection.off('disconnected',this.disconnected);}
}
module.exports={ConnectionSetup};
