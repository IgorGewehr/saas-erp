'use client';

/**
 * Lógica compartilhada de fusão (merge) de clientes.
 *
 * Usado em 2 fluxos:
 *   - MergeModal (ClientsModule): mescla pares detectados automaticamente
 *   - ManualMergeModal (detail/): vinculação manual via search no painel
 *
 * Merge é destrutivo no secondary: marca isActive=false + mergedInto=primary.id.
 * Todas as coleções que apontam pra Client são reassociadas pro primary, e o
 * campo denormalizado Conversation.contactName é re-propagado.
 */

import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import type { Client } from '@/lib/types';

/**
 * Cobrir TODAS as coleções que apontam pra Client. Sem isso, merge deixa
 * crmDeals/crmActivities/kanbanCards/loyaltyHistory órfãos apontando pro
 * doc desativado.
 */
export async function reassociateRelatedDocs(oldId: string, newId: string, businessId: string) {
  const targets = [
    { col: 'conversations',  field: 'crmContactId' },
    { col: 'appointments',   field: 'clientId' },
    { col: 'sales',          field: 'clientId' },
    { col: 'transactions',   field: 'clientId' },
    { col: 'transactions',   field: 'contactId' },
    { col: 'crmDeals',       field: 'contactId' },
    { col: 'crmActivities',  field: 'contactId' },
    { col: 'kanbanCards',    field: 'contactId' },
    { col: 'loyaltyHistory', field: 'clientId' },
  ];
  for (const { col, field } of targets) {
    try {
      const snap = await getDocs(query(
        collection(db, col),
        where('businessId', '==', businessId),
        where(field, '==', oldId),
      ));
      if (snap.empty) continue;
      // Chunk em batches de 400 (limite Firestore é 500, deixa folga)
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const slice = docs.slice(i, i + 400);
        const batch = writeBatch(db);
        slice.forEach(d => batch.update(d.ref, { [field]: newId, updatedAt: new Date().toISOString() }));
        await batch.commit();
      }
    } catch (err) {
      console.warn(`[Clients merge] reassociate ${col}.${field} failed:`, err);
    }
  }
}

/**
 * Atualiza Conversation.contactName em todas as conversas reassociadas pro
 * client primário (campo denormalizado fica stale após merge).
 */
export async function propagateContactNameToConversations(clientId: string, newName: string, businessId: string) {
  try {
    const snap = await getDocs(query(
      collection(db, 'conversations'),
      where('businessId', '==', businessId),
      where('crmContactId', '==', clientId),
    ));
    if (snap.empty) return;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const slice = docs.slice(i, i + 400);
      const batch = writeBatch(db);
      slice.forEach(d => batch.update(d.ref, { contactName: newName, updatedAt: new Date().toISOString() }));
      await batch.commit();
    }
  } catch (err) {
    console.warn('[Clients merge] propagate contactName failed:', err);
  }
}

/**
 * Funde dois clientes. Mantém `primary` (atualiza com campos vazios + somatórios
 * de `secondary` se fillEmpty=true) e desativa `secondary` (isActive=false +
 * mergedInto). Reassocia conversations/sales/appointments/etc. pro primary.
 *
 * fillEmpty=true (default): copia email/phone/whatsapp/etc do secondary nos
 * campos vazios do primary, soma totalSpent/visitCount/loyaltyPoints, une tags
 * e mergea channelIdentities (primary tem precedência).
 *
 * Não dispara toasts — o caller é responsável pela UX de sucesso/erro.
 */
export async function mergeClients(opts: {
  primary: Client;
  secondary: Client;
  businessId: string;
  fillEmpty?: boolean;
}): Promise<void> {
  const { primary, secondary, businessId, fillEmpty = true } = opts;
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };

  if (fillEmpty) {
    if (!primary.email      && secondary.email)      updates.email      = secondary.email;
    if (!primary.phone      && secondary.phone)      updates.phone      = secondary.phone;
    if (!primary.whatsapp   && secondary.whatsapp)   updates.whatsapp   = secondary.whatsapp;
    if (!primary.company    && secondary.company)    updates.company    = secondary.company;
    if (!primary.cpfCnpj    && secondary.cpfCnpj)    updates.cpfCnpj    = secondary.cpfCnpj;
    if (!primary.notes      && secondary.notes)      updates.notes      = secondary.notes;
    if (!primary.endereco   && secondary.endereco)   updates.endereco   = secondary.endereco;

    const allTags = [...new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])])];
    if (allTags.length) updates.tags = allTags;

    if ((secondary.totalSpent ?? 0) > 0)
      updates.totalSpent = (primary.totalSpent ?? 0) + (secondary.totalSpent ?? 0);
    if ((secondary.visitCount ?? 0) > 0)
      updates.visitCount = (primary.visitCount ?? 0) + (secondary.visitCount ?? 0);
    if ((secondary.loyaltyPoints ?? 0) > 0)
      updates.loyaltyPoints = (primary.loyaltyPoints ?? 0) + (secondary.loyaltyPoints ?? 0);

    // primary tem precedência; secondary preenche gaps
    const mergedIdentities = {
      ...(secondary.channelIdentities ?? {}),
      ...(primary.channelIdentities ?? {}),
    };
    if (Object.keys(mergedIdentities).length) updates.channelIdentities = mergedIdentities;
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'clients', primary.id), updates);
  batch.update(doc(db, 'clients', secondary.id), {
    // `mergedInto` sozinho ja faz isActiveRecord retornar false — o helper
    // canonico (lib/utils/recordFilters) trata merged como nao-ativo. Antes
    // gravavamos `isActive: false` redundantemente; removido na Fase 1.
    // OBS: API publica /api/v1/crm/contacts?active=false NAO retorna merged,
    // mas o consumer dela tipicamente quer "deletados", nao "merged" — o
    // delta semantico e aceitavel.
    mergedInto: primary.id,
    mergedAt: now,
    updatedAt: now,
  });
  await batch.commit();

  await reassociateRelatedDocs(secondary.id, primary.id, businessId);
  const finalName = (primary.name || '').trim();
  if (finalName) {
    await propagateContactNameToConversations(primary.id, finalName, businessId);
  }
}
