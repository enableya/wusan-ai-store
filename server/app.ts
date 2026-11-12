import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { catalogRepository } from './database.ts';
import { createAlipayGateway } from './alipay.ts';
import type { PaymentGateway } from './alipay.ts';
import { browserOwner, orderRepository, OrderError, hash } from './orders.ts';
import { readBody, readJson } from './http.ts';
import { adminRepository } from './admin.ts';
import { adminOrderRepository } from './admin-orders.ts';
import { revenueRepository } from './revenue.ts';
import { couponRepository } from './coupons.ts';
import { analyticsRepository } from './analytics.ts';
import { voucherInventory } from './vouchers.ts';
import { orderTimeoutService } from './order-timeouts.ts';
import { redemptionRepository } from './redemptions.ts';
import { withdrawalRepository } from './withdrawals.ts';
import { referralRepository } from './referrals.ts';
import { hasAdminPermission, staffCheckoutUsername } from '../src/types/admin.ts';

export function createApiServer(db: DatabaseSync, gateway: PaymentGateway = createAlipayGateway(), options: { adminOrigin?: string; publicCheckoutEnabled?: boolean; fulfillmentMonitor?: boolean } = {}) {
  const catalog = catalogRepository(db);
  const orders = orderRepository(db, gateway);
  const withdrawals = withdrawalRepository(db, gateway);
  const referrals = referralRepository(db, gateway.origin, gateway.status.environment);
  const admin = adminRepository(db, options.adminOrigin ?? process.env.ADMIN_ORIGIN ?? gateway.origin);
  if (process.env.PUBLIC_CHECKOUT_ENABLED && !['true', 'false'].includes(process.env.PUBLIC_CHECKOUT_ENABLED)) throw new Error('PUBLIC_CHECKOUT_ENABLED must be true or false.');
  const publicCheckoutEnabled = options.publicCheckoutEnabled ?? process.env.PUBLIC_CHECKOUT_ENABLED !== 'false';
  const checkoutAllowed = (request: Parameters<typeof admin.current>[0]) => publicCheckoutEnabled || hasAdminPermission(admin.current(request), 'checkout.test');
  const coupons = couponRepository(db, gateway.status.environment);
  const adminOrders = adminOrderRepository(db, gateway.status.environment);
  const revenue = revenueRepository(db, gateway.status.environment);
  const analytics = analyticsRepository(db, gateway.status.environment, admin.origin.startsWith('https:'));
  const vouchers = voucherInventory(db, gateway.status.environment);
  const redemptions = redemptionRepository(db);
  const fulfillmentMonitor = orderTimeoutService(db,gateway,redemptions);
  const staffLink = db.prepare(`SELECT link.customer_id FROM customer_staff_checkout link
    JOIN admin_accounts account ON account.username = link.admin_username
    WHERE link.admin_username = ? AND account.role = 'super_admin'`);
  function hasStaffCheckout(user: ReturnType<typeof referrals.current>) {
    return user?.username === staffCheckoutUsername && staffLink.get(staffCheckoutUsername)?.customer_id === user.id;
  }
  function customerView(user: ReturnType<typeof referrals.current>) {
    return user && hasStaffCheckout(user) ? { ...user, staffCheckout: true } : user ?? null;
  }
  const limits = new Map<string, { count: number; expires: number }>();
  function rateLimit(key: string, max: number) {
    const now = Date.now();
    if (limits.size >= 10000) for (const [id, value] of limits) if (value.expires <= now) limits.delete(id);
    const value = limits.get(key);
    if (value && value.expires > now) {
      if (++value.count > max) throw new OrderError(429, 'TOO_MANY_REQUESTS', '操作过于频繁，请一分钟后重试。');
    } else {
      if (limits.size >= 10000) throw new OrderError(429, 'TOO_MANY_REQUESTS', '请求过多，请稍后重试。');
      limits.set(key, { count: 1, expires: now + 60000 });
    }
  }
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    const fail = (status: number, code: string, message: string) => send(status, { error: { code, message, requestId } });
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) return fail(404, 'NOT_FOUND', '接口不存在。');
      const reading = request.method === 'GET' || request.method === 'HEAD';
      const owner = () => browserOwner(request, response, gateway);
      const staffOwner = () => {
        const user = referrals.current(request);
        return user && hasStaffCheckout(user) ? hash(`staff-checkout:${user.id}`) : null;
      };
      if (url.pathname === '/api/customer/session' && reading) return send(200, { data: customerView(referrals.current(request)) });
      if (url.pathname.startsWith('/api/customer/') && request.method === 'POST') {
        if (request.headers.origin !== (gateway.origin || `http://${request.headers.host}`)) return fail(403, 'INVALID_ORIGIN', '请从本站页面操作。');
        rateLimit(`customer:${request.socket.remoteAddress}`, 12);
        const input = await readJson(request, gateway.origin);
        if (url.pathname === '/api/customer/logout') return send(200, { data: referrals.logout(request, response) });
        if (['/api/customer/login', '/api/customer/register'].includes(url.pathname)) {
          rateLimit(`customer-account:${hash(String(input.username).trim().toLowerCase())}`, 8);
          const browser = browserOwner(request, response, gateway, true)!;
          const user = await referrals.authenticate(request, response, browser, input, url.pathname.endsWith('/register'));
          return send(200, { data: customerView(user) });
        }
      }
      if (url.pathname === '/api/referrals/withdrawals' && (reading || request.method === 'POST')) {
        const user = referrals.requireUser(request);
        if (reading) return send(200, { data: withdrawals.list(url.searchParams, user.id) });
        rateLimit(`withdrawals:${user.id}`, 10);
        const input = await readJson(request, gateway.origin);
        const key = String(request.headers['idempotency-key'] || '');
        return send(201, { data: await withdrawals.request(user.id, input, key, () => {
          if (referrals.requireUser(request).id !== user.id) throw new OrderError(401, 'LOGIN_REQUIRED', '请重新登录。');
        }) });
      }
      if (url.pathname === '/api/referrals/invitation' && reading) return send(200, { data: referrals.invitation(owner()) });
      if (url.pathname === '/api/referrals/visit' && request.method === 'POST') {
        rateLimit(`referral:${request.socket.remoteAddress}`, 60);
        const input = await readJson(request, gateway.origin);
        const browser = browserOwner(request, response, gateway, true)!;
        return send(200, { data: referrals.visit(browser, input.code) });
      }
      if (url.pathname === '/api/referrals' && reading) return send(200, { data: referrals.report(url.searchParams, referrals.requireUser(request).id) });
      if (url.pathname === '/api/analytics/product-click' && request.method === 'POST') {
        rateLimit('analytics', 600);
        const input = await readJson(request, admin.origin);
        return send(200, { data: analytics.record(request, response, input, /bot|spider|crawler/i.test(request.headers['user-agent'] || '')) });
      }
      if (url.pathname.startsWith('/api/admin/')) {
        const writeInput = async (limit?: number) => {
          if (request.headers.origin !== (admin.origin || `http://${request.headers.host}`)) throw new OrderError(403, 'INVALID_ORIGIN', '请从本站管理页面操作。');
          return readJson(request, admin.origin, limit);
        };
        if (url.pathname === '/api/admin/session' && reading) return send(200, { data: admin.session(request) });
        if (url.pathname === '/api/admin/staff-checkout' && (reading || request.method === 'POST')) {
          const actor = admin.requirePermission(request, 'users.manage');
          if (actor.username !== staffCheckoutUsername) return fail(403, 'STAFF_ACCOUNT_REQUIRED', '仅指定超级管理员可以管理免付开通。');
          if (reading) return send(200, { data: { linked: Boolean(staffLink.get(actor.username)) } });
          const input = await writeInput();
          const current = admin.requirePermission(request, 'users.manage');
          if (current.username !== actor.username) return fail(403, 'STAFF_ACCOUNT_REQUIRED', '管理员会话已变更，请重试。');
          if (input.linked === true) {
            const user = referrals.current(request);
            if (user?.username !== actor.username) return fail(409, 'STAFF_CUSTOMER_REQUIRED', '请先在同一浏览器登录同名商城账号，再返回绑定。');
            db.prepare('INSERT OR IGNORE INTO customer_staff_checkout (customer_id, admin_username, linked_at) VALUES (?, ?, ?)')
              .run(user.id, actor.username, new Date().toISOString());
          } else if (input.linked === false) {
            db.prepare('DELETE FROM customer_staff_checkout WHERE admin_username = ?').run(actor.username);
          } else {
            return fail(400, 'INVALID_STAFF_LINK', '请选择绑定或解除绑定。');
          }
          return send(200, { data: { linked: Boolean(staffLink.get(actor.username)) } });
        }
        if (request.method === 'POST' && ['/api/admin/login', '/api/admin/logout'].includes(url.pathname)) {
          rateLimit('admin-login', 12);
          const input = await writeInput();
          return send(200, { data: url.pathname.endsWith('/login') ? await admin.login(request, response, input) : admin.logout(request, response) });
        }
        if (url.pathname === '/api/admin/coupons') {
          admin.requirePermission(request, 'coupons.manage');
          if (reading) return send(200, { data: coupons.list() });
          if (request.method === 'POST') { const input = await writeInput(); admin.requirePermission(request, 'coupons.manage'); return send(201, { data: coupons.create(input) }); }
        }
        const couponAction = /^\/api\/admin\/coupons\/([0-9a-f-]+)\/(status|update|delete)$/.exec(url.pathname);
        if (couponAction && request.method === 'POST') { admin.requirePermission(request, 'coupons.manage'); const input = await writeInput(); admin.requirePermission(request, 'coupons.manage'); return send(200, { data: couponAction[2] === 'status' ? coupons.setActive(couponAction[1], input.active) : couponAction[2] === 'update' ? coupons.update(couponAction[1], input) : coupons.remove(couponAction[1]) }); }
        if (url.pathname === '/api/admin/referrals/withdrawals' && reading) {
          admin.requirePermission(request, 'withdrawals.manage');
          return send(200, { data: withdrawals.list(url.searchParams) });
        }
        const withdrawalReceipt = /^\/api\/admin\/referrals\/withdrawals\/(WD[a-f0-9]{32})\/receipt$/.exec(url.pathname);
        if (withdrawalReceipt && reading) {
          admin.requirePermission(request, 'withdrawals.manage');
          const receipt = withdrawals.receipt(withdrawalReceipt[1]);
          response.setHeader('Content-Type', receipt.type);
          response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          response.setHeader('Content-Disposition', `inline; filename="${withdrawalReceipt[1]}.${receipt.type === 'image/png' ? 'png' : 'jpg'}"`);
          response.writeHead(200);
          return response.end(request.method === 'HEAD' ? undefined : receipt.bytes);
        }
        const withdrawalAction = /^\/api\/admin\/referrals\/withdrawals\/(WD[a-f0-9]{32})\/(approve|reject|pay|query|manual-start|manual-complete|manual-release)$/.exec(url.pathname);
        if (withdrawalAction && request.method === 'POST') {
          admin.requirePermission(request, 'withdrawals.manage');
          const input = await writeInput();
          const actor = admin.requirePermission(request, 'withdrawals.manage');
          rateLimit(`withdrawal-review:${actor.username}`, 60);
          const [,id,action] = withdrawalAction;
          if (action === 'manual-start') return send(200, { data: withdrawals.manualStart(id, actor.username) });
          if (action === 'manual-complete') return send(200, { data: withdrawals.manualComplete(id, actor.username, input) });
          if (action === 'manual-release') return send(200, { data: withdrawals.manualRelease(id, actor.username, input) });
          return send(200, { data: action === 'approve' || action === 'reject'
            ? withdrawals.review(id, action === 'approve', actor.username, input.reason)
            : await withdrawals.pay(id, actor.username, action === 'query') });
        }
        if (url.pathname === '/api/admin/referrals' && reading) {
          admin.requirePermission(request, 'referrals.view');
          return send(200, { data: referrals.report(url.searchParams) });
        }
        if (url.pathname === '/api/admin/orders' && reading) {
          const actor = admin.requirePermission(request, 'orders.view');
          return send(200, { data: adminOrders.list(url.searchParams, hasAdminPermission(actor, 'vouchers.codes'), hasAdminPermission(actor, 'orders.refund'), 'orders', hasAdminPermission(actor,'orders.reclaim')) });
        }
        if (url.pathname === '/api/admin/refunds' && reading) {
          const actor = admin.requirePermission(request, 'orders.refund');
          return send(200, { data: adminOrders.list(url.searchParams, hasAdminPermission(actor, 'vouchers.codes'), true, 'refunds') });
        }
        const reclaimVoucher = /^\/api\/admin\/orders\/(WS[0-9a-f]{20,60})\/reclaim-voucher$/.exec(url.pathname);
        if (reclaimVoucher && request.method === 'POST') {
          admin.requirePermission(request,'orders.reclaim');
          const input = await writeInput();
          const actor = admin.requirePermission(request,'orders.reclaim');
          rateLimit(`voucher-reclaim:${actor.username}`,20);
          const order = orders.forAdmin(reclaimVoucher[1]);
          return send(200,{data:await redemptions.reclaim(order,actor.username,input.expectedVoucherCode,()=>{
            if (admin.requirePermission(request,'orders.reclaim').username !== actor.username) throw new OrderError(403,'ADMIN_PERMISSION_REQUIRED','当前账号没有此操作权限。');
          })});
        }
        const refundReview = /^\/api\/admin\/orders\/(WS[0-9a-f]{20,60})\/refund\/(approve|reject)$/.exec(url.pathname);
        if (refundReview && request.method === 'POST') {
          admin.requirePermission(request, 'orders.refund');
          const input = await writeInput();
          const actor = admin.requirePermission(request, 'orders.refund');
          rateLimit(`order-refund-review:${actor.username}`, 30);
          return send(200, { data: await fulfillmentMonitor.review(refundReview[1],refundReview[2] === 'approve',actor.username,input.reason) });
        }
        if (url.pathname === '/api/admin/revenue' && reading) {
          admin.requirePermission(request, 'revenue.view');
          return send(200, { data: revenue.report(url.searchParams) });
        }
        if (url.pathname === '/api/admin/analytics/products' && reading) {
          admin.requirePermission(request, 'analytics.view');
          return send(200, { data: analytics.report(url.searchParams) });
        }
        if (url.pathname === '/api/admin/vouchers') {
          if (reading) {
            admin.requirePermission(request, 'vouchers.view');
            return send(200, { data: vouchers.list() });
          }
          if (request.method === 'POST') {
            admin.requirePermission(request, 'vouchers.import');
            const input = await writeInput();
            admin.requirePermission(request, 'vouchers.import');
            return send(201, { data: vouchers.importBatch(input) });
          }
        }
        const instructions = /^\/api\/admin\/vouchers\/([a-z0-9-]{1,80})\/instructions$/.exec(url.pathname);
        if (instructions && request.method === 'POST') {
          admin.requirePermission(request,'vouchers.import');
          const input = await writeInput();
          admin.requirePermission(request,'vouchers.import');
          return send(200,{data:vouchers.saveInstructions(instructions[1],input)});
        }
        const voucher = /^\/api\/admin\/vouchers\/([a-z0-9-]{1,80})\/cards(?:\/([1-9][0-9]*)\/remove)?$/.exec(url.pathname);
        if (voucher) {
          const [, productId, id] = voucher;
          if (!id && reading) {
            admin.requirePermission(request, 'vouchers.codes');
            const after = url.searchParams.get('after') ?? '0';
            if (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after))) return fail(400, 'INVALID_CURSOR', '卡密分页参数无效。');
            return send(200, { data: vouchers.listCards(productId, Number(after)) });
          }
          if (id && request.method === 'POST') {
            admin.requirePermission(request, 'vouchers.delete');
            if (!Number.isSafeInteger(Number(id))) return fail(400, 'INVALID_VOUCHER_ID', '卡密编号无效。');
            const input = await writeInput();
            admin.requirePermission(request, 'vouchers.delete');
            return send(200, { data: vouchers.removeCard(productId, Number(id), input) });
          }
        }
        if (url.pathname === '/api/admin/users') {
          const actor = admin.requirePermission(request, 'users.manage');
          if (reading) return send(200, { data: admin.listAccounts() });
          if (request.method === 'POST') {
            rateLimit(`admin-users:${actor.username}`, 20);
            return send(201, { data: await admin.createAccount(request, await writeInput()) });
          }
        }
        const accountAction = /^\/api\/admin\/users\/([a-zA-Z0-9_-]{3,40})\/(access|delete)$/.exec(url.pathname);
        if (accountAction && request.method === 'POST') {
          admin.requirePermission(request, 'users.manage');
          const [, username, action] = accountAction;
          const input = await writeInput();
          return send(200, { data: action === 'delete' ? admin.deleteAccount(request, username, input) : admin.updateAccess(request, username, input) });
        }
        return fail(404, 'NOT_FOUND', '后台接口不存在。');
      }
      if (url.pathname === '/api/payments/alipay/notify' && request.method === 'POST') {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        try {
          if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') throw new Error();
          const form = new URLSearchParams(await readBody(request));
          if ([...form.keys()].some(key => form.getAll(key).length !== 1)) throw new Error();
          orders.notify(Object.fromEntries(form));
          response.writeHead(200); response.end('success');
        } catch {
          console.warn('Alipay notification rejected; signature or business validation failed.');
          response.writeHead(400); response.end('fail');
        }
        return;
      }
      if (url.pathname === '/api/payments/config' && reading) {
        browserOwner(request, response, gateway, true);
        return send(200, { data: checkoutAllowed(request) ? gateway.status : {
          ...gateway.status, enabled: false, message: '购买暂未开放，请稍后再来。',
        } });
      }
      if (url.pathname === '/api/coupons/quote' && request.method === 'POST') {
        rateLimit(`coupon:${request.socket.remoteAddress}`, 30);
        const input = await readJson(request, gateway.origin);
        const { discountCents, originalCents, payableCents, code } = coupons.quote(input.code, input.productId);
        return send(200, { data: { discountCents, originalCents, payableCents, code } });
      }
      if (url.pathname === '/api/orders/lookup' && request.method === 'POST') {
        rateLimit('order-lookup', 40);
        const input = await readJson(request, gateway.origin);
        rateLimit(`lookup:${hash(String(input.contact || '').trim().toLowerCase())}`, 8);
        const browser = browserOwner(request, response, gateway, true)!;
        return send(200, { data: await orders.lookup(browser, input) });
      }
      if (url.pathname === '/api/orders/staff-checkout' && request.method === 'POST') {
        if (request.headers.origin !== (gateway.origin || `http://${request.headers.host}`)) return fail(403, 'INVALID_ORIGIN', '请从本站页面操作。');
        const input = await readJson(request, gateway.origin);
        const staff = staffOwner();
        if (!staff) return fail(403, 'STAFF_CHECKOUT_REQUIRED', '当前账号未开通免付权限。');
        rateLimit(`staff-checkout:${staff}`, 12);
        const key = request.headers['idempotency-key'];
        if (typeof key !== 'string') return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少订单提交编号，请刷新后重试。');
        return send(201, { data: orders.createStaff(staff, input.productId, key) });
      }
      if (url.pathname === '/api/orders') {
        if (reading) return send(200, { data: orders.list(owner(), staffOwner()) });
        if (request.method === 'POST') {
          if (!checkoutAllowed(request)) return fail(503, 'CHECKOUT_CLOSED', '购买暂未开放，请稍后再来。');
          rateLimit(`create:${request.socket.remoteAddress}`, 20);
          const input = await readJson(request, gateway.origin);
          const key = request.headers['idempotency-key'];
          if (typeof key !== 'string') return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少订单提交编号，请刷新后重试。');
          const browser = browserOwner(request, response, gateway, true)!;
          return send(201, { data: await orders.create(browser, input, key, referrals.attribution(browser, referrals.current(request)?.id)) });
        }
      }
      const redemption = url.pathname.match(/^\/api\/orders\/(WS[0-9a-f]{20,60})\/redemption(?:\/(policy|preview|submit|refresh))?$/);
      if (redemption) {
        const [, id, action] = redemption;
        const order = orders.owned(id, owner(), staffOwner());
        if (order.deliveryType === 'voucher') return fail(409,'NOT_REDEMPTION_PRODUCT','该商品付款后获取卡密，请在订单中查看交付内容。');
        if (order.cancellation) {
          if (reading && !action) return send(200,{data:{enabled:false,submitted:false,account:null,result:null,cancellation:order.cancellation}});
          if (request.method === 'POST' && action === 'refresh') {
            await readJson(request,gateway.origin);
            const current=orders.owned(id,owner(),staffOwner());
            return send(200,{data:{enabled:false,submitted:false,account:null,result:null,cancellation:current.cancellation}});
          }
          return fail(409,'ORDER_FULFILLMENT_TIMEOUT',order.cancellation.message);
        }
        if (order.status !== 'paid' || order.environment !== gateway.status.environment) {
          return fail(409, 'REDEMPTION_ORDER_INELIGIBLE', '仅支持兑换当前环境的已付款订单。');
        }
        if (reading && !action) return send(200, { data: redemptions.view(order) });
        if (reading && action === 'policy') {
          rateLimit(`redemption-policy:${id}`, 10);
          return send(200, { data: await redemptions.policy() });
        }
        if (request.method === 'POST' && (action === 'preview' || action === 'submit' || action === 'refresh')) {
          if (request.headers.origin !== (gateway.origin || `http://${request.headers.host}`)) return fail(403, 'INVALID_ORIGIN', '请从本站页面发起请求。');
          rateLimit(`redemption:${action}:${id}`, action === 'refresh' ? 20 : 8);
          const input = await readJson(request, gateway.origin, action === 'preview' || (action === 'submit' && order.staffCheckout) ? 1024000 : undefined);
          // Recheck authorization after reading the request body.
          if (order.staffCheckout) orders.owned(id, null, staffOwner());
          const data = action === 'preview' ? await redemptions.preview(order, input)
            : action === 'submit' ? await redemptions.submit(order, input.confirmationId, input.sessionInput) : await redemptions.refresh(order);
          return send(200, { data });
        }
        return fail(405, 'METHOD_NOT_ALLOWED', '请求方式无效。');
      }
      const cardDelivery = /^\/api\/orders\/(WS[0-9a-f]{20,60})\/card$/.exec(url.pathname);
      if (cardDelivery && request.method === 'POST') {
        await readJson(request,gateway.origin);
        const browser = owner(), staff = staffOwner();
        orders.owned(cardDelivery[1],browser,staff);
        rateLimit(`card-delivery:${browser || staff}:${cardDelivery[1]}`,30);
        return send(200,{data:orders.claimCard(cardDelivery[1],browser,staff)});
      }
      const match = url.pathname.match(/^\/api\/orders\/(WS[0-9a-f]{20,60})(?:\/(payment|payment-qr|refresh|close|cancel))?$/);
      if (match) {
        const [, id, action] = match;
        if (!action && reading) return send(200, { data: orders.owned(id, owner(), staffOwner()) });
        if (action && request.method === 'POST') {
          const input = await readJson(request, gateway.origin);
          const browser = owner();
          if (orders.owned(id, browser, staffOwner()).staffCheckout) return fail(409, 'ORDER_PAYMENT_EXEMPT', action === 'cancel' ? '免付开通订单不支持取消。' : '免付开通订单无需付款。');
          rateLimit(`${action}:${browser}`, action === 'refresh' ? 30 : 20);
          if(action==='cancel') {
            const current=orders.owned(id,browser);
            if(current.cancellation)return send(200,{data:current});
            const eligible=orders.cancellationEligible(id,browser);
            if(input.expectedAction!==eligible.cancelAction) return fail(409,'ORDER_CANCELLATION_CHANGED','订单状态已变更，请刷新后重新确认取消方式。');
            if(eligible.cancelAction==='request_refund') {
              await fulfillmentMonitor.requestCancellation(()=>orders.cancellationEligible(id,browser));
              return send(200,{data:orders.owned(id,browser)});
            }
            try {return send(200,{data:await orders.close(id,browser,true)});}
            catch(error) {
              if(error instanceof OrderError)throw error;
              return fail(502,'CANCELLATION_UNCONFIRMED','暂时无法核实支付状态，未确认取消，请刷新订单后重试。');
            }
          }
          if (action === 'payment' || action === 'payment-qr') {
            if (!checkoutAllowed(request)) return fail(503, 'CHECKOUT_CLOSED', '购买暂未开放，请稍后再来。');
            return send(200, { data: action === 'payment-qr' ? orders.paymentQr(id, browser) : orders.payment(id, browser) });
          }
          try { return send(200, { data: action === 'close' ? await orders.close(id, browser) : await orders.refresh(id, browser) }); }
          catch (error) {
            if (error instanceof OrderError) throw error;
            return fail(502, 'PAYMENT_QUERY_FAILED', '暂时无法核实支付宝交易，请稍后查询，勿重复付款。');
          }
        }
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        return fail(405, 'METHOD_NOT_ALLOWED', '该接口只支持读取。');
      }
      if (url.pathname === '/api/health') {
        db.prepare('SELECT 1').get();
        return send(200, { data: { status: 'ok' } });
      }
      if (url.pathname === '/api/home') {
        return send(200, { data: { ...catalog.home(), products: catalog.listProducts(), faqs: catalog.faqs() } });
      }
      if (url.pathname === '/api/products') {
        const category = url.searchParams.get('category') || undefined;
        if (category && !['Plus', 'Pro', 'Codex'].includes(category)) return fail(400, 'INVALID_CATEGORY', '套餐分类无效。');
        if ([...url.searchParams.keys()].some((key) => key !== 'category') || url.searchParams.getAll('category').length > 1) {
          return fail(400, 'INVALID_QUERY', '请求参数无效。');
        }
        return send(200, { data: catalog.listProducts(category) });
      }
      if (url.pathname.startsWith('/api/products/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/products/'.length));
        if (!/^[a-z0-9-]{1,80}$/.test(id)) return fail(400, 'INVALID_PRODUCT_ID', '商品编号无效。');
        const product = catalog.findProduct(id);
        return product ? send(200, { data: product }) : fail(404, 'PRODUCT_NOT_FOUND', '套餐不存在或已下架。');
      }
      if (url.pathname === '/api/content') {
        return send(200, { data: { faqs: catalog.faqs(), articles: catalog.articles() } });
      }
      return fail(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (error instanceof OrderError) return fail(error.status, error.code, error.message);
      if (error instanceof URIError) return fail(400, 'INVALID_PATH', '请求路径无效。');
      console.error(`[${requestId}] API request failed`);
      return fail(503, 'SERVICE_UNAVAILABLE', '服务暂不可用，请稍后重试。');
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 50;
  if (options.fulfillmentMonitor) server.once('listening', () => fulfillmentMonitor.start());
  server.once('close', () => { void fulfillmentMonitor.stop().catch(() => {}); });
  return Object.assign(server, { stopFulfillmentMonitor: () => fulfillmentMonitor.stop() });
}
