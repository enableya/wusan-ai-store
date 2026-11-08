import { useMessage } from '../app/MessageProvider';
import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useApiResource } from '../hooks/useApiResource';
import { ApiError, postApi } from '../services/api';
import { AdminVoucherCards } from './AdminVoucherCards';

type Inventory = {
  environment: 'sandbox' | 'production';
  products: { id: string; name: string; total: number; priority: number }[];
};

function VoucherImport({ productId, onExpired, onImported }: { productId: string; onExpired: () => void; onImported: () => void }) {
  const [lines, setLines] = useState('');
  const [priority, setPriority] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const $message = useMessage();
  const fileInput = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    try {
      if (!file.name.toLowerCase().endsWith('.txt') || file.size > 16384) {
        throw new Error('请选择不超过 16 KB 的 TXT 文件。');
      }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setLines(content);
    } catch (cause) {
      $message.error(cause instanceof TypeError ? '请使用 UTF-8 编码的 TXT 文件。' : cause instanceof Error ? cause.message : '无法读取文件。');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const payload = { productId, lines, priority, skipDuplicates };
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 16384) {
        throw new Error('本批卡密超过 16 KB，请分批导入。');
      }
      const result = await postApi<{ added: number; skipped: number }>('/admin/vouchers', payload);
      setLines(''); $message.success('已添加 ' + result.added + ' 条，跳过重复卡密 ' + result.skipped + ' 条。');
      onImported();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else $message.error(cause instanceof Error ? cause.message : '卡密导入失败。');
    } finally { setBusy(false); }
  }

  const fieldId = `voucher-lines-${productId}`;
  return <form className="admin-vouchers" onSubmit={submit}>
      <fieldset disabled={busy}>
        <label htmlFor={fieldId}>卡密</label>
        <textarea id={fieldId} rows={9} maxLength={16384} value={lines} onChange={event => setLines(event.target.value)} required
          autoComplete="off" spellCheck={false} placeholder="每行一条完整卡密，空行会自动忽略。每批最多 200 条。" />
        <div className="admin-voucher-options">
          <label><input type="checkbox" checked={priority} onChange={event => setPriority(event.target.checked)} />标记为优先卡密</label>
          <label><input type="checkbox" checked={skipDuplicates} onChange={event => setSkipDuplicates(event.target.checked)} />跳过重复卡密</label>
          <input type="file" accept=".txt,text/plain" hidden ref={fileInput} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void readFile(file);
          }} />
          <button type="button" className="button secondary" onClick={() => fileInput.current?.click()}>TXT 导入</button>
        </div>
        <button type="submit" className="button primary" disabled={busy || !lines.trim()}>{busy ? '正在添加…' : '添加卡密'}</button>
      </fieldset>
    </form>;
}

export function AdminVouchers({ onExpired, canImport, canViewCodes, canDelete }: {
  onExpired: () => void; canImport: boolean; canViewCodes: boolean; canDelete: boolean;
}) {
  const inventory = useApiResource<Inventory>('/admin/vouchers', { keepDataWhileReloading: true });
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState('');
  const [imports, setImports] = useState<Record<string, number>>({});
  const products = inventory.data?.products ?? [];
  const active = products.find(product => product.id === selected) ?? products[0];

  function select(productId: string) {
    if (active?.id !== productId) setEditing('');
    setSelected(productId);
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = (index - 1 + products.length) % products.length; break;
      case 'ArrowRight': next = (index + 1) % products.length; break;
      case 'Home': next = 0; break;
      case 'End': next = products.length - 1; break;
      default: return;
    }
    event.preventDefault();
    select(products[next].id);
    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
  }

  return <>
    <div className="admin-heading"><div><h1>卡密管理</h1><p>{canImport ? '按商品批量添加卡密并查看库存。' : '按商品查看卡密库存。'}</p></div>
      {inventory.data && <span className="admin-chip">{inventory.data.environment === 'sandbox' ? '测试库存' : '正式库存'}</span>}
    </div>
    {inventory.loading && !inventory.data && <p role="status">正在读取卡密库存…</p>}
    {inventory.error && <p>
      <button className="text-button" onClick={inventory.error.status === 401 ? onExpired : inventory.reload}>{inventory.error.status === 401 ? '重新登录' : '重试'}</button>
    </p>}
    {inventory.data && !active && <p className="admin-panel admin-zero" role="status">暂无可管理的商品。</p>}
    {active && <div className="admin-panel admin-voucher-catalog">
      <div className="admin-voucher-tabs" role="tablist" aria-label="商品">
        {products.map((product, index) => <button key={product.id} id={`voucher-tab-${product.id}`} type="button" role="tab"
          aria-selected={product.id === active.id} aria-controls={`voucher-panel-${product.id}`} tabIndex={product.id === active.id ? 0 : -1}
          onClick={() => select(product.id)} onKeyDown={event => navigateTabs(event, index)}>
          <span>{product.name}</span><span className="admin-voucher-tab-count" aria-hidden="true">{product.total}</span>
        </button>)}
      </div>
      {products.map(product => <section key={product.id} id={`voucher-panel-${product.id}`} className="admin-voucher-panel" role="tabpanel"
        aria-labelledby={`voucher-tab-${product.id}`} hidden={product.id !== active.id} tabIndex={0}>
        <div className="admin-voucher-panel-heading">
          <dl className="admin-voucher-stock">
            <div><dt>可用库存</dt><dd>{product.total} 条</dd></div>
            <div><dt>优先卡密</dt><dd>{product.priority} 条</dd></div>
          </dl>
          {canImport && <button className="button secondary" type="button" aria-expanded={editing === product.id}
            aria-controls={`voucher-edit-${product.id}`} onClick={() => setEditing(editing === product.id ? '' : product.id)}>{editing === product.id ? '退出编辑' : '编辑'}</button>}
        </div>
        {canViewCodes && product.id === active.id && editing !== product.id && <AdminVoucherCards key={imports[product.id] ?? 0} productId={product.id}
          canDelete={canDelete} onExpired={onExpired} onRemoved={inventory.reload} />}
        {canImport && <div id={`voucher-edit-${product.id}`} hidden={editing !== product.id}>
          <VoucherImport productId={product.id} onExpired={onExpired} onImported={() => {
            setImports(previous => ({ ...previous, [product.id]: (previous[product.id] ?? 0) + 1 }));
            inventory.reload();
          }} />
        </div>}
      </section>)}
    </div>}
  </>;
}
