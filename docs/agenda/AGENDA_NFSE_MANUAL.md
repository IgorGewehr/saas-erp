# Agenda → NFSe — vínculo manual (go-live odontologia)

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: segunda frente pro go-live da odontologia (a primeira, hardening dos efeitos de conclusão da Agenda, ver `docs/agenda/AGENDA_HARDENING_EFEITOS_SERVIDOR.md`). Investigação prévia mapeou que a emissão manual de NFS-e já funcionava ponta a ponta, mas sem NENHUM vínculo com a Agenda — a recepção teria que redigitar tudo manualmente num módulo separado a cada atendimento concluído.

## 1. Resultado entregue

Botão **"Emitir NFSe"** no detalhe de um atendimento `concluido` (`ViewAppointmentDialog`, Agenda) que abre o mesmo `EmitirNotaDialog` já usado pra emissão avulsa, pré-preenchido com serviço/valor/códigos fiscais do atendimento — mesmo padrão do botão "Emitir NFC-e" em Pedidos (`OrdersModule.tsx`). O operador confere/completa o tomador (CPF/CNPJ, via o autocomplete de cliente que já existe no dialog) e emite. Uma vez emitida, o botão vira badge "NFSe emitida" (idempotência visual, mesmo padrão do NFC-e).

**Decisão de escopo deliberada: manual, não automático.** Existe hoje um `NFCeConfig.autoEmit` (opt-in) que dispara NFC-e sozinho ao concluir um pedido — não criamos o equivalente pra NFSe nesta fatia. A emissão real de NFS-e pro município da odontologia (Maximiliano de Almeida, RS — provider "Padrão Nacional ADN") ainda não foi validada contra o gateway real; ligar auto-emit agora significaria tentar emitir automaticamente pra CADA atendimento concluído contra um endpoint não confirmado. Manual primeiro — dá pro operador conferir cada nota antes de emitir enquanto o processo pra este município ainda não tem histórico. Auto-emit é incremento natural depois que a validação real (item que fica com o usuário, precisa de credenciais/certificado) confirmar que funciona.

## 2. Bug real corrigido pela investigação

A branch de NFSe de `POST /api/fiscal/emit` **nunca chamava `linkFiscalDocToSource`** — só NFe/NFCe recebiam o writeback (`fiscalDocumentId`/`fiscalAccessKey`/`fiscalStatus` de volta no documento de origem). Sem isso, mesmo um botão manual não teria como saber que a nota já foi emitida (sem idempotência visual, risco de emissão duplicada num segundo clique). Corrigido como parte desta fatia — agora vale tanto pra NFSe vinculada a Appointment quanto, por extensão do mesmo mecanismo, qualquer emissão futura vinculada por `appointmentId`.

## 3. O que mudou tecnicamente

- **`lib/contracts/domain/appointment.ts` + `lib/types/index.ts`**: `Appointment` ganha `fiscalDocumentId?`, `fiscalAccessKey?`, `fiscalStatus?` — mesmo padrão de `DeliveryOrder`.
- **`lib/types/index.ts`**: `FiscalConfig` ganha `cnae?: string` — algumas prefeituras (ex: BH) exigem CNAE no corpo da NFS-e; antes só dava pra digitar por nota, agora configura uma vez em Settings → Fiscal.
- **`lib/utils/validators.ts`**: nova `formatCNAEInput` (máscara `XXXX-X/XX`), extraída da lógica que antes só existia inline em `EmitirNotaDialog.tsx`.
- **Settings → Fiscal**: novo campo CNAE na seção "Regime e Operação", ao lado do Código IBGE (que já existia e já funcionava — confirmado na investigação, nenhuma mudança necessária ali).
- **`lib/contracts/api/fiscal/emit.ts`**: `SharedFields` ganha `appointmentId?` e `sourceType` ganha `'appointment'` — mesmo nível de `orderId`/`saleId`.
- **`app/api/fiscal/emit/route.ts`**: idempotência (âncora `appointment_${id}`) e `linkFiscalDocToSource` (union de `type` ganha `'nfse'`, mapa de coleção ganha `appointmentId → 'appointments'`) estendidos; a branch de sucesso do NFSe agora CHAMA o writeback (gap corrigido, item 2).
- **`lib/services/fiscal/appointmentNfse.ts`** (novo): `buildAppointmentNfseInput(appointment, service, business)` — mapper puro, mesmo papel de `buildDeliveryOrderNfceInput`. Usa os campos fiscais do `Service` (`lc116Code`, `codigoMunicipal`, `aliquotaISS`, `nbs`) quando cadastrados; tomador sai só com nome (Appointment não guarda CPF/CNPJ do cliente).
- **`EmitirNotaDialog.tsx`**: novo prop `prefillNFSe`, mesmo padrão de `prefillNFCe` — popula o form sem travar nenhum campo. Novo efeito de prefill de CNAE a partir de `business.fiscal.cnae`.
- **`AgendaModule.tsx`**: novo estado `nfseAppointment`, botão/badge em `ViewAppointmentDialog` (prop `onEmitNfse`), `EmitirNotaDialog` montado com `prefillNFSe` via `buildAppointmentNfseInput`.

## 4. O que ficou de fora (deliberado)

- **Auto-emissão de NFSe** (`NFSeConfig.autoEmit`) — ver decisão de escopo acima.
- **Validação de emissão real** contra o gateway sefaz-api pra Maximiliano de Almeida (RS) — precisa das credenciais/certificado do usuário; a coverage table (`lib/fiscal/nfse-coverage.ts`) continua sem entrada pra este município até essa validação acontecer.
- **Resolução automática de tomador** (CPF/CNPJ) a partir do CRM Client — operador continua selecionando/confirmando manualmente dentro do dialog, como já fazia pra qualquer emissão avulsa.

## 5. Evidências automatizadas

- `tests/contracts/fiscalEmitNfse.test.ts` (4 casos, primeiro teste de `route.ts` deste repo — precedente novo de mock hoisted de `@/lib/config/firebaseAdmin`): emissão NFSe com sucesso persiste em `fiscalDocuments`; com `appointmentId` grava o writeback (`fiscalDocumentId`/`fiscalAccessKey`/`fiscalStatus`) de volta no Appointment (prova da correção do gap do item 2); replay do mesmo `appointmentId` não duplica (idempotência); rejeita sem `inscricaoMunicipal` configurada.
- Suíte completa: 815 testes em 59 arquivos aprovados. `tsc --noEmit` limpo.
