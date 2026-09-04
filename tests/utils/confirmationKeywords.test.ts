import { describe, it, expect } from 'vitest';
import { isConfirmationKeyword } from '@/lib/utils/confirmationKeywords';

describe('isConfirmationKeyword', () => {
  it.each(['confirmo', 'confirmado', 'sim'])('reconhece "%s" sozinho', (word) => {
    expect(isConfirmationKeyword(word)).toBe(true);
  });

  it('é case-insensitive', () => {
    expect(isConfirmationKeyword('CONFIRMO')).toBe(true);
    expect(isConfirmationKeyword('Sim')).toBe(true);
  });

  it('tolera espaço ao redor', () => {
    expect(isConfirmationKeyword('  confirmo  ')).toBe(true);
  });

  it('remove pontuação de borda', () => {
    expect(isConfirmationKeyword('confirmo!')).toBe(true);
    expect(isConfirmationKeyword('Sim.')).toBe(true);
    expect(isConfirmationKeyword('?confirmo?')).toBe(true);
  });

  it('NÃO ativa quando a palavra é só parte de uma frase maior', () => {
    expect(isConfirmationKeyword('Sim, confirmo às 15h')).toBe(false);
    expect(isConfirmationKeyword('confirmo o pagamento')).toBe(false);
  });

  it('rejeita string vazia, null, undefined', () => {
    expect(isConfirmationKeyword('')).toBe(false);
    expect(isConfirmationKeyword('   ')).toBe(false);
    expect(isConfirmationKeyword(null)).toBe(false);
    expect(isConfirmationKeyword(undefined)).toBe(false);
  });

  it('rejeita texto muito longo (>30 chars) mesmo que comece com a keyword', () => {
    expect(isConfirmationKeyword('confirmo'.padEnd(31, 'o'))).toBe(false);
  });

  it('não confunde com palavras não relacionadas', () => {
    expect(isConfirmationKeyword('ok')).toBe(false);
    expect(isConfirmationKeyword('obrigado')).toBe(false);
    expect(isConfirmationKeyword('cancelar')).toBe(false);
  });
});
