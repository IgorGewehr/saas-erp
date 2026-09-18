import { describe, it, expect } from 'vitest';
import { parseProductSpecs } from '@/lib/utils/productSpecs';

describe('parseProductSpecs', () => {
  it('vazio/nulo/undefined devolvem tudo vazio', () => {
    expect(parseProductSpecs('')).toEqual({ specs: [], rest: '' });
    expect(parseProductSpecs(null)).toEqual({ specs: [], rest: '' });
    expect(parseProductSpecs(undefined)).toEqual({ specs: [], rest: '' });
  });

  it('interpreta linhas "Rótulo: valor" em specs', () => {
    const result = parseProductSpecs('Duração: 30 segundos\nHorário: nobre\nInserções: 60 por mês');
    expect(result.specs).toEqual([
      { label: 'Duração', value: '30 segundos' },
      { label: 'Horário', value: 'nobre' },
      { label: 'Inserções', value: '60 por mês' },
    ]);
    expect(result.rest).toBe('');
  });

  it('aceita marcadores de lista (- • *) antes do rótulo', () => {
    const result = parseProductSpecs('- Duração: 30s\n• Horário: nobre\n* Alcance: 50 mil');
    expect(result.specs.map((s) => s.label)).toEqual(['Duração', 'Horário', 'Alcance']);
  });

  it('separa texto livre das specs, preservando a ordem do texto', () => {
    const result = parseProductSpecs('Pacote mensal de spots.\nDuração: 30s\nHorário: nobre\nIdeal pra varejo local.');
    expect(result.specs).toHaveLength(2);
    expect(result.rest).toBe('Pacote mensal de spots.\nIdeal pra varejo local.');
  });

  it('uma única linha "Rótulo: valor" é frase, não lista de specs', () => {
    const text = 'Atenção: pacote válido só em dias úteis';
    expect(parseProductSpecs(text)).toEqual({ specs: [], rest: text });
  });

  it('descrição sem dois-pontos vira só texto', () => {
    const text = 'Spot de 30 segundos em horário nobre.';
    expect(parseProductSpecs(text)).toEqual({ specs: [], rest: text });
  });

  it('rótulo maior que 40 caracteres não é spec', () => {
    const long = 'Um rótulo absurdamente comprido que passa do limite de quarenta';
    const result = parseProductSpecs(`${long}: valor\nDuração: 30s\nHorário: nobre`);
    expect(result.specs).toHaveLength(2);
    expect(result.rest).toContain(long);
  });

  it('URL (https://...) não vira spec', () => {
    const result = parseProductSpecs('Site: https://radio.com.br\nMais info: https://radio.com.br/pacotes\nDuração: 30s\nHorário: nobre');
    expect(result.specs.map((s) => s.label)).toEqual(['Site', 'Mais info', 'Duração', 'Horário']);
    const onlyUrls = parseProductSpecs('https://radio.com.br\nhttps://radio.com.br/pacotes');
    expect(onlyUrls.specs).toEqual([]);
  });

  it('horário no rótulo (10:30) não vira spec', () => {
    const text = '10:30 às 12h\n14:00 às 16h';
    expect(parseProductSpecs(text)).toEqual({ specs: [], rest: text });
  });

  it('normaliza CRLF', () => {
    const result = parseProductSpecs('Duração: 30s\r\nHorário: nobre');
    expect(result.specs).toHaveLength(2);
  });

  it('valor pode conter dois-pontos (só o primeiro separa)', () => {
    const result = parseProductSpecs('Faixa: 08:00 às 10:00\nDias: seg a sex');
    expect(result.specs[0]).toEqual({ label: 'Faixa', value: '08:00 às 10:00' });
  });
});
