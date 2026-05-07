/**
 * Sanitização de nome de contato.
 *
 * Defesa em profundidade contra o bug "(- Daia Salão" que aparecia em
 * conversations geradas por broadcast: parser do RecipientListInput tinha
 * regex de cleanup que não cobria parens/dots/asteriscos. Mesmo com fix
 * no parser, este helper roda no backend pra garantir que NENHUMA fonte
 * (CSV import, paste manual, agente IA, etc.) consiga injetar lixo nas
 * pontas do nome.
 *
 * Caracteres limpos das pontas: parens, brackets, braces, ângulos,
 * separadores comuns (- — – _ , : . ; • | * #) e whitespace. Caracteres
 * INTERNOS são preservados — "Salão e Estética" continua intacto.
 */

const EDGE_NOISE = /^[\s\-—–_,:.;•|<>(){}\[\]*#]+|[\s\-—–_,:.;•|<>(){}\[\]*#]+$/g;

/** Limpa pontuação espúria nas pontas do nome. Retorna undefined se o
 *  resultado for vazio ou só ruído (sem letra). */
export function cleanContactName(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // Roda 2x: o regex remove só uma "camada" por vez (ex: "(- Foo" → "- Foo"
  // → "Foo"). Sem isso, "( - " só perde o "(" da primeira passada. 2x cobre
  // sequências comuns; mais de 2 é overkill.
  let cleaned = raw.replace(EDGE_NOISE, '').replace(EDGE_NOISE, '').trim();
  if (!cleaned) return undefined;
  // Filtra ruído: precisa ter pelo menos 1 letra/dígito além de símbolos.
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return undefined;
  // Cap de segurança contra strings absurdamente longas (evita display issues
  // em badges/headers e atende limites Firestore).
  if (cleaned.length > 200) cleaned = cleaned.slice(0, 200);
  return cleaned;
}

/** Quando o nome veio sujo, retorna versão limpa OU o fallback. Útil pro
 *  caso `contactName: cleanContactName(name) ?? recipientId` no broadcast. */
export function cleanContactNameOr<T>(raw: string | undefined | null, fallback: T): string | T {
  return cleanContactName(raw) ?? fallback;
}
