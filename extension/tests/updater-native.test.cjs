// Windows only; fixture paths remain inside the workspace, no installation/registry mutation.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),assert=require('assert/strict');
if(process.platform!=='win32'){console.log('SKIP: Windows native host');process.exit(0);}
const root=fs.mkdtempSync(path.join(__dirname,'../../../un-')),target=path.join(root,'extension');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({manifest_version:3,name:'Meta Assistant Native Fixture',version:'2.4.0'}));
const exe=path.join(root,'MetaAssistantUpdater.exe');fs.copyFileSync(path.join(__dirname,'../windows-updater/MetaAssistantUpdater.exe'),exe);const origin='chrome-extension://'+('a'.repeat(32))+'/';fs.writeFileSync(path.join(root,'updater-config.json'),JSON.stringify({origin,extensionPath:target}));
function send(action,from=origin){const json=Buffer.from(JSON.stringify({action})),size=Buffer.alloc(4);size.writeUInt32LE(json.length);const p=spawnSync(exe,[from],{input:Buffer.concat([size,json]),windowsHide:true,timeout:10000});assert.ifError(p.error);assert.equal(p.status,0);assert.ok(p.stdout.length>4);assert.equal(p.stdout.readUInt32LE(0),p.stdout.length-4);return JSON.parse(p.stdout.subarray(4));}
assert.equal(send('status').version,'2.4.0');assert.equal(send('status','chrome-extension://'+('b'.repeat(32))+'/').ok,false);assert.equal(send('arbitrary-command').ok,false);
console.log('PASS: compiled Windows native host framing, allowed extension origin, status, unauthorized origin and unknown action rejection.');
