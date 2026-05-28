/**
 * lib/utils/sessionKey.ts
 *
 * Helper PURO e DETERMINÍSTICO para montar o `sessionKey` canônico de uma
 * turma/sessão compartilhada (feature de capacidade/grade no Service).
 *
 * Cada aluno de uma turma é UM Appointment próprio que COMPARTILHA o mesmo
 * sessionKey. As vagas de uma turma = capacity - count(appointments
 * não-cancelados com aquele sessionKey).
 *
 * Formato canônico (4 partes, separador '_'):
 *
 *     `${serviceId}_${date}_${startTime}_${professionalId || 'any'}`
 *
 *   - serviceId      → DocId do Service (turma é definida pelo serviço)
 *   - date           → 'YYYY-MM-DD'
 *   - startTime      → 'HH:MM' (24h) — horário de início da sessão
 *   - professionalId → UID do profissional, ou o literal 'any' quando a
 *                      sessão não fixa profissional (sessão aberta).
 *
 * Por que 'any' em vez de string vazia: garante que o key sempre tenha 4
 * partes não-vazias, evita colisão acidental (`a__b` vs `a_b`) e mantém o
 * split reversível em `parseSessionKey`.
 *
 * NÃO use para agendamentos exclusivos (Service.capacity ausente ou 1) — nesses
 * o appointment NÃO recebe sessionKey e o conflito permanece BIT-A-BIT o atual.
 */

/** Sentinela usado quando a sessão não fixa profissional. */
export const SESSION_KEY_ANY_PROFESSIONAL = 'any' as const;

export interface SessionKeyParts {
  serviceId: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:MM' (24h) */
  startTime: string;
  /** UID do profissional ou undefined (sessão aberta). */
  professionalId?: string;
}

/**
 * Monta o sessionKey canônico. Determinístico: mesmas partes → mesmo key.
 * Não valida formato (validação acontece no boundary via Zod) — assume que o
 * caller já passou date/startTime no formato esperado.
 */
export function buildSessionKey(parts: SessionKeyParts): string {
  const prof = parts.professionalId && parts.professionalId.length > 0
    ? parts.professionalId
    : SESSION_KEY_ANY_PROFESSIONAL;
  return `${parts.serviceId}_${parts.date}_${parts.startTime}_${prof}`;
}

/**
 * Inverso de `buildSessionKey`. Retorna null quando o key não tem exatamente
 * 4 partes (formato inválido). `professionalId` vem como undefined quando o
 * componente é o sentinela 'any'.
 *
 * Nota: serviceId é a 1ª parte; como ids do Firestore não contêm '_', o split
 * por '_' é seguro para os 4 componentes canônicos.
 */
export function parseSessionKey(key: string): SessionKeyParts | null {
  const segments = key.split('_');
  if (segments.length !== 4) return null;
  const [serviceId, date, startTime, prof] = segments;
  if (!serviceId || !date || !startTime || !prof) return null;
  return {
    serviceId,
    date,
    startTime,
    professionalId: prof === SESSION_KEY_ANY_PROFESSIONAL ? undefined : prof,
  };
}
