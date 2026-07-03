import type { Business } from '@/lib/types';

/**
 * Zona de entrega configurada em `settings.aiAgent.deliveryZones`. Tipo derivado
 * do modelo (fonte única) — nunca redeclarar paralelo (R2/§6).
 */
export type DeliveryZone = NonNullable<
  NonNullable<NonNullable<Business['settings']>['aiAgent']>['deliveryZones']
>[number];

export interface ResolveZoneInput {
  /** CEP (com ou sem máscara). Usado como pista secundária. */
  cep?: string;
  /** Bairro informado no checkout — chave primária de match por `neighborhood`. */
  bairro?: string;
}

/**
 * Resultado da resolução de zona:
 * - `matched`   → zona encontrada; `fee`/`estimatedMinutes` são autoritativos.
 *                 `estimated: true` quando resolvida por `radius`/`polygon` (sem
 *                 geocoding não dá pra confirmar distância — não bloqueia).
 * - `no-zones`  → negócio não configurou zonas → chamador usa a taxa PLANA.
 * - `out-of-area` → há zonas de bairro e nenhuma casou → bloquear entrega.
 */
export type ZoneResolution =
  | { status: 'matched'; zone: DeliveryZone; fee: number; estimatedMinutes?: number; estimated: boolean }
  | { status: 'no-zones' }
  | { status: 'out-of-area' };

/** minúsculas, sem acento, sem pontuação, espaços colapsados. */
function normalize(value: string | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matched(zone: DeliveryZone, estimated: boolean): ZoneResolution {
  return {
    status: 'matched',
    zone,
    fee: Math.max(0, zone.fee ?? 0),
    estimatedMinutes: zone.estimatedMinutes,
    estimated,
  };
}

/**
 * Resolve a zona de entrega de um endereço — função PURA, reusada pelo cardápio
 * (client) e pela rota pública (server) para garantir que a taxa exibida == a
 * cobrada (SOTA-05/COE).
 *
 * Estratégia:
 *   1. `neighborhood` — match real por nome do bairro (igualdade normalizada ou
 *      contenção em qualquer direção, p/ tolerar "Jardim América" vs "America").
 *   2. `radius`/`polygon` — sem geocoding no boundary não há como confirmar a
 *      distância; devolvemos a 1ª como estimativa (`estimated: true`) em vez de
 *      bloquear o cliente. TODO: geocodificar CEP e computar raio/ponto-em-polígono.
 *   3. Só há zonas de bairro e nenhuma casou → `out-of-area` (bloqueia).
 *
 * Sem zonas configuradas → `no-zones` (o chamador cai na taxa plana).
 */
export function resolveDeliveryZone(
  zones: DeliveryZone[] | undefined,
  input: ResolveZoneInput,
): ZoneResolution {
  if (!zones?.length) return { status: 'no-zones' };

  const bairro = normalize(input.bairro);

  if (bairro) {
    for (const zone of zones) {
      if (zone.type !== 'neighborhood') continue;
      const value = normalize(zone.value);
      if (!value) continue;
      if (value === bairro || bairro.includes(value) || value.includes(bairro)) {
        return matched(zone, false);
      }
    }
  }

  const geoZone = zones.find(z => z.type === 'radius' || z.type === 'polygon');
  if (geoZone) return matched(geoZone, true);

  return { status: 'out-of-area' };
}
