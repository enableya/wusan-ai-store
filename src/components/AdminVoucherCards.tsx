import { useMessage } from '../app/MessageProvider';
import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import { Dialog } from './Dialog';
import { useApiResource } from '../hooks/useApiResource';
import { ApiError, postApi } from '../services/api';
import type { VoucherCard, VoucherPage } from '../types/admin';

function ConfirmRemoval({ card, copyFirst, path, onClose, onRemoved, onExpired }: {
  card: VoucherCard; copyFirst: boolean; path: string; onClose: (refresh: boolean) => void; onRemoved: () => void; onExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const $message = useMessage();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const close = () => { if (!busy) onClose(needsRefresh); };

  async function confirm() {
    if (busy) return;
    setBusy(true);
    let copied = false;
    try {
      if (copyFirst) {
        await navigator.clipboard.writeText(card.code);
        copied = true;
      }
      await postApi(`${path}/${card.id}/remove`, { createdAt: card.createdAt });
      onRemoved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else if (copyFirst && !copied) $message.error('复制失败，未删除卡密。请允许浏览器访问剪贴板后重试。');
      else {
        setNeedsRefresh(true);
        const prefix = copied ? '卡密已复制，' : '';
        $message.error(cause instanceof ApiError && cause.status === 409
          ? `${prefix}库存发生变更，请核对最新列表。` : `${prefix}删除结果未确认，请核对最新列表。`);
      }
    } finally { setBusy(false); }
  }

  return <Dialog title={copyFirst ? '确认复制并删除' : '删除卡密'} className="admin-user-dialog" onClose={close}>
    <p>确认后会将尾号为 <strong>{card.code.slice(-6)}</strong> 的卡密{copyFirst ? '复制到剪贴板，并' : ''}从可用库存中删除。此操作无法撤销。</p>
    <div className="admin-account-actions">
      <button className="button secondary" type="button" disabled={busy} onClick={close}>{needsRefresh ? '关闭并刷新' : '取消'}</button>
      {!needsRefresh && <button className="button danger" type="button" disabled={busy} onClick={() => void confirm()}>
        {busy ? '正在处理…' : copyFirst ? '确认复制并删除' : '确认删除'}
      </button>}
    </div>
  </Dialog>;
}

export function AdminVoucherCards({ productId, canDelete, onExpired, onRemoved }: {
  productId: string; canDelete: boolean; onExpired: () => void; onRemoved: () => void;
}) {
  const $message = useMessage();
  const [cursors, setCursors] = useState([0]);
  const [pendingRemoval, setPendingRemoval] = useState<{ card: VoucherCard; copyFirst: boolean } | null>(null);
  const path = `/admin/vouchers/${encodeURIComponent(productId)}/cards`;
  const inventory = useApiResource<VoucherPage>(`${path}?after=${cursors.at(-1)}`, { keepDataWhileReloading: true });
  const cards = inventory.data?.cards;
  const next = inventory.data?.next;

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      $message.success('已复制卡密。');
    } catch { $message.error('无法访问剪贴板。可以选中卡密手动复制。'); }
  }

  function removed(copyFirst: boolean) {
    setPendingRemoval(null);
    $message.success(copyFirst ? '已复制卡密，并从库存删除。' : '已删除卡密。');
    onRemoved();
    if (cards?.length === 1 && cursors.length > 1) setCursors(current => current.slice(0, -1));
    else inventory.reload();
  }

  function changePage(cursor?: number) {
    setCursors(current => cursor === undefined ? current.slice(0, -1) : [...current, cursor]);
  }

  return <div className="admin-voucher-list">
    <h2>可用卡密</h2>
    {inventory.loading && !cards && <p role="status">正在读取卡密…</p>}
    {inventory.error && <p>
      <button className="text-button" type="button" onClick={inventory.error.status === 401 ? onExpired : inventory.reload}>{inventory.error.status === 401 ? '重新登录' : '重试'}</button>
    </p>}
    {cards?.length === 0 && <p className="admin-voucher-empty">当前页暂无可用卡密。</p>}
    {cards && cards.length > 0 && <ul className="admin-voucher-rows" aria-label="可用卡密列表">
      {cards.map(card => <li key={card.id}>
        <div className="admin-voucher-code"><code>{card.code}</code>{!!card.priority && <span className="admin-chip">优先</span>}</div>
        <div className="admin-voucher-row-actions">
          <button className="button secondary" type="button" disabled={inventory.loading} onClick={() => void copy(card.code)}><Copy aria-hidden="true" />复制</button>
          {canDelete && <>
            <button className="button secondary" type="button" disabled={inventory.loading}
              onClick={() => setPendingRemoval({ card, copyFirst: true })}>复制并删除</button>
            <button className="button secondary admin-voucher-remove" type="button" disabled={inventory.loading}
              onClick={() => setPendingRemoval({ card, copyFirst: false })}><Trash2 aria-hidden="true" />删除</button>
          </>}
        </div>
      </li>)}
    </ul>}
    {(cursors.length > 1 || next != null) && <nav className="admin-voucher-pagination" aria-label="卡密分页">
      <button className="button secondary" type="button" disabled={cursors.length === 1 || inventory.loading} onClick={() => changePage()}>上一页</button>
      <span>第 {cursors.length} 页</span>
      <button className="button secondary" type="button" disabled={next == null || inventory.loading} onClick={() => { if (next != null) changePage(next); }}>下一页</button>
    </nav>}
    {pendingRemoval && <ConfirmRemoval {...pendingRemoval} path={path} onExpired={onExpired}
      onRemoved={() => removed(pendingRemoval.copyFirst)} onClose={refresh => {
        setPendingRemoval(null);
        if (refresh) { onRemoved(); inventory.reload(); }
      }} />}
  </div>;
}
