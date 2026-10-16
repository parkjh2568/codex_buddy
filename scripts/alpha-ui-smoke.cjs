const fs = require('node:fs');
const path = require('node:path');
module.exports = ({app,pet,petNotice,panel,store,codex,screen,publish,smoke,realSmoke}) => {
  setTimeout(async () => {
      try {
        const artifactRoot=path.resolve(process.env.ONGGI_SMOKE_ROOT??path.join(__dirname,'..','artifacts'));fs.mkdirSync(artifactRoot,{recursive:true});
        if (smoke) {
          const petCheck = await pet.webContents.executeJavaScript(`(async()=>{
            const character=document.querySelector('#pet-character'),bubble=document.querySelector('#pet-bubble'),controls=document.querySelector('.pet-controls');
            const size={width:parseFloat(getComputedStyle(character).width),height:parseFloat(getComputedStyle(character).height)};
            for(let i=0;i<8;i++){await window.onggi.action('sync');await new Promise(r=>setTimeout(r,400));}
            const hiddenAfterIdle=bubble.hidden;
            character.dispatchEvent(new PointerEvent('pointerenter'));
            const visibleOnHover=!bubble.hidden;
            const controlsVisibleOnHover=getComputedStyle(controls).visibility==='visible';
            document.querySelector('#pet-settings').focus();const menuFocused=document.activeElement===document.querySelector('#pet-settings');
            for(let i=0;i<8;i++){character.dispatchEvent(new PointerEvent('pointerenter'));await window.onggi.action('sync');await new Promise(r=>setTimeout(r,400));}
            const visibleWhileHovered=!bubble.hidden;
            character.dispatchEvent(new PointerEvent('pointerleave'));
            await new Promise(r=>setTimeout(r,3200));
            const hiddenAfterHover=bubble.hidden;
            const controlsHiddenAfterHover=getComputedStyle(controls).visibility==='hidden';
            await window.onggi.action('hide-panel');
            character.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));
            return {...size,hiddenAfterIdle,visibleOnHover,hiddenAfterHover,controlsVisibleOnHover,menuFocused,controlsHiddenAfterHover,visibleWhileHovered};
          })()`);
          if(petCheck.width!==75||petCheck.height!==95||!petCheck.hiddenAfterIdle||!petCheck.visibleOnHover||!petCheck.hiddenAfterHover||!petCheck.visibleWhileHovered||!petCheck.controlsVisibleOnHover||!petCheck.menuFocused||!petCheck.controlsHiddenAfterHover||!panel.isVisible())throw new Error('PET_SIZE_BUBBLE_FAILED '+JSON.stringify(petCheck));
          const compact = pet.getBounds();
          if(compact.width!==120||compact.height!==143)throw new Error('PET_COMPACT_WINDOW_FAILED '+JSON.stringify(compact));
          const hitCheck = await pet.webContents.executeJavaScript(`(async()=>{
            const blank=await window.onggi.action('pet-pointer-sync',{x:${compact.x+5},y:${compact.y+70}});
            const character=await window.onggi.action('pet-pointer-sync',{x:${compact.x+60},y:${compact.y+60}});
            return {blankPasses:blank.ignore,characterReceives:!character.ignore};
          })()`);
          if(!hitCheck.blankPasses||!hitCheck.characterReceives)throw new Error('PET_HIT_REGIONS_FAILED '+JSON.stringify(hitCheck));
          console.log('PET_NATIVE_HIT_REGIONS_OK',JSON.stringify(hitCheck));
          await pet.webContents.executeJavaScript(`(async()=>{await window.onggi.action('drag-start',{x:900,y:700});await window.onggi.action('drag-move',{x:860,y:670});await window.onggi.action('drag-move',{x:860,y:670});await window.onggi.action('drag-end');})()`);
          const moved = pet.getBounds();
          if(moved.x!==compact.x-40||moved.y!==compact.y-30)throw new Error('PET_ABSOLUTE_DRAG_FAILED '+JSON.stringify({compact,moved}));
          console.log('PET_COMPACT_ABSOLUTE_DRAG_OK',JSON.stringify({compact,moved}));
          fs.writeFileSync(path.join(artifactRoot,'pet-ui-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',result:petCheck},null,2));
          console.log('PET_HALF_SIZE_AUTO_HIDE_OK',JSON.stringify(petCheck));
          await require('../scripts/pet-notice-smoke.cjs')({pet,petNotice,panel,screen});
        }
        const result = await panel.webContents.executeJavaScript(`(async () => {
          await window.onggi.action('show-panel',{tab:'settings',full:true});
          await window.onggi.action('sync');
          await new Promise(r=>setTimeout(r,100));
          document.querySelector('[data-tab="settings"]').click();
          document.querySelector('[data-character="onggi-sprout"]').click();
          const switchDeadline=Date.now()+5000;
          while(Date.now()<switchDeadline&&!document.querySelector('[data-character="onggi-sprout"]').classList.contains('selected'))await new Promise(r=>setTimeout(r,30));
          const switched = document.querySelector('[data-character="onggi-sprout"]').classList.contains('selected');
          document.querySelector('[data-character="onggi-clip"]').click();
          document.querySelector('[data-tab="chat"]').click();
          ${realSmoke&&process.argv.includes('--real-mini-smoke')?"await window.onggi.action('settings',{chatMode:'bubble'});await window.onggi.action('persona-settings',{characterId:'onggi-clip',mode:'concise'});await window.onggi.action('show-panel',{tab:'chat'});await new Promise(r=>setTimeout(r,120));":''}
          const input = document.querySelector('#prompt'); input.value = ${JSON.stringify(realSmoke ? '한국어로 짧게 답해줘. 내 캐릭터 이름은 옹기봇이야. 그 이름만 답해줘. 도구는 사용하지 마.' : '안녕 옹기봇!')};
          document.querySelector('#composer').requestSubmit();
          const deadline = Date.now() + 90000;
          do { await new Promise(r => setTimeout(r, 150)); } while (Date.now() < deadline && !document.querySelector('.message.assistant[data-status="completed"]') && !document.querySelector('.message.assistant[data-status="failed"]'));
          return { switched, text: document.querySelector('#messages').innerText, cards: document.querySelectorAll('.message').length, error: document.querySelector('#toast').textContent };
        })()`);

        if (realSmoke) {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline && !store.data.messages.find(m => m.role === 'assistant')?.timing?.renderedAt) await new Promise(r => setTimeout(r,30));
          const timing = store.data.messages.find(m => m.role === 'assistant')?.timing;
          if (!timing?.renderedAt || !(timing.firstReplyAt >= timing.cliSentAt && timing.completedAt >= timing.firstReplyAt)) throw new Error('Actual CLI response timing was not acknowledged');
          fs.writeFileSync(path.join(artifactRoot,'real-response-timing.json'),JSON.stringify({verifiedAt:new Date().toISOString(),model:'gpt-5.6-luna',effort:'high',serviceTier:'default',timing},null,2));
          if(process.argv.includes('--real-mini-smoke')){
            const mini=await panel.webContents.executeJavaScript(`({compact:document.body.classList.contains('compact-mode'),width:innerWidth,height:innerHeight,reply:document.querySelector('.message.assistant .message-body').textContent,composerVisible:document.querySelector('#composer').getBoundingClientRect().bottom<innerHeight})`);
            if(!mini.compact||mini.width!==360||!mini.composerVisible||store.data.messages.at(-1)?.persona?.id!=='concise')throw Error('Real mini/persona integration failed');
            fs.writeFileSync(path.join(artifactRoot,'real-mini-persona-smoke.json'),JSON.stringify({verifiedAt:new Date().toISOString(),status:'passed',model:'gpt-5.6-luna',effort:'high',mini,persona:store.data.messages.at(-1).persona},null,2));
          }
        }
        fs.writeFileSync(path.join(artifactRoot,realSmoke ? 'alpha-real.png' : 'alpha-panel.png'), (await panel.webContents.capturePage()).toPNG());
        fs.writeFileSync(path.join(artifactRoot,'alpha-pet.png'), (await pet.webContents.capturePage()).toPNG());
        if (!result.switched || !result.text.includes(realSmoke ? '옹기봇' : '체험 모드예요') || result.cards !== 2 || !store.data.messages.some(m => m.role === 'assistant' && m.status === 'completed')) throw new Error(JSON.stringify(result));
        if (!realSmoke) {
          const sample = '## Markdown 표시\n\n**굵게**와 *기울임*, `inline()`을 지원해요.\n\n**알파인 리눅스(Alpine Linux)**는 작은 배포판이에요.\n\n- 첫 번째\n- 두 번째\n\n> 작은 인용문\n\n| 기능 | 상태 |\n| --- | --- |\n| 표 | 완료 |\n\n```js\nconst onggi = "친구";\nconsole.log(onggi);\n```\n\n[공식 문서](https://learn.chatgpt.com/docs/app-server)\n\n<script>window.__onggiInjected = true</script>\n[나쁜 링크](javascript:alert(1))\n![외부 이미지](https://example.com/tracker.png)';
          store.data.messages.find(m => m.role === 'assistant').text = sample; publish();
          await new Promise(r => setTimeout(r, 150));
          const markdownCheck = await panel.webContents.executeJavaScript(`({ heading: Boolean(document.querySelector('.markdown-body h2')), bold: Boolean(document.querySelector('.markdown-body strong')), table: Boolean(document.querySelector('.markdown-table table')), code: document.querySelector('.markdown-body pre code')?.textContent, copy: Boolean(document.querySelector('.copy-code')), noScript: !document.querySelector('.markdown-body script') && !window.__onggiInjected, noUnsafeLink: ![...document.querySelectorAll('.markdown-body a')].some(a => !/^https?:/.test(a.getAttribute('href'))), noRemoteImage: !document.querySelector('.markdown-body img') })`);
          if (!markdownCheck.heading || !markdownCheck.bold || !markdownCheck.table || !markdownCheck.code.includes('const onggi') || !markdownCheck.copy || !markdownCheck.noScript || !markdownCheck.noUnsafeLink || !markdownCheck.noRemoteImage) throw new Error('MARKDOWN_CHECK_FAILED ' + JSON.stringify(markdownCheck));
          if (!(await panel.webContents.executeJavaScript(`[...document.querySelectorAll('.markdown-body strong')].some(e => e.textContent === '알파인 리눅스(Alpine Linux)')`))) throw new Error('KOREAN_EMPHASIS_FAILED');
          console.log('MARKDOWN_SECURITY_OK', JSON.stringify(markdownCheck));
          await require('../scripts/buddy-name-smoke.cjs')({pet,panel,store});
          fs.writeFileSync(path.join(artifactRoot,'alpha-markdown.png'), (await panel.webContents.capturePage()).toPNG());
          store.data.messages.find(m => m.role === 'assistant').text = '```js\nconst partial ='; publish();
          await new Promise(r => setTimeout(r, 100));
          if (!(await panel.webContents.executeJavaScript(`Boolean(document.querySelector('.markdown-body pre code')?.textContent.includes('const partial ='))`))) throw new Error('STREAMING_MARKDOWN_FAILED');
          await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="settings"]').click()`);
          await new Promise(r => setTimeout(r, 100));
          fs.writeFileSync(path.join(artifactRoot,'alpha-settings.png'), (await panel.webContents.capturePage()).toPNG());
          await panel.webContents.executeJavaScript(`document.querySelector('[data-tab="chat"]').click(); document.querySelector('#new-chat').click()`);
          await new Promise(r => setTimeout(r, 150));
          fs.writeFileSync(path.join(artifactRoot,'alpha-welcome.png'), (await panel.webContents.capturePage()).toPNG());
          const layout = await panel.webContents.executeJavaScript(`({ scroll: window.scrollY, shellScroll: document.querySelector('.panel-shell').scrollTop, headerTop: document.querySelector('.header').getBoundingClientRect().top })`);
          if (layout.headerTop < 0 || layout.scroll || layout.shellScroll) throw new Error('LAYOUT_CHECK_FAILED ' + JSON.stringify(layout));
          await require('../scripts/ui-layout-smoke.cjs')({panel});
          const queueCheck = await panel.webContents.executeJavaScript(`(async () => {
            const first = await window.onggi.action('send', { text: '첫 번째 질문' });
            const second = await window.onggi.action('send', { text: '두 번째 질문' });
            const third = await window.onggi.action('send', { text: '세 번째 질문' });
            await window.onggi.action('cancel', { id: second.id });
            await new Promise(r => setTimeout(r, 130));
            document.querySelector('[data-tab="settings"]').click();
            document.querySelector('[data-character="onggi-sprout"]').click();
            document.querySelector('[data-tab="chat"]').click();
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline && !document.querySelector('.message.user[data-id="' + third.id + '"][data-status="running"]')) await new Promise(r => setTimeout(r, 50));
            const firstFinished = Boolean(document.querySelector('.message.user[data-id="' + first.id + '"][data-status="completed"]'));
            const secondCancelled = Boolean(document.querySelector('.message.user[data-id="' + second.id + '"][data-status="interrupted"]'));
            await window.onggi.action('cancel');
            await new Promise(r => setTimeout(r, 150));
            const thirdCancelled = Boolean(document.querySelector('.message.user[data-id="' + third.id + '"][data-status="interrupted"]'));
            return { firstFinished, secondCancelled, thirdCancelled };
          })()`);
          if (!Object.values(queueCheck).every(Boolean)) throw new Error('QUEUE_CHECK_FAILED ' + JSON.stringify(queueCheck));
          console.log('QUEUE_AND_HOT_SWAP_OK', JSON.stringify(queueCheck));
        }
        fs.writeFileSync(path.join(artifactRoot,realSmoke ? 'real-ui-smoke.json' : 'ui-smoke.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), status: 'passed', result }, null, 2));
        console.log(realSmoke ? 'REAL_UI_SMOKE_OK' : 'SMOKE_OK', JSON.stringify(result)); app.quit();
      } catch (error) { console.error('SMOKE_FAILED', error); codex.stop(); app.exit(1); }
    }, 700);
};
