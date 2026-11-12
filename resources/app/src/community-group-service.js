import { randomBytes, randomInt } from 'node:crypto';
import { createCommunityService } from './community-service.js';
import { createCommunityRedPacketService } from './community-redpacket-service.js';

const MAIN = '100001';
const key = value => String(value || '').toLowerCase();
const fail = message => { throw Object.assign(new Error(message), {statusCode:403}); };

export function createCommunityGroupService({database, walletService, teamService, adminService, clock=()=>Date.now()}) {
  const db=database.db;
  db.exec(`CREATE TABLE IF NOT EXISTS community_groups (
    number TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT '', invite TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS community_group_members (
    group_number TEXT NOT NULL, wallet TEXT NOT NULL COLLATE NOCASE, status TEXT NOT NULL DEFAULT 'active',
    muted_until INTEGER NOT NULL DEFAULT 0, last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(group_number,wallet)
  );`);
  for (const table of ['community_messages','community_red_packets']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='group_number'))
      db.exec(`ALTER TABLE ${table} ADD COLUMN group_number TEXT NOT NULL DEFAULT '${MAIN}'`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${table}_group_idx ON ${table}(group_number)`);
  }
  const add=db.prepare('INSERT OR IGNORE INTO community_groups(number,name,kind,owner,invite,created_at) VALUES(?,?,?,?,?,?)');
  for (const [n,name,kind] of [[MAIN,'总群','public'],['100002','商学院','public'],['100003','股东群','shareholder'],['100004','工作室群','studio']])
    add.run(n,name,kind,'','',clock());
  const get=number=>db.prepare('SELECT * FROM community_groups WHERE number=?').get(String(number||MAIN));
  const membership=(number,wallet)=>db.prepare('SELECT * FROM community_group_members WHERE group_number=? AND wallet=?').get(number,key(wallet));
  const isAdmin=(group,wallet)=>Boolean(wallet)&&(key(group.owner)===key(wallet)||adminService?.isAdmin(wallet));
  function entitled(group,wallet) {
    if (isAdmin(group,wallet)||group.kind==='public') return true;
    if (!wallet) return false;
    if (group.kind==='shareholder') return Boolean(database.getActiveATokenShareholderMember(wallet));
    if (group.kind==='studio') return database.listATokenStakes(wallet).some(s=>s.planId==='energy'&&s.status==='active');
    return membership(group.number,wallet)?.status==='active';
  }
  function access(number,wallet) {
    const group=get(number); if(!group) fail('群号不存在');
    if (wallet && (database.getCommunityMember(wallet)?.status==='kicked'||membership(group.number,wallet)?.status==='kicked')) fail('你已被移出该群');
    if (!entitled(group,wallet)) fail(group.kind==='private'?'私人群需要有效邀请后加入':'当前账号不符合该群加入条件');
    if(wallet) {
      database.ensureCommunityMember(wallet,`成员 ${key(wallet).slice(0,6)}…${key(wallet).slice(-4)}`,clock());
      db.prepare('INSERT OR IGNORE INTO community_group_members(group_number,wallet) VALUES(?,?)').run(group.number,key(wallet));
    }
    return group;
  }
  function view(group,wallet) {
    return {number:group.number,name:group.name,kind:group.kind,owner:group.owner,
      isAdmin:isAdmin(group,wallet),invite:isAdmin(group,wallet)?group.invite:undefined};
  }
  function list(wallet) {
    return {groups:db.prepare('SELECT * FROM community_groups ORDER BY number').all().filter(g=>entitled(g,wallet)&&membership(g.number,wallet)?.status!=='kicked').map(g=>view(g,wallet)),canCreate:Boolean(wallet)&&Number(teamService.snapshot(wallet).level)>=3};
  }
  function create(wallet,{name}) {
    if (Number(teamService.snapshot(wallet).level)<3) fail('V3及以上才可创建私人群');
    const title=String(name||'').trim();if(!title||title.length>40) fail('群名称需为1至40个字');
    if(db.prepare("SELECT COUNT(*) n FROM community_groups WHERE owner=?").get(key(wallet)).n>=20) fail('每个钱包最多创建20个私人群');
    let number;do{number=String(randomInt(200000,1000000));}while(get(number));
    const invite=randomBytes(18).toString('hex');
    return database.transaction(()=>{add.run(number,title,'private',key(wallet),invite,clock());access(number,wallet);return view(get(number),wallet);});
  }
  function joinInside(wallet,{number,invite}) {
    const group=get(number);if(!group)fail('群号不存在');
    if(group.kind==='private'&&!entitled(group,wallet)) {
      if(!invite||String(invite)!==group.invite)fail('群邀请码无效');
      if(membership(group.number,wallet)?.status==='kicked')fail('你已被移出该群');
      db.prepare('INSERT OR IGNORE INTO community_group_members(group_number,wallet) VALUES(?,?)').run(group.number,key(wallet));
    }
    return view(access(group.number,wallet),wallet);
  }
  function join(wallet,input) { return database.transaction(()=>joinInside(wallet,input)); }
  function moderate(number,actor,action,input) {
    const group=access(number,actor);if(!isAdmin(group,actor))fail('需要群管理员权限');
    if(action==='message-delete') {
      const msg=db.prepare('SELECT * FROM community_messages WHERE id=? AND group_number=?').get(Number(input.id),number);
      if(!msg)fail('群消息不存在');database.softDeleteCommunityMessage(msg.id,actor,clock());
    } else {
      const target=key(input.address);if(isAdmin(group,target))fail('不能操作群主或管理员');
      if(action==='kick')db.prepare("UPDATE community_group_members SET status='kicked' WHERE group_number=? AND wallet=?").run(number,target);
      else if(action==='mute'||action==='unmute')db.prepare('UPDATE community_group_members SET muted_until=? WHERE group_number=? AND wallet=?').run(action==='unmute'?0:clock()+Math.min(10080,Math.max(1,Number(input.minutes)||60))*60000,number,target);
      else fail('不支持的管理操作');
    }
    db.prepare('INSERT INTO audit_log(event_id,address,event_type,created_at,payload_json) VALUES(?,?,?,?,?)').run('group_'+randomBytes(12).toString('hex'),actor,'community_group_moderation',clock(),JSON.stringify({number,action,target:input.address,id:input.id}));
    return {ok:true};
  }
  const cache=new Map();
  function scoped(number,wallet) {
    const group=access(String(number||MAIN),wallet);const n=group.number;
    if(!cache.has(n)) {
      const selectMember=w=>{
        const global=database.getCommunityMember(w);if(!global)return null;
        const local=membership(n,w);return {...global,status:global.status==='kicked'?'kicked':local?.status||'active',muted_until:Math.max(Number(global.muted_until||0),Number(local?.muted_until||0))};
      };
      const overrides={
        getCommunityMember:selectMember,
        ensureCommunityMember:(w,nick,at)=>{access(n,w);database.ensureCommunityMember(w,nick,at);return selectMember(w);},
        listCommunityMembers:(limit=200)=>db.prepare("SELECT m.* FROM community_members m JOIN community_group_members g ON g.wallet=m.address WHERE g.group_number=? AND g.status='active' AND m.status='active' ORDER BY m.joined_at DESC LIMIT ?").all(n,Math.min(500,limit)),
        countCommunityMembers:()=>Number(db.prepare("SELECT COUNT(*) n FROM community_group_members WHERE group_number=? AND status='active'").get(n).n),
        insertCommunityMessage:input=>{const r=db.prepare("INSERT INTO community_messages(wallet,nickname,body,client_id,kind,ref_id,created_at,group_number) VALUES(?,?,?,?,?,?,?,?)").run(key(input.wallet),input.nickname,input.body,String(input.clientId||''),input.kind||'text',input.refId||'',input.createdAt,n);return db.prepare('SELECT * FROM community_messages WHERE id=?').get(Number(r.lastInsertRowid));},
        getCommunityMessage:id=>db.prepare('SELECT * FROM community_messages WHERE id=? AND group_number=?').get(Number(id),n)||null,
        getCommunityMessageByClient:(w,c)=>db.prepare('SELECT * FROM community_messages WHERE wallet=? AND client_id=? AND group_number=?').get(key(w),c,n)||null,
        getCommunityMessageByRef:(kind,id)=>db.prepare('SELECT * FROM community_messages WHERE kind=? AND ref_id=? AND group_number=?').get(kind,id,n)||null,
        listCommunityMessages:({beforeId=0,afterId=0,limit=60}={})=>{
          const clause=afterId>0?'AND id>?':beforeId>0?'AND id<?':'';
          const args=[n];if(clause)args.push(Number(afterId||beforeId));args.push(Math.min(200,Math.max(1,Number(limit)||60)));
          return db.prepare(`SELECT * FROM community_messages WHERE group_number=? ${clause} ORDER BY id ${afterId>0?'ASC':'DESC'} LIMIT ?`).all(...args);
        },
        latestCommunityMessageId:()=>Number(db.prepare('SELECT MAX(id) id FROM community_messages WHERE group_number=?').get(n).id||0),
        countCommunityUnread:(w,last)=>Number(db.prepare("SELECT COUNT(*) n FROM community_messages WHERE group_number=? AND id>? AND wallet<>? AND status='visible'").get(n,Number(last)||0,key(w)).n),
        getCommunityRead:w=>({lastReadId:Number(membership(n,w)?.last_read_id||0),updatedAt:0}),
        setCommunityRead:(w,last)=>{db.prepare('UPDATE community_group_members SET last_read_id=MAX(last_read_id,?) WHERE group_number=? AND wallet=?').run(Number(last)||0,n,key(w));return {lastReadId:Number(membership(n,w)?.last_read_id||0)};},
        insertCommunityRedPacket:input=>{const p=database.insertCommunityRedPacket(input);db.prepare('UPDATE community_red_packets SET group_number=? WHERE id=?').run(n,p.id);return {...p,group_number:n};},
        getCommunityRedPacket:id=>db.prepare('SELECT * FROM community_red_packets WHERE id=? AND group_number=?').get(String(id),n)||null,
        getCommunityRedPacketByClient:(w,c)=>db.prepare('SELECT * FROM community_red_packets WHERE sender=? AND client_id=? AND group_number=?').get(key(w),String(c),n)||null,
        listCommunityRedPacketsByIds:ids=>database.listCommunityRedPacketsByIds(ids).filter(p=>p.group_number===n),
      };
      const scopedDb=new Proxy(database,{get:(target,prop)=>prop in overrides?overrides[prop]:target[prop]});
      const service=createCommunityService({database:scopedDb,clock});
      const packets=createCommunityRedPacketService({database:scopedDb,walletService,clock,ensureMember:service.ensureMember});
      cache.set(n,{service,redPacketService:packets});
    }
    return {...cache.get(n),group:view(group,wallet)};
  }
  return {list,create,join,scoped,moderate};
}
