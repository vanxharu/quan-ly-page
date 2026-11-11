/* Only the ChatGPT subframe initiated by this extension receives embedding headers. */
const StudioEmbed={async prepare(api=chrome){
  // App Windows (Electron) không có declarativeNetRequest: chính app đã gỡ header chặn nhúng cho khung chatgpt.com.
  if(!api.declarativeNetRequest?.updateDynamicRules)return true;
  await api.declarativeNetRequest.updateDynamicRules({removeRuleIds:[7201],addRules:[{id:7201,priority:1,action:{type:'modifyHeaders',responseHeaders:[{header:'x-frame-options',operation:'remove'},{header:'frame-options',operation:'remove'},{header:'content-security-policy',operation:'remove'}]},condition:{regexFilter:'^https://chatgpt\\.com/',initiatorDomains:[api.runtime.id],resourceTypes:['sub_frame']}}]});return true;
}};
