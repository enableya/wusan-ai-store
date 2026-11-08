import { useMessage } from '../app/MessageProvider';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { Dialog } from './Dialog';
import { AdminTable } from './AdminTable';
import { useApiResource } from '../hooks/useApiResource';
import { ApiError, postApi } from '../services/api';
import { adminPermissions, impliedAdminPermissions, staffCheckoutUsername } from '../types/admin';
import type { AdminAccount, AdminPermission, AdminRole } from '../types/admin';

const roles = { admin: '普通管理员', super_admin: '超级管理员' } as const;
const permissionsList = Object.keys(adminPermissions) as AdminPermission[];
type AccountDialog = { type: 'add' } | { type: 'edit' | 'delete'; account: AdminAccount };

function AccountForm({ account, onSaved, onCancel, onExpired }: {
  account: AdminAccount | null; onSaved: (notice: string) => void; onCancel: () => void; onExpired: () => void;
}) {
  const [role, setRole] = useState<AdminRole>(account?.role ?? 'admin');
  const [permissions, setPermissions] = useState<AdminPermission[]>(account?.permissions ?? []);
  const [busy, setBusy] = useState(false);
  const $message = useMessage();

  function toggle(permission: AdminPermission, checked: boolean) {
    setPermissions(current => checked ? [...current, permission] : current.filter(item => item !== permission));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const access = { role, permissions: role === 'admin' ? permissions : [] };
    setBusy(true);
    try {
      if (account) await postApi(`/admin/users/${encodeURIComponent(account.username)}/access`, access);
      else await postApi('/admin/users', { ...access, username: form.get('username'), password: form.get('password') });
      onSaved(account ? '角色与权限已保存。' : '管理员已添加。');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else $message.error(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally { setBusy(false); }
  }

  const implied = impliedAdminPermissions(permissions);
  return <Dialog title={account ? '编辑管理员' : '新增管理员'} className="admin-user-dialog" onClose={() => { if (!busy) onCancel(); }}>
    {account && <p className="admin-dialog-account">账号 <strong>{account.username}</strong></p>}
    <form className="admin-account-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      {!account && <>
        <label htmlFor="new-admin-name">管理员账号</label>
        <input id="new-admin-name" name="username" autoComplete="off" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_\-]{3,40}" placeholder="3–40 位字母、数字、下划线或短横线" />
        <label htmlFor="new-admin-password">初始密码</label>
        <input id="new-admin-password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="10–128 位密码" />
      </>}
      <label htmlFor="new-admin-role">管理员角色</label>
      <select id="new-admin-role" value={role} onChange={event => setRole(event.target.value as AdminRole)}>
        <option value="admin">普通管理员</option><option value="super_admin">超级管理员</option>
      </select>
      {role === 'super_admin' ? <p className="field-hint">超级管理员拥有全部后台权限。</p> :
        <fieldset className="admin-permissions"><legend>允许的操作</legend>
          {permissionsList.map(permission => <label key={permission}>
            <input type="checkbox" checked={permissions.includes(permission) || implied.includes(permission)}
              disabled={implied.includes(permission)} onChange={event => toggle(permission, event.target.checked)} />{adminPermissions[permission]}
          </label>)}
        </fieldset>}
      <div className="admin-account-actions">
        <button className="button secondary" type="button" onClick={onCancel}>取消</button>
        <button className="button primary" type="submit">{busy ? '正在保存…' : account ? '保存权限' : '创建账号'}</button>
      </div>
    </fieldset>
    </form>
  </Dialog>;
}

function DeleteAccountDialog({ account, onSaved, onCancel, onExpired }: {
  account: AdminAccount; onSaved: (notice: string) => void; onCancel: () => void; onExpired: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const $message = useMessage();
  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await postApi(`/admin/users/${encodeURIComponent(account.username)}/delete`, { createdAt: account.createdAt });
      onSaved(`已删除管理员 ${account.username}。`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else $message.error(cause instanceof Error ? cause.message : '删除失败，请重试。');
    } finally { setBusy(false); }
  }
  return <Dialog title="删除管理员" className="admin-user-dialog" onClose={() => { if (!busy) onCancel(); }}>
    <p className="admin-delete-description">删除 <strong>{account.username}</strong> 后，该账号将失去后台访问权限，现有登录会话立即失效。</p>
    <div className="admin-account-actions">
      <button className="button secondary" type="button" onClick={onCancel} disabled={busy}>取消</button>
      <button className="button danger" type="button" onClick={() => void remove()} disabled={busy}>{busy ? '正在删除…' : '确认删除'}</button>
    </div>
  </Dialog>;
}

function StaffCheckoutSettings({ onExpired }: { onExpired: () => void }) {
  const access = useApiResource<{ linked: boolean }>('/admin/staff-checkout');
  const linked = access.data?.linked;
  const [busy, setBusy] = useState(false);
  const $message = useMessage();
  async function changeLink(linked: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await postApi('/admin/staff-checkout', { linked });
      access.reload();
      $message.success(linked ? '商城账号已开通免付权限。' : '已解除商城账号绑定。');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired();
      else $message.error(cause instanceof Error ? cause.message : '无法更新绑定，请重试。');
    } finally { setBusy(false); }
  }

  return <section className="admin-panel admin-list-panel" aria-labelledby="staff-checkout-title">
    <div className="admin-panel-title">
      <div>
        <h2 id="staff-checkout-title">商城免付开通</h2>
        <p>{linked ? `已绑定商城账号 ${staffCheckoutUsername}` : `请先在同一浏览器登录商城账号 ${staffCheckoutUsername}，再绑定。`}</p>
      </div>
      {linked !== undefined && <button className="button secondary" type="button" disabled={busy} onClick={() => void changeLink(!linked)}>
        {linked ? '解除绑定' : '绑定商城账号'}
      </button>}
      {access.error && <button className="button secondary" type="button" onClick={access.error.status === 401 ? onExpired : access.reload}>重试</button>}
    </div>
  </section>;
}

export function AdminUsers({ username, onExpired }: { username: string; onExpired: () => void }) {
  const accounts = useApiResource<AdminAccount[]>('/admin/users');
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const $message = useMessage();
  const close = () => setDialog(null);

  function open(next: AccountDialog) {
    setDialog(next);
  }

  function saved(message: string) {
    close();
    $message.success(message);
    accounts.reload();
  }

  return <>
    <div className="admin-heading admin-users-heading"><div><h1>用户管理</h1><p>管理后台账号、角色与模块权限。</p></div>
      <button className="button primary" type="button" onClick={() => open({ type: 'add' })}><Plus aria-hidden="true" />新增管理员</button>
    </div>
    <section className="admin-panel admin-list-panel" aria-labelledby="admin-account-list-title">
      <div className="admin-panel-title"><h2 id="admin-account-list-title">管理员列表</h2>
        {accounts.data && <span className="admin-list-count">{accounts.data.length} 个账号</span>}
      </div>
      {accounts.loading && <p className="admin-loading" role="status">正在读取管理员列表…</p>}
      {accounts.error && <p><button className="text-button" onClick={accounts.error.status === 401 ? onExpired : accounts.reload}>{accounts.error.status === 401 ? '重新登录' : '重试'}</button></p>}
      {accounts.data && <AdminTable className="admin-account-table" labelledBy="admin-account-list-title">
        <thead><tr><th scope="col">账号</th><th scope="col">角色</th><th scope="col" className="admin-account-permissions">权限</th><th scope="col" className="admin-table-end">操作</th></tr></thead>
        <tbody>{accounts.data.map(account => <tr key={account.username}>
          <td><div className="admin-account-identity"><span className="admin-account-avatar"><UserRound aria-hidden="true" /></span><div>
            <strong>{account.username}</strong>{account.username === username && <small>当前账号</small>}
          </div></div></td>
          <td><span className={`admin-role-badge ${account.role}`}>
            {account.role === 'super_admin' && <ShieldCheck aria-hidden="true" />}{roles[account.role]}</span></td>
          <td className="admin-account-permissions"><div className="admin-account-tags">
            {account.role === 'super_admin' ? <span>全部权限</span> : account.permissions.length ? account.permissions.map(permission => <span key={permission}>{adminPermissions[permission]}</span>) : <span>未分配</span>}
          </div></td>
          <td className="admin-table-end">{account.username === username ? <span className="admin-account-self">—</span> : <div className="admin-table-actions">
            <button type="button" className="admin-table-edit" aria-label={`编辑 ${account.username} 的权限`} onClick={() => open({ type: 'edit', account })}><Pencil aria-hidden="true" />编辑</button>
            <button type="button" className="admin-table-delete" aria-label={`删除 ${account.username}`} onClick={() => open({ type: 'delete', account })}><Trash2 aria-hidden="true" />删除</button>
          </div>}</td>
        </tr>)}</tbody>
      </AdminTable>}
    </section>
    {username === staffCheckoutUsername && <StaffCheckoutSettings onExpired={onExpired} />}
    {dialog?.type === 'delete' && <DeleteAccountDialog account={dialog.account} onSaved={saved} onCancel={close} onExpired={onExpired} />}
    {(dialog?.type === 'add' || dialog?.type === 'edit') && <AccountForm account={dialog.type === 'edit' ? dialog.account : null} onSaved={saved} onCancel={close} onExpired={onExpired} />}
  </>;
}
