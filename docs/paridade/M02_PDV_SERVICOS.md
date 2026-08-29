# M02.3 — PDV e venda de serviços

> Concluída em código em: 29/08/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Escopo: primeiro canal real migrado para o núcleo comercial M02

## Resultado entregue

O checkout de `sales` agora usa a cotação autoritativa da M02.1 e o coordenador recuperável da M02.2. A mesma regra atende o PDV autenticado, a API v1 e a criação de venda pelo agente. Os três caminhos preservam o documento legado de venda, mas preço, disponibilidade, estoque e efeitos deixam de ser decididos no navegador.

Cada venda concluída guarda `commercialOperationId`, movimentos de estoque, transações relacionadas e estados separados de pagamento, financeiro, estoque e fiscal. Um replay recupera a intenção persistida e não recalcula o checkout usando catálogo ou saldo já alterados pela própria venda.

## Fronteiras migradas

- `/api/sales/checkout`: operador autenticado, permissão de desconto pela função e comissão lida do cadastro do usuário;
- `/api/v1/sales`: cotação e execução pelo mesmo serviço, com `operationId` e todas as transações relacionadas na resposta;
- ferramenta de vendas do agente: variações, modificadores, vencimento e chave idempotente chegam ao mesmo núcleo;
- histórico do PDV: exibe os estados reais de pagamento, financeiro, estoque e fiscal.

Somente vendas `finalizada` entram nessa operação. Rascunho, cancelamento e devolução permanecem em fluxos próprios até as etapas previstas no roadmap.

## Fonte de verdade do checkout

O cliente informa IDs, quantidades, seleções e a expectativa de total. Antes de qualquer efeito, o servidor:

1. valida o tenant do cliente, produto, serviço e referências associadas;
2. relê nome, situação ativa, preço, variação e modificadores do catálogo;
3. recompõe insumos de produto composto e modificadores;
4. confirma a permissão para desconto manual e registra seu motivo;
5. calcula todos os valores em centavos e rejeita total obsoleto ou adulterado;
6. resolve a comissão a partir do usuário autenticado, ignorando a taxa enviada pelo navegador.

A venda persiste snapshots autoritativos de descrição, variação, preço base e modificadores para que histórico, fiscal e futuras reversões não dependam do catálogo atual.

## Pagamentos e financeiro

| Meio legado | Estado da alocação | Efeito financeiro nesta etapa |
|---|---|---|
| dinheiro, PIX, crédito, débito e outros | pago | receita paga, uma por alocação |
| boleto e crédito da loja | pendente | receita a receber, uma por alocação |
| pontos e gift card | pendente | sem receita; liquidação do benefício entra na M02.4 |
| sem pagamento | não pago | nenhum lançamento financeiro |

Pagamentos divididos continuam preservados na venda. Cada parcela ou meio aplicável recebe uma transação determinística vinculada à venda e à operação. A primeira receita continua no campo legado `transactionId`; a lista completa fica em `transactionIds`. Comissão é uma despesa separada e determinística, sem ser confundida com a receita principal.

Esta etapa representa o diferimento de forma compatível na coleção financeira atual. Parcelamento e contas a receber canônicos serão consolidados na M03, sem duplicar estes lançamentos.

## Estoque, serviços e cliente

- Produtos, variações, BOM, modificadores, lotes e FEFO usam o núcleo de estoque M01.
- O requisito calculado pela cotação é persistido na operação; replay não recompõe estoque pelo catálogo mutável.
- Venda apenas de serviço termina com estoque `not_required` e não cria movimento artificial.
- Estatísticas do cliente e mudança para cliente ganho são idempotentes pelo ID da venda.
- Comissão usa taxa validada de 0 a 100 e cria uma única despesa, mesmo depois de retentativa.

## Recuperação e concorrência

A identidade combina tenant, origem e chave idempotente. Datas de cotação, timestamps do documento e snapshots de saldo disponível não alteram o fingerprint de um replay; preço, itens, quantidades, desconto, pagamentos e conteúdo comercial continuam protegidos contra reutilização divergente da chave.

Duas tentativas simultâneas são serializadas pela lease da operação. Os IDs determinísticos impedem venda, transação, comissão, movimento ou atualização de cliente duplicados. Uma falha posterior pode retomar os checkpoints já persistidos.

## Compatibilidade e próximos limites

- Cupons, pontos e gift cards ainda seguem a integração posterior já existente no PDV; a reserva, confirmação e compensação server-side entram na M02.4.
- Delivery, cardápio e pedidos manuais ainda não foram migrados; pertencem à M02.5.
- Cancelamento do PDV ainda não usa a reversão pelos efeitos originais; essa migração é a M02.7.
- Regras que bloqueiam todas as escritas críticas diretas e a validação dos índices em homologação pertencem à M02.9/M02.10.
- O arquivo local não rastreado `scripts/wipe-financial.ts` não faz parte desta entrega.

## Evidências automatizadas

Os testes direcionados cobrem:

- classificação de meios imediatos, diferidos, benefícios e sem pagamento;
- rejeição de preço adulterado antes de qualquer efeito;
- preço e estoque autoritativos de variação e modificador com insumo;
- pagamento dividido com receita paga, receita pendente e comissão;
- venda exclusiva de serviço sem baixa de estoque;
- replay posterior e tentativas concorrentes sem duplicidade;
- desconto com e sem permissão e conflito de chave idempotente;
- isolamento de cliente entre tenants;
- estabilidade do fingerprint diante de snapshots voláteis.

Na validação desta entrega, os 27 testes direcionados passaram, a suíte completa aprovou 756 testes em 53 arquivos, o typecheck foi aprovado e o build de produção gerou as 153 páginas sem falha.

## Próxima etapa

A M02.4 levará cupom, gift card e fidelidade para ledgers server-side determinísticos, com reserva, confirmação, estorno e proteção concorrente compartilhados entre os canais.
