/**
 * lib/contracts/_runtime/withContract.ts
 *
 * Wrapper que valida request e response de uma Next.js App Router route.
 * Falha cedo com ErrorEnvelope padronizado quando shape diverge.
 *
 * Uso típico:
 *   export const POST = withContract({
 *     body: CreateSaleBodySchema,
 *     headers: IdempotencyHeaderSchema.merge(ApiKeyAuthHeaderSchema),
 *     response: CreateSaleResponseSchema,
 *   }, async ({ body, headers, req }) => {
 *     // ...lógica
 *     return { ok: true, data: { ... } };
 *   });
 */

import { z, ZodTypeAny } from 'zod';
import { ErrorEnvelopeSchema, type ErrorEnvelope } from '../api/_envelope';

export interface ContractDefinition<
  TBody extends ZodTypeAny | undefined = undefined,
  TQuery extends ZodTypeAny | undefined = undefined,
  TParams extends ZodTypeAny | undefined = undefined,
  THeaders extends ZodTypeAny | undefined = undefined,
  TResponse extends ZodTypeAny = ZodTypeAny,
> {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  headers?: THeaders;
  response: TResponse;
  /** Se `true`, valida a resposta antes de devolver (default true em dev, false em prod). */
  validateResponse?: boolean;
}

type Infer<T> = T extends ZodTypeAny ? z.infer<T> : undefined;

export interface ContractContext<
  TBody extends ZodTypeAny | undefined,
  TQuery extends ZodTypeAny | undefined,
  TParams extends ZodTypeAny | undefined,
  THeaders extends ZodTypeAny | undefined,
> {
  body: Infer<TBody>;
  query: Infer<TQuery>;
  params: Infer<TParams>;
  headers: Infer<THeaders>;
  req: Request;
}

function errorResponse(envelope: ErrorEnvelope, status: number): Response {
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function shouldValidateResponse(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit;
  return process.env.NODE_ENV !== 'production';
}

export function withContract<
  TBody extends ZodTypeAny | undefined,
  TQuery extends ZodTypeAny | undefined,
  TParams extends ZodTypeAny | undefined,
  THeaders extends ZodTypeAny | undefined,
  TResponse extends ZodTypeAny,
>(
  contract: ContractDefinition<TBody, TQuery, TParams, THeaders, TResponse>,
  handler: (
    ctx: ContractContext<TBody, TQuery, TParams, THeaders>,
  ) => Promise<z.infer<TResponse>>,
): (req: Request, routeCtx?: { params?: Record<string, string> }) => Promise<Response> {
  return async (req, routeCtx) => {
    try {
      const ctx: ContractContext<TBody, TQuery, TParams, THeaders> = {
        body: undefined as Infer<TBody>,
        query: undefined as Infer<TQuery>,
        params: undefined as Infer<TParams>,
        headers: undefined as Infer<THeaders>,
        req,
      };

      if (contract.headers) {
        const headersObj: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headersObj[key.toLowerCase()] = value;
        });
        const parsed = contract.headers.safeParse(headersObj);
        if (!parsed.success) {
          return errorResponse(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Headers inválidos',
                details: parsed.error.flatten(),
              },
            },
            400,
          );
        }
        ctx.headers = parsed.data as Infer<THeaders>;
      }

      if (contract.params) {
        const parsed = contract.params.safeParse(routeCtx?.params ?? {});
        if (!parsed.success) {
          return errorResponse(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Path params inválidos',
                details: parsed.error.flatten(),
              },
            },
            400,
          );
        }
        ctx.params = parsed.data as Infer<TParams>;
      }

      if (contract.query) {
        const url = new URL(req.url);
        const queryObj: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          queryObj[key] = value;
        });
        const parsed = contract.query.safeParse(queryObj);
        if (!parsed.success) {
          return errorResponse(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Query params inválidos',
                details: parsed.error.flatten(),
              },
            },
            400,
          );
        }
        ctx.query = parsed.data as Infer<TQuery>;
      }

      if (contract.body) {
        let raw: unknown = undefined;
        try {
          raw = await req.json();
        } catch {
          return errorResponse(
            {
              ok: false,
              error: { code: 'VALIDATION_ERROR', message: 'Body JSON inválido' },
            },
            400,
          );
        }
        const parsed = contract.body.safeParse(raw);
        if (!parsed.success) {
          return errorResponse(
            {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Body inválido',
                details: parsed.error.flatten(),
              },
            },
            400,
          );
        }
        ctx.body = parsed.data as Infer<TBody>;
      }

      const result = await handler(ctx);

      if (shouldValidateResponse(contract.validateResponse)) {
        const parsed = contract.response.safeParse(result);
        if (!parsed.success) {
          console.error('[withContract] Response shape diverge do contrato', parsed.error);
          return errorResponse(
            {
              ok: false,
              error: {
                code: 'INTERNAL',
                message: 'Response shape inválido (contrato violado)',
                details: parsed.error.flatten(),
              },
            },
            500,
          );
        }
        return new Response(JSON.stringify(parsed.data), {
          status: 'ok' in (parsed.data as object) && (parsed.data as { ok: unknown }).ok === false ? 400 : 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      const inferred = result as { ok?: unknown };
      const status = inferred?.ok === false ? 400 : 200;
      return new Response(JSON.stringify(result), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      console.error('[withContract] Erro não tratado', err);
      const envelope = ErrorEnvelopeSchema.parse({
        ok: false,
        error: {
          code: 'INTERNAL',
          message: err instanceof Error ? err.message : 'Erro interno',
        },
      });
      return errorResponse(envelope, 500);
    }
  };
}

/**
 * Helper para responder erro estruturado de dentro de um handler `withContract`.
 *
 *   if (!business) throw new ContractError('NOT_FOUND', 'business inexistente');
 */
export class ContractError extends Error {
  constructor(
    public code: ErrorEnvelope['error']['code'],
    message: string,
    public details?: unknown,
    public retryable = false,
  ) {
    super(message);
  }

  toEnvelope(): ErrorEnvelope {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
        retryable: this.retryable,
      },
    };
  }
}
