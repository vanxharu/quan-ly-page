// Quét bài viết: nhận link/ID bài, nhận SĐT trong bình luận.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const App={tab(){}};vm.runInNewContext(fs.readFileSync(__dirname+'/../../js/scanner.js','utf8'),{App,Pure:{dayKeyOf:()=>''},URL,Set,String,Number,Math,Date});
const P=App.scannerParseLink,j=v=>JSON.parse(JSON.stringify(v));
assert.deepEqual(j(P('947912421959980_1082743908118146')),{full:'947912421959980_1082743908118146'});
assert.deepEqual(j(P('1082743908118146')),{post:'1082743908118146'});
assert.deepEqual(j(P('https://www.facebook.com/tangfollowgiatot.ozi/posts/1082743908118146')),{post:'1082743908118146'});
assert.deepEqual(j(P('https://www.facebook.com/permalink.php?story_fbid=123456789&id=947912421959980')),{post:'123456789',page:'947912421959980'});
assert.deepEqual(j(P('https://www.facebook.com/tangfollowgiatot.ozi/posts/pfbid02abcXYZ123')),{pfbid:'pfbid02abcXYZ123'});
assert.deepEqual(j(P('https://www.facebook.com/photo/?fbid=555666777&set=a.1')),{post:'555666777'});
assert.deepEqual(j(P('https://www.facebook.com/page/videos/998877665544')),{post:'998877665544'});
assert.deepEqual(j(P('facebook.com/page/photos/a.1/444555666/')),{post:'444555666'});
assert.equal(P('xin chào'),null);
assert.deepEqual(j(App.scannerPhones('Em lấy 2 cái, sđt 0899.779.488 hoặc +84 912 345 678, gọi 0899779488')),['0899779488','0912345678']);
assert.deepEqual(j(App.scannerPhones('giá bao nhiêu')),[]);
console.log('PASS: scanner parses post IDs and links (posts, permalink story_fbid, pfbid, photo fbid, videos, album photos) and extracts/normalises Vietnamese phone numbers from comments.');
