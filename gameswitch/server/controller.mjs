import { randomUUID } from 'node:crypto';
import { createDiagnostics, friendlyDiagnosticMessage, validCorrelationId } from './diagnostics.mjs';
import { libraryGames } from './game-library.mjs';
import { profilesHavePortCollision } from './game-ports.mjs';
const quietDiagnostics = createDiagnostics({ write: () => {} });

const actions = {
  parallel: { title: 'Serverstart', steps: ['Laufzeit und Ressourcen prüfen', 'Ausstehende Sicherung abschließen', 'Profil installieren', 'Profil starten'] },
  activate: { title: 'Profilwechsel', steps: ['Laufzeit prüfen', 'Spielstand speichern', 'Alte Instanz stoppen', 'Sicherung abschließen', 'Ziel installieren', 'Ziel starten'] },
  restart: { title: 'Serverneustart', steps: ['Laufzeit prüfen', 'Spielstand speichern', 'Instanz stoppen', 'Stopp bestätigen', 'Sicherung abschließen', 'Instanz starten'] },
  update: { title: 'Server- und Mod-Update', steps: ['Laufzeit prüfen', 'Spielstand speichern', 'Instanz stoppen', 'Sicherung abschließen', 'Server & Mods aktualisieren', 'Instanz starten'] },
  stop: { title: 'Serverstopp', steps: ['Laufzeit prüfen', 'Spielstand speichern', 'Instanz stoppen', 'Sicherung abschließen'] },
  backup: { title: 'Sicherung', steps: ['Laufzeit prüfen', 'Sicherung abschließen'] },
  restore: { title: 'Wiederherstellung', steps: ['Laufzeit prüfen', 'Sicherheitskopie erstellen', 'Sicherung wiederherstellen'] },
};

const lifecycleError = (message, diagnosticReason) => Object.assign(new Error(message), { diagnosticReason });

export class Controller {
  constructor(store, runtime, diagnostics = quietDiagnostics, config = {}) { this.store = store; this.runtime = runtime; this.diagnostics = diagnostics; this.config = config; this.busy = false; this.pending = null; }
  recordFailure(error, job, profile, stage) {
    let id;
    try { id = this.diagnostics.error(error, { requestId: job.requestId, jobId: job.id, profileId: profile.id, sourceProfileId: job.sourceProfileId, gameId: profile.gameId, type: job.type, operation: job.type, status: 'failed', stage }); } catch { /* An injected logger must also fail soft. */ }
    if (!validCorrelationId(id)) id = randomUUID();
    job.errorId = id;
    job.error = `${friendlyDiagnosticMessage(error)} Fehler-ID: ${id}`;
  }
  profile(id) {
    const profile = this.store.state.profiles.find(profile => profile.id === id);
    if (!profile) { const error = new Error('Profil nicht gefunden.'); error.status = 404; throw error; }
    return profile;
  }
  runningProfiles() {
    return this.store.state.profiles.filter(profile => profile.status === 'running');
  }
  syncActiveProfile() {
    this.store.state.activeProfileId = this.runningProfiles()[0]?.id ?? null;
  }
  reconcile() {
    // Share an in-flight status read with polling. Publish one complete snapshot
    // before a lifecycle job can proceed with writes.
    if (!this.reconciling) this.reconciling = this.refreshStatuses().finally(() => { this.reconciling = null; });
    return this.reconciling;
  }
  async refreshStatuses() {
    const profiles = [...this.store.state.profiles];
    const results = await Promise.allSettled(profiles.map(async profile => {
      const status = await this.runtime.status(profile);
      if (typeof status?.running !== 'boolean') throw lifecycleError('Laufzeitstatus ist unklar.', 'runtime_status_invalid');
      return status.running ? 'running' : 'stopped';
    }));
    const errors = new Map();
    results.forEach((result, index) => {
      const profile = profiles[index];
      profile.status = result.status === 'fulfilled' ? result.value : 'unknown';
      if (result.status === 'rejected') errors.set(profile.id, result.reason);
    });
    this.syncActiveProfile();
    return errors;
  }
  async requireStatuses(profile) {
    const errors = await this.reconcile();
    if (profile) {
      if (errors.has(profile.id)) throw errors.get(profile.id);
    } else if (errors.size) {
      throw errors.values().next().value;
    }
  }
  checkConcurrent(profile, excludedId) {
    const others = this.runningProfiles().filter(other => other.id !== profile.id && other.id !== excludedId);
    if (others.some(other => profilesHavePortCollision(other, profile))) throw lifecycleError('Ein anderes laufendes Profil nutzt dieselben Ports.', 'port_conflict');
    const total = [profile, ...others].reduce((sum, server) => sum + (server.memoryMb ?? 0), 0);
    if (this.config.memoryMb && total > this.config.memoryMb - (this.config.reservedMemoryMb ?? 0)) throw lifecycleError('RAM-Budget überschritten.', 'memory_capacity');
  }
  requireStopped(profile) {
    if (profile.status === 'running') throw lifecycleError('Dieses Profil läuft bereits.', 'already_running');
  }
  async confirmStopped(profile) {
    const status = await this.runtime.status(profile);
    if (status?.running !== false) throw lifecycleError('Stopp wurde nicht bestätigt.', 'runtime_status_invalid');
    profile.status = 'stopped';
    this.syncActiveProfile();
  }
  async markPendingBackup(profile) {
    const pending = this.store.state.pendingSafetyBackupProfileIds;
    if (!pending.includes(profile.id)) pending.push(profile.id);
    await this.store.save();
  }
  async completePendingBackup(profile) {
    if (this.store.state.pendingSafetyBackupProfileIds.includes(profile.id)) await this.backup(profile, 'Nach-Stopp');
  }
  async install(profile) {
    if (profile.installed) return;
    await this.requireStatuses();
    this.requireStopped(profile);
    this.checkConcurrent(profile);
    const result = await this.runtime.install(profile);
    profile.installed = true;
    if (typeof result?.libraryUpdatedAt === 'string') profile.libraryUpdatedAt = result.libraryUpdatedAt;
  }
  async start(profile, switching = false) {
    await this.requireStatuses();
    this.requireStopped(profile);
    if (switching && this.runningProfiles().length > 0) throw lifecycleError('Eine Instanz wurde außerhalb von GameSwitch gestartet.', 'outside_instance');
    this.checkConcurrent(profile);
    if (this.store.state.pendingSafetyBackupProfileIds.includes(profile.id)) throw lifecycleError('Die Sicherheitskopie wurde nicht abgeschlossen.', 'backup_unconfirmed');
    await this.runtime.start(profile);
    profile.status = 'running';
    this.syncActiveProfile();
  }
  begin(type, profileId, backupId, context = {}) {
    if (!this.store.healthy) { const error = new Error('Persistenzfehler: Aktionen sind bis zum Dienstneustart gesperrt.'); error.status = 503; throw error; }
    if (this.busy) { const error = new Error('Eine Serveraktion läuft bereits.'); error.status = 409; throw error; }
    const profile = this.profile(profileId);
    if (type === 'update' && !libraryGames.has(profile.gameId)) { const error = new Error('Server & Mods lassen sich nur für Arma 3 und DayZ aus der Steam-Bibliothek aktualisieren.'); error.status = 400; throw error; }
    const labels = actions[type].steps;
    const job = { id: randomUUID(), type, status: 'running', profileId, createdAt: new Date().toISOString(), steps: labels.map(label => ({ label, status: 'pending' })) };
    if (validCorrelationId(context.requestId)) job.requestId = context.requestId;
    if (type === 'activate') job.sourceProfileId = context.sourceProfileId;
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
    this.store.state.pendingSafetyBackupProfileIds = this.store.state.pendingSafetyBackupProfileIds.filter(id => id !== profile.id);
    this.store.event(`Sicherung für „${profile.name}“ abgeschlossen.`);
    await this.store.save();
    return backup;
  }
  async prepare(job, profile) {
    const startsOrInstalls = ['parallel', 'activate', 'restart', 'update'].includes(job.type);
    await this.requireStatuses(startsOrInstalls ? undefined : profile);

    if (startsOrInstalls && this.store.state.recoveryRequiredProfileIds.includes(profile.id)) {
      throw lifecycleError('Unvollständige Wiederherstellung.', 'recovery_required');
    }
    if (['parallel', 'activate'].includes(job.type)) this.requireStopped(profile);
    if (['restart', 'stop'].includes(job.type) && profile.status !== 'running') {
      throw lifecycleError('Dieses Profil läuft nicht.', 'not_running');
    }
    if (['backup', 'restore'].includes(job.type) && profile.status !== 'stopped') {
      throw lifecycleError('Profil zuerst sauber stoppen.', 'not_running');
    }
    if (['restart', 'update', 'backup', 'restore'].includes(job.type) && !profile.installed) {
      throw lifecycleError('Profil wurde noch nicht installiert.', 'not_installed');
    }

    let source;
    if (job.type === 'activate') {
      const running = this.runningProfiles();
      if (running.length !== 1 || running[0].id !== job.sourceProfileId) {
        throw lifecycleError('Das bestätigte Quellprofil läuft nicht mehr allein.', 'switch_source_changed');
      }
      source = running[0];
    }
    if (startsOrInstalls) {
      this.checkConcurrent(profile, source?.id);
      await this.runtime.preflight?.(profile);
    }
    return source;
  }
  async stopAndConfirm(profile) {
    await this.runtime.stop(profile);
    await this.confirmStopped(profile);
  }
  async run(job, profile, backupId) {
    try {
      const source = await this.step(job, 0, () => this.prepare(job, profile));
      switch (job.type) {
        case 'parallel':
          await this.step(job, 1, () => this.completePendingBackup(profile));
          await this.step(job, 2, () => this.install(profile));
          await this.step(job, 3, () => this.start(profile));
          break;
        case 'activate':
          await this.step(job, 1, async () => {
            // The target may still owe a backup from an earlier job. Complete it
            // before touching the source, then verify the confirmed source again.
            await this.completePendingBackup(profile);
            await this.requireStatuses();
            this.requireStopped(profile);
            const running = this.runningProfiles();
            if (running.length !== 1 || running[0].id !== source.id) {
              throw lifecycleError('Das bestätigte Quellprofil läuft nicht mehr allein.', 'switch_source_changed');
            }
            await this.markPendingBackup(source);
            await this.runtime.save(source);
          });
          await this.step(job, 2, () => this.stopAndConfirm(source));
          await this.step(job, 3, () => this.backup(source, 'Vor-Wechsel'));
          await this.step(job, 4, () => this.install(profile));
          await this.step(job, 5, () => this.start(profile, true));
          break;
        case 'restart':
          await this.step(job, 1, async () => {
            await this.markPendingBackup(profile);
            await this.runtime.save(profile);
          });
          await this.step(job, 2, () => this.runtime.stop(profile));
          await this.step(job, 3, () => this.confirmStopped(profile));
          await this.step(job, 4, () => this.backup(profile, 'Vor-Neustart'));
          await this.step(job, 5, () => this.start(profile));
          break;
        case 'update': {
          const wasRunning = profile.status === 'running';
          await this.step(job, 1, async () => {
            if (!wasRunning) return;
            await this.markPendingBackup(profile);
            await this.runtime.save(profile);
          });
          await this.step(job, 2, async () => {
            if (wasRunning) await this.runtime.stop(profile);
            await this.confirmStopped(profile);
          });
          await this.step(job, 3, () => this.backup(profile, 'Vor-Update'));
          await this.step(job, 4, async () => {
            // The installer uses the same container limits and port bindings.
            await this.requireStatuses();
            this.requireStopped(profile);
            this.checkConcurrent(profile);
            const result = await this.runtime.update(profile);
            if (typeof result?.libraryUpdatedAt === 'string') profile.libraryUpdatedAt = result.libraryUpdatedAt;
          });
          await this.step(job, 5, async () => { if (wasRunning) await this.start(profile); });
          break;
        }
        case 'stop':
          await this.step(job, 1, async () => {
            await this.markPendingBackup(profile);
            await this.runtime.save(profile);
          });
          await this.step(job, 2, () => this.stopAndConfirm(profile));
          await this.step(job, 3, () => this.backup(profile, 'Nach-Stopp'));
          break;
        case 'backup':
          await this.step(job, 1, () => this.backup(profile));
          break;
        case 'restore': {
          const backup = this.store.state.backups.find(backup => backup.id === backupId && backup.profileId === profile.id);
          if (!backup) throw new Error('Sicherung nicht gefunden.');
          await this.step(job, 1, () => this.backup(profile, 'Vor-Wiederherstellung'));
          await this.step(job, 2, async () => {
            if (!this.store.state.recoveryRequiredProfileIds.includes(profile.id)) this.store.state.recoveryRequiredProfileIds.push(profile.id);
            await this.store.save();
            await this.runtime.restore(profile, backup);
            this.store.state.recoveryRequiredProfileIds = this.store.state.recoveryRequiredProfileIds.filter(id => id !== profile.id);
          });
          break;
        }
      }
      job.status = 'completed';
      this.store.event(actions[job.type].title + ' für „' + profile.name + '“ abgeschlossen.');
    } catch (error) {
      job.status = 'failed';
      const stage = job.steps.find(step => step.status === 'failed' || step.status === 'running')?.label || job.steps[0].label;
      this.recordFailure(error, job, profile, stage);
      this.store.event(job.error, 'error');
      if (job.steps[0].status === 'completed') await this.reconcile();
    }
    await this.store.save();
  }
}
