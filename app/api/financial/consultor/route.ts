/**
 * POST /api/financial/consultor — Super Consultor do financial-v2.
 *
 * O motor de regras determinístico roda no client (read-models + consultor-rules.ts)
 * e já escolheu 1 ruleId + facts + templateFallback. Esta rota apenas:
 *   1. autentica (Firebase ID token → businessId; R1 — businessId nunca vem do body)
 *   2. valida o request com Zod (R6)
 *   3. rate-limita por tenant (reusa lib/agent/rate-limit, escopo 'operator')
 *   4. verifica cache Firestore por chave idempotente (R3) — hit retorna na hora
 *   5. miss → chama OpenAI (mesmo padrão fetch de lib/channels/media-enrichment.ts)
 *   6. valida a saída do LLM (contém os números dos facts? ≤220 chars?) — falha
 *      NUNCA vira erro na UI, cai pro templateFallback
 *   7. grava cache só no caminho de sucesso do LLM
 *
 * Nunca lança erro 500 por falha do LLM — o pior caso é devolver o template
 * (source: 'template'), que a UI já está renderizando otimisticamente.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/config/firebaseAdmin';
import { verifyAuth, isAuthError } from '@/lib/utils/verifyAuth';
import { checkRateLimit } from '@/lib/agent/rate-limit';
import {
  FinancialConsultorRequestSchema,
  FinancialInsightCacheDocSchema,
  buildFinancialInsightCacheKey,
  type FinancialConsultorResponse,
} from '@/lib/contracts/api/financial/consultor';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL_DEFAULT || 'gpt-4o-mini';
const MAX_PHRASE_CHARS = 220;

const SYSTEM_PROMPT =
  'Você é um consultor financeiro brasileiro para dono de pequeno negócio. ' +
  'Reescreva o fato em UMA frase (máximo 200 caracteres), tom direto e sem jargão, ' +
  'terminando com a ação no imperativo. Use os números EXATAMENTE como fornecidos — ' +
  'não invente números nem conselhos fora do fato dado.';

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const auth = await verifyAuth(req);
  if (isAuthError(auth)) return auth;
  const { businessId } = auth;

  const parsed = FinancialConsultorRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Request inválido', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { tab, period, ruleId, facts, templateFallback } = parsed.data;

  const rate = await checkRateLimit(businessId, 'operator');
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit excedido', retryAfterSec: rate.retryAfterSec },
      { status: 429 },
    );
  }

  const factsHash8 = crypto
    .createHash('sha256')
    .update(JSON.stringify(facts, Object.keys(facts).sort()))
    .digest('hex')
    .slice(0, 8);
  const cacheKey = buildFinancialInsightCacheKey({ businessId, tab, period, ruleId, factsHash8 });

  // X-Idempotency-Key é opcional no client, mas quando presente deve bater com a
  // chave derivada do próprio request — só logamos divergência (nunca bloqueia:
  // a chave determinística já garante a idempotência real, R3).
  const idempotencyKeyHeader = req.headers.get('x-idempotency-key');
  if (idempotencyKeyHeader && idempotencyKeyHeader !== cacheKey) {
    console.warn(`[financial/consultor] X-Idempotency-Key divergente (esperado ${cacheKey})`);
  }

  const cacheRef = adminDb.collection('financialInsightCache').doc(cacheKey);

  try {
    const cached = await cacheRef.get();
    if (cached.exists) {
      const data = cached.data();
      const phrase = (data?.phrase as string | undefined) || templateFallback;
      const response: FinancialConsultorResponse = { phrase, source: 'cache', ruleId };
      return NextResponse.json(response);
    }
  } catch (err) {
    console.error('[financial/consultor] cache read failed:', (err as Error).message);
    // segue pro caminho normal — pior caso é uma chamada de LLM a mais
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const response: FinancialConsultorResponse = { phrase: templateFallback, source: 'template', ruleId };
    return NextResponse.json(response);
  }

  try {
    const userPayload = JSON.stringify({ facts, templateFallback });
    const resp = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 100,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload },
        ],
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[financial/consultor] OpenAI ${resp.status}: ${body.slice(0, 200)}`);
      const response: FinancialConsultorResponse = { phrase: templateFallback, source: 'template', ruleId };
      return NextResponse.json(response);
    }

    const payload = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const rawPhrase = payload.choices?.[0]?.message?.content?.trim();

    if (!rawPhrase || !isValidConsultorPhrase(rawPhrase, facts)) {
      const response: FinancialConsultorResponse = { phrase: templateFallback, source: 'template', ruleId };
      return NextResponse.json(response);
    }

    const cacheDoc = FinancialInsightCacheDocSchema.parse({
      businessId,
      tab,
      period,
      ruleId,
      factsHash: factsHash8,
      phrase: rawPhrase,
      model: OPENAI_MODEL,
      createdAt: new Date().toISOString(),
    });
    await cacheRef.set(cacheDoc);

    const response: FinancialConsultorResponse = { phrase: rawPhrase, source: 'llm', ruleId };
    return NextResponse.json(response);
  } catch (err) {
    console.error('[financial/consultor] OpenAI call failed:', (err as Error).message);
    const response: FinancialConsultorResponse = { phrase: templateFallback, source: 'template', ruleId };
    return NextResponse.json(response);
  }
}

/**
 * Validação da frase do LLM: precisa parecer 1 frase curta e conter, como
 * substring, o valor de cada fact numérico/string fornecido — impede o modelo
 * de "inventar" um número diferente do calculado pelo motor de regras.
 */
function isValidConsultorPhrase(phrase: string, facts: Record<string, string | number>): boolean {
  if (phrase.length > MAX_PHRASE_CHARS) return false;
  if (phrase.split('\n').filter(Boolean).length > 1) return false;

  for (const value of Object.values(facts)) {
    const needle = String(value);
    // Só exige presença de valores "que parecem número" (o fato quantitativo em
    // si) — labels textuais soltos no facts (ex.: um enum) não precisam bater
    // literalmente pois o LLM pode reformular a frase ao redor deles.
    if (/\d/.test(needle) && !phrase.includes(needle)) return false;
  }
  return true;
}
