/**
 * lib/contracts/_runtime/agentToolValidation.ts
 *
 * Helpers minimamente invasivos para adicionar validação Zod a uma route
 * `/api/agent/tools/{domain}` SEM mudar a estrutura existente (que já tem
 * verifyAgentRequest HMAC + parseAgentBody).
 *
 * Uso na route:
 *
 *   const parsed = parseToolRequest('agenda', body);
 *   // → throw ContractError 'VALIDATION_ERROR' se shape errado
 *
 *   const data = await handlers[parsed.action](businessId, parsed.params);
 *
 *   const validated = validateToolResponse('agenda', parsed.action, data);
 *   return NextResponse.json({ ok: true, data: validated });
 */

import { z } from 'zod';
import { AGENT_TOOLS_REGISTRY, type AgentToolDomain, getAgentToolDataSchema } from '../api/agent';
import { ContractError } from './withContract';

/** Parse + valida `{ action, params }` de uma tool. Falha = ContractError VALIDATION_ERROR. */
export function parseToolRequest<D extends AgentToolDomain>(
  domain: D,
  body: unknown,
): { action: string; params: unknown } {
  const entry = AGENT_TOOLS_REGISTRY[domain];
  if (!entry) {
    throw new ContractError('INTERNAL', `Domain de tool desconhecido: ${domain}`);
  }
  const parsed = entry.request.safeParse(body);
  if (!parsed.success) {
    throw new ContractError(
      'VALIDATION_ERROR',
      `Request inválido para ${domain}`,
      parsed.error.flatten(),
    );
  }
  // discriminated union: `parsed.data` é `{ action, params }`
  return parsed.data as { action: string; params: unknown };
}

/**
 * Valida shape de `data` retornado por uma action. Em produção, loga warning se
 * não bate mas devolve o data original (não quer quebrar caller em prod se schema
 * está incompleto). Em dev/test, lança ContractError 'INTERNAL'.
 */
export function validateToolResponse<D extends AgentToolDomain>(
  domain: D,
  action: string,
  data: unknown,
): unknown {
  const dataSchema = getAgentToolDataSchema(domain, action);
  if (!dataSchema) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[agentToolValidation] Sem schema de data para ${domain}.${action}`);
    }
    return data;
  }
  const parsed = (dataSchema as z.ZodTypeAny).safeParse(data);
  if (!parsed.success) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        `[agentToolValidation] Response shape diverge em ${domain}.${action}`,
        parsed.error.flatten(),
      );
      return data;
    }
    throw new ContractError(
      'INTERNAL',
      `Response do handler ${domain}.${action} diverge do contrato`,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

/**
 * Helper combinado: dado um body bruto e o domain, retorna `{ action, params }`
 * já parseado e tipado pelo discriminated union.
 *
 * Para o handler validar a response e responder JSON estruturado:
 *
 *   try {
 *     const { action, params } = parseToolRequest('agenda', body);
 *     const data = await dispatchAgendaAction(action, params, businessId);
 *     const out = validateToolResponse('agenda', action, data);
 *     return NextResponse.json({ ok: true, data: out });
 *   } catch (e) {
 *     if (e instanceof ContractError) {
 *       return NextResponse.json(e.toEnvelope(), { status: 400 });
 *     }
 *     throw e;
 *   }
 */
export function isContractError(err: unknown): err is ContractError {
  return err instanceof ContractError;
}
