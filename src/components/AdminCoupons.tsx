import { useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Ticket, Trash2 } from 'lucide-react';
import { useMessage } from '../app/MessageProvider';
import { useApiResource } from '../hooks/useApiResource';
import { ApiError, postApi } from '../services/api';
import { money } from '../lib/format';
import type { Product } from '../types/catalog';
import { SelectField } from './SelectField';
import { Dialog } from './Dialog';
import { AdminTable } from './AdminTable';
import './admin-coupons.css';

type Coupon = { id: string; code: string; productId: string | null; minCents: number; discountCents: number; usageLimit: number; active: number; reserved: number; paid: number };
type CouponDialog = { type: 'add' } | { type: 'edit' | 'delete'; coupon: Coupon };
const cents = (value: string) => /^\d{1,8}(\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : NaN;

function CouponForm({ coupon, products, onCancel, onSaved, onExpired }: { coupon: Coupon | null; products: Product[]; onCancel: () => void; onSaved: (text: string) => void; onExpired: () => void }) {
  const [productId, setProductId] = useState(coupon?.productId ?? 'all');
  const [minimum, setMinimum] = useState(coupon ? String(coupon.minCents / 100) : '0');
  const [discount, setDiscount] = useState(coupon ? String(coupon.discountCents / 100) : '');
  const [limit, setLimit] = useState(coupon ? String(coupon.usageLimit) : '');
  const [busy, setBusy] = useState(false); const message = useMessage();
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!Number.isSafeInteger(cents(minimum)) || !Number.isSafeInteger(cents(discount)) || cents(discount) <= 0 || !/^[1-9]\d{0,6}$/.test(limit) || Number(limit) > 1000000) {
      message.warning('请填写有效的金额和使用次数。');
      return;
    }
    setBusy(true);
    try {
      await postApi(coupon ? `/admin/coupons/${coupon.id}/update` : '/admin/coupons', {
        productId: productId === 'all' ? null : productId,
        minCents: cents(minimum),
        discountCents: cents(discount),
        usageLimit: Number(limit),
      });
      onSaved(coupon ? '优惠券已保存。' : '优惠券已创建。');
    } catch (error) { if (error instanceof ApiError && error.status === 401) onExpired(); else message.error(error instanceof Error ? error.message : '保存失败。'); } finally { setBusy(false); }
  }
  return <Dialog title={coupon ? '编辑优惠券' : '新增优惠券'} className="admin-user-dialog" onClose={() => { if (!busy) onCancel(); }}>
    {!coupon && <p className="admin-dialog-account">优惠码将在创建后自动生成。</p>}
    <form className="admin-account-form coupon-dialog-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        {coupon && <>
          <label htmlFor="coupon-admin-code">优惠码</label>
          <input id="coupon-admin-code" value={coupon.code} readOnly />
        </>}
        <SelectField label="适用商品" value={productId} onValueChange={setProductId} options={[{ value: 'all', label: '全店商品' }, ...products.map(p => ({ value: p.id, label: p.name }))]} />
        <label htmlFor="coupon-minimum">满额（元）</label><input id="coupon-minimum" inputMode="decimal" value={minimum} onChange={e => setMinimum(e.target.value)} />
        <label htmlFor="coupon-discount">优惠金额（元）</label><input id="coupon-discount" inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} placeholder="例如 5" />
        <label htmlFor="coupon-limit">使用次数</label><input id="coupon-limit" inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} placeholder="例如 100" />
        {coupon && <p className="field-hint">已有 {coupon.reserved} 笔订单占用名额，已创建订单的金额保持不变。</p>}
        <div className="admin-account-actions"><button type="button" className="button secondary" onClick={onCancel}>取消</button><button className="button primary" type="submit">{busy ? '正在保存…' : coupon ? '保存修改' : '创建优惠券'}</button></div>
      </fieldset>
    </form>
  </Dialog>;
}

function DeleteCoupon({ coupon, onCancel, onSaved, onExpired }: { coupon: Coupon; onCancel: () => void; onSaved: (text: string) => void; onExpired: () => void }) {
  const [busy, setBusy] = useState(false); const message = useMessage();
  async function remove() {
    if (busy) return; setBusy(true);
    try { await postApi(`/admin/coupons/${coupon.id}/delete`, {}); onSaved('优惠券已删除。'); }
    catch (error) { if (error instanceof ApiError && error.status === 401) onExpired(); else message.error(error instanceof Error ? error.message : '删除失败。'); } finally { setBusy(false); }
  }
  return <Dialog title="删除优惠券" className="admin-user-dialog" onClose={() => { if (!busy) onCancel(); }}>
    <p className="admin-delete-description">确定删除优惠券 <strong>{coupon.code}</strong>？删除后顾客不能再使用该优惠码，历史订单和占用记录会保留。</p>
    <div className="admin-account-actions"><button className="button secondary" onClick={onCancel} disabled={busy}>取消</button><button className="button danger" onClick={() => void remove()} disabled={busy}>{busy ? '正在删除…' : '确认删除'}</button></div>
  </Dialog>;
}

export function AdminCoupons({ onExpired }: { onExpired: () => void }) {
  const coupons = useApiResource<Coupon[]>('/admin/coupons'); const products = useApiResource<Product[]>('/products');
  const [dialog, setDialog] = useState<CouponDialog | null>(null); const message = useMessage();
  function saved(text: string) { setDialog(null); coupons.reload(); message.success(text); }
  async function toggle(coupon: Coupon) {
    try { await postApi(`/admin/coupons/${coupon.id}/status`, { active: !coupon.active }); coupons.reload(); message.success(coupon.active ? '优惠券已停用。' : '优惠券已启用。'); }
    catch (error) { if (error instanceof ApiError && error.status === 401) onExpired(); else message.error(error instanceof Error ? error.message : '操作失败。'); }
  }
  return <><div className="admin-heading admin-users-heading"><div><h1>优惠券管理</h1><p>管理优惠码、适用商品、满减门槛和使用次数。</p></div><button className="button primary" onClick={() => setDialog({ type: 'add' })}><Plus aria-hidden="true" />新增优惠券</button></div>
    <section className="admin-panel admin-list-panel" aria-labelledby="coupon-list-title">
      <div className="admin-panel-title">
        <div>
          <h2 id="coupon-list-title">优惠券列表</h2>
          <p>订单创建后占用一次名额，已付款数量单独统计。</p>
        </div>
        {coupons.data && <span className="admin-list-count">{coupons.data.length} 张优惠券</span>}
      </div>
      {coupons.loading && <p className="admin-loading" role="status">正在读取优惠券列表…</p>}
      {coupons.error && <p><button className="text-button" onClick={coupons.error.status === 401 ? onExpired : coupons.reload}>{coupons.error.status === 401 ? '重新登录' : '重试'}</button></p>}
      {coupons.data && <AdminTable className="coupon-table" labelledBy="coupon-list-title"
        emptyState={coupons.data.length === 0 && <>
          <span className="admin-table-empty-icon"><Ticket aria-hidden="true" /></span>
          <strong>暂无优惠券</strong>
          <p className="admin-table-secondary">点击「新增优惠券」创建第一张优惠券。</p>
        </>}>
        <thead>
          <tr>
            <th scope="col"><span className="coupon-wide">优惠码</span><span className="coupon-compact">优惠券</span></th>
            <th scope="col" className="coupon-wide">适用商品</th>
            <th scope="col" className="coupon-wide admin-table-end">优惠规则</th>
            <th scope="col" className="coupon-wide admin-table-end">名额占用</th>
            <th scope="col" className="coupon-wide">状态</th>
            <th scope="col" className="admin-table-end">操作</th>
          </tr>
        </thead>
        <tbody>{coupons.data.map(coupon => {
          const productName = coupon.productId
            ? products.data?.find(product => product.id === coupon.productId)?.name ?? coupon.productId
            : '全店商品';
          const discount = `减 ¥${money(coupon.discountCents)}`;
          const threshold = coupon.minCents ? `满 ¥${money(coupon.minCents)} 可用` : '无门槛';
          const usage = `${coupon.reserved} / ${coupon.usageLimit}`;
          const paid = `已付款 ${coupon.paid} 笔`;
          const status = <span className={`coupon-status ${coupon.active ? 'active' : ''}`}>{coupon.active ? '启用' : '停用'}</span>;
          return <tr key={coupon.id}>
            <td>
              <div className="coupon-code">
                <span className="coupon-code-icon"><Ticket aria-hidden="true" /></span>
                <code>{coupon.code}</code>
                <span className="coupon-compact">{status}</span>
              </div>
              <div className="coupon-compact coupon-compact-details">
                <div>{productName}</div>
                <div><strong className="coupon-discount admin-table-number">{discount}</strong> · {threshold}</div>
                <div className="admin-table-secondary">占用 <span className="admin-table-number">{usage}</span> · {paid}</div>
              </div>
            </td>
            <td className="coupon-wide coupon-product-name">{productName}</td>
            <td className="coupon-wide admin-table-end">
              <strong className="coupon-discount admin-table-number">{discount}</strong>
              <div className="admin-table-secondary admin-table-number">{threshold}</div>
            </td>
            <td className="coupon-wide admin-table-end">
              <strong className="admin-table-number">{usage}</strong>
              <div className="admin-table-secondary">{paid}</div>
            </td>
            <td className="coupon-wide">{status}</td>
            <td className="admin-table-end">
              <div className="admin-table-actions">
                <button type="button" className="admin-table-edit" onClick={() => setDialog({ type: 'edit', coupon })} aria-label={`编辑 ${coupon.code}`}>
                  <Pencil aria-hidden="true" />编辑
                </button>
                <button type="button" onClick={() => void toggle(coupon)}>{coupon.active ? '停用' : '启用'}</button>
                <button type="button" className="admin-table-delete" onClick={() => setDialog({ type: 'delete', coupon })} aria-label={`删除 ${coupon.code}`}>
                  <Trash2 aria-hidden="true" />删除
                </button>
              </div>
            </td>
          </tr>;
        })}</tbody>
      </AdminTable>}
    </section>
    {dialog?.type === 'delete' && <DeleteCoupon coupon={dialog.coupon} onCancel={() => setDialog(null)} onSaved={saved} onExpired={onExpired} />}
    {(dialog?.type === 'add' || dialog?.type === 'edit') && <CouponForm coupon={dialog.type === 'edit' ? dialog.coupon : null} products={products.data ?? []} onCancel={() => setDialog(null)} onSaved={saved} onExpired={onExpired} />}
  </>;
}
