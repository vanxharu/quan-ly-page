/* Cùng một cặp lệnh cho mọi Page; không dùng mẫu cũ theo ngày. */
(() => {
  const P=MetaAIProtocol;
  const common=()=>({id:P.WORKFLOW,title:'Marketing từ Reddit',dayLabel:'Mỗi lần tạo',postPrompt:P.POST_PROMPT,imagePrompt:P.IMAGE_PROMPT});
  App.topics={async load(){return {topics:[common()],profile:{},inherited:true};},open(){App.show('topics');}};
  // Lệnh lưu trong tiện ích Studio AI (nơi gửi lệnh sang ChatGPT); trang web chỉ đọc/ghi qua cầu nối.
  async function loadPrompts(){
    const f=$('tpPrompts');if(!f)return;
    try{const r=await App.ai.getSettings();f.postPrompt.value=r.settings.postPrompt;f.imagePrompt.value=r.settings.imagePrompt;$('tpStatus').textContent='Lệnh đang dùng trong tiện ích.';}
    catch{$('tpStatus').textContent='Chưa kết nối tiện ích Studio AI 2.5.6: đang hiện lệnh mặc định. Cập nhật tiện ích rồi tải lại trang để sửa.';}
  }
  async function savePrompts(e){
    e.preventDefault();const f=e.target;
    try{await App.ai.saveSettings({postPrompt:f.postPrompt.value,imagePrompt:f.imagePrompt.value});toast('Đã lưu lệnh vào tiện ích.');loadPrompts();}
    catch(err){toast('Không lưu được: '+err.message,6000);}
  }
  App.tab('topics',{
    mount(el){
      el.append(h('div',{className:'card ai-first-hero'},
        h('div',{},h('span',{className:'ai-first-eyebrow',textContent:'SỬA LỆNH GPT NGAY BÊN DƯỚI'}),h('h3',{textContent:'Từ ý tưởng Reddit đến bài Fanpage'}),h('p',{textContent:'Chọn Page và số bài trong Studio AI. GPT tự tìm nguồn marketing trên Reddit, viết bài mới và tạo ảnh cho từng bài.'}),h('div',{className:'ai-first-steps'},h('span',{},'1 · Tìm ý trên Reddit'),h('span',{},'2 · Viết bài & tạo ảnh'),h('span',{},'3 · Xem nháp & duyệt'))),
        h('button',{type:'button',className:'btn btn-primary','data-ai-sidepanel':'1',textContent:'✦ Mở Studio AI',onclick:e=>App.ai.open({trigger:e.currentTarget})})),
        h('form',{className:'card',id:'tpPrompts',onsubmit:savePrompts},
          h('h3',{className:'card-title',textContent:'Lệnh cho GPT (sửa được)'}),
          h('label',{className:'field'},'Lệnh viết bài',h('textarea',{name:'postPrompt',value:P.POST_PROMPT,style:'min-height:150px'})),
          h('label',{className:'field section-gap'},'Lệnh tạo ảnh',h('textarea',{name:'imagePrompt',value:P.IMAGE_PROMPT,style:'min-height:120px'})),
          h('div',{className:'row section-gap'},h('button',{className:'btn btn-primary',textContent:'Lưu lệnh'}),
            h('button',{type:'button',className:'btn btn-ghost',textContent:'Về lệnh mặc định',onclick:()=>{const f=$('tpPrompts');f.postPrompt.value=P.POST_PROMPT;f.imagePrompt.value=P.IMAGE_PROMPT;}}),
            h('span',{className:'hint',id:'tpStatus',textContent:'Đang đọc lệnh từ tiện ích…'}))),
        h('div',{className:'card'},h('h3',{className:'card-title',textContent:'Ý tưởng mới, giữ đúng Page'}),h('p',{textContent:'Tiện ích nhớ tối đa 8 bài gần đây của mỗi Page để GPT chọn chủ đề khác. Bài hoàn chỉnh và ảnh được lưu trước khi tạo bài tiếp. Nguồn Reddit nằm riêng trong bản nháp để bạn kiểm tra.'}),h('p',{className:'hint',textContent:'Cần ChatGPT có quyền tìm kiếm web và đọc Reddit. Nếu không truy cập được nguồn, tiện ích sẽ báo rõ để bạn kiểm tra trong ChatGPT.'})));
    },refresh(){loadPrompts();}
  });
})();
