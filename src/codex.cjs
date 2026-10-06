const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

class CodexConnection extends EventEmitter {
  constructor({maxFrameBytes=64*1024*1024}={}) {
    super();
    this.maxFrameBytes=maxFrameBytes;
    this.pending = new Map();
    this.sequence = 0;
    this.process = null;
    this.ready = null;
    this.active = null;
  }
  async connect(executable, cwd) {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, stdio: ['pipe','pipe','pipe'], shell: false });
      this.process = child;
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
          try { message = JSON.parse(line); } catch { this.emit('protocol-error', 'Codex 응답 형식이 올바르지 않습니다.'); continue; }
          if (message.id !== undefined && !message.method) {
            const request = this.pending.get(message.id);
            if (request) {
              clearTimeout(request.timer); this.pending.delete(message.id);
              if(message.error){const error=new Error(message.error.message??'Codex 요청 실패');error.code=message.error.code;error.data=message.error.data;request.reject(error);}else request.resolve(message.result);
            }
          } else if (message.id !== undefined && message.method) {
            this.emit('request', message);
          } else {
            if (message.method === 'turn/started') this.active = { threadId: message.params.threadId, turnId: message.params.turn.id };
            if (message.method === 'turn/completed') this.active = null;
            this.emit('notification', message);
          }
        }
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      const onExit = error => {
        if (this.process !== child) return;
        this.process = null; this.ready = null; this.active = null;
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
        this.pending.clear();
        this.emit('disconnected', error.message);
      };
      child.once('error', error => onExit(new Error(`Codex 실행 실패: ${error.message}`)));
      child.once('exit', (code, signal) => onExit(new Error(`Codex 연결 종료 (${signal ?? code}). 설정에서 CLI 경로와 로그인을 확인해주세요.`)));
      await this.request('initialize', { clientInfo: { name: 'onggi_bot', title: 'OnggiBot', version: '0.1.0-alpha.8' } });
      this.write({ method: 'initialized', params: {} });
      return true;
    })();
    try { return await this.ready; } catch (error) { this.stop(); throw error; }
  }
  write(message) {
    if (!this.process || !this.process.stdin.writable) throw new Error('Codex에 연결되어 있지 않습니다.');
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params, timeout = 30000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex 요청 시간 초과: ${method}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      if (method === 'turn/start' && this.pending.has(id)) this.emit('turn-sent', { threadId:params.threadId, at:performance.timeOrigin + performance.now() });
    });
  }
  respond(id, result) { this.write({ id, result }); }
  async interrupt() {
    if (this.active) await this.request('turn/interrupt', this.active);
  }
  stop() {
    const child = this.process;
    this.process = null; this.ready = null; this.active = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('연결을 종료했습니다.')); }
    this.pending.clear();
    if (child) child.kill();
  }
}

module.exports = { CodexConnection };
