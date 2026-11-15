import { z } from 'zod';

const lifecycleCommands = new Set(['stop', 'restart', 'shutdown', 'quit', 'exit']);

export function commandVerb(command) {
  return command.split(/\s+/u, 1)[0].toLowerCase().split(':').at(-1);
}

export const consoleCommandSchema = z.object({
  command: z.string().max(1024, 'Ein Konsolenbefehl darf höchstens 1024 Zeichen enthalten.')
    .refine(value => !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value), 'Nur einzeilige Befehle ohne Steuerzeichen sind erlaubt.')
    .transform(value => value.trim().replace(/^\//, '').trim())
    .refine(value => value.length > 0, 'Bitte einen Spielbefehl eingeben.')
    .refine(value => !lifecycleCommands.has(commandVerb(value)), 'Zum Stoppen oder Neustarten bitte die Profilsteuerung verwenden.'),
}).strict();

export function safeCommandVerb(command) {
  const verb = command.split(/\s+/u, 1)[0];
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(verb) ? verb : 'Spielbefehl';
}

const writableGames = new Set(['minecraft', 'gmod', 'terraria', 'squad', 'factorio']);
const otherLifecycleCommands = new Set([...lifecycleCommands, '_restart', 'changelevel', 'map', 'exit-nosave', 'adminkillserver']);

export function parseConsoleCommand(profile, input) {
  const gameId = profile.gameId || 'minecraft';
  if (!writableGames.has(gameId)) throw Object.assign(new Error('Dieses Spiel hat keine unterstützte Server-Befehlschnittstelle. Bitte die Admin-Einstellungen verwenden.'), { status: 400 });
  const result = consoleCommandSchema.parse(input);
  if (gameId !== 'minecraft') {
    if (result.command.includes(';') || !/^[A-Za-z_][A-Za-z0-9_.:+-]*(?:\s|$)/u.test(result.command)) {
      throw Object.assign(new Error('Nur ein einzelner Spielbefehl mit unquotiertem Befehlsnamen ist erlaubt; keine Semikolons.'), { status: 400 });
    }
    if (otherLifecycleCommands.has(commandVerb(result.command))) throw Object.assign(new Error('Zum Stoppen oder Neustarten bitte die Profilsteuerung verwenden.'), { status: 400 });
  }
  return gameId === 'factorio' ? { command: `/${result.command}` } : result;
}
