/* Only the ChatGPT subframe initiated by this extension receives embedding headers. */
const StudioEmbed={async prepare(api=chrome){
  if(!api.declarativeNetRequest?.updateDynamicRules)throw Error('Trình duyệt chưa hỗ trợ khung GPT nhúng. Chọn dùng tab riêng.');
  await api.declarativeNetRequest.updateDynamicRules({removeRuleIds:[7201],addRules:[{id:7201,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-frame-options',operation:'remove'},{header:'frame-options',operation:'remove'},{header:'content-security-policy',operation:'remove'}]},condition:{regexFilter:'^https://chatgpt\\.com/',initiatorDomains:[api.runtime.id],resourceTypes:['sub_frame']}}]});return true;
}};
