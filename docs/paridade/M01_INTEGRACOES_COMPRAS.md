# M01.6 — Integrações de compras

> Data: 26/08/2026
> Status: M01.6a e M01.6b concluídos; próxima entrega: M01.6c.

## Decisão de adaptação

O Gestão Raiz vincula a importação da NF-e a `accounts_payable`, aceita compra já paga, exige um portador e atualiza o saldo bancário. O AEVO já possui um financeiro próprio baseado em `transactions` e `bankAccounts`. A paridade será funcional: preservar as garantias validadas sem introduzir as coleções ou a complexidade industrial do Gestão Raiz.

## Garantias do M01.6

1. O valor financeiro vem sempre de `purchaseNote.totals.invoice`; o navegador não informa o valor.
2. Uma nota gera no máximo um vínculo financeiro determinístico.
3. Compra já paga exige conta ativa do mesmo tenant e debita o saldo na mesma transação que cria a despesa.
4. Reprocessar não duplica despesa nem débito bancário.
5. Reverter uma compra cancela a despesa sem apagá-la e recompõe o saldo quando ela estava paga.
6. Eventos são trilha de auditoria; efeitos de dinheiro continuam síncronos e transacionais.
7. Capacidades do agente e da API reutilizam o mesmo núcleo server-side.

## M01.6a — Financeiro da compra

- [x] Criar conta a pagar em `transactions` usando o total real da NF-e.
- [x] Permitir registrar a compra como já paga, exigindo conta bancária.
- [x] Vincular nota, fornecedor e transação nos dois sentidos.
- [x] Usar identificador determinístico e transação atômica para impedir duplicidade.
- [x] Integrar cancelamento/reversão financeira à reversão do estoque.
- [x] Disponibilizar a ação na tela de Compras.

**M01.6a concluído:** a despesa usa exclusivamente o total canônico da NF-e, pode nascer pendente ou paga, possui identificador determinístico e é criada junto com o débito bancário em uma única transação. A reversão cancela o lançamento, recompõe o saldo quando necessário e preserva a auditoria.

## M01.6b — Eventos, agente e API v1

- [x] Emitir eventos auditáveis determinísticos de compra importada, financeiro vinculado e compra revertida.
- [x] Expor vínculo financeiro e consulta das notas ao agente pelo mesmo núcleo.
- [x] Criar endpoints equivalentes na API v1 com isolamento de tenant e escopos próprios.
- [x] Garantir que reentregas não repitam efeitos de estoque, custo ou dinheiro.

**M01.6b concluído:** os eventos `purchase.imported`, `purchase.financialLinked` e `purchase.reverted` usam IDs determinísticos e são persistidos atomicamente com a mudança principal. O evento de importação referencia movimentos e atualizações de custo. Agente e API v1 reutilizam os mesmos núcleos de consulta, confirmação, vínculo financeiro e reversão; a API separa `read:purchases`/`write:purchases` e exige também os escopos de estoque ou financeiro quando aplicável.

## M01.6c — Fiscal e sincronização operacional

- [ ] Mapear a configuração fiscal necessária para consulta de documentos destinados ao CNPJ.
- [ ] Sincronizar resumos/documentos recebidos sem transformar automaticamente qualquer XML em entrada.
- [ ] Reutilizar preparação, validação de destinatário e claim de chave do M01.5.
- [ ] Tratar manifestação/download do XML como capacidade opcional quando o provedor fiscal permitir.
- [ ] Exibir diagnóstico e recuperação sem bloquear upload manual.

## Fora deste marco

- Plano de contas industrial, centro de custo fabril e qualidade de fornecedor.
- Contabilidade/SPED industrial e múltiplos depósitos.
- Automação financeira baseada apenas em evento assíncrono.
