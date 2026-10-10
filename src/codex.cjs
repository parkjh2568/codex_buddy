const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const metadata = require('../package.json');

class CodexConnection extends EventEmitter {
  constructor({maxFrameBytes=64*1024*1024,experimentalApi=false}={}) {
    super();
    this.maxFrameBytes=maxFrameBytes;
    this.experimentalApi=experimentalApi;
    this.pending = new Map();
    this.sequence = 0;
    this.process = null;
    this.ready = null;
    this.active = null;
    this.turnContext = null;
  }
  async connect(executable, cwd) {
    if (this.ready) return this.ready;
    if (typeof executable !== 'string' || !executable || typeof cwd !== 'string' || !cwd) throw new Error('CLI 실행 파일과 작업 폴더를 확인해주세요.');
    if (process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('Windows에서는 런처 대신 네이티브 codex.exe를 선택해주세요.');
    const nodeScript = /\.(cjs|mjs|js)$/i.test(executable);
    const child = spawn(nodeScript ? process.execPath : executable, [...(nodeScript ? [path.resolve(executable)] : []), 'app-server', '--listen', 'stdio://'], {
      cwd, stdio: ['pipe','pipe','pipe'], shell: false, windowsHide: true,
      ...(nodeScript && process.versions.electron ? {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}} : {})
    });
    this.process = child;
    this.ready = (async () => {
      let parts=[],frameBytes=0,frameFailure=false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (frameFailure || this.process!==child) return;
        let offset=0;
        while (offset<chunk.length) {
          const newline=chunk.indexOf('\n',offset),end=newline<0?chunk.length:newline;
          const segment=chunk.slice(offset,end);frameBytes+=Buffer.byteLength(segment,'utf8');
          if (frameBytes>this.maxFrameBytes) {
            frameFailure=true;parts=[];
            const error=new Error(`Codex 응답 한 프레임이 ${this.maxFrameBytes}바이트 한도를 초과했습니다. 저장된 기록은 유지됩니다.`);
            this.emit('protocol-error',error.message);onExit(error);child.kill();return;
          }
          if (segment) parts.push(segment);
          if (newline<0) break;
          const line=parts.join('');parts=[];frameBytes=0;offset=newline+1;
          if (!line.trim()) continue;
          let message;
          try {
            message = JSON.parse(line);
            if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('객체 응답이 필요합니다.');
            if (message.id !== undefined && !((typeof message.id === 'string' && message.id.length <= 200) || Number.isSafeInteger(message.id))) throw new Error('요청 ID가 올바르지 않습니다.');
            if (message.method !== undefined && (typeof message.method !== 'string' || !message.method || message.method.length > 200)) throw new Error('메서드가 올바르지 않습니다.');
            if (!message.method && (message.id === undefined || !('result' in message || 'error' in message) || ('result' in message && 'error' in message))) throw new Error('요청 응답이 올바르지 않습니다.');
            if (message.error !== undefined && (!message.error || typeof message.error !== 'object' || typeof message.error.message !== 'string')) throw new Error('오류 응답이 올바르지 않습니다.');
            if (message.method) {
              const params = message.params ?? {};
              if (typeof params !== 'object' || Array.isArray(params) || message.params === null) throw new Error('이벤트 인수가 올바르지 않습니다.');
              message.params = params;
              if (['turn/started','turn/completed'].includes(message.method) && (!params.turn || typeof params.turn.id !== 'string' || !params.turn.id || typeof params.threadId !== 'string' || !params.threadId)) throw new Error('턴 정보가 올바르지 않습니다.');
              if (message.method === 'turn/completed' && !['completed','interrupted','failed'].includes(params.turn.status)) throw new Error('턴 종료 상태가 올바르지 않습니다.');
              if (['item/started','item/completed'].includes(message.method) && (!params.item || typeof params.item.id !== 'string' || typeof params.item.type !== 'string' || (['agentMessage','plan'].includes(params.item.type) && typeof params.item.text !== 'string') || ['enteredReviewMode','exitedReviewMode'].includes(params.item.type)&&typeof params.item.review!=='string')) throw new Error('항목 정보가 올바르지 않습니다.');
              if (['item/agentMessage/delta','item/plan/delta'].includes(message.method) && (typeof params.itemId !== 'string' || typeof params.delta !== 'string')) throw new Error('답변 조각이 올바르지 않습니다.');
              if (message.method === 'item/tool/requestUserInput' && (!Array.isArray(params.questions) || !params.questions.length || params.questions.length > 32 || params.questions.some(q => !q || typeof q.id !== 'string' || !q.id || typeof q.question !== 'string' || (q.options !== undefined && q.options !== null && (!Array.isArray(q.options) || q.options.some(o => !o || typeof o.label !== 'string')))))) throw new Error('추가 질문 구성이 올바르지 않습니다.');
            }
          } catch (error) {
            frameFailure = true; parts = [];
            const failure = new Error('Codex 응답 형식이 올바르지 않습니다. ' + error.message);
            this.emit('protocol-error', failure.message); onExit(failure); child.kill(); return;
          }
          if (message.id !== undefined && !message.method) {
            const request = this.pending.get(message.id);
            if (request) {
              clearTimeout(request.timer); this.pending.delete(message.id);
              if(message.error){const error=new Error(message.error.message??'Codex 요청 실패');error.code=message.error.code;error.data=message.error.data;if(this.turnContext===request.turnContext)this.turnContext=null;request.reject(error);}
              else {
                if(request.turnContext){
                  const context=request.turnContext,id=message.result?.turn?.id;
                  if(typeof id!=='string'||!id){const failure=new Error('Codex 턴 시작 응답 ID가 올바르지 않습니다.');request.reject(failure);onExit(failure);child.kill();return;}
                  context.turnId=id;
                  if(this.turnContext===context){
                    this.active={threadId:context.threadId,turnId:id};
                    for(const early of context.events){
                      const turnId=early.params.turnId??early.params.turn?.id;
                      if(early.params.threadId&&early.params.threadId!==context.threadId||turnId&&turnId!==id)continue;
                      if(early.method==='turn/completed'){context.completed=true;this.active=null;}
                      try{this.emit(early.id!==undefined?'request':'notification',early);}catch(error){const failure=new Error('Codex 초기 턴 이벤트 처리 실패: '+error.message);request.reject(failure);onExit(failure);child.kill();return;}
                    }
                    context.events=[];context.eventBytes=0;context.imageBytes=0;
                  }
                }
                request.resolve(message.result);
              }
            }
          } else if(this.turnContext&&!this.turnContext.turnId&&(/^(turn\/|item\/|serverRequest\/)/.test(message.method))&&(!message.params.threadId||message.params.threadId===this.turnContext.threadId)){
            // RPC 응답으로 소유 턴이 확정될 때까지 늦은 이전 턴 알림을 적용하지 않는다.
            const context=this.turnContext,item=message.method==='item/completed'?message.params.item:null;
            const imageBytes=item?.type==='imageGeneration'&&typeof item.result==='string'?Buffer.byteLength(item.result):item?.type==='mcpToolCall'&&Array.isArray(item.result?.content)?item.result.content.filter(c=>c?.type==='image'&&typeof c.data==='string').reduce((sum,c)=>sum+Buffer.byteLength(c.data),0):0;
            context.imageBytes+=imageBytes;context.eventBytes+=Buffer.byteLength(line)-imageBytes;
            if(context.events.length>=128||context.eventBytes>256*1024||context.imageBytes>32*1024*1024){const failure=new Error('Codex 초기 턴 알림 한도를 초과했습니다. 자동 재전송하지 않습니다.');onExit(failure);child.kill();return;}
            context.events.push(message);
          } else if (message.id !== undefined && message.method) {
            try { this.emit('request', message); } catch (error) { onExit(new Error('Codex 요청 처리 실패: ' + error.message)); child.kill(); return; }
          } else {
            const context=this.turnContext;
            const incomingTurn=message.params.turnId??message.params.turn?.id;
            if(context?.turnId&&context.threadId===message.params.threadId&&incomingTurn&&incomingTurn!==context.turnId)continue;
            if(message.method==='turn/started'&&context&&!context.completed&&context.threadId===message.params.threadId&&(!context.turnId||context.turnId===message.params.turn.id)){context.turnId=message.params.turn.id;this.active={threadId:context.threadId,turnId:context.turnId};}
            if(message.method==='turn/completed'&&context&&context.threadId===message.params.threadId&&context.turnId===message.params.turn.id){context.completed=true;if(this.active?.threadId===context.threadId&&this.active.turnId===context.turnId)this.active=null;}
            try { this.emit('notification', message); } catch (error) { onExit(new Error('Codex 이벤트 처리 실패: ' + error.message)); child.kill(); return; }
          }
        }
      });
      child.stderr.resume();
      const onExit = error => {
        if (this.process !== child) return;
        this.process = null; this.ready = null; this.active = null; this.turnContext=null;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
        this.pending.clear();
        this.emit('disconnected', error.message);
      };
      child.stdin.on('error', error => { onExit(new Error('Codex 입력 연결 실패: ' + error.message)); child.kill(); });
      child.once('error', error => onExit(new Error(`Codex 실행 실패: ${error.message}`)));
      child.once('exit', (code, signal) => onExit(new Error(`Codex 연결 종료 (${signal ?? code}). 설정에서 CLI 경로와 로그인을 확인해주세요.`)));
      await this.request('initialize', { clientInfo: { name: 'onggi_bot', title: 'OnggiBot', version: metadata.onggiProjectVersion ?? metadata.version },...(this.experimentalApi?{capabilities:{experimentalApi:true}}:{}) });
      this.write({ method: 'initialized', params: {} });
      return true;
    })();
    const ready = this.ready;
    try { return await ready; }
    catch (error) {
      // A late failure belongs to this child, never to its replacement connection.
      if (this.process === child) this.stop();
      throw error;
    }
  }
  write(message) {
    if (!this.process || !this.process.stdin.writable) throw new Error('Codex에 연결되어 있지 않습니다.');
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params, timeout = 30000) {
    if(['turn/start','review/start'].includes(method)&&(this.active||this.turnContext&&!this.turnContext.completed))return Promise.reject(new Error('이전 턴을 마친 뒤 새 턴을 시작해주세요.'));
    const turnContext=['turn/start','review/start'].includes(method)?{threadId:params.threadId,turnId:null,completed:false,events:[],eventBytes:0,imageBytes:0}:undefined;
    if(turnContext)this.turnContext=turnContext;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 요청 시간 초과: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer,turnContext });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id);if(this.turnContext===turnContext)this.turnContext=null;reject(error); }
      if (['turn/start','review/start'].includes(method) && this.pending.has(id)) this.emit('turn-sent', { threadId:params.threadId, at:performance.timeOrigin + performance.now() });
    });
  }
  respond(id, result) { this.write({ id, result }); }
  async interrupt(target=this.active) {
    if(target?.threadId&&target.turnId)await this.request('turn/interrupt',{threadId:target.threadId,turnId:target.turnId});
  }
  stop() {
    const child = this.process;
    this.process = null; this.ready = null; this.active = null;this.turnContext=null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('연결을 종료했습니다.')); }
    this.pending.clear();
    if (child) child.kill();
  }
}

module.exports = { CodexConnection };
