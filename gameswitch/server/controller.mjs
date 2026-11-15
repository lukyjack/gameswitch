import { randomUUID } from 'node:crypto';
import { createDiagnostics, friendlyDiagnosticMessage, validCorrelationId } from './diagnostics.mjs';
const quietDiagnostics = createDiagnostics({ write: () => {} });

export class Controller {
  constructor(store, runtime, diagnostics = quietDiagnostics) { this.store = store; this.runtime = runtime; this.diagnostics = diagnostics; this.busy = false; this.pending = null; }
  recordFailure(error, job, profile, stage) {
    let id;
    try { id = this.diagnostics.error(error, { requestId: job.requestId, jobId: job.id, profileId: profile.id, sourceProfileId: this.store.state.pendingSafetyBackupProfileId, gameId: profile.gameId, type: job.type, operation: job.type, status: 'failed', stage }); } catch { /* An injected logger must also fail soft. */ }
    if (!validCorrelationId(id)) id = randomUUID();
    job.errorId = id;
    job.error = `${friendlyDiagnosticMessage(error)} Fehler-ID: ${id}`;
  }
  profile(id) {
    const profile = this.store.state.profiles.find(profile => profile.id === id);
    if (!profile) { const error = new Error('Profil nicht gefunden.'); error.status = 404; throw error; }
    return profile;
  }
  async reconcile() {
    const running = [];
    for (const profile of this.store.state.profiles) {
      try {
        const status = await this.runtime.status(profile);
        profile.status = status.running ? 'running' : 'stopped';
        if (status.running) running.push(profile);
      } catch (error) { profile.status = 'unknown'; throw error; }
    }
    this.store.state.activeProfileId = running.length === 1 ? running[0].id : null;
    if (running.length > 1) throw new Error('Mehrere Instanzen laufen außerhalb von GameSwitch. Bitte zuerst in PufferPanel stoppen.');
    return running[0];
  }
  begin(type, profileId, backupId, context = {}) {
    if (!this.store.healthy) { const error = new Error('Persistenzfehler: Aktionen sind bis zum Dienstneustart gesperrt.'); error.status = 503; throw error; }
    if (this.busy) { const error = new Error('Eine Serveraktion läuft bereits.'); error.status = 409; throw error; }
    const profile = this.profile(profileId);
    const labels = type === 'activate' ? ['Laufzeit prüfen', 'Spielstand speichern', 'Alte Instanz stoppen', 'Sicherung abschließen', 'Ziel installieren', 'Ziel starten']
      : type === 'restart' ? ['Laufzeit prüfen', 'Spielstand speichern', 'Instanz stoppen', 'Stopp bestätigen', 'Sicherung abschließen', 'Instanz starten']
      : type === 'restore' ? ['Laufzeit prüfen', 'Sicherheitskopie erstellen', 'Sicherung wiederherstellen']
      : type === 'backup' ? ['Laufzeit prüfen', 'Sicherung abschließen'] : ['Laufzeit prüfen', 'Spielstand speichern', 'Instanz stoppen'];
    const job = { id: randomUUID(), type, status: 'running', profileId, createdAt: new Date().toISOString(), steps: labels.map(label => ({ label, status: 'pending' })) };
    if (validCorrelationId(context.requestId)) job.requestId = context.requestId;
    this.busy = true;
    this.store.state.job = job;
    this.pending = new Promise(resolve => setImmediate(resolve)).then(() => this.run(job, profile, backupId)).catch(error => {
      // A persistence failure is terminal for mutations until restart. Never continue with unrecorded lifecycle state.
      this.store.healthy = false; job.status = 'failed';
      this.recordFailure(Object.assign(new Error('Persistenzfehler'), { diagnosticReason: 'persistence_failed', code: error?.code }), job, profile, 'persistence');
    }).finally(() => { this.busy = false; });
    return job;
  }
  async step(job, index, action) {
    job.steps[index].status = 'running'; await this.store.save();
    try { const result = await action(); job.steps[index].status = 'completed'; await this.store.save(); return result; }
    catch (error) { job.steps[index].status = 'failed'; throw error; }
  }
  async backup(profile, prefix = 'Spielstand') {
    const name = `${prefix}-${randomUUID()}`;
    const runtime = await this.runtime.backup(profile, name);
    const backup = { id: randomUUID(), profileId: profile.id, profileName: profile.name, name, createdAt: new Date().toISOString(), status: 'completed', runtimeId: runtime.runtimeId };
    this.store.state.backups.unshift(backup);
    if (this.store.state.pendingSafetyBackupProfileId === profile.id) this.store.state.pendingSafetyBackupProfileId = null;
    this.store.event(`Sicherung für „${profile.name}“ abgeschlossen.`);
    await this.store.save();
    return backup;
  }
  async run(job, profile, backupId) {
    try {
      const current = await this.step(job, 0, () => this.reconcile());
      if (job.type === 'activate') {
        if (this.store.state.recoveryRequiredProfileIds.includes(profile.id)) throw new Error('Unvollständige Wiederherstellung: Dieses Profil muss zuerst erfolgreich aus einer Sicherung wiederhergestellt werden.');
        if (current?.id === profile.id) throw new Error('Dieses Profil läuft bereits.');
        await this.runtime.preflight?.(profile);
        const pending = this.store.state.pendingSafetyBackupProfileId ? this.profile(this.store.state.pendingSafetyBackupProfileId) : null;
        if (pending && current && pending.id !== current.id) throw new Error('Ausstehende Sicherung zuerst für das vorherige Profil abschließen.');
        const source = current || pending;
        if (source) { this.store.state.pendingSafetyBackupProfileId = source.id; await this.store.save(); }
        await this.step(job, 1, async () => { if (current) await this.runtime.save(current); });
        await this.step(job, 2, async () => { if (current) { await this.runtime.stop(current); current.status = 'stopped'; this.store.state.activeProfileId = null; } });
        await this.step(job, 3, async () => { if (source) await this.backup(source, 'Vor-Wechsel'); });
        await this.step(job, 4, async () => { if (!profile.installed) { await this.runtime.install(profile); profile.installed = true; await this.store.save(); } });
        await this.step(job, 5, async () => {
          // Re-read every profile immediately before starting; stale browser/state cannot start a second managed server.
          if (await this.reconcile()) throw new Error('Eine Instanz wurde außerhalb von GameSwitch gestartet.');
          await this.runtime.start(profile); profile.status = 'running'; this.store.state.activeProfileId = profile.id;
        });
      } else if (job.type === 'restart') {
        if (!profile.installed) throw new Error('Profil wurde noch nicht installiert.');
        if (this.store.state.recoveryRequiredProfileIds.includes(profile.id)) throw new Error('Unvollständige Wiederherstellung: Dieses Profil muss zuerst erfolgreich aus einer Sicherung wiederhergestellt werden.');
        if (current?.id !== profile.id) throw new Error('Nur das aktuell laufende Profil kann neu gestartet werden.');
        if (this.store.state.pendingSafetyBackupProfileId && this.store.state.pendingSafetyBackupProfileId !== profile.id) throw new Error('Ausstehende Sicherung zuerst für das vorherige Profil abschließen.');
        await this.runtime.preflight?.(profile);
        // Record the safety obligation before save/stop. A crash or failed backup
        // must not let a later activate request silently skip this snapshot.
        this.store.state.pendingSafetyBackupProfileId = profile.id;
        await this.store.save();
        await this.step(job, 1, () => this.runtime.save(profile));
        await this.step(job, 2, () => this.runtime.stop(profile));
        await this.step(job, 3, async () => {
          const status = await this.runtime.status(profile);
          if (status.running !== false) throw new Error('Stopp wurde nicht bestätigt. Neustart bleibt angehalten.');
          profile.status = 'stopped';
          this.store.state.activeProfileId = null;
        });
        await this.step(job, 4, () => this.backup(profile, 'Vor-Neustart'));
        await this.step(job, 5, async () => {
          if (await this.reconcile()) throw new Error('Eine Instanz wurde außerhalb von GameSwitch gestartet.');
          if (this.store.state.pendingSafetyBackupProfileId) throw new Error('Ausstehende Sicherung verhindert den Neustart.');
          await this.runtime.start(profile);
          profile.status = 'running';
          this.store.state.activeProfileId = profile.id;
        });
      } else if (job.type === 'stop') {
        if (current?.id !== profile.id) throw new Error('Dieses Profil läuft nicht.');
        this.store.state.pendingSafetyBackupProfileId = profile.id; await this.store.save();
        await this.step(job, 1, () => this.runtime.save(profile));
        await this.step(job, 2, async () => { await this.runtime.stop(profile); profile.status = 'stopped'; this.store.state.activeProfileId = null; });
      } else {
        if (profile.status !== 'stopped') throw new Error('Profil zuerst sauber stoppen.');
        if (!profile.installed) throw new Error('Profil wurde noch nicht installiert.');
        if (job.type === 'backup') await this.step(job, 1, () => this.backup(profile));
        else {
          const backup = this.store.state.backups.find(backup => backup.id === backupId && backup.profileId === profile.id);
          if (!backup) throw new Error('Sicherung nicht gefunden.');
          await this.step(job, 1, () => this.backup(profile, 'Vor-Wiederherstellung'));
          await this.step(job, 2, async () => {
            if (!this.store.state.recoveryRequiredProfileIds.includes(profile.id)) this.store.state.recoveryRequiredProfileIds.push(profile.id);
            await this.store.save();
            await this.runtime.restore(profile, backup);
            this.store.state.recoveryRequiredProfileIds = this.store.state.recoveryRequiredProfileIds.filter(id => id !== profile.id);
          });
        }
      }
      job.status = 'completed'; this.store.event(`${job.type === 'activate' ? 'Profilwechsel' : job.type === 'restart' ? 'Serverneustart' : job.type === 'stop' ? 'Serverstopp' : job.type === 'restore' ? 'Wiederherstellung' : 'Sicherung'} für „${profile.name}“ abgeschlossen.`);
    } catch (error) {
      job.status = 'failed';
      const stage = job.steps.find(step => step.status === 'failed' || step.status === 'running')?.label || 'Laufzeit prüfen';
      this.recordFailure(error, job, profile, stage);
      this.store.event(job.error, 'error');
      // Never roll back by blindly starting the old server: target could have started before a timeout.
      try { await this.reconcile(); } catch { this.store.state.activeProfileId = null; }
    }
    await this.store.save();
  }
}
