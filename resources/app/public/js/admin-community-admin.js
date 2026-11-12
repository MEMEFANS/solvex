// 后台「群聊管理」：群管理员任免、成员踢出/恢复/禁言、敏感词、软删消息、审计日志
window.AdminCommunityAdmin = (()=>{
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const short=addr=>{const s=String(addr||'');return s.length>14?`${s.slice(0,8)}…${s.slice(-4)}`:s;};
  const fmt=ts=>{const n=Number(ts||0);if(!n)return '-';const d=new Date(n);const p=v=>String(v).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;};
  const ACTION_LABEL={appoint:'任命管理员',revoke:'撤销管理员',restore:'恢复成员',kick:'踢出成员',mute:'禁言',unmute:'解除禁言',delete_message:'删除消息',word_add:'添加敏感词',word_remove:'移除敏感词',red_packet_refund:'红包过期退款'};

  let api,toast,data={admins:[],members:[],words:[],messages:[],logs:[]},busy=false,loaded=false;

  function status(message='',error=false){
    const el=$('acm-status');
    if(!el)return;
    el.textContent=message;
    el.style.color=error?'var(--admin-red)':'var(--admin-green)';
  }

  function renderAdmins(){
    const body=$('acm-admins-body');
    body.innerHTML=(data.admins||[]).map(admin=>`<tr>
      <td title="${esc(admin.address)}">${esc(short(admin.address))}</td>
      <td><span class="admin-status ${admin.status==='active'?'good':''}">${admin.status==='active'?'在任':'已撤销'}</span></td>
      <td>${esc(admin.appointedBy||'-')}<br><small>${esc(fmt(admin.appointedAt))}</small></td>
      <td>${esc(admin.revokedBy||'-')}<br><small>${admin.revokedAt?esc(fmt(admin.revokedAt)):'-'}</small></td>
      <td>${admin.status==='active'
        ? `<button type="button" class="admin-secondary-button" data-acm-act="revoke" data-address="${esc(admin.address)}">撤销</button>`
        : `<button type="button" class="admin-secondary-button" data-acm-act="appoint" data-address="${esc(admin.address)}">重新任命</button>`}</td>
    </tr>`).join('')||'<tr><td colspan="5" class="admin-empty">还没有群管理员，先在上方按钱包地址任命。</td></tr>';
  }

  function visibleMembers(){
    const keyword=$('acm-member-search').value.trim().toLowerCase();
    const filter=$('acm-member-filter').value;
    const now=Date.now();
    return (data.members||[]).filter(member=>{
      if(keyword){
        const hay=`${member.address} ${member.nickname||''}`.toLowerCase();
        if(!hay.includes(keyword))return false;
      }
      if(filter==='active')return member.status==='active';
      if(filter==='kicked')return member.status==='kicked';
      if(filter==='muted')return Number(member.mutedUntil||0)>now;
      return true;
    });
  }

  function renderMembers(){
    const rows=visibleMembers();
    const muted=Number((data.members||[]).filter(m=>Number(m.mutedUntil||0)>Date.now()).length);
    $('acm-member-count').textContent=`共 ${(data.members||[]).length} 位成员 · 禁言中 ${muted} · 已踢出 ${(data.members||[]).filter(m=>m.status==='kicked').length}`;
    const now=Date.now();
    $('acm-members-body').innerHTML=rows.map(member=>{
      const activeMute=Number(member.mutedUntil||0)>now;
      const kicked=member.status==='kicked';
      const actions=[];
      if(kicked)actions.push(`<button type="button" class="admin-secondary-button" data-acm-act="restore" data-address="${esc(member.address)}">恢复</button>`);
      else actions.push(`<button type="button" class="admin-secondary-button" data-acm-act="kick" data-address="${esc(member.address)}">踢出</button>`);
      if(activeMute)actions.push(`<button type="button" class="admin-secondary-button" data-acm-act="unmute" data-address="${esc(member.address)}">解禁</button>`);
      else if(!kicked)actions.push(`<button type="button" class="admin-secondary-button" data-acm-act="mute" data-address="${esc(member.address)}">禁言</button>`);
      return `<tr>
        <td title="${esc(member.address)}">${esc(short(member.address))}${member.isAdmin?' <span class="admin-status good">管理员</span>':''}</td>
        <td>${esc(member.nickname||'-')}</td>
        <td><span class="admin-status ${kicked?'':'good'}">${kicked?'已踢出':activeMute?'禁言中':'正常'}</span></td>
        <td>${activeMute?esc(fmt(member.mutedUntil)):'-'}</td>
        <td><div class="admin-filters">${actions.join('')}</div></td>
      </tr>`;
    }).join('')||'<tr><td colspan="5" class="admin-empty">没有符合条件的成员。</td></tr>';
  }

  function renderWords(){
    $('acm-words').innerHTML=(data.words||[]).map(item=>
      `<span class="acm-chip">${esc(item.word)}<button type="button" title="移除" data-acm-act="word-remove" data-word="${esc(item.word)}">×</button></span>`
    ).join('')||'<span class="admin-inline-status">尚未配置敏感词。</span>';
  }

  function renderMessages(){
    $('acm-messages-body').innerHTML=(data.messages||[]).map(message=>{
      const deleted=message.status!=='visible';
      const text=message.kind==='red_packet'?'[红包]':message.body;
      return `<tr>
        <td>${esc(fmt(message.createdAt))}</td>
        <td title="${esc(message.address)}">${esc(short(message.address))}<br><small>${esc(message.nickname||'')}</small></td>
        <td>${esc(String(text||'').slice(0,80))}${String(text||'').length>80?'…':''}</td>
        <td><span class="admin-status ${deleted?'':'good'}">${deleted?'已删除':'正常'}</span></td>
        <td>${deleted?'-':`<button type="button" class="admin-secondary-button" data-acm-act="message-delete" data-id="${message.id}">删除</button>`}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="5" class="admin-empty">还没有消息。</td></tr>';
  }

  function renderLogs(){
    $('acm-logs-body').innerHTML=(data.logs||[]).map(log=>`<tr>
      <td>${esc(fmt(log.createdAt))}</td>
      <td>${esc(log.actor||'-')}</td>
      <td>${esc(log.actorRole==='platform'?'后台':'群管理员')}</td>
      <td>${esc(ACTION_LABEL[log.action]||log.action)}</td>
      <td title="${esc(log.target||'')}">${esc(log.target?short(log.target):'-')}</td>
      <td>${esc(JSON.stringify(log.detail||{}))}</td>
    </tr>`).join('')||'<tr><td colspan="6" class="admin-empty">暂无操作记录。</td></tr>';
  }

  function render(){
    renderAdmins();renderMembers();renderWords();renderMessages();renderLogs();
  }

  async function load(){
    if(busy)return;
    busy=true;
    try{
      data=await api('/api/admin/community/overview');
      loaded=true;
      render();
    }catch(error){status(error.message,true);}
    finally{busy=false;}
  }

  async function post(path,body){
    return api(path,{method:'POST',body:JSON.stringify(body||{})});
  }

  async function appoint(address){
    if(!address)return status('请输入钱包地址',true);
    status('正在任命…');
    try{
      const result=await post('/api/admin/community/admins/appoint',{address});
      status(result.already?'该地址已经是群管理员':'已任命为群管理员');
      toast('群管理员已任命');
      await load();
    }catch(error){status(error.message,true);}
  }

  async function revoke(address){
    if(!address)return status('请输入钱包地址',true);
    if(!await confirmDialog(`确认撤销 ${short(address)} 的群管理员身份？`))return;
    status('正在撤销…');
    try{
      await post('/api/admin/community/admins/revoke',{address});
      status('已撤销群管理员');
      toast('群管理员已撤销');
      await load();
    }catch(error){status(error.message,true);}
  }

  async function memberAction(action,address){
    if(!address)return;
    try{
      if(action==='kick'){
        if(!await confirmDialog(`确认踢出 ${short(address)}？被踢后重新登录不会自动恢复。`))return;
        await post('/api/admin/community/members/kick',{address});
        status('已踢出该成员');
      }else if(action==='restore'){
        await post('/api/admin/community/members/restore',{address});
        status('已恢复该成员');
      }else if(action==='mute'){
        const input=window.prompt('禁言时长（分钟，1-43200）','60');
        if(input===null)return;
        const minutes=Number(input);
        if(!Number.isFinite(minutes)||minutes<1||minutes>43200)return status('禁言时长需在 1-43200 分钟之间',true);
        const reason=window.prompt('禁言原因（选填）','')||'';
        await post('/api/admin/community/members/mute',{address,minutes:Math.round(minutes),reason});
        status(`已禁言 ${Math.round(minutes)} 分钟`);
      }else if(action==='unmute'){
        await post('/api/admin/community/members/unmute',{address});
        status('已解除禁言');
      }
      await load();
    }catch(error){status(error.message,true);}
  }

  async function deleteMessage(id){
    if(!id)return;
    if(!await confirmDialog('确认删除这条消息？前台会保留占位，内容与操作人写入审计日志。'))return;
    try{
      await post('/api/admin/community/messages/delete',{id:Number(id)});
      status('消息已删除');
      await load();
    }catch(error){status(error.message,true);}
  }

  async function removeWord(word){
    try{
      const result=await post('/api/admin/community/words/remove',{word});
      data.words=result.words||[];
      renderWords();
      status(`已移除敏感词：${word}`);
    }catch(error){status(error.message,true);}
  }

  async function addWord(word){
    const value=String(word||'').trim();
    if(!value)return;
    try{
      const result=await post('/api/admin/community/words/add',{word:value});
      data.words=result.words||[];
      $('acm-word-input').value='';
      renderWords();
      status(`已添加敏感词：${value}`);
    }catch(error){status(error.message,true);}
  }

  const ACTIONS={
    appoint:el=>appoint(el.dataset.address),
    revoke:el=>revoke(el.dataset.address),
    kick:el=>memberAction('kick',el.dataset.address),
    restore:el=>memberAction('restore',el.dataset.address),
    mute:el=>memberAction('mute',el.dataset.address),
    unmute:el=>memberAction('unmute',el.dataset.address),
    'message-delete':el=>deleteMessage(el.dataset.id),
    'word-remove':el=>removeWord(el.dataset.word),
  };

  function init(dependencies){
    api=dependencies.api;toast=dependencies.toast;
    document.addEventListener('click',event=>{
      const button=event.target.closest('[data-acm-act]');
      if(!button||!button.closest('[data-admin-panel="community-admin"]'))return;
      const run=ACTIONS[button.dataset.acmAct];
      if(run)run(button);
    });
    $('acm-appoint')?.addEventListener('click',()=>appoint($('acm-admin-address').value.trim()));
    $('acm-revoke')?.addEventListener('click',()=>revoke($('acm-admin-address').value.trim()));
    $('acm-admin-form')?.addEventListener('submit',event=>{event.preventDefault();appoint($('acm-admin-address').value.trim());});
    $('acm-refresh')?.addEventListener('click',load);
    $('acm-member-search')?.addEventListener('input',()=>{if(loaded)renderMembers();});
    $('acm-member-filter')?.addEventListener('change',()=>{if(loaded)renderMembers();});
    $('acm-word-form')?.addEventListener('submit',event=>{event.preventDefault();addWord($('acm-word-input').value);});
  }

  return {init,load};
})();
