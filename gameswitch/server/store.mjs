import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function openStore(dataDir) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error('State file unreadable; refusing to reset saved profiles');
    state = { schema: 1, admin: null, profiles: [], activeProfileId: null, pendingSafetyBackupProfileId: null, recoveryRequiredProfileIds: [], job: null, backups: [], events: [] };
  }
  if (state.schema !== 1 || !Array.isArray(state.profiles) || !Array.isArray(state.backups) || !Array.isArray(state.events) || (state.admin && (typeof state.admin.username !== 'string' || typeof state.admin.passwordHash !== 'string' || typeof state.admin.salt !== 'string'))) throw new Error('Unsupported or damaged state schema');
  state.pendingSafetyBackupProfileId ??= null;
  state.recoveryRequiredProfileIds ??= [];
  if (!Array.isArray(state.recoveryRequiredProfileIds)) throw new Error('Damaged recovery state');
  let writes = Promise.resolve();
  const store = {
    state, healthy: true,
    save() {
      if (!store.healthy) return Promise.reject(new Error('Persistenz fehlgeschlagen. Dienst nach Behebung neu starten.'));
      const content = JSON.stringify(state, null, 2);
      writes = writes.catch(() => {}).then(async () => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, file);
      }).catch(error => { store.healthy = false; throw error; });
      return writes;
    },
    event(message, level = 'info') {
      state.events.unshift({ id: randomUUID(), time: new Date().toISOString(), level, message });
      state.events = state.events.slice(0, 300);
    },
    flush() { return writes; },
  };
  if (state.job?.status === 'running') {
    state.job.status = 'failed';
    state.job.error = 'Prozess unterbrochen. Laufzeitstatus wird vor der nächsten Aktion neu geprüft.';
    store.event(state.job.error, 'warning');
    await store.save();
  }
  return store;
}
