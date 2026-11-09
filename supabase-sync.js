/* Public browser configuration. Authorization is enforced by Supabase Auth + RLS. */
const SHIORI_URL='https://xwecdsedobpludaacebv.supabase.co';
const SHIORI_PUBLIC_KEY='sb_publishable_dlwVIYGE3CB98-eqkqNKpA_7FrcVqYH';
let syncClient=null,activeUser=null,authGeneration=0,authAction=false;
const localSnapshot=()=>{try{return {format:'shiori-backup',version:1,events:JSON.parse(localStorage.getItem('shiori-events')||'[]'),templates:JSON.parse(localStorage.getItem('shiori-templates')||'[]')}}catch{return {format:'shiori-backup',version:1,events:[],templates:[]}}};
function authMessage(message){$('authMessage').textContent=message}
function syncUi(){
 $('authButton').textContent=activeUser?'アカウント':'ログインして同期';
 $('accountEmail').textContent=activeUser?.email||'';
 $('authFields').hidden=!!activeUser;$('accountActions').hidden=!activeUser;
 $('importLocal').disabled=!synced||busy;
 $('logout').disabled=busy;$('reloadSync').disabled=busy;
}
function safeError(error){
 if(error?.code==='40001'||error?.message?.includes('shiori_conflict'))return '別の端末で予定が更新されています。入力内容を控えて編集画面を閉じ、最新の予定を読み込んでから再編集してください。';
 if(['42P01','PGRST205','PGRST202'].includes(error?.code))return '同期の初期設定が未完了です。Supabaseで設定SQLを実行してください。';
 return '同期できませんでした。通信・ログイン状態を確認して再試行してください。';
}
function acceptState(row){
 const data=row||{events:[],templates:[],revision:0};
 if(!Array.isArray(data.events)||!data.events.every(validBackupEvent)||!Array.isArray(data.templates)||!data.templates.every(validTemplate)||!Number.isSafeInteger(Number(data.revision)))throw Error('保存データの形式を確認できません');
 events=data.events;templates=data.templates;revision=Number(data.revision);synced=true;render();syncStatus('● クラウド同期済み');syncUi();
}
async function refreshCloud(){
 if(!syncClient||!activeUser||busy||$('dialog').open||document.hidden)return;
 const generation=authGeneration,user=activeUser.id;busy=true;syncUi();
 try{const {data,error}=await syncClient.from('shiori_calendars').select('events,templates,revision').eq('user_id',user).maybeSingle();if(generation!==authGeneration)return;if(error)throw error;acceptState(data)}
 catch(error){if(generation===authGeneration){synced=false;syncStatus(safeError(error));}}
 finally{if(generation===authGeneration){busy=false;syncUi()}}
}
async function commitCloud(nextEvents,nextTemplates,expectedRevision){
 if(!syncClient||!activeUser||!synced||busy){$('error').textContent='同期が完了してから保存してください。';return false}
 if(!nextEvents.every(validBackupEvent)||!nextTemplates.every(validTemplate)){toast('保存内容を確認してください');return false}
 const generation=authGeneration;busy=true;$('save').disabled=true;$('delete').disabled=true;syncStatus('クラウドに保存中…');syncUi();
 try{
  const {data,error}=await syncClient.rpc('shiori_save',{p_revision:expectedRevision,p_events:nextEvents,p_templates:nextTemplates});
  if(generation!==authGeneration)return false;if(error)throw error;
  if(!data?.[0])throw Error('empty_response');acceptState(data[0]);editRevision=revision;return true;
 }catch(error){if(generation===authGeneration){const message=safeError(error);$('error').textContent=message;authMessage(message);syncStatus('未保存・再確認が必要');toast(message)}return false}
 finally{if(generation===authGeneration){busy=false;$('save').disabled=false;$('delete').disabled=false;syncUi()}}
}
async function saveCloud(next){return commitCloud(next,templates,editRevision)}
async function saveTemplates(next){
 if(cloud){const ok=await commitCloud(events,next,editRevision);if(ok)paintTemplates();return ok}
 try{localStorage.setItem('shiori-templates',JSON.stringify(next));templates=next;paintTemplates();return true}catch{$('error').textContent='テンプレートを保存できませんでした';return false}
}
async function switchAccount(session){
 const user=session?.user||null;if(user?.id===activeUser?.id)return;
 authGeneration++;busy=false;synced=false;activeUser=user;cloud=!!user;revision=0;editRevision=0;
 if($('dialog').open)$('dialog').close();
 if(user){events=[];templates=[];render();syncStatus('クラウドに接続中…');syncUi();await refreshCloud()}
 else{const local=localSnapshot();events=local.events.filter(validBackupEvent);templates=local.templates.filter(validTemplate);render();syncStatus('この端末のみ保存・同期なし');syncUi()}
}
$('authButton').onclick=()=>{authMessage('');syncUi();$('authDialog').showModal()};
$('closeAuth').onclick=()=>$('authDialog').close();
$('authForm').onsubmit=async e=>{
 e.preventDefault();if(authAction)return;if(!syncClient){authMessage('同期機能を読み込めません。ネット接続を確認してページを再読み込みしてください。');return}
 authAction=true;$('login').disabled=true;authMessage('ログイン中…');
 try{const {data,error}=await syncClient.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});if(error){authMessage('ログインできません。メールアドレス・パスワードとユーザー登録を確認してください。');return}$('authPassword').value='';await switchAccount(data.session);authMessage('ログインしました。初回は「この端末の予定を取り込む」で移行できます。')}
 catch{authMessage('通信できませんでした。再試行してください。')}
 finally{authAction=false;$('login').disabled=false}
};
$('logout').onclick=async()=>{if(busy)return;const {error}=await syncClient.auth.signOut({scope:'local'});if(error){authMessage('ログアウトできませんでした。再試行してください。');return}await switchAccount(null);$('authDialog').close()};
$('reloadSync').onclick=async()=>{authMessage('');await refreshCloud()};
$('importLocal').onclick=async()=>{
 if(busy||!synced)return;
 try{const merged=mergeBackup(localSnapshot());if(!merged.eventCount&&!merged.templateCount){authMessage('この端末に未移行の予定・テンプレートはありません');return}
 if(!confirm(`この端末の予定${merged.eventCount}件とテンプレート${merged.templateCount}件を、ログイン中のアカウントへ追加しますか？`))return;
 if(await commitCloud(merged.events,merged.templates,revision)){authMessage('取り込みました。元の端末内データは残しています。');toast('クラウドに取り込みました')}}catch(e){authMessage(e.message)}
};
$('backupFile').onchange=async()=>{
 const file=$('backupFile').files?.[0];if(!file)return;
 try{if(file.size>5_000_000)throw Error('5MB以下のバックアップを選んでください');if(busy||cloud&&!synced)throw Error('同期が完了してから復元してください');const merged=mergeBackup(JSON.parse(await file.text()));if(!merged.eventCount&&!merged.templateCount){toast('すべて登録済みです');return}if(!confirm(`予定${merged.eventCount}件・テンプレート${merged.templateCount}件を${cloud?'ログイン中のアカウント':'この端末'}に追加しますか？現在の予定は残ります。`))return;
 if(cloud){if(await commitCloud(merged.events,merged.templates,revision))toast('バックアップを復元しました');return}
 const oldT=localStorage.getItem('shiori-templates');try{localStorage.setItem('shiori-templates',JSON.stringify(merged.templates));localStorage.setItem('shiori-events',JSON.stringify(merged.events))}catch(e){if(oldT===null)localStorage.removeItem('shiori-templates');else localStorage.setItem('shiori-templates',oldT);throw e}events=merged.events;templates=merged.templates;render();toast('バックアップを復元しました');
 }catch(e){toast(e.message||'復元できませんでした')}
};
// Never start a second edit or close a form while its server write is in flight.
document.addEventListener('click',e=>{if(busy&&e.target.closest('button')&&!['authButton'].includes(e.target.closest('button').id)){e.preventDefault();e.stopImmediatePropagation()}},true);
$('dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
if(window.supabase){
 syncClient=window.supabase.createClient(SHIORI_URL,SHIORI_PUBLIC_KEY,{auth:{storageKey:'shiori-supabase-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15000)})}});
 syncClient.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>switchAccount(session),0)});
 const initialGeneration=authGeneration;
 syncClient.auth.getSession().then(({data,error})=>{if(authGeneration!==initialGeneration)return;if(error){syncStatus('ログイン状態を確認できません');return}switchAccount(data.session)}).catch(()=>syncStatus('ログイン状態を確認できません'));
 setInterval(refreshCloud,15000);window.addEventListener('focus',refreshCloud);window.addEventListener('online',refreshCloud);document.addEventListener('visibilitychange',refreshCloud);$('dialog').addEventListener('close',refreshCloud);
}else syncStatus('この端末のみ保存・同期機能を読み込めません');
syncUi();
