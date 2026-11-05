/* Thư viện chủ đề riêng từng Page, kế thừa mẫu chung khi chưa tuỳ chỉnh. */
(() => {
  const LIB='marketingTopicLibraryV1', PAGE_LIB='marketingPageTopicsV1', PROFILES='fanpageProfilesV1';
  const FIELDS=[['title','Chủ đề'],['time','Giờ gợi ý'],['style','Phong cách'],['direction','Định hướng'],['postPrompt','Yêu cầu soạn bài'],['imagePrompt','Yêu cầu tạo ảnh']];
  let scope=null,revision=0;
  async function load(pageId='') {
    const [shared,perPage,profiles]=await Promise.all([DB.get(LIB,[]),DB.get(PAGE_LIB,{}),DB.get(PROFILES,{})]);
    const base=Array.isArray(shared)&&shared.length?shared:Pure.DEFAULT_TOPICS;
    const own=pageId&&Array.isArray(perPage[pageId])&&perPage[pageId].length?perPage[pageId]:null;
    const profileKey=Object.keys(profiles).find(k=>k===pageId)||Object.keys(profiles).find(k=>k.split(/[^0-9]+/).includes(String(pageId)));
    return {topics:(own||base).map(t=>({...t})),profile:profiles[profileKey]||{},inherited:!!pageId&&!own};
  }
  async function save(pageId,list){
    if(pageId){const all=await DB.get(PAGE_LIB,{});all[pageId]=list;await DB.set(PAGE_LIB,all);}
    else await DB.set(LIB,list);App.ai?.syncCatalog();
  }
  App.topics={load,save,open(pageId){scope=String(pageId||'');App.show('topics');}};
  App.tab('topics',{
    mount(el){el.append(h('div',{className:'card'},h('div',{className:'row'},
      h('label',{className:'field grow'},'Chọn Page để chỉnh chủ đề',h('select',{id:'tpScope',onchange:e=>{scope=e.target.value;this.refresh();}})),
      h('button',{type:'button',className:'btn btn-primary','data-ai-sidepanel':'1',textContent:'Mở Studio AI',onclick:e=>{if(!scope)return toast('Chọn một Page trước khi tạo bài.');App.ai.open({mode:'planner',pageIds:[scope],trigger:e.currentTarget});}})),
      h('p',{id:'tpScopeHint',className:'hint'})),h('div',{className:'card',id:'tpProfile'}),
      h('div',{className:'card-head section-gap'},h('h3',{id:'tpListTitle',className:'card-title'}),
        h('button',{className:'btn btn-ghost btn-sm',textContent:'Khôi phục mẫu',onclick:async()=>{const pageId=scope;if(!confirm(pageId?'Bỏ tuỳ chỉnh của Page này và dùng mẫu chung?':'Khôi phục mẫu chung mặc định?'))return;if(pageId){const all=await DB.get(PAGE_LIB,{});delete all[pageId];await DB.set(PAGE_LIB,all);}else await DB.del(LIB);this.refresh();}})),
      h('div',{className:'tpl-cards',id:'tpList'}));},
    async refresh(){
      const version=++revision;
      if(scope===null||(scope&&!App.pageById(scope)))scope=App.selected()[0]?.id||App.pages[0]?.id||'';
      const pageId=scope,page=App.pageById(pageId),data=await load(pageId);if(version!==revision)return;
      $('tpScope').replaceChildren(h('option',{value:'',textContent:'Mẫu chung cho các Page chưa tuỳ chỉnh',selected:!pageId}),...App.pages.map(p=>h('option',{value:p.id,textContent:p.name,selected:p.id===pageId})));
      $('tpScopeHint').textContent=page?(data.inherited?'Page đang dùng mẫu chung. Bấm Lưu trên chủ đề để tạo bản riêng cho Page này.':'Chủ đề này chỉ áp dụng cho '+page.name+'.')+' AI dùng cả hồ sơ Page, nội dung và yêu cầu ảnh bên dưới.':'Mẫu dự phòng cho các Page chưa có chủ đề riêng. Chọn từng Page để tuỳ chỉnh ngành hàng và hình ảnh.';
      $('tpListTitle').textContent='Chủ đề 7 ngày · '+(page?.name||'Mẫu chung');
      const today=new Date().getDay();
      $('tpList').replaceChildren(...data.topics.map((t,index)=>{
        const form=h('form',{className:'tpl-card',style:Number(t.day)===today?'border-color:var(--primary)':''});
        const persist=async()=>{const all=(await load(pageId)).topics;const f=new FormData(form);all[index]={...t,...Object.fromEntries(FIELDS.map(([key])=>[key,String(f.get(key)||'')]))};await save(pageId,all);return all[index];};
        form.onsubmit=async e=>{e.preventDefault();try{await persist();toast('Đã lưu chủ đề cho '+(page?.name||'mẫu chung')+'.');}catch(e){toast('Chưa lưu được: '+e.message);}};
        form.append(h('div',{className:'row'},h('strong',{className:'grow',textContent:t.dayLabel}),Number(t.day)===today?h('span',{className:'tag tone-green',textContent:'Hôm nay'}):null),
          ...FIELDS.map(([key,label])=>h('label',{className:'field'},label,['postPrompt','direction','imagePrompt'].includes(key)?h('textarea',{name:key,value:t[key]||'',style:'min-height:70px'}):h('input',{type:'text',name:key,value:t[key]||''}))),
          h('p',{className:'hint',textContent:'Ảnh dọc 4:5 cho điện thoại, tiêu đề ngắn và Liên hệ: 0899779488; tổng chữ dưới 25% diện tích, nội dung phù hợp chính sách Facebook.'}),
          h('div',{className:'actions'},h('button',{className:'btn btn-ghost btn-sm',textContent:'Lưu chủ đề'}),h('button',{type:'button',className:'btn btn-soft btn-sm','data-ai-sidepanel':'1',textContent:'Tạo trong Studio AI',onclick:async e=>{if(!page)return toast('Chọn một Page ở trên trước.');const trigger=e.currentTarget;try{await persist();await App.ai.open({mode:'planner',pageIds:[pageId],topicDay:Number(t.day),trigger});}catch(e){toast(e.message);}}})));return form;
      }));
      if(!page){$('tpProfile').hidden=true;return;}$('tpProfile').hidden=false;
      const p=data.profile;
      const form=h('form',{className:'form-grid',onsubmit:async e=>{e.preventDefault();const f=new FormData(e.target),all=await DB.get(PROFILES,{});all[pageId]={...p,niche:String(f.get('niche')||''),audience:String(f.get('audience')||''),voice:String(f.get('voice')||''),updatedAt:Date.now()};await DB.set(PROFILES,all);App.ai?.syncCatalog();toast('Đã lưu hồ sơ '+page.name+'.');}});
      form.append(...[['niche','Ngành / sản phẩm'],['audience','Khách hàng'],['voice','Giọng văn']].map(([key,label])=>h('label',{className:'field'},label,h('textarea',{name:key,value:p[key]||'',rows:2}))),h('div',{className:'field wide'},h('button',{className:'btn btn-primary btn-sm',textContent:'Lưu hồ sơ Page'})));
      $('tpProfile').replaceChildren(h('div',{className:'card-head'},h('h3',{className:'card-title',textContent:'Hồ sơ · '+page.name})),form);
    }
  });
})();
