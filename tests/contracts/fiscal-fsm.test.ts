/**
 * Contrato FSM de FiscalDocument — garante que a máquina de estados modelada
 * em lib/contracts/fsm/fiscalDocument.ts continua espelhando os write paths
 * reais (emit/retry/cancel/consultaStatusRunner/contingenciaRunner).
 *
 * Se uma transição for adicionada/removida do mapa sem atualizar os
 * consumidores (rotas 409, runners warn+skip), estes testes falham cedo.
 */

import { describe, it, expect } from 'vitest';
import {
  FISCAL_DOCUMENT_STATUSES,
  FISCAL_DOCUMENT_TRANSITIONS,
  FISCAL_DOCUMENT_TERMINAL_STATUSES,
  FiscalDocumentStatusSchema,
  canTransitionFiscalDocument,
  assertTransitionFiscalDocument,
  normalizeFiscalDocumentStatus,
} from '@/lib/contracts/fsm/fiscalDocument';

describe('FiscalDocument FSM — transições válidas (write paths reais)', () => {
  it('pendente → autorizada/processando/rejeitada/erro (retry)', () => {
    expect(canTransitionFiscalDocument('pendente', 'autorizada')).toBe(true);
    expect(canTransitionFiscalDocument('pendente', 'processando')).toBe(true);
    expect(canTransitionFiscalDocument('pendente', 'rejeitada')).toBe(true);
    expect(canTransitionFiscalDocument('pendente', 'erro')).toBe(true);
  });

  it('processando → autorizada/cancelada/rejeitada/erro (consultaStatusRunner)', () => {
    expect(canTransitionFiscalDocument('processando', 'autorizada')).toBe(true);
    // Cancelamento externo detectado via consulta (cStat 101/151/155)
    expect(canTransitionFiscalDocument('processando', 'cancelada')).toBe(true);
    expect(canTransitionFiscalDocument('processando', 'rejeitada')).toBe(true);
    expect(canTransitionFiscalDocument('processando', 'erro')).toBe(true);
  });

  it('contingencia → autorizada/processando/rejeitada/erro (contingenciaRunner)', () => {
    expect(canTransitionFiscalDocument('contingencia', 'autorizada')).toBe(true);
    expect(canTransitionFiscalDocument('contingencia', 'processando')).toBe(true);
    expect(canTransitionFiscalDocument('contingencia', 'rejeitada')).toBe(true);
    expect(canTransitionFiscalDocument('contingencia', 'erro')).toBe(true);
  });

  it('contingencia → contingencia (self-loop: retry rejeitado preserva doc elegível)', () => {
    expect(canTransitionFiscalDocument('contingencia', 'contingencia')).toBe(true);
  });

  it('autorizada → cancelada é a única saída de autorizada (cancel)', () => {
    expect(canTransitionFiscalDocument('autorizada', 'cancelada')).toBe(true);
    expect([...FISCAL_DOCUMENT_TRANSITIONS.autorizada]).toEqual(['cancelada']);
  });
});

describe('FiscalDocument FSM — transições inválidas', () => {
  it('estados terminais não têm saída (reemissão cria novo doc)', () => {
    for (const terminal of FISCAL_DOCUMENT_TERMINAL_STATUSES) {
      for (const to of FISCAL_DOCUMENT_STATUSES) {
        expect(canTransitionFiscalDocument(terminal, to)).toBe(false);
      }
    }
  });

  it('cancelada não volta pra autorizada', () => {
    expect(canTransitionFiscalDocument('cancelada', 'autorizada')).toBe(false);
  });

  it('autorizada não regride pra pendente/processando/contingencia', () => {
    expect(canTransitionFiscalDocument('autorizada', 'pendente')).toBe(false);
    expect(canTransitionFiscalDocument('autorizada', 'processando')).toBe(false);
    expect(canTransitionFiscalDocument('autorizada', 'contingencia')).toBe(false);
  });

  it('pendente não pula direto pra cancelada (precisa autorizar antes)', () => {
    expect(canTransitionFiscalDocument('pendente', 'cancelada')).toBe(false);
  });

  it('status desconhecido nunca transiciona', () => {
    expect(
      canTransitionFiscalDocument(
        'rascunho' as Parameters<typeof canTransitionFiscalDocument>[0],
        'autorizada',
      ),
    ).toBe(false);
  });
});

describe('assertTransitionFiscalDocument', () => {
  it('não lança em transição válida', () => {
    expect(() => assertTransitionFiscalDocument('autorizada', 'cancelada')).not.toThrow();
  });

  it('lança com mensagem identificável em transição inválida', () => {
    expect(() => assertTransitionFiscalDocument('cancelada', 'autorizada')).toThrow(
      /transição inválida cancelada → autorizada/,
    );
  });
});

describe('normalizeFiscalDocumentStatus — canonização do gateway/legado', () => {
  it('formas femininas canônicas passam direto', () => {
    for (const status of FISCAL_DOCUMENT_STATUSES) {
      expect(normalizeFiscalDocumentStatus(status)).toBe(status);
    }
  });

  it('formas masculinas do gateway sefaz-api viram femininas', () => {
    expect(normalizeFiscalDocumentStatus('autorizado')).toBe('autorizada');
    expect(normalizeFiscalDocumentStatus('rejeitado')).toBe('rejeitada');
    expect(normalizeFiscalDocumentStatus('cancelado')).toBe('cancelada');
  });

  it('denegada/denegado normalizam pra rejeitada (recusa definitiva)', () => {
    expect(normalizeFiscalDocumentStatus('denegada')).toBe('rejeitada');
    expect(normalizeFiscalDocumentStatus('denegado')).toBe('rejeitada');
  });

  it('é case/whitespace-insensitive', () => {
    expect(normalizeFiscalDocumentStatus('  AUTORIZADA ')).toBe('autorizada');
    expect(normalizeFiscalDocumentStatus('Rejeitado')).toBe('rejeitada');
  });

  it('legado fora do FSM e lixo retornam null (caller decide)', () => {
    expect(normalizeFiscalDocumentStatus('rascunho')).toBeNull();
    expect(normalizeFiscalDocumentStatus('')).toBeNull();
    expect(normalizeFiscalDocumentStatus(null)).toBeNull();
    expect(normalizeFiscalDocumentStatus(undefined)).toBeNull();
    expect(normalizeFiscalDocumentStatus(42)).toBeNull();
    expect(normalizeFiscalDocumentStatus('finalizada')).toBeNull();
  });
});

describe('FiscalDocumentStatusSchema (Zod)', () => {
  it('aceita todos os status do enum e rejeita formas não-canônicas', () => {
    for (const status of FISCAL_DOCUMENT_STATUSES) {
      expect(FiscalDocumentStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(FiscalDocumentStatusSchema.safeParse('autorizado').success).toBe(false);
    expect(FiscalDocumentStatusSchema.safeParse('rascunho').success).toBe(false);
  });

  it('mapa de transições cobre exatamente os status do enum', () => {
    expect(Object.keys(FISCAL_DOCUMENT_TRANSITIONS).sort()).toEqual(
      [...FISCAL_DOCUMENT_STATUSES].sort(),
    );
    // Todo destino declarado também é um status válido
    for (const targets of Object.values(FISCAL_DOCUMENT_TRANSITIONS)) {
      for (const to of targets) {
        expect(FISCAL_DOCUMENT_STATUSES).toContain(to);
      }
    }
  });
});
