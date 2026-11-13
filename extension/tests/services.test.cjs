// Dịch vụ: gọi API qua app (svcApi giả, không đặt đơn thật), cập nhật trạng thái → giá gốc thật, thời gian hoàn thành, đơn tính vào Bán hàng.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const src=fs.readFileSync(__dirname+'/../../js/services.js','utf8');
global.window={};global.MetaAIProtocol={};require('../../js/lib/pure.js');const Pure=window.Pure;
const db={svcSettingsV1:{apiKey:'TEST'},shopOrdersV1:[
  {id:'a',source:'service',providerOrderId:'11',svcStatus:'Pending',status:'new',at:1,items:[{name:'Like',qty:1000,price:30,cost:20}]},
  {id:'b',source:'service',providerOrderId:'12',svcStatus:'In progress',status:'shipping',at:2,items:[{name:'Follow',qty:500,price:50,cost:40}]},
  {id:'c',source:'service',providerOrderId:'13',svcStatus:'Completed',status:'done',at:3,completedAt:5,items:[{name:'X',qty:1,price:1,cost:1}]},
  {id:'d',source:'manual',status:'new',at:4,items:[]}]};
const calls=[];
const ctx=vm.createContext({DB:{get:async(k,f)=>structuredClone(db[k]??f),set:async(k,v)=>{db[k]=structuredClone(v);}},
  App:{tab:()=>{},tabs:{},current:()=>''},Pure,setInterval:()=>{},window:{metaDesktop:{svcApi:async({url,body})=>{calls.push({url,body});
    if(body.action==='status')return{status:200,json:{11:{charge:'18000',status:'Completed',start_count:'5',remains:'0'},12:{charge:'0',status:'Canceled'}}};
    return{status:200,json:{error:'unexpected '+body.action}};}}},
  Date,JSON,Number,String,Object,Array,Math,URL,Error,Promise,structuredClone});
vm.runInContext(src,ctx);
const S=ctx.App.services;
(async()=>{
  assert.deepEqual([...S.linksIn([{text:'làm giúp https://facebook.com/p/1, cảm ơn'},{text:'và https://tiktok.com/@a/video/2.'},{text:'https://facebook.com/p/1'}])],
    ['https://tiktok.com/@a/video/2','https://facebook.com/p/1'],'links found, cleaned, newest first, no duplicates');
  assert.equal(S.mapStatus('Partial'),'done');assert.equal(S.mapStatus('Refunded'),'cancelled');assert.equal(S.mapStatus('Processing'),'shipping');assert.equal(S.mapStatus('Pending'),'new');
  const n=await S.refreshStatus();
  assert.equal(n,2);assert.equal(calls.length,1);
  assert.deepEqual({...calls[0].body},{key:'TEST',action:'status',orders:'11,12'},'only unfinished orders asked, in one call');
  assert.equal(calls[0].url,'https://smm.baostar.net/api/v2');
  const [a,b,c]=db.shopOrdersV1;
  assert.equal(a.status,'done');assert.equal(a.items[0].cost,18,'real charge replaces estimated cost');assert.ok(a.completedAt>1e12,'completion time recorded when first seen Completed');
  assert.equal(b.status,'cancelled');assert.ok(!b.completedAt);assert.equal(c.completedAt,5,'finished orders untouched');
  const sum=Pure.summarize(db.shopOrdersV1);
  assert.equal(sum.revenue,30000+1);assert.equal(sum.cost,18000+1,'sales tab counts service orders with real cost');
  calls.length=0;assert.equal(await S.refreshStatus(),0);assert.equal(calls.length,0,'nothing left to poll');
  db.svcSettingsV1.apiKey='';await assert.rejects(S.call('balance'),/API key/);
  console.log('PASS: service orders: links, status mapping, batched status poll, real cost + completion time, counted in sales.');
})().catch(e=>{console.error(e);process.exitCode=1;});
