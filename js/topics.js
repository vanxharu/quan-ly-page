/* Cùng một cặp lệnh cho mọi Page; không dùng mẫu cũ theo ngày. */
(() => {
  const P=MetaAIProtocol;
  const common=()=>({id:P.WORKFLOW,title:'Marketing từ Reddit',dayLabel:'Mỗi lần tạo',postPrompt:P.POST_PROMPT,imagePrompt:P.IMAGE_PROMPT});
  App.topics={async load(){return {topics:[common()],profile:{},inherited:true};},open(){App.show('topics');}};
  App.tab('topics',{
    mount(el){
      el.append(h('div',{className:'card ai-first-hero'},
        h('div',{},h('span',{className:'ai-first-eyebrow',textContent:'DÙNG CHUNG CHO MỌI PAGE'}),h('h3',{textContent:'Từ ý tưởng Reddit đến bài Fanpage'}),h('p',{textContent:'Chọn Page và số bài trong Studio AI. GPT tự tìm nguồn marketing trên Reddit, viết bài mới và tạo ảnh cho từng bài.'}),h('div',{className:'ai-first-steps'},h('span',{},'1 · Tìm ý trên Reddit'),h('span',{},'2 · Viết bài & tạo ảnh'),h('span',{},'3 · Xem nháp & duyệt'))),
        h('button',{type:'button',className:'btn btn-primary','data-ai-sidepanel':'1',textContent:'✦ Mở Studio AI',onclick:e=>App.ai.open({trigger:e.currentTarget})})),
        h('div',{className:'grid2'},
          h('div',{className:'card'},h('h3',{className:'card-title',textContent:'Lệnh viết bài'}),h('p',{textContent:P.POST_PROMPT})),
          h('div',{className:'card'},h('h3',{className:'card-title',textContent:'Lệnh tạo ảnh'}),h('p',{textContent:P.IMAGE_PROMPT}),h('p',{className:'hint',textContent:'Ảnh ngang 5:4 · Chữ dưới 25% · Tuân thủ chính sách Facebook'}))),
        h('div',{className:'card'},h('h3',{className:'card-title',textContent:'Ý tưởng mới, giữ đúng Page'}),h('p',{textContent:'Tiện ích nhớ tối đa 8 bài gần đây của mỗi Page để GPT chọn chủ đề khác. Bài hoàn chỉnh và ảnh được lưu trước khi tạo bài tiếp. Nguồn Reddit nằm riêng trong bản nháp để bạn kiểm tra.'}),h('p',{className:'hint',textContent:'Cần ChatGPT có quyền tìm kiếm web và đọc Reddit. Nếu không truy cập được nguồn, tiện ích sẽ báo rõ để bạn kiểm tra trong ChatGPT.'})));
    },refresh(){}
  });
})();
