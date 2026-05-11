/**
 * lib/contracts/_runtime/handlers/index.ts
 *
 * Registra todos os handlers conhecidos. Import este arquivo UMA VEZ no
 * bootstrap (idealmente em `instrumentation.ts` do Next.js) para garantir
 * que handlers estão pluggados antes do primeiro dispatch.
 *
 * Adicione handler novo:
 *   1. Crie arquivo `handlers/{nome}.ts` com função tipada
 *   2. Importe + chame `registerHandler('event.type', fn)` aqui
 *   3. Documente no jsdoc do evento em `events/index.ts` quem agora reage
 */

import { registerHandler } from '../dispatch';
import { handleAppointmentCompleted } from './appointmentCompleted';

let initialized = false;

/** Idempotente: garante que handlers estão registrados (chame de qualquer entrypoint). */
export function ensureDomainEventHandlers(): void {
  if (initialized) return;
  initialized = true;

  // ─── Piloto: appointment.completed ─────────────────────────────────────
  registerHandler('appointment.completed', handleAppointmentCompleted);

  // Outros handlers entram aqui conforme forem implementados.
  // Convention: cada handler em seu próprio arquivo dentro de handlers/.
}
