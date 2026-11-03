import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { createUser, setPassword } from '../lib/auth';
import type { Role, User } from '../lib/types';
import { useApp } from '../state';
import { Field, Modal, PageHead } from '../components/ui';
import { t, tk } from '../i18n';

const ROLE_HELP: Record<Role, string> = {
  owner: tk('Everything: reports, profit, settings, users, editing and cancelling invoices.'),
  salesman: tk('Make sales, add customers, take payments. Cannot see costs or profit.'),
  storekeeper: tk('Purchases, suppliers, items and stock. Cannot make sales.'),
};
const ROLE_NAME: Record<Role, string> = { owner: tk('Owner'), salesman: tk('Salesman'), storekeeper: tk('Storekeeper') };
const roleHelp = (r: Role) => t(ROLE_HELP[r]); // i18n-ok
const roleName = (r: Role) => t(ROLE_NAME[r]); // i18n-ok

export default function UsersPage() {
  const { user: me, toast } = useApp();
  const users = useLiveQuery(async () => (await db.users.toArray()).filter((u) => !u.deleted).sort((a, b) => a.name.localeCompare(b.name)), [], [] as User[]);
  const [adding, setAdding] = useState(false);
  const [reset, setReset] = useState<User | null>(null);
  const owners = users.filter((u) => u.role === 'owner' && u.active).length;

  const update = async (u: User, patch: Partial<User>) => {
    if (u.role === 'owner' && u.active && owners <= 1 && (patch.role && patch.role !== 'owner' || patch.active === false)) {
      toast(t('Keep at least one active owner'), 'err'); return;
    }
    await db.put<User>('users', { ...u, ...patch });
  };

  return (
    <>
      <PageHead title={t('Users')}><button className="btn primary" onClick={() => setAdding(true)}>{t('+ New user')}</button></PageHead>
      <div className="card flush"><div className="table-wrap"><table className="data">
        <thead><tr><th>{t('Name')}</th><th>{t('Username')}</th><th>{t('Role')}</th><th>{t('Status')}</th><th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><b>{u.name}</b>{u.id === me.id && <span className="muted"> {t('(you)')}</span>}</td>
            <td>{u.username}</td>
            <td><select aria-label={t('Role for {name}', { name: u.name })} value={u.role} onChange={(e) => update(u, { role: e.target.value as Role })} style={{ width: 'auto' }} disabled={u.id === me.id}>
              <option value="owner">{roleName('owner')}</option><option value="salesman">{roleName('salesman')}</option><option value="storekeeper">{roleName('storekeeper')}</option></select></td>
            <td>{u.active ? <span className="badge ok">{t('active')}</span> : <span className="badge bad">{t('disabled')}</span>}</td>
            <td className="num">
              <button className="btn sm" onClick={() => setReset(u)}>{t('Reset password')}</button>{' '}
              {u.id !== me.id && <button className="btn sm" onClick={() => update(u, { active: !u.active })}>{u.active ? t('Disable') : t('Enable')}</button>}
            </td>
          </tr>))}</tbody>
      </table></div></div>
      <div className="card mt"><h2>{t('Roles')}</h2>
        {(Object.keys(ROLE_HELP) as Role[]).map((r) => <p key={r} className="small" style={{ margin: '6px 0' }}><b>{roleName(r)}:</b> {roleHelp(r)}</p>)}
        <p className="hint">{t('Users and passwords sync to your other devices, so staff can sign in anywhere.')}</p></div>
      {adding && <NewUser onClose={() => setAdding(false)} />}
      {reset && <Reset user={reset} onClose={() => setReset(null)} />}
    </>
  );
}

function NewUser({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'salesman' as Role });
  const save = async () => {
    try { await createUser(db, f); toast(t('User created'), 'ok'); onClose(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title={t('New user')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Create user')}</button></>}>
      <div className="form-grid">
        <Field label={t('Full name')}><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t('Username')}><input type="text" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></Field>
        <Field label={t('Password')}><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label={t('Role')} hint={roleHelp(f.role)}>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="salesman">{roleName('salesman')}</option><option value="storekeeper">{roleName('storekeeper')}</option><option value="owner">{roleName('owner')}</option></select></Field>
      </div>
    </Modal>
  );
}

function Reset({ user, onClose }: { user: User; onClose: () => void }) {
  const { toast } = useApp();
  const [pw, setPw] = useState('');
  const save = async () => {
    try { await setPassword(db, user, pw); toast(t('Password changed'), 'ok'); onClose(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title={t('New password for {name}', { name: user.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save}>{t('Change password')}</button></>}>
      <Field label={t('New password')}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" /></Field>
    </Modal>
  );
}
