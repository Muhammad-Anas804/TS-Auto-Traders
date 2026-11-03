import { useState } from 'react';
import { login } from '../lib/auth';
import { db } from '../lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { Field } from '../components/ui';
import LangSwitch from '../components/LangSwitch';
import { t } from '../i18n';

export default function Login({ onDone }: { onDone: () => void }) {
  const shop = useLiveQuery(() => db.getShop(), []);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(db, username, password); onDone(); }
    catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };
  return (
    <div className="login-wrap">
      <form className="login-card col" onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><LangSwitch /></div>
        <div className="brand"><img src="/icon.svg" alt="" /> {shop?.name ?? 'TS Auto Trader'}</div>
        {err && <div className="alert bad">{err}</div>}
        <Field label={t('Username')}><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoCapitalize="none" autoComplete="username" /></Field>
        <Field label={t('Password')}><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        <button className="btn primary" disabled={busy || !username || !password}>{busy ? t('Checking…') : t('Sign in')}</button>
        <p className="hint" style={{ margin: 0 }}>{t('Forgot your password? Ask the owner to reset it under Users.')}</p>
      </form>
    </div>
  );
}
