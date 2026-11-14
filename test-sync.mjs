import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
const database=new Map();let fail=false;
function device(){
 const els={},element=()=>({value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,open:false,style:{},classList:{toggle(){}},setAttribute(){},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}});
 let user=null;const storage=new Map();
 const client={auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}}),signInWithPassword:async()=>({data:{session:{user:{id:'owner',email:'owner@example.test'}}}}),signOut:async()=>({})},from(){return {select(){return {eq(_field,id){return {maybeSingle:async()=>fail?{error:{code:'network'}}:{data:structuredClone(database.get(id)||null)}}}}}}},rpc:async(_fn,args)=>{if(fail)return {error:{code:'network'}};const old=database.get(user);if((old?.revision||0)!==args.p_revision)return {error:{code:'40001'}};const row={user_id:user,events:structuredClone(args.p_events),templates:structuredClone(args.p_templates),revision:(old?.revision||0)+1};database.set(user,row);return {data:[structuredClone(row)]}}};
 const ctx={document:{getElementById:id=>els[id]??=element(),body:{classList:{toggle(){},contains(){return false}}},addEventListener(){},hidden:false},window:{addEventListener(){},supabase:{createClient:()=>client}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},location:{protocol:'https:',reload(){}},setTimeout(){},clearTimeout(){},setInterval(){},crypto:webcrypto,confirm:()=>true,console,AbortSignal,fetch(){throw Error('unexpected network')}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],ctx);vm.runInContext(fs.readFileSync('supabase-sync.js','utf8'),ctx);
 return {ctx,els,storage,run:s=>vm.runInContext(s,ctx),async login(id='owner'){user=id;await vm.runInContext(`switchAccount({user:{id:'${id}',email:'${id}@example.test'}})`,ctx)}};
}
const a=device(),b=device();await a.login();await b.login();assert.equal(a.run('cloud'),true);
const event={id:'e1',title:'同期テスト',color:'#aa95ec',start:'2026-11-09',end:'2026-11-09',time:'16:30',finish:'23:15',joinDays:false};
a.ctx.fixture=event;assert(await a.run('commitCloud([fixture],[],revision)'));await b.run('refreshCloud()');assert.equal(b.run('events[0].title'),'同期テスト');
// A stale form cannot overwrite another device's newer write.
b.run('open()');a.ctx.fixture={...event,title:'PC更新'};assert(await a.run('commitCloud([fixture],[],revision)'));b.ctx.fixture={...event,title:'古いスマホ更新'};assert.equal(await b.run('commitCloud([fixture],[],editRevision)'),false);assert.equal(database.get('owner').events[0].title,'PC更新');assert(b.els.error.textContent.includes('別の端末'));
b.els.dialog.close();await b.run('refreshCloud()');assert.equal(b.run('events[0].title'),'PC更新');
// Templates and appointments save atomically and transfer to the other device.
b.run('open()');b.ctx.tpl={id:'t1',title:'バイト',color:'#aa95ec',time:'16:30',finish:'23:15',joinDays:false};assert(await b.run('saveTemplates([tpl])'));await a.run('refreshCloud()');assert.equal(a.run('templates.length'),1);
// Failed writes retain user data and do not claim success.
fail=true;assert.equal(await a.run('commitCloud([],[],revision)'),false);assert.equal(a.run('events.length'),1);fail=false;
assert(await a.run('commitCloud([],templates,revision)'));b.els.dialog.close();await b.run('refreshCloud()');assert.equal(b.run('events.length'),0);
// Local migration is explicit, duplicates are skipped, and originals remain.
a.storage.set('shiori-events',JSON.stringify([event]));a.storage.set('shiori-templates','[]');await a.els.importLocal.onclick();assert.equal(database.get('owner').events.length,1);assert.equal(JSON.parse(a.storage.get('shiori-events')).length,1);await a.els.importLocal.onclick();assert.equal(database.get('owner').events.length,1);
await a.run('switchAccount(null)');assert.equal(a.run('cloud'),false);assert.equal(a.run('events[0].title'),'同期テスト');await a.login('other');assert.equal(a.run('events.length'),0);assert.equal(a.run('templates.length'),0);
const sql=fs.readFileSync('supabase-setup.sql','utf8');assert(sql.includes('enable row level security'));assert(sql.includes('security invoker'));assert(sql.includes('where user_id=uid and revision=p_revision'));assert(sql.includes('from public,anon'));assert(!fs.readFileSync('supabase-sync.js','utf8').includes('sb_secret_'));
console.log('PASS: two-device load/save, stale-write conflict, templates, failed writes, deletion, explicit local migration/deduplication, logout/account isolation. SQL reviewed statically; live Supabase not configured/tested.');

