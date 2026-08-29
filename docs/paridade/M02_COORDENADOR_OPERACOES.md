# M02.2 — Coordenador recuperável de operações comerciais

> Concluída em código em: 29/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: fundação transacional comum; migração dos escritores começa na M02.3

## Resultado entregue

A M02.2 cria o registro interno `commercialOperations` para coordenar uma venda ou pedido que atravessa estoque, documento comercial, financeiro, benefícios e auditoria. Cada operação possui identidade estável, lease de execução, checkpoints persistidos, referências determinísticas e estado explícito de falha ou compensação.

O coordenador não substitui `sales`, `deliveryOrders` ou `orders`. Ele persiste o documento correto para cada origem e mantém as informações necessárias para retomar uma queda sem recalcular preço, repetir baixa de estoque ou duplicar dinheiro.

## Identidade e invariantes

- A identidade combina `businessId`, origem e `idempotencyKey`.
- O payload validado recebe um fingerprint canônico; reutilizar a chave com conteúdo diferente é conflito.
- Documento comercial, estoque, pagamentos, cupons, gift cards, fidelidade, fiscal e evento recebem IDs ou chaves derivados da operação.
- A cotação autoritativa da M02.1 precisa pertencer ao mesmo tenant e canal.
- O total legado em reais precisa corresponder exatamente ao total cotado em centavos.
- Quando há pagamentos, a soma das alocações precisa fechar o total da cotação.
- O coordenador rejeita uma cotação indisponível antes de criar efeitos.

## Checkpoints

A execução segue os checkpoints abaixo:

1. `input_validated` — contrato, tenant, total e identidade confirmados;
2. `benefits_reserved` — reservas idempotentes de cupom, gift card ou fidelidade;
3. `stock_applied` — baixa pelo núcleo transacional da M01;
4. `document_persisted` — criação determinística em `sales`, `deliveryOrders` ou `orders`;
5. `downstream_reconciled` — efeitos financeiros, cliente, comissão e fiscal fornecidos pelo adaptador do canal;
6. `event_enqueued` — evento de auditoria determinístico com o mesmo `operationId`;
7. `operation_completed` — resultado e documento comercial marcados como concluídos na mesma transação.

Cada checkpoint registra estado, tentativas, horários, resultado ou erro. Uma lease curta impede duas execuções simultâneas; depois de expirar, outra execução pode assumir a operação. Como os efeitos têm identidade determinística, a retomada confirma o que já ocorreu em vez de reproduzi-lo.

## Estoque e lotes

O coordenador envia ao núcleo M01 os requisitos de estoque já expandidos pela cotação, com `expandBom=false`. Isso evita recalcular a composição usando um catálogo que pode ter mudado entre a cotação e a recuperação.

O resultado comercial conserva:

- ID da operação de estoque;
- IDs exatos dos movimentos;
- saldo anterior e posterior de cada produto ou variação;
- alocações de lote escolhidas pelo núcleo, inclusive FEFO quando aplicável.

Uma queda depois da baixa reexecuta a mesma chave do núcleo M01. O saldo não muda novamente e o checkpoint passa a apontar para os movimentos originais.

## Adaptadores de efeitos

Benefícios e efeitos posteriores são interfaces server-side deliberadamente explícitas. Um canal que usa pagamento, intenção fiscal ou benefício precisa fornecer um handler idempotente.

`ensureCommercialEffectDocumentAdmin` oferece criação transacional determinística para `transactions`, resgates de cupom, gift card, fidelidade e documentos fiscais. Um replay com o mesmo conteúdo é aceito; tenant, operação ou payload divergente geram conflito.

Os adaptadores reais serão conectados por domínio:

- M02.3: PDV, serviços, pagamentos, cliente e comissão;
- M02.4: cupons, gift cards e fidelidade;
- M02.5: delivery, cardápio, agente e Mercado Pago;
- M02.6: B2B, condicionais e recebíveis.

## Falha e compensação

- Falha transitória libera a lease e mantém a operação retomável.
- Erro permanente depois de um efeito confirmado muda o estado para `compensation_pending`.
- O pedido de compensação é idempotente, exige tenant e motivo auditável e bloqueia a retomada como checkout normal.
- A execução concreta das reversões usará os movimentos e ledgers originais na M02.7.
- Nenhuma etapa de melhor esforço é tratada como sucesso silencioso.

## Segurança e observabilidade

- `commercialOperations` é negada integralmente ao cliente nas regras do Firestore.
- Somente serviços administrativos podem criar ou avançar checkpoints.
- Índices permitem consultar operações por tenant e estado operacional ou de compensação.
- Logs estruturados usam `operationId` como correlação em claim, início, conclusão, falha e compensação.
- `commercial.operationCompleted` é um evento de auditoria determinístico; os efeitos críticos já foram confirmados sincronamente.

## Compatibilidade e limites desta etapa

- Nenhum escritor atual de PDV, delivery ou B2B foi redirecionado ainda.
- As coleções e telas legadas permanecem operacionais.
- A M02.2 não publica endpoint genérico de checkout; cada canal terá uma fronteira autenticada e um adaptador próprio.
- A marcação de compensação está pronta, mas o orquestrador de cancelamento e devolução pertence à M02.7.
- Índices e regras foram preparados em código; a validação no ambiente de homologação continua parte da M02.9/M02.10.

## Evidências automatizadas

Os testes direcionados cobrem:

- contratos, total em centavos e IDs determinísticos separados por tenant;
- execução completa com documento, estoque e evento correlacionados;
- replay integral sem novo saldo, movimento, documento ou evento;
- retomada depois de queda no estoque, no documento, no financeiro e no evento;
- lease concorrente para a mesma operação;
- conflito da mesma chave com payload diferente;
- bloqueio de documento ou efeito determinístico ocupado por outro conteúdo;
- solicitação de compensação idempotente e isolamento de tenant;
- negação de acesso cliente à coleção interna.

Na validação desta entrega, os 65 testes direcionados passaram, a suíte completa aprovou 744 testes em 52 arquivos, o typecheck foi aprovado e o build de produção gerou as 153 páginas sem falha.

## Próxima etapa

A M02.3 migrará o checkout do PDV e a venda de serviços para este coordenador. Será o primeiro uso real dos adaptadores de pagamento, financeiro, cliente e comissão, preservando vendas sem estoque e múltiplas alocações.
