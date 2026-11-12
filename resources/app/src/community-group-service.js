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
    owner TEXT NOT NULL DEFAULT '', invite TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
    muted_all INTEGER NOT NULL DEFAULT 0
  ); CREATE TABLE IF NOT EXISTS community_group_members (
    group_number TEXT NOT NULL, wallet TEXT NOT NULL COLLATE NOCASE, status TEXT NOT NULL DEFAULT 'active',
    muted_until INTEGER NOT NULL DEFAULT 0, last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(group_number,wallet)
  );`);
  if (!db.prepare('PRAGMA table_info(community_groups)').all().some(c => c.name === 'muted_all'))
    db.exec('ALTER TABLE community_groups ADD COLUMN muted_all INTEGER NOT NULL DEFAULT 0');
  // 群头像：存 data URL，对外返回可缓存的固定地址（带版本号刷新缓存）
  for (const [name, sql] of [['avatar', "avatar TEXT NOT NULL DEFAULT ''"], ['avatar_version', 'avatar_version INTEGER NOT NULL DEFAULT 0']])
    if (!db.prepare('PRAGMA table_info(community_groups)').all().some(c => c.name === name))
      db.exec(`ALTER TABLE community_groups ADD COLUMN ${sql}`);
  for (const table of ['community_messages','community_red_packets']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='group_number'))
      db.exec(`ALTER TABLE ${table} ADD COLUMN group_number TEXT NOT NULL DEFAULT '${MAIN}'`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${table}_group_idx ON ${table}(group_number)`);
  }
  const add=db.prepare('INSERT OR IGNORE INTO community_groups(number,name,kind,owner,invite,created_at) VALUES(?,?,?,?,?,?)');
  for (const [n,name,kind] of [[MAIN,'总群','public'],['100002','商学院','public'],['100003','股东群','shareholder'],['100004','工作室群','studio']])
    add.run(n,name,kind,'','',clock());
  // 只有总群免邀请；其余群（含预置的商学院/股东群/工作室群）都要群号 + 邀请码，
  // 预置群原先没有邀请码，这里补发一个，由后台管理员在群信息里查看并分发。
  for (const row of db.prepare("SELECT number FROM community_groups WHERE number<>? AND invite=''").all(MAIN))
    db.prepare('UPDATE community_groups SET invite=? WHERE number=?').run(randomBytes(9).toString('hex'),row.number);
  const get=number=>db.prepare('SELECT * FROM community_groups WHERE number=?').get(String(number||MAIN));
  const membership=(number,wallet)=>db.prepare('SELECT * FROM community_group_members WHERE group_number=? AND wallet=?').get(number,key(wallet));
  const isAdmin=(group,wallet)=>Boolean(wallet)&&(key(group.owner)===key(wallet)||adminService?.isAdmin(wallet));
  // 总群对所有人开放；其他群一律需要群号 + 邀请码（管理员与自己已加入的群除外）。
  function entitled(group,wallet) {
    if (isAdmin(group,wallet)||group.number===MAIN) return true;
    if (!wallet) return false;
    return membership(group.number,wallet)?.status==='active';
  }
  function access(number,wallet) {
    const group=get(number); if(!group) fail('群号不存在');
    if (wallet && (database.getCommunityMember(wallet)?.status==='kicked'||membership(group.number,wallet)?.status==='kicked')) fail('你已被移出该群');
    if (!entitled(group,wallet)) fail(group.number===MAIN?'当前账号无法进入总群':'该群需要群号和邀请码才能加入');
    if(wallet) {
      database.ensureCommunityMember(wallet,`成员 ${key(wallet).slice(0,6)}…${key(wallet).slice(-4)}`,clock());
      db.prepare('INSERT OR IGNORE INTO community_group_members(group_number,wallet) VALUES(?,?)').run(group.number,key(wallet));
    }
    return group;
  }
  function view(group,wallet) {
    // 总群默认用代币 LOGO；管理员自定义头像后走带版本号的固定地址（可长期缓存）。
    const custom = group.avatar ? `/api/community/group-avatar/${group.number}?v=${Number(group.avatar_version||0)}` : '';
    return {number:group.number,name:group.name,kind:group.kind,owner:group.owner,
      avatar:custom||(group.number===MAIN?'/assets/brand/logo.svg':''),
      mutedAll:Number(group.muted_all||0),
      isAdmin:isAdmin(group,wallet),invite:isAdmin(group,wallet)?group.invite:undefined};
  }
  // 群头像与个人头像同一套校验：JPG/PNG/WebP，240KB 以内
  function normalizeGroupAvatar(raw) {
    if (raw == null || raw === '') return '';
    const value = String(raw);
    if (value.length > 400_000) fail('群头像图片过大，请重新选择');
    const match = value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) fail('群头像仅支持 JPG、PNG 或 WebP 图片');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 240 * 1024) fail('群头像图片不能超过 240KB');
    const valid = match[1] === 'png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'jpeg'
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) fail('群头像图片内容无效');
    return value;
  }
  function setAvatar(number, wallet, raw) {
    const group = access(number, wallet);
    if (!isAdmin(group, wallet)) fail('只有群管理员可以更换群头像');
    db.prepare('UPDATE community_groups SET avatar=?, avatar_version=avatar_version+1 WHERE number=?')
      .run(normalizeGroupAvatar(raw), group.number);
    return view(get(group.number), wallet);
  }
  // 群名称：仅群管理员可改，长度与建群规则一致（1-40 字）
  function setName(number, wallet, raw) {
    const group = access(number, wallet);
    if (!isAdmin(group, wallet)) fail('只有群管理员可以修改群名称');
    const title = String(raw || '').trim();
    if (!title || title.length > 40) fail('群名称需为1至40个字');
    db.prepare('UPDATE community_groups SET name=? WHERE number=?').run(title, group.number);
    return view(get(group.number), wallet);
  }
  function getAvatar(number) {
    const group = get(number);
    const match = String(group?.avatar || '').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    return match ? { mime: match[1], data: match[2] } : null;
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
    // 总群直接进入；其他群一律校验邀请码。
    if(group.number!==MAIN&&!entitled(group,wallet)) {
      if(!group.invite)fail('该群暂未开放邀请，请联系群管理员');
      if(!invite||String(invite)!==group.invite)fail('群邀请码无效');
      if(membership(group.number,wallet)?.status==='kicked')fail('你已被移出该群');
      db.prepare('INSERT OR IGNORE INTO community_group_members(group_number,wallet) VALUES(?,?)').run(group.number,key(wallet));
    }
    return view(access(group.number,wallet),wallet);
  }
  function join(wallet,input) { return database.transaction(()=>joinInside(wallet,input)); }
  function moderate(number,actor,action,input) {
    const group=access(number,actor);if(!isAdmin(group,actor))fail('需要群管理员权限');
    if(action==='mute-all'||action==='unmute-all') {
      db.prepare('UPDATE community_groups SET muted_all=? WHERE number=?').run(action==='mute-all'?1:0,group.number);
    } else if(action==='message-delete') {
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
        insertCommunityMessage:input=>{
          const current=get(n);
          if(Number(current?.muted_all||0)&&!isAdmin(current,input.wallet))fail('全员禁言中，仅群管理员可发言');
          const r=db.prepare("INSERT INTO community_messages(wallet,nickname,body,client_id,kind,ref_id,created_at,group_number) VALUES(?,?,?,?,?,?,?,?)").run(key(input.wallet),input.nickname,input.body,String(input.clientId||''),input.kind||'text',input.refId||'',input.createdAt,n);return db.prepare('SELECT * FROM community_messages WHERE id=?').get(Number(r.lastInsertRowid));},
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
  return {list,create,join,scoped,moderate,setAvatar,getAvatar,setName};
}
