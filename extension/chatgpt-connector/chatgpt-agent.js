/* Chỉ chạy công việc được giao cho tab này, không đọc các cuộc trò chuyện khác. */
(() => {
  if(globalThis.__metaStudioAgentInstalled)return;globalThis.__metaStudioAgentInstalled=true;
  const EXTENSION_ORIGIN=chrome.runtime.getURL?chrome.runtime.getURL('').replace(/\/$/,''):'';
  const embeddedFrame=!!window.parent&&window.parent!==window&&location.ancestorOrigins?.[0]===EXTENSION_ORIGIN;
  const FRAME_LOAD_KEY=typeof location.href==='string'?new URL(location.href).searchParams.get('meta_studio_job')||'':'';
  let embeddedStart=null,embeddedTheme=null;
  function applyEmbeddedTheme(){const root=document.documentElement;if(!root||!embeddedTheme)return;const dark=embeddedTheme==='dark';if(root.classList.contains('dark')!==dark)root.classList.toggle('dark',dark);if(root.classList.contains('light')===dark)root.classList.toggle('light',!dark);if(root.style.colorScheme!==embeddedTheme)root.style.colorScheme=embeddedTheme;}
  const P=MetaAIProtocol;let working=false,job=null,lastPing=0,stage='',step=0,expectedMarker='',expectedPrefix='',submittedUser=null,baselineUsers=[],baselineReplies=[],baselineTurns=[],baselineSignatures=new Set(),boundConversation='',waitingForImage=false,baselineImages=new Set(),rootReadError='',baselineTurnKeys=new Set(),responseRead={};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function message(type,extra={}){const r=await chrome.runtime.sendMessage({type,id:job?.id,nonce:job?.nonce,...extra});if(r?.ok===false)throw Error(r.error);if(r?.cancelled)throw Error('Đã dừng lượt tạo.');return r;}
  let cachedRoots=[],rootsAt=0;
  function queryAll(selector){
    if(!cachedRoots.length||Date.now()-rootsAt>2000){
      const roots=[document],seen=new Set(roots);
      for(let i=0;i<roots.length&&i<20;i++)for(const el of roots[i].querySelectorAll('*')){
        let child=el.shadowRoot;try{if(el.tagName==='IFRAME'&&el.contentDocument?.location?.origin===location.origin)child=el.contentDocument;}catch{}
        if(child&&!seen.has(child)){seen.add(child);roots.push(child);}
      }
      cachedRoots=roots;rootsAt=Date.now();
    }
    return [...new Set(cachedRoots.flatMap(root=>[...root.querySelectorAll(selector)]))];
  }
  const ASSISTANT='[data-message-author-role="assistant"],[data-message-role="assistant"],[data-author="assistant"],[data-role="assistant"],[data-turn="assistant"],[data-turn-role="assistant"],[data-content-search-unit-key$=":assistant"],[data-chatgpt-search-unit-key$=":assistant"],[data-conversation-role="assistant"]';
  const USER='[data-message-author-role="user"],[data-message-role="user"],[data-author="user"],[data-role="user"],[data-turn="user"],[data-turn-role="user"],[data-content-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":user"],[data-conversation-role="user"]';
  const WRITING='[data-testid="chatgpt-writing-block"],[data-oai-writing-block-surface],[data-markdown-copy-content],[data-markdown-text-style="assistant-message"]';
  const turnRoot=el=>el.closest?.('[data-content-search-unit-key]')||el.closest?.('[data-chatgpt-search-unit-key]')||el.closest?.('[data-testid^="conversation-turn"],[data-turn-id],article')||el;
  const uniqueTurns=nodes=>[...new Set(nodes.map(turnRoot))].filter((node,_,all)=>!all.some(other=>other!==node&&other.contains(node)));
  const visible=el=>!!el?.getClientRects().length;
  function editor(){
    const candidates=queryAll('textarea,[contenteditable="true"]');
    const ranked=[];
    for(const el of candidates){
      if(!visible(el)||el.disabled||el.closest(ASSISTANT+','+USER+','+WRITING+',[data-testid*="canvas" i],[data-testid*="artifact" i]'))continue;
      let labels='',near=el;for(let i=0;near&&i<8;i++,near=near.parentElement)labels+=' '+['id','aria-label','placeholder','data-placeholder','data-testid'].map(k=>near.getAttribute(k)||'').join(' ');
      labels+=' '+[...el.querySelectorAll('[data-placeholder],[aria-label]')].slice(0,8).map(n=>n.getAttribute('data-placeholder')||n.getAttribute('aria-label')||'').join(' ');
      if(/bắt đầu viết|start writing|write a document/i.test(el.getAttribute('aria-label')||''))continue;
      const id=el.id==='prompt-textarea'||/prompt-textarea/.test(labels),named=/(?:hỏi|làm việc với|nhắn cho|trò chuyện với|ask|message|chat with)\s*chatgpt|ask anything|send a message/i.test(labels);
      const form=el.closest('form,[data-testid*="composer" i],[class*="composer" i]');
      const send=!!form?.querySelector('button[data-testid="send-button"],button[data-testid="fruitjuice-send-button"],button[aria-label="Send prompt"],button[aria-label="Gửi lời nhắc"]');
      if(!id&&!named&&!send)continue;ranked.push({el,score:(id?200:0)+(named?100:0)+(send?50:0),bottom:el.getBoundingClientRect?.().bottom||0});
    }
    ranked.sort((a,b)=>b.score-a.score||b.bottom-a.bottom);return ranked[0]?.el;
  }
  const button=(kind)=>queryAll('button').find(el=>!el.closest(WRITING+',[data-testid*="canvas" i],[data-testid*="artifact" i]')&&(kind==='stop'?!el.hidden&&!el.closest?.('[hidden],[aria-hidden="true"]'):visible(el))&&((kind==='send'&&(/^(send|gửi)(\s|$)/i.test(el.getAttribute('aria-label')||'')||['send-button','composer-submit-button','fruitjuice-send-button'].includes(el.dataset.testid)))||(kind==='stop'&&(/^(stop generating|stop streaming|dừng tạo|ngừng tạo|dừng phản hồi|stop|dừng)$/i.test(el.getAttribute('aria-label')||'')||el.dataset.testid==='stop-button'))));
  // Background tabs may report zero layout rectangles. Message discovery must not depend on visibility.
  const assistants=()=>{const nodes=queryAll(ASSISTANT).filter(el=>!el.closest(USER));return uniqueTurns(nodes.length?nodes:queryAll('main .markdown,[data-assistant-markdown-root],[data-markdown-text-style="assistant-message"]'));};
  const users=()=>uniqueTurns(queryAll(USER));
  const userText=el=>[el?.textContent||'',el?.innerText||''].join('\n');
  const compact=text=>String(text||'').replace(/\s+/g,' ').trim();
  const matchesStep=el=>!!expectedMarker&&(userText(el).includes(expectedMarker)||!!expectedPrefix&&compact(userText(el)).includes(expectedPrefix));
  const textOf=el=>{const body=el.querySelector('.markdown,[data-message-content],[data-assistant-markdown-root]')||el;return body.innerText?.trim()||body.textContent?.trim()||'';};
  const turns=()=>uniqueTurns(queryAll(ASSISTANT+','+USER+',[data-testid^="conversation-turn"],[data-turn-id]'));
  const signature=el=>compact(userText(el))+'|'+[...el.querySelectorAll('img')].map(img=>img.currentSrc||img.src).join('|');
  const turnKey=el=>el.getAttribute?.('data-content-search-unit-key')||el.getAttribute?.('data-chatgpt-search-unit-key')||el.getAttribute?.('data-message-id')||el.getAttribute?.('data-turn-id')||el.querySelector?.('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id')||'';
  const freshTurn=el=>!baselineReplies.includes(el)&&!baselineTurns.includes(el)&&!baselineSignatures.has(signature(el))&&(!turnKey(el)||!baselineTurnKeys.has(turnKey(el)));
  function readableText(root){
    const copy=(root.ownerDocument||document).createElement('div');for(const child of root.childNodes)copy.appendChild(child.cloneNode(true));
    for(const n of copy.querySelectorAll('button,svg,script,style,textarea,#prompt-textarea,[data-testid*="composer" i]'))n.remove();
    const walk=n=>{if(n.nodeType===3)return n.textContent||'';if(n.nodeType!==1)return '';if(n.tagName==='BR')return '\n';const text=[...n.childNodes].map(walk).join('');return /^(P|H[1-6]|PRE|BLOCKQUOTE|DIV|SECTION|LI)$/.test(n.tagName)?'\n'+text+'\n':text;};
    return [...copy.childNodes].map(walk).join('').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').trim();
  }
  function responseTexts(turn){
    // GPT may split a reply across sibling Markdown blocks or a Write editor.
    // Reading only the first .markdown can return an introduction instead of the JSON.
    const nodes=[...turn.querySelectorAll('pre,code,[data-markdown-copy-content],[data-testid="chatgpt-writing-block"],[data-oai-writing-block-surface],.markdown,[data-assistant-markdown-root],[data-markdown-text-style="assistant-message"]'),turn];
    return [...new Set(nodes.flatMap(node=>[node.innerText||'',node.textContent||'',readableText(node)]).map(text=>text.trim()).filter(Boolean))];
  }
  function responseJSON(turn){
    const texts=responseTexts(turn);let json='';
    for(const text of texts){json=P.findResponse(text,job.input);if(json)break;}
    responseRead={candidateLengths:texts.map(text=>text.length).slice(-12),jsonLike:texts.some(text=>/"posts"\s*:/.test(text)),valid:!!json};
    return json;
  }
  function boundPostResponse(){
    if(!job?.input?.items?.length||waitingForImage)return '';
    for(const turn of assistants().filter(freshTurn).reverse()){
      const preceding=users().filter(user=>user.getRootNode()===turn.getRootNode()&&Boolean(user.compareDocumentPosition(turn)&4)).at(-1);
      if(!preceding||!userText(preceding).includes(expectedMarker))continue;
      const card=turn.querySelector('[data-testid="chatgpt-writing-block"],[data-oai-writing-block-surface]');
      const body=card?.querySelector('[contenteditable="true"],[data-markdown-copy-content]')||card||turn;
      const text=readableText(body).replace(/^(?:Viết|Write)\s*\n+/i,'').trim();
      const json=responseJSON(turn);if(json)return json;
      if(text.length<20||/^(?:\s*```|\s*[\[{])/.test(text)||/"posts"\s*:/.test(text))continue;
      // A stable introduction is not a finished post, even if GPT has no visible Stop button.
      // Natural Write cards must contain the requested hashtags before we accept them.
      if((text.match(/#[\p{L}\p{N}_]+/gu)||[]).length<1||!card&&text.length<40)continue;
      const refs=P.sources([...body.querySelectorAll('a[href]')].map(a=>({url:a.href,title:a.textContent})));
      if(job.input.workflow===P.WORKFLOW&&!refs.length)continue;
      const item=job.input.items[0];return JSON.stringify({posts:[{key:item.key,text,topicTitle:text.split('\n')[0].slice(0,300),sources:refs}]});
    }return '';
  }
  const conversationKey=path=>path.match(/\/c\/([^/]+)/)?.[1]||path.replace(/\/$/,'')||'/';
  function checkConversation(){
    // SPA route updates can precede message rendering. A URL change alone is not a failed job.
    // Ownership is enforced by the background's tab/nonce check and each result's exact item key.
    boundConversation=conversationKey(location.pathname);
  }

  function structuredResponse(){
    if(!job?.input?.items?.length)return '';
    for(const turn of assistants().filter(freshTurn).reverse()){const found=responseJSON(turn);if(found)return found;}
    queryAll('pre,code');
    rootReadError='';
    for(const root of cachedRoots){try{
      const body=root.body||root,copy=(body.ownerDocument||document).createElement('div');
      // ShadowRoot itself is not clonable in Chromium; its ordinary child nodes are.
      for(const child of body.childNodes)copy.appendChild(child.cloneNode(true));
      for(const el of copy.querySelectorAll('script,style,textarea,#prompt-textarea,'+USER))el.remove();
      for(const el of copy.querySelectorAll('[contenteditable="true"]'))if(!el.closest(WRITING+','+ASSISTANT))el.remove();
      for(const text of [copy.textContent,readableText(copy)]){const found=P.findResponse(text,job.input);if(found)return found;}
    }catch(error){rootReadError=String(error.message||error).slice(0,300);}}return '';
  }
  function validImage(img){
    const src=img.currentSrc||img.src||'',label=(img.alt||'')+' '+(img.className||'');
    return img.naturalWidth>=256&&img.naturalHeight>=256&&P.imageURL(src)&&!/avatar|profile|rounded-full/i.test(label)&&!/avatar|\/icon/i.test(src)&&!img.closest?.(USER);
  }
  function genericReply(wantImage){
    if(wantImage){const images=queryAll('img').filter(img=>validImage(img)&&!baselineImages.has(img.currentSrc||img.src));if(images.length)return {innerText:'',textContent:'',querySelector:()=>null,querySelectorAll:selector=>selector==='img'?images:[]};return null;}
    const text=structuredResponse()||boundPostResponse();return text?{innerText:text,textContent:text,querySelector:()=>null,querySelectorAll:()=>[]}:null;
  }
  function newReply(){return assistants().filter(freshTurn).at(-1)||turns().filter(el=>freshTurn(el)&&!userText(el).includes(expectedMarker)&&!users().some(u=>el===u||el.contains(u))&&!el.matches(USER)&&!el.querySelector(USER)).at(-1)||genericReply(waitingForImage);}

  async function progress(text){if(!/đang xử lý/i.test(text))stage=text;await message('PROGRESS',{text,diagnostic:{agentVersion:'2.4.6',step,rootTextLengths:cachedRoots.map(root=>(root.body||root).textContent?.length||0),structure:queryAll('main,article,section,[data-testid],[role],iframe').slice(-25).map(el=>({tag:el.tagName,role:el.getAttribute('role'),testId:el.getAttribute('data-testid')})),structuredResponseFound:!!structuredResponse(),rootReadError,responseRead,imageHosts:[...new Set(queryAll('img').filter(img=>img.naturalWidth>=256).map(img=>{try{return new URL(img.currentSrc||img.src).hostname;}catch{return 'invalid';}}))],capturedAt:Date.now(),roots:cachedRoots.length,rawRoleNodes:queryAll(ASSISTANT+','+USER).length,markdownNodes:queryAll('.markdown,[data-assistant-markdown-root],[data-markdown-text-style="assistant-message"],[data-testid="chatgpt-writing-block"]').length,turnNodes:turns().length,imageNodes:queryAll('img').filter(img=>img.naturalWidth>=256).length,documentState:document.readyState,users:users().length,replies:assistants().length,editorEmpty:!editorText(editor()||{}),generationVisible:!!button('stop')}});lastPing=Date.now();}
  async function ping(){if(Date.now()-lastPing>20000)await progress(stage?stage+' ChatGPT đang xử lý…':'Đang chờ ChatGPT hoàn tất…');}
  async function waitEditor(){
    let explained=false;
    while(true){await ping();const el=editor();const login=queryAll('button').some(x=>visible(x)&&/^(đăng nhập|log in|sign in)$/i.test(x.innerText.trim()));if(el&&!el.disabled&&!login)return el;if(!explained){await progress('Nếu ChatGPT yêu cầu, hãy đăng nhập và hoàn tất kiểm tra trong tab này.');explained=true;}await sleep(1000);}
  }
  const editorText=el=>(el.value||el.innerText||'').trim();
  const ownDraft=text=>/Bạn là trợ lý soạn nội dung Fanpage|Hãy TẠO MỘT ẢNH/.test(text)&&/\[Meta Assistant: ai-[a-zA-Z0-9_-]+(?::step-\d+)?;[^\]]*\]/.test(text);
  async function prepareEditor(){
    let emptySince=0,notice=false;
    while(true){await ping();const el=await waitEditor(),text=editorText(el);
      if(text){emptySince=0;
        if(ownDraft(text)){
          const key='recoveredMetaAssistantPrompts',previous=(await chrome.storage.local.get(key))[key]||[];
          await chrome.storage.local.set({[key]:[...previous,{text,at:Date.now(),jobId:job.id}].slice(-5)});
          el.focus();
          if(el.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'');}
          else{const range=(el.ownerDocument||document).createRange();range.selectNodeContents(el);const selection=(el.ownerDocument?.defaultView||window).getSelection();selection.removeAllRanges();selection.addRange(range);(el.ownerDocument||document).execCommand('delete',false);}
          el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));
          if(editorText(el))throw Error('Đã sao lưu prompt cũ nhưng chưa dọn được ô soạn. Xoá prompt cũ ở tab ChatGPT để tiếp tục lượt mới.');
          await progress('Đã sao lưu và dọn prompt Meta Assistant cũ. Đang chuẩn bị gửi từng bài…');
        }else if(!notice){await progress('Ô ChatGPT có nội dung bạn đang soạn. Hãy gửi hoặc cất nội dung đó; tiện ích đang chờ ô trống và sẽ tự tiếp tục.');notice=true;}
      }else{if(!emptySince)emptySince=Date.now();if(Date.now()-emptySince>=1500)return el;}
      await sleep(500);
    }
  }
  async function send(prompt,wantImage=false){
    waitingForImage=wantImage;
    responseRead={};
    checkConversation();const el=await prepareEditor();
    expectedMarker=job.id+':step-'+(++step);
    expectedPrefix=compact(prompt).slice(0,160);submittedUser=null;
    const previousUser=users().at(-1);
    prompt = '[Meta Assistant: '+expectedMarker+'; mã nhận diện, không đưa vào bài viết hoặc ảnh.]\nMETA_AUTOMATION_REQUEST: '+expectedMarker+'\n'+prompt;
    baselineUsers=users();baselineReplies=assistants();baselineTurns=turns();baselineSignatures=new Set([...baselineReplies,...baselineTurns].map(signature));
    baselineTurnKeys=new Set([...baselineReplies,...baselineTurns].map(turnKey).filter(Boolean));
    baselineImages=new Set(queryAll('img').map(img=>img.currentSrc||img.src));
    const count=baselineReplies.length;
    el.focus();
    if(el.tagName==='TEXTAREA'){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(el,prompt);el.dispatchEvent(new Event('input',{bubbles:true}));}
    else{(el.ownerDocument||document).execCommand('insertText',false,prompt);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:prompt}));}
    if(!(el.value||el.innerText||'').includes(expectedMarker))throw Error('Chưa điền được prompt vào ô soạn ChatGPT. Không gửi yêu cầu rỗng.');
    const end=Date.now()+10000;let sendButton;
    while(Date.now()<end){sendButton=button('send');if(sendButton&&!sendButton.disabled)break;await sleep(300);}
    if(!sendButton||sendButton.disabled)throw Error('Không tìm thấy nút Gửi của ChatGPT. Yêu cầu đang được giữ trong ô soạn.');
    sendButton.click();
    // A click is not proof of submission: wait for this exact step to appear as a user turn.
    let explained=false;
    while(true){await ping();checkConversation();const user=users().at(-1);if(user&&(userText(user).includes(expectedMarker)||(user!==previousUser&&compact(userText(user)).includes(expectedPrefix)))){submittedUser=user;await progress('ChatGPT đã nhận yêu cầu. Đang chờ kết quả…');return count;}
      if(editor()&&!editorText(editor())){submittedUser=user||null;await progress('Đã xác nhận ChatGPT đang trả lời. Đang chờ kết quả…');return count;}
      if(!explained){await progress('Đang xác nhận ChatGPT đã nhận yêu cầu. Nếu prompt vẫn trong ô soạn, bấm Gửi tại tab ChatGPT; tiện ích sẽ tự tiếp tục.');explained=true;}
      await sleep(500);
    } // Never click Send again automatically for this step.
  }
  function responseAfterUser(before){
    const user=users().at(-1);if(!user||!matchesStep(user))return newReply()||null;
    // Generated-image cards may be siblings of the assistant message, inside the turn article.
    const currentTurns=turns();
    const index=currentTurns.findIndex(turn=>turn.contains(user));
    if(index>=0){const following=currentTurns.slice(index+1).filter(turn=>!turn.contains(user)&&freshTurn(turn));if(following.length)return following.at(-1);}
    return newReply()||null;
  }
  async function waitAnswer(before,wantImage=false){
    let previous='',stableSince=0,waitingNotice=false;
    while(true){await ping();checkConversation();const user=users().at(-1);if(user&&submittedUser&&user!==submittedUser&&!baselineUsers.includes(user)&&!matchesStep(user))throw Error('Có tin nhắn khác trong tab ChatGPT. Đã dừng để không lấy nhầm kết quả.');const last=genericReply(wantImage)||responseAfterUser(before);
      if(last){if(!wantImage&&assistants().filter(freshTurn).some(turn=>responseTexts(turn).some(P.sourceIssue)))throw Error('GPT không đọc được nguồn Reddit. Mở công cụ tìm kiếm web trong ChatGPT rồi tạo lượt mới; chưa lưu bài thiếu nguồn.');const raw=textOf(last),text=wantImage?raw:P.findResponse(raw,job.input)||boundPostResponse();const imgs=[...last.querySelectorAll('img')].filter(validImage);const value=text+'|'+imgs.map(i=>i.currentSrc||i.src).join('|');
        if(value!==previous){previous=value;stableSince=Date.now();}
        if(!button('stop')&&Date.now()-stableSince>6000&&(wantImage?imgs.length:text.length))return {text,images:imgs.map(i=>i.currentSrc||i.src)};
        if(!wantImage&&!text&&!waitingNotice){await progress('GPT đã bắt đầu trả lời. Đang chờ bài đầy đủ, đúng Page; chưa gửi lại lệnh và không giới hạn thời gian chờ.');waitingNotice=true;}
      }await sleep(1000);
    }
  }
  async function imageData(url){
    if(!P.imageURL(url))throw Error('Đường dẫn ảnh không được phép.');
    const response=await fetch(url,{credentials:'include'});if(!response.ok)throw Error('Không tải được ảnh ChatGPT.');
    const blob=await response.blob();if(!blob.type.startsWith('image/')||blob.size>15*1024*1024)throw Error('Ảnh quá lớn hoặc sai định dạng.');
    const bitmap=await createImageBitmap(blob),scale=Math.min(1,1350/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    // Preserve the original aspect ratio and resolution and use the best JPEG quality that fits the transfer budget.
    const encode=async quality=>{const blob=await canvas.convertToBlob({type:'image/jpeg',quality});return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});};
    for(let size=0;size<5;size++){
      for(const quality of [.94,.9,.86,.82,.78,.74]){const data=await encode(quality);if(data.length<=600000)return data;}
      const copy=new OffscreenCanvas(canvas.width,canvas.height);copy.getContext('2d').drawImage(canvas,0,0);
      canvas.width=Math.max(1,Math.round(canvas.width*.85));canvas.height=Math.max(1,Math.round(canvas.height*.85));canvas.getContext('2d').drawImage(copy,0,0,canvas.width,canvas.height);
    }
    throw Error('Ảnh quá lớn để chuyển tự động. Tải ảnh gốc từ ChatGPT rồi chọn ảnh trên web.');
  }

  async function run(){
    if(working)return;working=true;
    try{const claimed=embeddedStart?{job:embeddedStart}:await chrome.runtime.sendMessage({type:'CLAIM',agentVersion:'2.4.6'});embeddedStart=null;if(!claimed?.job)return;job=claimed.job;
      if(embeddedFrame){await message('FRAME_CLAIM');window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_CLAIMED',jobId:job.id},EXTENSION_ORIGIN);}
      await waitEditor();
      if(job.status==='running'||sessionStorage.getItem('meta-ai-job:'+job.id))throw Error('Tab ChatGPT đã được tải lại. Giữ các kết quả đã có và tạo lượt mới để tránh gửi lặp.');
      if(!embeddedFrame&&(assistants().length||users().length))throw Error('Tab ChatGPT không phải cuộc trò chuyện mới. Đã dừng để giữ riêng các cuộc trò chuyện của bạn.');
      await message('START');
      sessionStorage.setItem('meta-ai-job:'+job.id,'started');
      while(job.input){
        const i=job.index||0,total=job.total;const item=job.input.items[0];
        await progress(`Đang soạn nội dung bài ${i+1}/${total} · ${item.pageName}…`);
        const before=await send(P.prompt({...job.input,items:[item]}));
        const answer=await waitAnswer(before);
        const result=await message('TEXT_RESULT',{key:item.key,text:answer.text});
        const post=result.posts.find(p=>p.key===item.key);
        await progress(`Đã lưu nội dung bài ${i+1}/${total} · ${item.pageName}.`);
        if(job.input.images){
          await progress(`Đang tạo ảnh ${i+1}/${total} · ${item.pageName}…`);
          try{const count=await send(P.imagePrompt(post,job.input.settings),true);const generated=await waitAnswer(count,true);await progress(`Đã nhận ảnh ${i+1}/${total}. Đang tải ảnh về bản nháp…`);const data=await imageData(generated.images[0]);await progress(`Đang chuyển bài và ảnh ${i+1}/${total} về trang duyệt…`);await message('IMAGE_RESULT',{key:post.key,data});}
          catch(e){await message('IMAGE_RESULT',{key:post.key,error:e.message});throw e;}
        }
        await message('COMMIT_POST',{key:item.key});
        await progress(`Đang lưu bài ${i+1}/${total} · ${item.pageName}…`);
        let next;
        do{next=await message('NEXT_ITEM',{key:item.key});if(next.waiting){await ping();await sleep(2000);}}while(next.waiting);
        await progress(`Đã lưu bài ${i+1}/${total} · ${item.pageName}.`);
        job.input=next.input;job.index=next.index;job.total=next.total;
      }
      await message('DONE');
    }catch(e){if(embeddedFrame&&job)window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_ERROR',jobId:job.id,error:e.message},EXTENSION_ORIGIN);if(job)await message('FAILED',{error:e.message}).catch(()=>{});}
    finally{working=false;}
  }
  if(embeddedFrame){
    const announce=()=>window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_READY',version:'2.4.6',loadKey:FRAME_LOAD_KEY},EXTENSION_ORIGIN);
    window.addEventListener('message',event=>{
      const m=event.data,ownAncestor=location.ancestorOrigins?.[0]===EXTENSION_ORIGIN;
      const parentSource=event.source===window.parent||(event.source===null&&event.origin===EXTENSION_ORIGIN&&ownAncestor);
      const parentOrigin=event.origin===EXTENSION_ORIGIN||(event.origin==='null'&&event.source===window.parent&&ownAncestor);
      if(!parentSource||!parentOrigin||m?.source!=='META_STUDIO_PANEL')return;
      if(m.type==='FRAME_INSPECT'){window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_DIAGNOSTIC',version:'2.4.6',loadKey:FRAME_LOAD_KEY,hasJob:!!job,jobId:job?.id||'',working,step,responseRead,users:users().length,replies:assistants().length,images:queryAll('img').filter(validImage).length,composerFound:!!editor(),documentState:document.readyState},EXTENSION_ORIGIN);return;}
      if(m.type==='FRAME_CANCEL'&&job&&m.jobId===job.id){button('stop')?.click();return;}
      if(m.type==='FRAME_THEME'&&['light','dark'].includes(m.theme)){embeddedTheme=m.theme;applyEmbeddedTheme();return;}
      if(m.type!=='FRAME_RUN')return;
      if(job||working){if(job?.id===m.job?.id)window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_RUN_ACK',jobId:job.id},EXTENSION_ORIGIN);return;}
      if(!m.job?.id||!m.job?.nonce||m.job?.input?.items?.length!==1)return;
      window.parent.postMessage({source:'META_STUDIO_GPT_FRAME',type:'FRAME_RUN_ACK',jobId:m.job.id},EXTENSION_ORIGIN);embeddedStart=m.job;run();
    });
    const watchTheme=()=>{applyEmbeddedTheme();if(document.documentElement&&typeof MutationObserver!=='undefined'){const observer=new MutationObserver(applyEmbeddedTheme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});}};
    document.addEventListener('DOMContentLoaded',watchTheme,{once:true});if(document.readyState!=='loading')watchTheme();
    announce();const readyTimer=setInterval(()=>{if(job)clearInterval(readyTimer);else announce();},1500);
  }else{
    run();let attempts=0;const timer=setInterval(()=>{if(!job&&!working&&attempts++<20)run();if(job||attempts>=20)clearInterval(timer);},1500);
  }
})();
