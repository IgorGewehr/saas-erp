# Financeiro — enforcement no servidor via firestore.rules (M03.4)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: sexta fatia de execução do M03, logo após a primeira rodada de M03.3. Fecha a
> lacuna "enforcement" que o núcleo (M03.2) e a migração da API v1 (M03.3) só cobrem PRA QUEM
> já usa o novo caminho — `firestore.rules` é a última linha de defesa pros caminhos que ainda
> escrevem client SDK direto (clássico/V2, hoje) e continuará sendo mesmo depois de mais
> migrações (regra de negócio nunca deveria depender só de o cliente "se comportar").

## 1. O que existia

`firestore.rules` pra `transactions` só validava enum de `type`/`status` na escrita — nada de
`amount > 0`, nada de transição de status válida. Confirmado na investigação de abertura do M03:
"a manager-role client pode reverter `pago→pendente` ou mutar `amount` post-hoc sem nenhuma
regra impedindo."

## 2. O que foi entregue

- **`amount > 0`** exigido tanto em `create` quanto em `update` — fecha o `NON_POSITIVE_AMOUNT`
  que `m03-financial-audit.ts` já media, agora impedido na origem pra qualquer escrita client
  SDK (o núcleo Admin-SDK, M03.2, já exigia isso via `AdminTransactionPayload`/`TransactionSchema`,
  mas só protegia quem passa por ele).
- **Transição de status validada** (`isValidTransactionTransition`, nova função local, declarada
  logo antes do `match /transactions/{transactionId}`): espelha
  `lib/contracts/fsm/transaction.ts:TRANSACTION_TRANSITIONS` manualmente — Firestore Rules não
  importa código TS, então a duplicação é necessária, não um descuido (comentário no arquivo
  aponta pra manter sincronizado se o FSM mudar, mesmo espírito do comentário que já existia no
  próprio FSM antes do M03.1). Fecha concretamente o exemplo da investigação: `pago→pendente`
  agora é rejeitado pelas regras (não está em `TRANSACTION_TRANSITIONS['pago']`, que só permite
  `cancelado`).

**Deliberadamente não adicionado**: um allowlist de quais CAMPOS podem mudar por transição.
`amount` continua editável independente de mudança de status (correção de erro de digitação
antes do pagamento é um caso de uso legítimo) — o que ficou proibido é só o valor NÃO-POSITIVO,
não a edição em si.

## 3. Risco assumido e mitigado: sem tenant real, sem dado pra quebrar

Mesmo racional já usado pra `amount.positive()` no contrato Zod (M03.1): como nenhum tenant real
está em produção neste sistema ainda, não existe risco de "travar um lançamento hoje aceito"
(o risco #2 da tabela de riscos do plano M03) — a auditoria prévia recomendada lá é moot porque
não há dado real pra violar a regra nova. Dá pra começar com a regra certa desde o primeiro dia.

## 4. Verificação — limitação real, não escondida

**Não foi possível validar a sintaxe via emulador do Firestore nesta sessão**: `firebase
emulators:start --only firestore` falhou com `Could not spawn 'java -version'` — o emulador do
Firestore é baseado em JVM e este ambiente não tem Java instalado. Não é um erro de sintaxe nas
regras — é a ferramenta de validação que não pôde rodar. Este projeto também não tem NENHUM teste
de regras baseado em emulador (`tests/security/rules.test.ts` só confere que a string
`'transactions'` aparece no arquivo — não exercita comportamento real).

**Mitigação real, não hipotética**: a sintaxe usada (`function nome(a,b) { return <expressão
booleana multi-linha>; }`, operador `in` sobre lista literal, `&&`/`||` encadeados) já é usada
extensivamente em outras partes deste MESMO arquivo (`allow create`/`allow update` de outras
coleções), então o risco de erro de sintaxe é baixo — revisão manual cuidadosa feita linha a
linha contra esse precedente. Adicionalmente, `firebase deploy --only firestore:rules` **recusa
o deploy inteiro** se o arquivo não compilar — um erro de sintaxe aqui seria pego no deploy,
antes de afetar produção (as regras atuais continuariam valendo até um deploy válido).

**Recomendado antes de confiar 100%**: rodar `firebase deploy --only firestore:rules --project
<id>` (ou o emulador, num ambiente com Java) contra um projeto de teste/homologação antes do
deploy de produção — validação que esta sessão não conseguiu fazer sozinha.

## 5. Próxima etapa

Retomar os 2 follow-ups reais de M03.3 (contrato do agente com identificador estável; decisão
sobre reversão de venda do PDV) e/ou o checkpoint de decisão V1 vs V2 (M03.6).
