import { z } from 'zod';

const lifecycleCommands = new Set(['stop', 'restart', 'shutdown', 'quit', 'exit']);

export function commandVerb(command) {
  return command.split(/\s+/u, 1)[0].toLowerCase().split(':').at(-1);
}

export const consoleCommandSchema = z.object({
  command: z.string().max(1024, 'Ein Konsolenbefehl darf höchstens 1024 Zeichen enthalten.')
    .refine(value => !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value), 'Nur einzeilige Befehle ohne Steuerzeichen sind erlaubt.')
    .transform(value => value.trim().replace(/^\//, '').trim())
    .refine(value => value.length > 0, 'Bitte einen Minecraft-Befehl eingeben.')
    .refine(value => !lifecycleCommands.has(commandVerb(value)), 'Zum Stoppen oder Neustarten bitte die Profilsteuerung verwenden.'),
}).strict();

export function safeCommandVerb(command) {
  const verb = command.split(/\s+/u, 1)[0];
  return /^[a-zA-Z0-9_.:-]{1,64}$/.test(verb) ? verb : 'Minecraft-Befehl';
}
