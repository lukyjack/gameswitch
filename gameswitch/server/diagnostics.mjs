import { randomUUID, createHash } from 'node:crypto';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const identifier = /^(?:[a-f0-9]{16}|[a-f0-9]{32}|[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;
const codes = new Set(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'EIO', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'CONSOLE_DELIVERY_UNCERTAIN', 'ADMIN_WRITE_UNCERTAIN']);
const classes = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'AggregateError', 'DOMException', 'ZodError', 'AbortError', 'TimeoutError']);
const reasons = new Set(['backup_unsafe_links', 'steam_cache_unexpected', 'disk_full', 'permission_denied', 'upstream_auth', 'upstream_not_found', 'upstream_error', 'network_timeout', 'network_unavailable', 'invalid_upstream_response', 'response_too_large', 'outside_instance', 'recovery_required', 'already_running', 'not_running', 'not_installed', 'runtime_busy', 'runtime_status_invalid', 'runtime_patch_required', 'backup_unconfirmed', 'restore_unconfirmed', 'process_exited', 'persistence_failed', 'delivery_uncertain', 'unknown']);
const operations = new Set(['activate', 'restart', 'stop', 'backup', 'restore', 'http', 'request', 'console', 'admin', 'profile-create', 'status', 'setup', 'login', 'logout', 'oauth', 'start', 'install', 'file', 'definition', 'server', 'persistence']);
const stages = new Set(['request', 'response', 'middleware', 'handler', 'persistence', 'Laufzeit prüfen', 'Spielstand speichern', 'Alte Instanz stoppen', 'Sicherung abschließen', 'Ziel installieren', 'Ziel starten', 'Sicherheitskopie erstellen', 'Sicherung wiederherstellen', 'Instanz stoppen', 'Stopp bestätigen', 'Instanz starten']);
const games = new Set(['minecraft', 'gmod', 'squad', 'valheim', 'terraria', 'factorio', 'fs25']);
games.add('arma3'); games.add('dayz');
reasons.add('steam_library_required'); reasons.add('steam_mods_required');
codes.add('STEAM_INPUT_UNCERTAIN');
const trustedFiles = new Set(['app.mjs', 'controller.mjs', 'runtime.mjs', 'diagnostics.mjs', 'store.mjs', 'catalog.mjs', 'templates.mjs', 'game-ports.mjs', 'profile-secrets.mjs', 'game-admin.mjs', 'console-command.mjs', 'rcon-client.mjs', 'steam-cache.mjs', 'minecraft-memory.mjs']);
trustedFiles.add('steam-setup.mjs');
const value = (object, key) => { try { return object?.[key]; } catch { return undefined; } };

export const validCorrelationId = input => typeof input === 'string' && uuid.test(input);

export function safeDiagnosticReason(error) {
  const declared = value(error, 'diagnosticReason');
  if (reasons.has(declared)) return declared;
  const code = value(error, 'code') || value(value(error, 'cause'), 'code');
  if (code === 'ENOSPC') return 'disk_full';
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) return 'permission_denied';
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code) || ['AbortError', 'TimeoutError'].includes(value(error, 'name'))) return 'network_timeout';
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'network_unavailable';
  if (['CONSOLE_DELIVERY_UNCERTAIN', 'ADMIN_WRITE_UNCERTAIN', 'STEAM_INPUT_UNCERTAIN'].includes(code)) return 'delivery_uncertain';
  const message = typeof value(error, 'message') === 'string' ? value(error, 'message').slice(0, 16384) : '';
  // Messages are used only for fixed classification, never retained or logged.
  if (/symbolic|symlink|hard links|unsafe archive/i.test(message)) return 'backup_unsafe_links';
  if (/Steam-Cache.*unerwartete Struktur/i.test(message)) return 'steam_cache_unexpected';
  if (/außerhalb von GameSwitch/.test(message)) return 'outside_instance';
  if (/Unvollständige Wiederherstellung/.test(message)) return 'recovery_required';
  if (/läuft bereits/.test(message)) return 'already_running';
  if (/läuft nicht|laufende Profil|zuerst.*stoppen|benötigen eine gestoppte|bestätigten Stopp/.test(message)) return 'not_running';
  if (/noch nicht installiert/.test(message)) return 'not_installed';
  if (/Laufzeit arbeitet noch/.test(message)) return 'runtime_busy';
  if (/Status ist unklar|Laufzeitstatus ist unklar|Stopp wurde nicht bestätigt/.test(message)) return 'runtime_status_invalid';
  if (/Backup-Sicherheitspatch/.test(message)) return 'runtime_patch_required';
  if (/Sicherung.*nicht.*abgeschlossen|Sicherung.*nicht nachweisbar/.test(message)) return 'backup_unconfirmed';
  if (/Wiederherstellung wurde nicht bestätigt/.test(message)) return 'restore_unconfirmed';
  if (/Spielprozess.*beendet/.test(message)) return 'process_exited';
  if (/Persistenz/.test(message)) return 'persistence_failed';
  return 'unknown';
}

export function classifyUpstreamError(content, status) {
  const text = Buffer.isBuffer(content) ? content.subarray(0, 16384).toString('utf8') : String(content || '').slice(0, 16384);
  if (/symbolic|symlink|hard links|unsafe archive/i.test(text)) return 'backup_unsafe_links';
  if (/no space left|disk.*full|ENOSPC/i.test(text)) return 'disk_full';
  if (/permission denied|operation not permitted|read.only file system|EACCES|EPERM/i.test(text)) return 'permission_denied';
  if (status === 401 || status === 403 || /invalid_client|invalid.credentials/i.test(text)) return 'upstream_auth';
  if (status === 404) return 'upstream_not_found';
  return 'upstream_error';
}

export async function upstreamFailure(response, operation = 'request') {
  const chunks = []; let size = 0, truncated = false;
  const reader = response.body?.getReader();
  if (reader) try {
    while (size < 16384) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const remaining = 16384 - size;
      const included = chunk.subarray(0, remaining);
      chunks.push(included); size += included.byteLength;
      if (chunk.byteLength > remaining || size === 16384) { truncated = true; await reader.cancel(); break; }
    }
  } catch { /* Metadata already received remains useful; never retain reader errors. */ }
  finally { reader.releaseLock(); }
  const content = Buffer.concat(chunks);
  return Object.assign(new Error('Die Server-Laufzeit hat die Anfrage abgewiesen.'), {
    status: [401, 403].includes(response.status) ? 502 : response.status, upstreamStatus: response.status,
    diagnosticReason: classifyUpstreamError(content, response.status),
    responseHash: createHash('sha256').update(content).digest('hex'), responseTruncated: truncated,
    upstreamOperation: operations.has(operation) ? operation : 'request',
  });
}

export function networkFailure(error) {
  const reason = safeDiagnosticReason(error);
  const code = value(error, 'code') || value(value(error, 'cause'), 'code');
  return Object.assign(new Error('Die Verbindung zur Server-Laufzeit ist fehlgeschlagen.'), { diagnosticReason: reason === 'unknown' ? 'network_unavailable' : reason, ...(codes.has(code) ? { code } : {}) });
}

const messages = {
  steam_library_required: 'Steam-Einrichtung erforderlich. Die Serverdateien zuerst über „Steam einrichten“ im Panel vorbereiten. Die laufende Instanz bleibt aktiv.',
  steam_mods_required: 'Ausgewählte Workshop-Mods sind noch nicht vorbereitet. Die geschützte Steam-Bibliothek zuerst ergänzen. Die laufende Instanz bleibt aktiv.',
  backup_unsafe_links: 'Die Sicherung wurde wegen unsicherer Datei-Verknüpfungen angehalten. Bitte die Steam-Cache-Pflege prüfen; es wird keine weitere Instanz gestartet.',
  steam_cache_unexpected: 'Der Steam-Cache konnte nicht sicher bereinigt werden. Bitte die vorhandenen Serverdateien prüfen.',
  disk_full: 'Für die Aktion ist zu wenig Speicherplatz verfügbar. Bitte freien Speicher prüfen.',
  permission_denied: 'Der Server-Laufzeit fehlen Datei- oder Zugriffsrechte. Bitte die Serverkonfiguration prüfen.',
  upstream_auth: 'Die Anmeldung bei der Server-Laufzeit ist fehlgeschlagen. Bitte den internen Laufzeitzugang prüfen.',
  upstream_not_found: 'Die angeforderte Laufzeitinstanz oder Datei wurde nicht gefunden.',
  upstream_error: 'Die Server-Laufzeit hat die Aktion abgewiesen. Weitere Details sind unter der Fehler-ID protokolliert.',
  network_timeout: 'Die Server-Laufzeit hat nicht rechtzeitig geantwortet. Vor weiteren Aktionen muss ihr Status erneut geprüft werden.',
  network_unavailable: 'Die Server-Laufzeit ist momentan nicht erreichbar. Bitte Verbindung und Dienststatus prüfen.',
  outside_instance: 'Eine Instanz wurde außerhalb von GameSwitch gestartet. Bitte zuerst den Laufzeitstatus prüfen.',
  recovery_required: 'Die Wiederherstellung ist unvollständig. Dieses Profil zuerst erfolgreich aus einer Sicherung wiederherstellen.',
  already_running: 'Dieses Profil läuft bereits.', not_running: 'Für diese Aktion muss der passende Laufzeitstatus bestätigt sein. Bitte das laufende Profil prüfen.',
  not_installed: 'Dieses Profil wurde noch nicht installiert.', runtime_busy: 'Die Server-Laufzeit arbeitet noch an einer Installation oder Sicherung.',
  runtime_status_invalid: 'Der Laufzeitstatus ist unklar. Die Aktion wurde vorsorglich angehalten.', runtime_patch_required: 'Der Server-Laufzeit fehlt der erforderliche Backup-Sicherheitspatch.',
  backup_unconfirmed: 'Die Sicherung wurde nicht vollständig bestätigt. Es wird keine weitere Instanz gestartet.', restore_unconfirmed: 'Die Wiederherstellung wurde nicht bestätigt. Die Instanz bleibt gestoppt.',
  process_exited: 'Der Spielprozess wurde beim Start beendet. Bitte die Spielkonsole prüfen.', persistence_failed: 'Der Panelzustand konnte nicht sicher gespeichert werden. Weitere Aktionen bleiben bis zur Behebung gesperrt.',
  delivery_uncertain: 'Die Bestätigung fehlt. Die Aktion kann bereits ausgeführt worden sein; sie wird nicht automatisch erneut gesendet.',
  invalid_upstream_response: 'Die Server-Laufzeit hat eine ungültige Antwort geliefert.', response_too_large: 'Die Antwort der Server-Laufzeit überschreitet die Größenbegrenzung.',
  unknown: 'Die Serveraktion konnte nicht abgeschlossen werden. Weitere Details sind unter der Fehler-ID protokolliert.',
};
export const friendlyDiagnosticMessage = error => messages[typeof error === 'string' && reasons.has(error) ? error : safeDiagnosticReason(error)] || messages.unknown;

function stackFrames(error) {
  const stack = value(error, 'stack');
  if (typeof stack !== 'string') return [];
  return stack.slice(0, 16384).split('\n').slice(1, 25).flatMap(line => {
    const match = /[/\\]server[/\\]([a-z0-9-]+\.mjs):(\d{1,7}):(\d{1,7})/i.exec(line);
    return match && trustedFiles.has(match[1]) ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
  }).slice(0, 8);
}

export function createDiagnostics({ write = line => process.stderr.write(`${line}\n`) } = {}) {
  const report = (error, context = {}) => {
    const existing = value(error, 'errorId');
    const requestId = value(context, 'requestId');
    const id = validCorrelationId(requestId) ? requestId : validCorrelationId(existing) ? existing : randomUUID();
    try {
      const record = { time: new Date().toISOString(), level: 'error', event: 'gameswitch_error', errorId: id, reason: safeDiagnosticReason(error), errorClass: classes.has(value(error, 'name')) ? value(error, 'name') : 'Error' };
      for (const key of ['requestId', 'jobId']) if (validCorrelationId(value(context, key))) record[key] = value(context, key);
      for (const key of ['profileId', 'sourceProfileId']) if (typeof value(context, key) === 'string' && identifier.test(value(context, key))) record[key] = value(context, key);
      if (games.has(value(context, 'gameId'))) record.gameId = value(context, 'gameId');
      for (const key of ['operation', 'type']) if (operations.has(value(context, key))) record[key] = value(context, key);
      if (stages.has(value(context, 'stage'))) record.stage = value(context, 'stage');
      if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value(context, 'method'))) record.method = value(context, 'method');
      const status = value(context, 'status');
      if ((Number.isInteger(status) && status >= 100 && status <= 599) || ['running', 'completed', 'failed'].includes(status)) record.status = status;
      const upstreamStatus = value(error, 'upstreamStatus');
      if (Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599) record.upstreamStatus = upstreamStatus;
      if (operations.has(value(error, 'upstreamOperation'))) record.upstreamOperation = value(error, 'upstreamOperation');
      if (/^[a-f0-9]{64}$/.test(value(error, 'responseHash') || '')) record.responseHash = value(error, 'responseHash');
      if (typeof value(error, 'responseTruncated') === 'boolean') record.responseTruncated = value(error, 'responseTruncated');
      const code = value(error, 'code') || value(value(error, 'cause'), 'code');
      if (codes.has(code)) record.code = code;
      const frames = stackFrames(error); if (frames.length) record.frames = frames;
      const result = write(JSON.stringify(record));
      if (result && typeof result.catch === 'function') result.catch(() => {});
      try { if (error && typeof error === 'object') error.errorId = id; } catch { /* Frozen errors are supported. */ }
    } catch { /* Diagnostics must never turn a recoverable failure into another failure. */ }
    return id;
  };
  return { error: report, diagnosticError: report };
}

const defaultDiagnostics = createDiagnostics();
export const diagnosticError = (error, context) => defaultDiagnostics.error(error, context);
