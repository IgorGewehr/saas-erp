import { describe, it, expect } from 'vitest';
import { parseOFX, parseCSV, autoMatch } from '@/lib/services/reconciliation';
import type { Transaction } from '@/lib/types';

/**
 * M03.5: primeira cobertura de testes pra lib/services/reconciliation.ts —
 * lógica pura (sem Firestore/React) que já roda em produção em DUAS telas
 * (financial/ClociliacaoTab.tsx e financial-v2/ConciliacaoImportModal.tsx)
 * fazendo conciliação bancária de dinheiro real, mas nunca teve nenhum
 * teste automatizado até esta fatia (ver docs/paridade/M03_PLANO_IMPLEMENTACAO.md).
 */

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx1',
    businessId: 'biz1',
    type: 'receita',
    description: 'Pagamento cliente',
    amount: 100,
    status: 'pendente',
    createdAt: '',
    updatedAt: '',
    ...over,
  } as Transaction;
}

describe('parseOFX', () => {
  it('extrai um lançamento de um bloco STMTTRN básico', () => {
    const ofx = `
      <STMTTRN>
        <TRNTYPE>DEBIT
        <DTPOSTED>20260115120000
        <TRNAMT>-150.50
        <FITID>ABC123
        <MEMO>Pagamento fornecedor
      </STMTTRN>
    `;
    const entries = parseOFX(ofx);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      date: '2026-01-15',
      description: 'Pagamento fornecedor',
      amount: -150.5,
      reference: 'ABC123',
    });
  });

  it('aceita DTPOSTED só com data (YYYYMMDD, sem hora)', () => {
    const ofx = `<STMTTRN><DTPOSTED>20260228<TRNAMT>50<MEMO>Teste</STMTTRN>`;
    const entries = parseOFX(ofx);
    expect(entries[0].date).toBe('2026-02-28');
  });

  it('usa NAME como fallback quando MEMO está ausente', () => {
    const ofx = `<STMTTRN><DTPOSTED>20260115<TRNAMT>10<NAME>Loja XPTO</STMTTRN>`;
    const entries = parseOFX(ofx);
    expect(entries[0].description).toBe('Loja XPTO');
  });

  it('usa REFNUM como fallback quando FITID está ausente', () => {
    const ofx = `<STMTTRN><DTPOSTED>20260115<TRNAMT>10<REFNUM>REF999</STMTTRN>`;
    const entries = parseOFX(ofx);
    expect(entries[0].reference).toBe('REF999');
  });

  it('extrai múltiplos lançamentos de múltiplos blocos STMTTRN', () => {
    const ofx = `
      <STMTTRN><DTPOSTED>20260101<TRNAMT>100<MEMO>Um</STMTTRN>
      <STMTTRN><DTPOSTED>20260102<TRNAMT>200<MEMO>Dois</STMTTRN>
      <STMTTRN><DTPOSTED>20260103<TRNAMT>300<MEMO>Tres</STMTTRN>
    `;
    const entries = parseOFX(ofx);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.description)).toEqual(['Um', 'Dois', 'Tres']);
  });

  it('ignora bloco sem DTPOSTED em vez de lançar', () => {
    const ofx = `<STMTTRN><TRNAMT>100<MEMO>Sem data</STMTTRN>`;
    expect(() => parseOFX(ofx)).not.toThrow();
    expect(parseOFX(ofx)).toHaveLength(0);
  });

  it('conteúdo vazio ou sem nenhum STMTTRN retorna array vazio, não lança', () => {
    expect(parseOFX('')).toEqual([]);
    expect(parseOFX('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>')).toEqual([]);
  });

  it('tags em minúsculo também são reconhecidas (case-insensitive)', () => {
    const ofx = `<stmttrn><dtposted>20260115<trnamt>75<memo>minusculo</stmttrn>`;
    const entries = parseOFX(ofx);
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(75);
  });

  it('TRNAMT ausente/inválido vira 0 em vez de NaN', () => {
    const ofx = `<STMTTRN><DTPOSTED>20260115<MEMO>Sem valor</STMTTRN>`;
    const entries = parseOFX(ofx);
    expect(entries[0].amount).toBe(0);
  });
});

describe('parseCSV', () => {
  it('formato brasileiro: delimitador ; , data DD/MM/YYYY, decimal com vírgula', () => {
    const csv = 'Data;Descricao;Valor\n15/01/2026;Pagamento cliente;1.234,56\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2026-01-15',
      description: 'Pagamento cliente',
      amount: 1234.56,
    });
  });

  it('formato genérico: delimitador , e data YYYY-MM-DD', () => {
    const csv = 'date,description,amount\n2026-01-15,Client payment,50\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: '2026-01-15', amount: 50 });
  });

  it('valor com decimal em PONTO (não-brasileiro) é malinterpretado — o parser SEMPRE trata "." como separador de milhar', () => {
    // Comportamento real descoberto, não hipotético: parseCSV assume formato
    // brasileiro sempre (remove "." antes de trocar "," por "."), então um
    // valor "1234.56" vira 123456, não 1234.56. Documentado aqui pra não virar
    // regressão silenciosa se alguém "corrigir" isso sem perceber que está sendo
    // usado assim em produção — e pra quem for revisar o formato aceito saber
    // que arquivos com decimal em ponto exigem normalização antes do upload.
    const csv = 'date,description,amount\n2026-01-15,Pagamento,1234.56\n';
    const entries = parseCSV(csv);
    expect(entries[0].amount).toBe(123456);
  });

  it('detecta delimitador tab quando presente no cabeçalho', () => {
    const csv = 'data\tdescricao\tvalor\n15/01/2026\tTeste\t50,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe(50);
  });

  it('remove BOM UTF-8 do início do conteúdo', () => {
    const csv = '﻿data;descricao;valor\n15/01/2026;Teste;10,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
  });

  it('respeita campo entre aspas contendo o delimitador', () => {
    const csv = 'data,descricao,valor\n15/01/2026,"Fornecedor, Ltda",100.00\n';
    const entries = parseCSV(csv);
    expect(entries[0].description).toBe('Fornecedor, Ltda');
  });

  it('reconhece variações de nome de coluna (hist/lancamento/observa, vlr/quantia)', () => {
    const csv = 'dt;lancamento;vlr\n15/01/2026;Compra;20,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('Compra');
  });

  it('inclui saldo quando a coluna existe', () => {
    const csv = 'data;descricao;valor;saldo\n15/01/2026;Teste;10,00;1.500,00\n';
    const entries = parseCSV(csv);
    expect(entries[0].balance).toBe(1500);
  });

  it('retorna array vazio quando só há a linha de cabeçalho (sem dados)', () => {
    expect(parseCSV('data;descricao;valor\n')).toEqual([]);
  });

  it('retorna array vazio quando não encontra coluna de data ou de valor', () => {
    const csv = 'foo;bar;baz\n1;2;3\n';
    expect(parseCSV(csv)).toEqual([]);
  });

  it('pula linha com data em formato não reconhecido, mantém as demais válidas', () => {
    const csv = 'data;descricao;valor\ndata-invalida;Ruim;10,00\n15/01/2026;Boa;20,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('Boa');
  });

  it('pula linha com valor não numérico, mantém as demais válidas', () => {
    const csv = 'data;descricao;valor\n15/01/2026;Ruim;abc\n16/01/2026;Boa;20,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('Boa');
  });

  it('pula linha com menos colunas do que o esperado', () => {
    const csv = 'data;descricao;valor\n15/01/2026;SoData\n16/01/2026;Completa;20,00\n';
    const entries = parseCSV(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBe('Completa');
  });

  it('separador de milhar (ponto) é removido corretamente antes do decimal', () => {
    const csv = 'data;descricao;valor\n15/01/2026;Grande;12.345,67\n';
    const entries = parseCSV(csv);
    expect(entries[0].amount).toBe(12345.67);
  });
});

describe('autoMatch', () => {
  it('casa entrada e transação com valor e data exatos (alta confiança)', () => {
    const entries = [{ date: '2026-01-15', description: 'Pagamento cliente', amount: 100 }];
    const transactions = [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15', description: 'Pagamento cliente' })];
    const matches = autoMatch(entries, transactions);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ statementIdx: 0, transactionId: 't1' });
    expect(matches[0].confidence).toBeGreaterThanOrEqual(80);
  });

  it('respeita o sinal — despesa espera valor negativo no extrato', () => {
    const entries = [{ date: '2026-01-15', description: 'Pagamento fornecedor', amount: -100 }];
    const transactions = [tx({ id: 't1', type: 'despesa', amount: 100, paymentDate: '2026-01-15' })];
    const matches = autoMatch(entries, transactions);
    expect(matches).toHaveLength(1);
    expect(matches[0].transactionId).toBe('t1');
  });

  it('não casa quando o valor está fora da tolerância padrão (R$0,01)', () => {
    const entries = [{ date: '2026-01-15', description: '', amount: 100.02 }];
    const transactions = [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15' })];
    expect(autoMatch(entries, transactions)).toHaveLength(0);
  });

  it('casa quando a diferença de valor está dentro da tolerância padrão (R$0,005 < R$0,01)', () => {
    const entries = [{ date: '2026-01-15', description: '', amount: 100.005 }];
    const transactions = [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15' })];
    expect(autoMatch(entries, transactions)).toHaveLength(1);
  });

  it('match absoluto (sinal invertido) pontua menos que o match exato e precisa de reforço de data/descrição pra passar do limiar', () => {
    // amountScore=40 (absoluto) sozinho não atinge o limiar de 50 — precisa de
    // pelo menos +10 de data/descrição pra ser reportado como match.
    const entriesSemReforco = [{ date: '2026-06-01', description: 'zzz', amount: 100 }];
    const txsSemReforco = [tx({ id: 't1', type: 'despesa', amount: 100, paymentDate: '2020-01-01' })];
    expect(autoMatch(entriesSemReforco, txsSemReforco)).toHaveLength(0);

    const entriesComReforco = [{ date: '2026-01-15', description: '', amount: 100 }];
    const txsComReforco = [tx({ id: 't2', type: 'despesa', amount: 100, paymentDate: '2026-01-15' })];
    const matches = autoMatch(entriesComReforco, txsComReforco);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(70); // 40 (absoluto) + 30 (data exata)
  });

  it('tolerância de data: dentro do limite (3 dias) pontua, além do dobro do limite (6 dias) não pontua', () => {
    const dentroDoLimite = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 100 }],
      [tx({ id: 't1', amount: 100, paymentDate: '2026-01-18' })], // 3 dias de diferença
    );
    expect(dentroDoLimite).toHaveLength(1); // 50 (valor) + 15 (data <= tolerance)

    const alemDoDobro = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 100 }],
      [tx({ id: 't1', amount: 100, paymentDate: '2026-01-25' })], // 10 dias de diferença
    );
    // Só o valor pontua (50) — abaixo do limiar de 50 seria falso, 50>=50 passa;
    // mas sem NENHUM reforço de data (>2x tolerance) ainda bate o limiar sozinho
    // porque o valor exato já vale 50 — comportamento correto: valor exato sozinho
    // já é reportado como match de confiança mínima.
    expect(alemDoDobro).toHaveLength(1);
    expect(alemDoDobro[0].confidence).toBe(50);
  });

  it('usa dueDate como fallback quando paymentDate está ausente', () => {
    const matches = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 100 }],
      [tx({ id: 't1', amount: 100, dueDate: '2026-01-15' })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe(80); // 50 (valor exato) + 30 (data exata)
  });

  it('soma pontos de sobreposição de palavras na descrição', () => {
    const matches = autoMatch(
      [{ date: '2026-01-15', description: 'pagamento consulta paciente silva', amount: 100 }],
      [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15', description: 'consulta paciente' })],
    );
    expect(matches).toHaveLength(1);
    // 50 (valor) + 30 (data exata) + min(20, 2*7=14) (2 palavras >2 chars em comum) = 94
    expect(matches[0].confidence).toBe(94);
  });

  it('confere netAmount (líquido, ex: Mercado Pago) antes do valor bruto quando presente', () => {
    const txComNetAmount = tx({ id: 't1', amount: 105, paymentDate: '2026-01-15' }) as Transaction & { netAmount: number };
    txComNetAmount.netAmount = 100; // taxa de R$5 descontada no extrato
    const matches = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 100 }], // extrato credita o líquido
      [txComNetAmount],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].transactionId).toBe('t1');
  });

  it('não reutiliza a mesma transação pra duas entradas do extrato (usedTxIds)', () => {
    const entries = [
      { date: '2026-01-15', description: '', amount: 100 },
      { date: '2026-01-15', description: '', amount: 100 },
    ];
    const transactions = [tx({ id: 'unico', amount: 100, paymentDate: '2026-01-15' })];
    const matches = autoMatch(entries, transactions);
    expect(matches).toHaveLength(1); // só a primeira entrada consegue a transação
    expect(matches[0].statementIdx).toBe(0);
  });

  it('escolhe a transação de maior pontuação quando há múltiplas candidatas', () => {
    const entries = [{ date: '2026-01-15', description: 'consulta dental', amount: 100 }];
    const transactions = [
      tx({ id: 'longe', amount: 100, paymentDate: '2026-01-20', description: 'outra coisa' }),
      tx({ id: 'perto', amount: 100, paymentDate: '2026-01-15', description: 'consulta dental' }),
    ];
    const matches = autoMatch(entries, transactions);
    expect(matches).toHaveLength(1);
    expect(matches[0].transactionId).toBe('perto');
  });

  it('array de entradas ou de transações vazio não lança e retorna vazio', () => {
    expect(autoMatch([], [tx()])).toEqual([]);
    expect(autoMatch([{ date: '2026-01-15', description: '', amount: 100 }], [])).toEqual([]);
  });

  it('respeita configuração customizada de tolerância', () => {
    const semTolerancia = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 105 }],
      [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15' })],
      { amountTolerance: 0.01 },
    );
    expect(semTolerancia).toHaveLength(0);

    const comToleranciaAmpla = autoMatch(
      [{ date: '2026-01-15', description: '', amount: 105 }],
      [tx({ id: 't1', amount: 100, paymentDate: '2026-01-15' })],
      { amountTolerance: 10 },
    );
    expect(comToleranciaAmpla).toHaveLength(1);
  });
});
