// 群聊 HTTP 路由（/api/community/*）
// 读接口允许匿名（未登录可看历史），写接口要求钱包会话 + 同源校验。
export function createCommunityApi({
  service:baseService, adminService, redPacketService:basePackets, groupService, send, readBody, getSession, isSameOrigin,
}) {
  if (!baseService) throw new Error('communityApi 需要 service');

  function sendError(res, error) {
    const message = String(error?.message || '请求失败，请重试');
    const status = Number(error?.statusCode)
      || (/不存在/.test(message) ? 404 : /登录|钱包/.test(message) ? 401 : 400);
    send(res, status, { error: message });
  }

  function requireSession(request) {
    const session = getSession(request);
    if (!session?.address) {
      throw Object.assign(new Error('请先连接钱包并完成身份验证'), { statusCode: 401 });
    }
    return session;
  }

  function guardWrite(request) {
    if (!isSameOrigin(request)) {
      throw Object.assign(new Error('拒绝跨站请求'), { statusCode: 403 });
    }
  }

  function positiveInt(searchParams, key) {
    const value = Number(searchParams.get(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function adminFlaggedMembers(members, group) {
    const admins = new Set(adminService ? adminService.activeAdminAddresses() : []);
    return members.map(member => ({
      ...member,
      isAdmin: admins.has(String(member.address).toLowerCase()) || String(member.address).toLowerCase()===group?.owner,
    }));
  }

  function sessionPayload(address, service, redPacketService, group, groupAdminList = []) {
    const data = service.overview(address);
    const admins = new Set(adminService ? adminService.activeAdminAddresses() : []);
    const groupAdmins = new Set(groupAdminList.map(item => String(item).toLowerCase()));
    const key = String(address || '').toLowerCase();
    const owner = String(group?.owner || '').toLowerCase();
    return {
      ...data,
      group,
      members: data.members.map(member => {
        const wallet = String(member.address).toLowerCase();
        return { ...member, isAdmin: admins.has(wallet) || wallet === owner || groupAdmins.has(wallet), isOwner: Boolean(owner) && wallet === owner, isGroupAdmin: groupAdmins.has(wallet) };
      }),
      me: data.me ? { ...data.me, isAdmin: admins.has(key) || Boolean(group?.isAdmin), isOwner: Boolean(owner) && key === owner } : null,
      isAdmin: Boolean(address) && (admins.has(key) || group?.isAdmin),
      redPacketPolicy: redPacketService ? redPacketService.policy() : [],
    };
  }

  async function handle(request, res, pathname) {
    if (!pathname.startsWith('/api/community/')) return false;
    try {
      const address=getSession(request)?.address||'';
      const params=new URLSearchParams(request.url?.split('?')[1]||'');
      const groupAvatarMatch = request.method === 'GET' && pathname.match(/^\/api\/community\/group-avatar\/(\d{1,12})$/);
      if (groupAvatarMatch) {
        const avatar = groupService?.getAvatar(groupAvatarMatch[1]);
        if (!avatar) return send(res, 404, { error: '群头像不存在' });
        const body = Buffer.from(avatar.data, 'base64');
        res.writeHead(200, {
          'Content-Type': avatar.mime,
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        res.end(body);
        return true;
      }
      const avatarMatch = request.method === 'GET' && pathname.match(/^\/api\/community\/avatar\/(0x[0-9a-fA-F]{40})$/);
      if (avatarMatch) {
        const avatar = baseService.getAvatar(avatarMatch[1]);
        if (!avatar) return send(res, 404, { error: '头像不存在' });
        const body = Buffer.from(avatar.data, 'base64');
        res.writeHead(200, {
          'Content-Type': avatar.mime,
          'Content-Length': body.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin',
        });
        res.end(body);
        return true;
      }
      if (groupService && pathname === '/api/community/groups' && request.method === 'GET') return send(res,200,groupService.list(address));
      if (groupService && request.method === 'POST' && ['/api/community/groups','/api/community/groups/join'].includes(pathname)) {
        guardWrite(request); const actor=requireSession(request).address; const payload=await readBody(request,8000);
        return send(res,200,{group:pathname.endsWith('/join')?groupService.join(actor,payload):groupService.create(actor,payload)});
      }
      // POST /api/community/groups/avatar?group=100001 { avatar: dataURL } — 仅群管理员
      if (groupService && request.method === 'POST' && pathname === '/api/community/groups/avatar') {
        guardWrite(request); const actor=requireSession(request).address; const payload=await readBody(request,400_000);
        return send(res,200,{group:groupService.setAvatar(params.get('group')||'100001',actor,payload.avatar)});
      }
      // POST /api/community/groups/name?group=100001 { name } — 仅群管理员
      if (groupService && request.method === 'POST' && pathname === '/api/community/groups/name') {
        guardWrite(request); const actor=requireSession(request).address; const payload=await readBody(request,8_000);
        return send(res,200,{group:groupService.setName(params.get('group')||'100001',actor,payload.name)});
      }
      // POST /api/community/groups/owner?group= { address } — 群主/平台管理员转让群主
      if (groupService && request.method === 'POST' && pathname === '/api/community/groups/owner') {
        guardWrite(request); const actor=requireSession(request).address; const payload=await readBody(request,8_000);
        return send(res,200,{group:groupService.setOwner(params.get('group')||'100001',actor,payload.address)});
      }
      // POST /api/community/groups/admin?group= { address, enabled } — 群主任命/取消群管理员
      if (groupService && request.method === 'POST' && pathname === '/api/community/groups/admin') {
        guardWrite(request); const actor=requireSession(request).address; const payload=await readBody(request,8_000);
        return send(res,200,{group:groupService.setGroupAdmin(params.get('group')||'100001',actor,payload.address,Boolean(payload.enabled))});
      }
      const scoped=groupService?.scoped(params.get('group')||'100001',address);
      const service=scoped?.service||baseService, redPacketService=scoped?.redPacketService||basePackets;
      if(groupService && request.method==='POST' && pathname.startsWith('/api/community/admin/')) {
        guardWrite(request);const actor=requireSession(request).address;const input=await readBody(request,8000);
        return send(res,200,groupService.moderate(scoped.group.number,actor,pathname.split('/').pop(),input));
      }
      // GET /api/community/session — 群概览（成员、本人身份、未读、红包限额）；匿名可用
      if (request.method === 'GET' && pathname === '/api/community/session') {
        const address = getSession(request)?.address || '';
        return send(res, 200, sessionPayload(address, service, redPacketService, scoped?.group, groupService?.adminAddresses(scoped?.group?.number)));
      }
      // GET /api/community/messages?before_id=&after_id=&limit=
      if (request.method === 'GET' && pathname === '/api/community/messages') {
        const searchParams = new URLSearchParams(request.url?.split('?')[1] || '');
        const page = service.listMessages({
          beforeId: positiveInt(searchParams, 'before_id'),
          afterId: positiveInt(searchParams, 'after_id'),
          limit: positiveInt(searchParams, 'limit') || 60,
        });
        const viewer = getSession(request)?.address || '';
        page.messages = redPacketService ? redPacketService.decorate(page.messages, viewer) : page.messages;
        return send(res, 200, page);
      }
      // GET /api/community/members
      if (request.method === 'GET' && pathname === '/api/community/members') {
        const data = service.listMembers();
        return send(res, 200, { ...data, members: adminFlaggedMembers(data.members, scoped?.group) });
      }
      // POST /api/community/messages { body, clientId }
      if (request.method === 'POST' && pathname === '/api/community/messages') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 16_000);
        return send(res, 200, service.postMessage(session.address, {
          body: payload.body,
          clientId: payload.clientId,
        }));
      }
      // POST /api/community/profile { nickname, avatar? }
      if (request.method === 'POST' && pathname === '/api/community/profile') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 400_000);
        return send(res, 200, service.setProfile(session.address, { nickname:payload.nickname, avatar:payload.avatar }));
      }
      // POST /api/community/read { lastId }
      if (request.method === 'POST' && pathname === '/api/community/read') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, service.markRead(session.address, payload.lastId));
      }

      // ── 群管理员操作（钱包身份） ──
      // POST /api/community/admin/kick { address, reason }
      if (request.method === 'POST' && pathname === '/api/community/admin/kick') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.kick({
          actor: session.address, role:'admin', target: payload.address, reason: payload.reason,
        }));
      }
      // POST /api/community/admin/mute { address, minutes, reason }
      if (request.method === 'POST' && pathname === '/api/community/admin/mute') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.mute({
          actor: session.address, role:'admin', target: payload.address,
          minutes: payload.minutes, reason: payload.reason,
        }));
      }
      // POST /api/community/admin/unmute { address }
      if (request.method === 'POST' && pathname === '/api/community/admin/unmute') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.unmute({
          actor: session.address, role:'admin', target: payload.address,
        }));
      }
      // POST /api/community/admin/message-delete { id, reason }
      if (request.method === 'POST' && pathname === '/api/community/admin/message-delete') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.deleteMessage({
          actor: session.address, role:'admin', id: payload.id, reason: payload.reason,
        }));
      }

      // ── 红包 ──
      // POST /api/community/red-packets { asset, algorithm, total, count, greeting, clientId, expiresInHours }
      if (request.method === 'POST' && pathname === '/api/community/red-packets') {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 16_000);
        return send(res, 200, redPacketService.createPacket(session.address, payload));
      }
      const grabMatch = pathname.match(/^\/api\/community\/red-packets\/([^/]+)\/grab$/);
      if (request.method === 'POST' && grabMatch) {
        guardWrite(request);
        const session = requireSession(request);
        const payload = await readBody(request, 8_000);
        return send(res, 200, redPacketService.grab(decodeURIComponent(grabMatch[1]), session.address, payload));
      }
      const packetMatch = pathname.match(/^\/api\/community\/red-packets\/([^/]+)$/);
      if (request.method === 'GET' && packetMatch) {
        const viewer = getSession(request)?.address || '';
        return send(res, 200, redPacketService.getPacket(decodeURIComponent(packetMatch[1]), viewer));
      }

      return send(res, 404, { error: '接口不存在' });
    } catch (error) {
      return sendError(res, error);
    }
  }

  // 后台路由：调用方（server.js）已校验管理员会话
  async function handleAdmin(request, res, pathname, context = {}) {
    if (!pathname.startsWith('/api/admin/community/')) return false;
    const actor = String(context.operatorSession?.username || context.operator?.username || 'admin');
    try {
      if (request.method === 'GET' && pathname === '/api/admin/community/overview') {
        return send(res, 200, adminService.overview());
      }
      if (request.method === 'GET' && pathname === '/api/admin/community/logs') {
        const searchParams = new URLSearchParams(request.url?.split('?')[1] || '');
        return send(res, 200, { logs: adminService.logs(positiveInt(searchParams, 'limit') || 100) });
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/admins/appoint') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.appoint({ actor, target: payload.address }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/admins/revoke') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.revoke({ actor, target: payload.address }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/members/restore') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.restore({ actor, target: payload.address }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/members/kick') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.kick({ actor, role:'platform', target: payload.address, reason: payload.reason }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/members/mute') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.mute({
          actor, role:'platform', target: payload.address, minutes: payload.minutes, reason: payload.reason,
        }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/members/unmute') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.unmute({ actor, role:'platform', target: payload.address }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/messages/delete') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.deleteMessage({ actor, role:'platform', id: payload.id, reason: payload.reason }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/words/add') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.addWord({ actor, word: payload.word }));
      }
      if (request.method === 'POST' && pathname === '/api/admin/community/words/remove') {
        const payload = await readBody(request, 8_000);
        return send(res, 200, adminService.removeWord({ actor, word: payload.word }));
      }
      return send(res, 404, { error: '接口不存在' });
    } catch (error) {
      return sendError(res, error);
    }
  }

  return { handle, handleAdmin };
}
