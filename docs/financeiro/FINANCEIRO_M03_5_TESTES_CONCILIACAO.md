# Financeiro — testes de conciliação bancária (M03.5)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: primeira fatia de execução do M03 (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md`),
> priorizada por não depender de nenhuma decisão de produto (ao contrário de M03.6, V1 vs V2) e
> por cobrir código que já mexe com dinheiro real em produção sem nenhuma rede de segurança.

## 1. O que existia

`lib/services/reconciliation.ts` — `parseOFX`, `parseCSV` e `autoMatch` — é lógica pura (sem
Firestore, sem React) usada em produção por DUAS telas diferentes (`financial/ConciliacaoTab.tsx`
no clássico e `financial-v2/ConciliacaoImportModal.tsx`/`ConciliacaoBaldesCard.tsx` no V2) pra
importar extrato bancário (OFX/CSV) e casar automaticamente com `Transaction`s existentes. Apesar
de mexer com conciliação de dinheiro real, tinha **zero teste automatizado** — confirmado na
investigação de abertura do M03.

## 2. O que foi entregue

`tests/services/reconciliation.test.ts` — 36 casos cobrindo os 3 exports:

- **`parseOFX`**: bloco básico com `DTPOSTED`/`TRNAMT`/`MEMO`/`FITID`; data só-dia (sem hora);
  fallback `NAME`→`MEMO` e `REFNUM`→`FITID`; múltiplos blocos `STMTTRN`; bloco sem `DTPOSTED`
  ignorado (não lança); conteúdo vazio/sem blocos; tags em minúsculo (case-insensitive);
  `TRNAMT` ausente vira `0`, não `NaN`.
- **`parseCSV`**: formato brasileiro (`;`, `DD/MM/YYYY`, decimal com vírgula); delimitador `,`
  genérico com data `YYYY-MM-DD`; auto-detecção de delimitador tab; remoção de BOM UTF-8; campo
  entre aspas contendo o delimitador; variações de nome de coluna (`hist`/`lancamento`/`observa`,
  `vlr`/`quantia`); coluna de saldo opcional; array vazio sem linhas de dado; array vazio sem
  coluna de data/valor reconhecível; linha com data malformada é pulada (mantém as válidas);
  linha com valor não-numérico é pulada; linha com menos colunas que o esperado é pulada;
  separador de milhar (ponto) removido antes do decimal.
- **`autoMatch`**: valor+data exatos (alta confiança); sinal correto pra despesa (extrato
  negativo); fora da tolerância padrão não casa; dentro da tolerância casa; match absoluto
  (sinal invertido) pontua menos e só passa do limiar com reforço de data/descrição; tolerância
  de data nos limites (3 dias casa, 10 dias só o valor sozinho ainda basta pro limiar mínimo);
  fallback pra `dueDate` quando `paymentDate` ausente; sobreposição de palavras na descrição soma
  pontos; `netAmount` (Mercado Pago, valor líquido) conferido antes do valor bruto; mesma
  transação nunca é reutilizada pra duas entradas do extrato; escolhe a transação de maior
  pontuação entre candidatas; arrays vazios não lançam; tolerância customizável respeitada.

## 3. Achados reais durante a escrita dos testes (não hipotéticos)

- **`parseCSV` não suporta decimal em ponto — nunca suportou.** A limpeza de valor SEMPRE remove
  `.` (tratado como separador de milhar) antes de trocar `,` por `.` (decimal). Um CSV com
  `"1234.56"` vira `123456`, não `1234.56`. Isso não é um bug a corrigir nesta fatia — é o
  formato brasileiro assumido de propósito (`,` decimal, `.` milhar) — mas ficou sem teste, então
  ninguém tinha essa garantia escrita em lugar nenhum. Documentado explicitamente com um teste
  próprio (`valor com decimal em PONTO... é malinterpretado`) pra que uma futura tentativa de
  "consertar" isso não vire regressão silenciosa sem ninguém perceber o comportamento real
  esperado hoje.
- **Precisão de ponto flutuante no limiar exato de tolerância**: `100.01 - 100` em JavaScript
  não é exatamente `0.01` (é `0.010000000000005116`), então testar o limiar EXATO da tolerância
  padrão (R$0,01) é frágil — depende de arredondamento de IEEE 754, não da regra de negócio.
  Ajustado pra testar um valor claramente dentro da tolerância (R$0,005) em vez do limite exato.

## 4. O que fica de fora

- Nenhuma mudança de comportamento em `reconciliation.ts` — esta fatia é só teste, sem refactor.
  Qualquer correção do formato de decimal (se um dia for pedida) é uma fatia própria, com
  decisão explícita sobre se quebra compatibilidade com arquivos já processados dessa forma.
- Testes de UI (`ConciliacaoTab.tsx`/`ConciliacaoImportModal.tsx`) — fora de escopo, cobertura
  aqui é só da lógica pura que ambas consomem.

## 5. Verificação

`tsc --noEmit` limpo. Suíte completa sem regressão (contagem exata no commit) — 36 testes novos
em 1 arquivo novo.
