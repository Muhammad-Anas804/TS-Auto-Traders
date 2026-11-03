import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { db } from '../lib/db';
import { getSyncConfig, getSyncState, subscribeSyncState, syncNow } from '../lib/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePending } from '../hooks';
import { useOnline, useToast } from '../state';

export default function SyncBadge() {
  const st = useSyncExternalStore(subscribeSyncState, getSyncState);
  const online = useOnline();
  const pending = usePending();
  const toast = useToast();
  const configured = useLiveQuery(async () => !!(await getSyncConfig(db)).key, [], false);

  let cls = 'online', label = t('Online');
  if (!online) { cls = 'offline'; label = pending ? t('Offline · {n} waiting', { n: pending }) : t('Offline'); }
  else if (!configured) { cls = ''; label = t('Online · sync off'); }
  else if (st.syncing) { cls = 'busy'; label = t('Syncing…'); }
  else if (st.lastError) { cls = 'err'; label = pending ? t('Not synced · {n} waiting', { n: pending }) : t('Sync problem'); }
  else if (pending) { cls = 'online'; label = t('{n} to sync', { n: pending }); }
  else label = t('Synced');

  const click = async () => {
    if (!configured) { toast(t('Set up sync in Settings to share data between devices.')); return; }
    const r = await syncNow(db);
    toast(r.ok ? t('Synced (sent {sent}, received {got})', { sent: r.pushed, got: r.pulled }) : r.error ?? t('Sync failed'), r.ok ? 'ok' : 'err');
  };
  return (
    <button className={`sync ${cls}`} onClick={click} title={st.lastError ?? t('Click to sync now')}>
      <span className="dot" />{label}
    </button>
  );
}
