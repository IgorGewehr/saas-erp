/**
 * lib/services/fiscal/appointmentNfse.ts
 *
 * Mapeia um Appointment concluído (módulo Agenda) para o INPUT de emissão de
 * NFS-e do contrato existente (`NfseRequest` de `lib/contracts/api/fiscal/emit.ts`).
 *
 * Função PURA e determinística: recebe (appointment, service, business), devolve
 * o mesmo shape que `EmitirNotaDialog` monta pro POST /api/fiscal/emit. Mesmo
 * papel de `buildDeliveryOrderNfceInput` (lib/services/fiscal/deliveryOrderNfce.ts)
 * pro NFC-e — serve só de prefill manual (botão "Emitir NFSe" na Agenda);
 * NÃO há auto-emissão nesta fatia (emissão real pro município do cliente ainda
 * não foi validada — ver docs/agenda/AGENDA_NFSE_MANUAL.md).
 *
 * ─── Limitações conhecidas (documentadas de propósito) ───────────────────────
 *   - Appointment não guarda CPF/CNPJ do cliente — só clientName. `tomador` sai
 *     com `nome` apenas; o operador resolve o documento no autocomplete de
 *     cliente que já existe dentro do EmitirNotaDialog antes de emitir (mesmo
 *     fluxo de uma emissão avulsa manual hoje).
 *   - codigoServico/codigoServicoMunicipal/aliquotaIss/nbs só saem preenchidos
 *     quando o Service tiver os campos fiscais cadastrados
 *     (lc116Code/codigoMunicipal/aliquotaISS/nbs — lib/contracts/domain/service.ts).
 *     Ausentes, o operador preenche manualmente no dialog (mesmo LC116 combobox
 *     usado pra emissão avulsa).
 */

import type { Appointment, Service, Business } from '@/lib/types';
import type { NfseRequest } from '@/lib/contracts/api/fiscal/emit';

/**
 * Mapeia um Appointment concluído → NfseRequest (input de emissão de NFS-e).
 *
 * PURA: não toca Firestore, rede, nem Date.now(). `appointmentId` +
 * `sourceType: 'appointment'` fazem o route ancorar a idempotência por
 * atendimento (retry do mesmo appointment replaya a nota já emitida) e gravar
 * o writeback (fiscalDocumentId/fiscalAccessKey) de volta no Appointment.
 *
 * @param appointment Atendimento concluído a faturar.
 * @param service     Serviço vinculado (opcional — appointment.serviceId pode
 *                     apontar pra um serviço arquivado/removido).
 * @param business    Empresa emitente (fornece `businessId`).
 */
export function buildAppointmentNfseInput(
  appointment: Appointment,
  service: Service | undefined,
  business: Business,
): NfseRequest {
  return {
    type: 'nfse',
    businessId: business.id,
    valorServicos: appointment.price || 0,
    discriminacao: appointment.serviceName || service?.name || 'Atendimento',
    codigoServico: service?.lc116Code || undefined,
    codigoServicoMunicipal: service?.codigoMunicipal || undefined,
    aliquotaIss: service?.aliquotaISS ?? undefined,
    nbs: service?.nbs || undefined,
    // Sem CPF/CNPJ no appointment → tomador só com nome (informativo). O
    // operador confirma/completa o documento no dialog antes de emitir.
    tomador: appointment.clientName ? { nome: appointment.clientName } : undefined,
    // Vínculo com a origem: ancora idempotência por atendimento no route e
    // grava o writeback (fiscalDocumentId/fiscalAccessKey) de volta no Appointment.
    appointmentId: appointment.id,
    sourceType: 'appointment',
  };
}
