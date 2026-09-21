import { describe, it, expect } from 'vitest';
import { filterClients, validateQuickClient } from '@/lib/utils/vitrineClient';
import { toLocalDateString, formatDateOnly } from '@/lib/utils/localDate';

const clients = [
  { name: 'Padaria do Zé', company: 'Zé Alimentos', phone: '5511987654321', whatsapp: undefined, email: 'ze@padaria.com.br' },
  { name: 'Mercado São João', company: undefined, phone: '5521912345678', whatsapp: '5521912345678', email: undefined },
  { name: 'Ótica Visão', company: undefined, phone: undefined, whatsapp: undefined, email: undefined },
];

describe('filterClients', () => {
  it('sem busca devolve todos', () => {
    expect(filterClients(clients, '')).toHaveLength(3);
    expect(filterClients(clients, '   ')).toHaveLength(3);
  });

  it('busca por nome sem acento e sem caixa', () => {
    expect(filterClients(clients, 'sao joao').map((c) => c.name)).toEqual(['Mercado São João']);
    expect(filterClients(clients, 'OTICA').map((c) => c.name)).toEqual(['Ótica Visão']);
  });

  it('busca por empresa e por e-mail', () => {
    expect(filterClients(clients, 'alimentos')).toHaveLength(1);
    expect(filterClients(clients, 'padaria.com')).toHaveLength(1);
  });

  it('busca por telefone ignora máscara e exige 3+ dígitos', () => {
    expect(filterClients(clients, '(11) 98765').map((c) => c.name)).toEqual(['Padaria do Zé']);
    expect(filterClients(clients, '21 91234').map((c) => c.name)).toEqual(['Mercado São João']);
    // 1–2 dígitos não viram filtro por telefone (casaria com quase todo mundo)
    expect(filterClients(clients, '9')).toHaveLength(0);
  });

  it('cliente sem telefone/e-mail não quebra a busca', () => {
    expect(() => filterClients(clients, '123')).not.toThrow();
  });
});

describe('validateQuickClient', () => {
  const valid = { name: 'Padaria do Zé', phone: '(11) 98765-4321', email: '' };

  it('nome + telefone com DDD bastam (e-mail é opcional)', () => {
    expect(validateQuickClient(valid)).toEqual({});
  });

  it('exige nome de 2+ letras', () => {
    expect(validateQuickClient({ ...valid, name: ' ' }).name).toBeDefined();
    expect(validateQuickClient({ ...valid, name: 'A' }).name).toBeDefined();
  });

  it('telefone: 10 a 13 dígitos', () => {
    expect(validateQuickClient({ ...valid, phone: '98765-4321' }).phone).toBeDefined();
    expect(validateQuickClient({ ...valid, phone: '' }).phone).toBeDefined();
    expect(validateQuickClient({ ...valid, phone: '55 11 98765-4321' })).toEqual({});
    expect(validateQuickClient({ ...valid, phone: '1198765432100000' }).phone).toBeDefined();
  });

  it('e-mail, quando informado, precisa ser válido', () => {
    expect(validateQuickClient({ ...valid, email: 'sem-arroba' }).email).toBeDefined();
    expect(validateQuickClient({ ...valid, email: 'ze@padaria.com.br' })).toEqual({});
  });
});

describe('datas locais', () => {
  it('toLocalDateString usa o dia do relógio local, não o UTC', () => {
    // 23:30 local do dia 18 — em UTC já seria dia 19 em fusos a oeste (ex.: Brasil).
    expect(toLocalDateString(new Date(2026, 8, 18, 23, 30))).toBe('2026-09-18');
    expect(toLocalDateString(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });

  it('formatDateOnly reformata sem deslocar o dia', () => {
    expect(formatDateOnly('2026-09-18')).toBe('18/09/2026');
    expect(formatDateOnly('2026-10-01T00:00:00.000Z')).toBe('01/10/2026');
  });

  it('formatDateOnly devolve traço pra vazio/inválido', () => {
    expect(formatDateOnly(undefined)).toBe('—');
    expect(formatDateOnly('não é data')).toBe('—');
  });
});
