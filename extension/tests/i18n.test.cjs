// Giao diện tiếng Anh: dịch nguyên câu + mẫu có số; nội dung khách không khớp bảng thì giữ nguyên; tiếng Việt thì không đổi gì.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync(__dirname+'/../../js/i18n.js','utf8');
const run=lang=>{const ctx={location:{search:'?lang='+lang,href:'http://x/?lang='+lang},localStorage:{getItem:()=>'',setItem:()=>{}},URLSearchParams,URL,document:{documentElement:{},addEventListener:()=>{}},alert(){},confirm(){},prompt(){}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(src,ctx);return ctx.I18N;};
const en=run('en');
assert.equal(en.t('Bình luận'),'Comments');assert.equal(en.t('  Gửi '),'  Send ');
assert.equal(en.t('Đã kết nối 3 Page'),'Connected to 3 Pages');assert.equal(en.t('T2 20h: 2 bài, TB 8 tương tác'),'Mon 20:00: 2 posts, avg 8 engagement');
assert.equal(en.t('Shop ơi còn hàng không'),'Shop ơi còn hàng không','customer text untouched');
const vi=run('vi');assert.equal(vi.t('Bình luận'),'Bình luận');
console.log('PASS: English UI translates labels and counted phrases, leaves customer text, Vietnamese unchanged.');
