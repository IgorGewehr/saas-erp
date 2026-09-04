# Fiscal — vínculo de documentos pendentes com a origem (M04)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: achado sinalizado com destaque durante a fatia M06.6
> (`docs/agenda/AGENDA_M06_6_COBRANCA_FISCAL.md` §2) — risco real de emissão de nota fiscal
> duplicada. Priorizado pelo usuário como primeira fatia de M04 (Fiscal), antes de qualquer
> outro item do backlog fiscal.

## 1. O problema (recapitulando o achado original)

`POST /api/fiscal/emit` (`app/api/fiscal/emit/route.ts`) é a rota compartilhada por NFe, NFCe e
NFSe — usada por Sales, DeliveryOrders e Appointments. Quando a SEFAZ está temporariamente
indisponível (timeout, 5xx, `ECONNREFUSED`, etc. — `isTransientSefazError`), a rota chama
`persistPendingAndRespond`: grava um `fiscalDocuments` com `status: 'pendente'` e devolve 200 ao
cliente com instrução pra reenviar depois via `/api/fiscal/retry`.

O bug: `persistPendingAndRespond` **nunca recebia** `saleId`/`orderId`/`appointmentId` — só o
caminho de SUCESSO chamava `linkFiscalDocToSource` (a função que grava `fiscalDocumentId` de
volta no documento de origem). Consequência prática, não hipotética:

- O registro de origem (venda/pedido/atendimento) nunca aprendia que existia uma nota pendente
  pra ele — continuava sem `fiscalDocumentId`, como se nada tivesse sido tentado.
- Um operador podia clicar "Emitir NFSe"/"Emitir NFC-e" de novo — criando um **segundo**
  documento pendente pro mesmo registro. Se a SEFAZ voltasse e os dois fossem reenviados
  manualmente (um de cada vez, no módulo Fiscal), o resultado seria **duas notas fiscais
  autorizadas pro mesmo atendimento/pedido/venda**.
- Não era específico de Appointments — o mesmo caminho é compartilhado por NFe/NFCe (Sales,
  DeliveryOrders) e NFSe (Appointments).

## 2. Correção

`persistPendingAndRespond` (`app/api/fiscal/emit/route.ts`) agora aceita `saleId?`/`orderId?`/
`appointmentId?`/`sourceType?` e, depois de criar o `fiscalDocuments` com `status: 'pendente'`,
chama `linkFiscalDocToSource` com `accessKey: null` (nada foi emitido de fato — só uma tentativa
que falhou por indisponibilidade temporária) e `status: 'pendente'`. Mesmo padrão do writeback
best-effort que já existia no caminho de sucesso — falha de writeback loga (warn) e não derruba
a resposta ao cliente. Os 3 call-sites (`NFSe`/`NFCe`/`NFe`) passam a repassar os IDs de origem
já resolvidos no topo de `emitCore` (nenhuma leitura nova — os IDs já estavam disponíveis).

O documento `fiscalDocuments` criado como pendente também passou a gravar `saleId`/`orderId`/
`appointmentId`/`sourceType`, igualando-se aos documentos do caminho de sucesso (rastreabilidade
bidirecional: da origem pro documento E do documento pra origem).

## 3. Efeito colateral positivo — auto-emissão de NFC-e (Pedidos)

`OrdersModule.tsx`'s `autoEmitNfceIfEnabled` (auto-emissão opcional na conclusão do pedido) já
tinha um guard `if (order.fiscalDocumentId) return;` — antes desta correção, esse guard NUNCA
disparava pra um pedido cuja tentativa anterior tinha ficado pendente (porque `fiscalDocumentId`
nunca era gravado nesse caso), então o auto-emit podia tentar de novo a cada conclusão
subsequente do mesmo fluxo. Com o vínculo agora gravado, esse guard passa a funcionar
corretamente também pro caminho pendente — sem nenhuma mudança de código nesse arquivo, só
consequência direta da correção do vínculo na origem.

## 4. UI: terceiro estado visual — "pendente" não é "emitida" nem reabilita reemissão

Corrigir só o backend sem tocar a UI teria trocado um bug por outro pior: com o vínculo gravado,
`fiscalDocumentId` passaria a existir pra um documento `pendente`, e as duas telas que checam
"presença de `fiscalDocumentId` = emitida" (binário, sem olhar o status) passariam a mostrar
**"NFSe emitida"/"NFC-e emitida" pra uma nota que na verdade nunca foi emitida** — pior que o
silêncio anterior, porque agora seria uma afirmação falsa e explícita.

- **`AgendaModule.tsx` (`ViewAppointmentDialog`, NFSe)**: já tinha status ao vivo desde M06.6
  (busca `fiscalDocuments/{id}` quando o dialog abre). Adicionado um 3º ramo:
  `pendente`/`contingencia` → badge âmbar neutra (não “emitida”, não erro) com tooltip
  explicando que o reenvio é feito no módulo Fiscal — e o botão "Emitir NFSe" **não** reaparece
  (reaparecer criaria a segunda nota que esta fatia inteira existe pra evitar).
- **`OrdersModule.tsx` (NFC-e)**: não tinha status ao vivo nenhum — só `order.fiscalDocumentId`
  binário. Adicionado o mesmo 3º ramo, lendo `order.fiscalStatus` (campo que `linkFiscalDocToSource`
  já gravava desde sempre no caminho de sucesso, mas nunca tinha sido declarado no tipo
  `DeliveryOrder` — adicionado em `lib/types/index.ts`). Diferente da Agenda, não há busca ao
  vivo aqui — é uma leitura direta do campo denormalizado no pedido, suficiente pra fechar o
  risco de reemissão (o objetivo desta fatia), mas ainda sujeita à MESMA limitação de staleness
  que o resto do módulo tinha antes de M06.6 (se o status mudar depois via reconsulta/retry, o
  campo no pedido não se atualiza sozinho — gap pré-existente, não introduzido aqui, registrado
  como possível follow-up se aparecer necessidade real).

**Deliberadamente fora do escopo desta fatia**: paridade completa com M06.6 (status ao vivo +
tratamento de falha terminal) pra Sales/DeliveryOrders — o pedido do usuário foi especificamente
"corrigir a lacuna fiscal" (o vínculo pendente/duplicidade), não redesenhar toda a UI fiscal de
Pedidos. Também fora do escopo: o gap separado (não descoberto por esta investigação, mas
observado de passagem) de que NFSe com status `'processando'` sem `chaveAcesso`/`codigoVerificacao`
nem `'autorizado'` não cria NENHUM `fiscalDocuments` — silenciosamente perdido. Diferente do
achado original (documento existe mas órfão), aqui o documento nem chega a existir; merece
investigação própria, não filha desta fatia.

## 5. Verificação

Novo teste em `tests/contracts/fiscalEmitNfse.test.ts` (o único arquivo deste repo que já testa
`POST /api/fiscal/emit` fim-a-fim contra um fake Firestore): simula `emitirNFSe` lançando um erro
transiente (`mockRejectedValueOnce`, via mock parcial de `lib/services/sefaz-gateway` que delega
pro mock mode real em todo o resto — o mock mode nativo do gateway nunca falha, então não dava
pra exercitar o caminho pendente sem isso) e confirma: resposta 200 com `fallback:'pending'`, o
`appointment` de origem grava `fiscalDocumentId`/`fiscalStatus:'pendente'`, e o `fiscalDocuments`
criado tem `appointmentId`/`sourceType` corretos.

`tsc --noEmit` limpo. Suíte completa sem regressão (contagem exata no commit). **Não testado
manualmente contra o gateway sefaz-api real** — a simulação de indisponibilidade é só no mock;
antes de confiar 100% em produção, vale um teste manual: derrubar a conectividade com o gateway
(ou usar um `SEFAZ_API_URL` inválido temporariamente em homologação), emitir uma NFSe/NFCe a
partir de um atendimento/pedido real, e confirmar que a UI mostra o badge âmbar em vez do botão
de emissão.

## 6. O que continua no backlog fiscal

Ver `docs/roadmap/ROADMAP_FISCAL_BACKLOG.md` — este item entra como concluído lá. Itens restantes
do backlog (certificado A3, fila persistente Redis/Bull, MDF-e) seguem dormentes até sinal real
de demanda, sem relação com esta correção.
