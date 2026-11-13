import { usePaymentConfig } from '../hooks/usePaymentConfig';
import { useMessage } from '../app/MessageProvider';
import { useCustomer } from '../app/CustomerProvider';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Copy, X } from 'lucide-react';
import { Icon } from './Icon';
import { SupportButton } from './SupportButton';
import { AccountRedemption } from './AccountRedemption';
import { CardDelivery } from './CardDelivery';
import { PurchaseForm, PurchaseSummary } from './PurchaseForm';
import type { CouponQuote } from './PurchaseForm';
import { postApi } from '../services/api';
import { money } from '../lib/format';
import type { Product } from '../types/catalog';
import type { Order } from '../types/orders';


function randomCode(previous = '') {
  let code: string;
  do {
    code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  } while (code === previous);
  return code;
}

export function ProductPurchase({ product }: { product: Product }) {
  const payment = usePaymentConfig(product.id);
  const { user } = useCustomer();
  const [code, setCode] = useState(randomCode);
  const [answer, setAnswer] = useState('');
  const [invalidCode, setInvalidCode] = useState(false);
  const $message = useMessage();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [creating, setCreating] = useState(false);
  const createLock = useRef(false);
  const staffOrderKey = useRef(crypto.randomUUID());
  const selectable = product.selectable && product.priceCents !== null;
  const sandbox = payment.data?.environment === 'sandbox';
  const staff = user?.staffCheckout === true;
  const currentOrder = order?.staffCheckout && !staff ? null : order;
  const canOpenCheckout = selectable && (staff || (!payment.paused && (sandbox || payment.data?.enabled === true)));

  function renewCode() {
    setCode(randomCode(code)); setAnswer(''); setInvalidCode(false);
  }
  async function showCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOpenCheckout) return;
    if (staff) {
      if (createLock.current) return;
      createLock.current = true; setCreating(true);
      try {
        const result = await postApi<Order>('/orders/staff-checkout', { productId: product.id }, staffOrderKey.current);
        setOrder(result);
        setOpen(true);
      } catch (cause) {
        $message.error(cause instanceof Error ? cause.message : '无法创建免付订单，请重试。');
      } finally {
        createLock.current = false; setCreating(false);
      }
      return;
    }
    if (answer !== code) {
      setInvalidCode(true);
      $message.warning('请输入正确的四位验证码。');
      event.currentTarget.querySelector<HTMLInputElement>('input[name="captcha"]')?.focus();
      return;
    }
    setOpen(true);
  }
  return <>
    <form className="product-purchase-form" onSubmit={showCheckout}>
      {staff && (!currentOrder || currentOrder.staffCheckout)
        ? <div className="product-order-total"><span>超级管理员免付开通</span><strong>¥0</strong></div>
        : <PurchaseSummary product={product} environment={payment.data?.environment} />}
      {selectable && !currentOrder && !staff && <div className="purchase-field purchase-captcha">
        <label htmlFor="purchase-captcha">验证码</label>
        <div className="purchase-captcha-row">
          <input id="purchase-captcha" name="captcha" value={answer} inputMode="numeric" autoComplete="off" maxLength={4} placeholder="输入四位验证码" aria-invalid={invalidCode} onChange={event => { setAnswer(event.target.value.replace(/\D/g, '')); setInvalidCode(false); }} />
          <button type="button" className="purchase-captcha-code" onClick={renewCode} aria-label={`验证码 ${code}，点击更换`} title="更换验证码">{code}</button>
        </div>
      </div>}
      <button className="button primary full-width buy-now" type={currentOrder ? 'button' : 'submit'} disabled={creating || !selectable || (!currentOrder && !canOpenCheckout)} onClick={currentOrder ? () => setOpen(true) : undefined}>
        {creating ? '正在创建订单…' : currentOrder ? '查看订单进度' : '立即购买'}<Icon name="arrow-right" />
      </button>
      {!selectable && <p className="field-hint payment-availability">商品暂未开放购买。</p>}
      {selectable && !currentOrder && !staff && (!payment.data?.enabled || payment.paused) && <p className="field-hint payment-availability">
        {payment.loading ? '正在确认支付状态…' : payment.error ? null : payment.paused ? payment.data?.message : sandbox ? '可预览购买流程，付款需启用支付宝沙箱。' : '支付宝收款暂未开放。'}
        {payment.error && <button type="button" className="text-button" onClick={payment.reload}>重试</button>}
      </p>}
    </form>
    <PurchaseDialog product={product} open={open && (!order?.staffCheckout || staff)} onClose={() => setOpen(false)} order={currentOrder} onOrder={setOrder} />
  </>;
}

export function PurchaseDialog({ product, open, onClose, order, onOrder }: {
  product: Product; open: boolean; onClose: () => void; order: Order | null; onOrder: (order: Order) => void;
}) {
  const payment = usePaymentConfig(order?.productId||product.id,open);
  const dialog = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [couponQuote, setCouponQuote] = useState<CouponQuote | null>(null);
  useEffect(() => { if (!open || order) setCouponQuote(null); }, [open, order]);
  const queryFailed = useRef(false);
  const $message = useMessage();
  const [now, setNow] = useState(Date.now);
  const queryLock = useRef(false);
  const qrLock = useRef(false);
  const orderId = order?.id;
  const pending = order?.status === 'pending';
  const remaining = order ? Math.max(0, Math.ceil((Date.parse(order.expiresAt) - now) / 1000)) : 0;

  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (open && !modal.open) modal.showModal();
    else if (!open && modal.open) modal.close();
  }, [open]);

  async function loadQr(order: Order) {
    if (qrLock.current || payment.paused) return;
    qrLock.current = true; setQrLoading(true); setQrFailed(false);
    try {
      const result = await postApi<{ paymentUrl: string }>(`/orders/${order.id}/payment-qr`, {});
      const url = new URL(result.paymentUrl);
      const gateway = order.environment === 'production' ? 'https://openapi.alipay.com' : 'https://openapi-sandbox.dl.alipaydev.com';
      if (url.origin !== gateway || url.pathname !== '/gateway.do' || url.username || url.password) {
        throw new Error('支付宝扫码地址异常，请从付款页继续。');
      }
      setQr(url.href);
    } catch (cause) {
      setQrFailed(true);
      $message.error(cause instanceof Error ? cause.message : '暂时无法生成支付宝二维码。');
    } finally { qrLock.current = false; setQrLoading(false); }
  }

  useEffect(() => {
    if (!open || !pending || !orderId) return;
    setNow(Date.now());
    const expiresAt = Date.parse(order.expiresAt);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (Date.now() > expiresAt + 60_000) clearInterval(poll);
      else if (document.visibilityState === 'visible') void refresh(orderId);
    }, 5000);
    return () => { clearInterval(timer); clearInterval(poll); };
  }, [open, pending, orderId, order?.expiresAt]);

  async function refresh(id: string, manual = false) {
    if (queryLock.current) return;
    queryLock.current = true;
    try {
      const result = await postApi<Order>(`/orders/${id}/refresh`, {});
      onOrder(result);
      queryFailed.current = false;
      if (result.status === 'paid') $message.success('付款已确认。');
      else if (manual && result.status === 'pending') $message.info('暂未确认付款，请稍后再查。');
    } catch (cause) {
      if (manual || !queryFailed.current) $message.error(cause instanceof Error ? cause.message : '暂时无法查询支付结果。');
      queryFailed.current = true;
    }
    finally { queryLock.current = false; }
  }

  function created(result: Order) {
    setNow(Date.now()); onOrder(result);
    if (result.status === 'pending') void loadQr(result);
  }

  async function copyOrder(id: string) {
    try { await navigator.clipboard.writeText(id); $message.success('订单号已复制。'); }
    catch { $message.error('复制失败，请手动选中订单号。'); }
  }

  const [redemptionStarted, setRedemptionStarted] = useState(false);
  const cardProduct = (order?.deliveryType || product.deliveryType) === 'voucher';
  const steps = cardProduct ? ['信息确认','确认付款','获取卡密'] : order?.staffCheckout ? ['连接账号', '开通结果'] : ['信息确认', '确认付款', '连接账号', '开通结果'];
  const step = cardProduct ? order?.status === 'paid' ? redemptionStarted ? 3 : 2 : order ? 1 : 0 : order?.staffCheckout ? Number(redemptionStarted) : order?.status === 'paid' ? (redemptionStarted ? 3 : 2) : order ? 1 : 0;
  const amount = order?.priceCents ?? couponQuote?.payableCents ?? product.priceCents;
  const originalAmount = order ? order.originalPriceCents : couponQuote?.originalCents;
  const discounted = !order?.staffCheckout && amount !== null && originalAmount != null && originalAmount > amount;
  return createPortal(<dialog ref={dialog} className="purchase-dialog" aria-labelledby="purchase-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="purchase-dialog-header">
      <div><h2 id="purchase-dialog-title">{order ? '订单编号' : '确认购买'}</h2>{order && <p className="mono">{order.id}</p>}</div>
      {order && <button type="button" className="purchase-dialog-icon" aria-label="复制订单编号" onClick={() => void copyOrder(order.id)}><Copy /></button>}
      <button type="button" className="purchase-dialog-icon" aria-label="关闭购买弹窗" onClick={onClose}><X /></button>
    </header>
    <div className="purchase-dialog-body">
      <div className="purchase-dialog-product">
        <Icon name="package" />
        <div><h3>{order?.productName ?? product.name}</h3><p>{cardProduct?(product.unitLabel==='次'?'一次性接码 · 卡密交付':'成品号 · 卡密交付'):`${order?.periodMonths ?? product.periodMonths} 个月订阅`}</p></div>
        <div className="purchase-dialog-price" aria-live="polite"><div className="purchase-dialog-price-amounts" data-discounted={discounted}>
          <strong>{amount === null ? '待确认' : `¥${money(amount)}`}</strong>
          {discounted && <del title="优惠前价格">¥{money(originalAmount)}</del>}</div><p>数量 × 1</p></div>
      </div>
      <ol className="purchase-dialog-steps" data-staff-checkout={order?.staffCheckout} data-card-delivery={cardProduct || undefined}>
        {steps.map((label, index) =>
          <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step || undefined}>
            <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>{label}
          </li>)}
      </ol>
      {open && !order && <PurchaseForm product={product} onCreated={created} onQuoteChange={setCouponQuote} />}
      {open && order?.cancellation && <section className="purchase-qr-panel" aria-label="订单取消状态"><h3>{order.status === 'cancelled' ? '订单已取消' : '超时退款处理中'}</h3><p>{order.cancellation.message}</p></section>}
      {open && order?.status === 'paid' && !order.cancellation && <>
        <p>{order.staffCheckout ? '免付开通订单已创建' : '付款已确认'}</p>
        {cardProduct?<CardDelivery orderId={order.id} onDelivered={()=>setRedemptionStarted(true)} />:<AccountRedemption orderId={order.id} productName={order.productName} presentation="dialog" onResult={() => setRedemptionStarted(true)} />}
      </>}
      {order && order.status !== 'paid' && order.status !== 'cancelled' && <section className="purchase-qr-panel" aria-label="支付宝支付">
        <header><img src="/brand/alipay.svg" alt="" width="28" height="28" /><h3>支付宝支付</h3>
          {pending && remaining > 0 && <time>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</time>}
        </header>
        {payment.paused ? <p role="status">{payment.data?.message}</p> : pending && remaining > 0 ? <>
          <div className="purchase-qr-content">
            {qr && <iframe className="purchase-qr-frame" src={qr} title="支付宝付款二维码" />}
            <div><p>应付金额</p><strong>¥{money(order.priceCents)}</strong>
              {qr && <p>{order.environment === 'sandbox' ? '请使用支付宝沙箱版 App 扫码付款。' : '请使用手机支付宝「扫一扫」完成付款。'}</p>}
              {qrLoading && <p role="status">正在生成付款二维码…</p>}
              {qrFailed && <button type="button" className="button secondary" onClick={() => void loadQr(order)}>重新获取二维码</button>}
              <Link className="text-button spaced-button" to={`/pay/${order.id}`} target="_blank" rel="noopener">在新标签页打开付款页</Link>
            </div>
          </div>
          <p className="purchase-qr-note">付款后自动更新进度，请勿重复付款。</p>
        </> : <div className="purchase-qr-content" role="status">
          {order.status === 'closed' ? '订单已关闭。' : '付款时间已结束，请刷新进度确认付款结果。'}
          <Link className="text-button" to={`/pay/${order.id}`}>查看订单</Link>
        </div>}
      </section>}
      <footer className="purchase-dialog-footer">
        <SupportButton className="button secondary"><Icon name="headphones" />联系客服</SupportButton>
        {order && pending && <button type="button" className="button secondary" onClick={() => void refresh(order.id, true)}><Icon name="refresh-cw" />刷新进度</button>}
      </footer>
    </div>
  </dialog>, document.body);
}
