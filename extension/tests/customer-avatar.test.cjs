const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(__dirname+'/../../js/core.js','utf8');const section=source.slice(source.indexOf('const PIC_TTL'),source.indexOf('// Dòng Page nhỏ'));
const values={},requests=[];let phase=0;
const App={GRAPH:'https://graph.facebook.com/v23.0'},DB={get:async(k,f)=>structuredClone(values[k]||f),set:async(k,v)=>{values[k]=structuredClone(v)}};
let active=0,maxActive=0,releasePicture,holdPicture=false;
const api=async(path,p,method,token)=>{
  requests.push({path,p,method,token});
  if(method==='GET'){
    active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setImmediate(r));active--;
    const link=new URL(path,App.GRAPH+'/');if(!link.pathname.endsWith('/picture'))return {};const id=link.pathname.split('/').at(-2);if(holdPicture&&id==='102')await new Promise(r=>releasePicture=r);assert.equal(link.searchParams.get('redirect'),'false');assert.equal(link.searchParams.get('access_token'),null,'caller URL never includes token');
    if(id==='7')throw Error('picture link unavailable');
    return {data:{is_silhouette:id==='2',url:id==='1'?'https://cdn.example/'+token+phase+'.jpg':id==='3'?'https://cdn.example/fallback.jpg':id==='4'?'https://cdn.example/avatar?access_token=secret':Number(id)>=100?'https://cdn.example/'+id+'.jpg':''}};
  }
  return p.batch.map(b=>({code:200,body:JSON.stringify({profile_pic:b.relative_url.startsWith('7?')?'https://cdn.example/profile.jpg':''})}));
};
const pool=async(items,n,fn)=>{let index=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(index<items.length){const i=index++;await fn(items[i],i);}}));};
vm.runInNewContext(section,{App,DB,api,pool,URL,console,Date,Set,Map,Promise});
(async()=>{const a={id:'10',access_token:'pageA'},b={id:'20',access_token:'pageB'};
const first=await App.customerPics(a,['1','2','3','4','7']);assert.equal(first.get('1'),'https://cdn.example/pageA0.jpg');assert.equal(first.get('3'),'https://cdn.example/fallback.jpg');assert.equal(first.get('2'),'','silhouette is not a customer avatar');assert.ok(!JSON.stringify(values).includes('secret'),'token-bearing image URLs rejected');
assert.equal(first.get('7'),'https://cdn.example/profile.jpg','profile fallback survives direct link failure');assert.equal(requests[0].method,'GET');assert.ok(requests[0].path.startsWith(App.GRAPH+'/1/picture?'));assert.equal(App.customerAvatarLink('invalid/id'),'');
const n=requests.length;await App.customerPics(a,['1','2']);assert.equal(requests.length,n,'positive and negative caches respected');await App.customerPics(b,['1']);assert.equal(requests.at(-1).token,'pageB','same ID on another Page fetched separately');phase=1;assert.equal((await App.customerPics(a,['1'],{force:true})).get('1'),'https://cdn.example/pageA1.jpg');
await Promise.all([App.customerPics(a,['5'],{force:true}),App.customerPics(b,['6'],{force:true})]);assert.ok(values.avatarCacheV6['10:5']&&values.avatarCacheV6['20:6'],'parallel Page cache updates retained');
await App.customerPics(a,Array.from({length:10},(_,i)=>String(100+i)));assert.ok(maxActive<=4,'at most four direct picture requests per Page');
holdPicture=true;const arrived=[];const progressive=App.customerPics(a,['101','102'],{force:true,onResult:(id,url)=>arrived.push(id)});while(!releasePicture)await new Promise(r=>setImmediate(r));assert.ok(arrived.includes('101'));assert.ok(!arrived.includes('102'),'first avatar arrives while another request is still pending');releasePicture();await progressive;holdPicture=false;
const inputPart=source.slice(source.indexOf('App.pageSearchField ='),source.indexOf('let pickerQuery'));
const h=(_,props)=>({...props,setAttribute(k,v){this[k]=v}});vm.runInNewContext(inputPart,{App,h});let searches=0;const field=App.pageSearchField({oninput:()=>searches++});assert.equal(field.autocomplete,'off');assert.equal(field.readOnly,true);field.value='autofilled@example.com';field.oninput({target:field});assert.equal(field.value,'');assert.equal(searches,0);field.onkeydown({key:'m'});field.value='Mộc';field.oninput({target:field});assert.equal(searches,1,'real keyboard input enabled');
console.log('PASS: direct avatar links first, authenticated per Page, profile fallback on link failure, bounded concurrency; silhouettes and token URLs rejected; Page-scoped cache, forced refresh, concurrent writes; Page search blocks autofill and accepts user input.');})().catch(e=>{console.error(e);process.exitCode=1});
