import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateDoc, type DocumentReference } from 'firebase/firestore';
import {
  softDeleteDoc,
  restoreDoc,
  cascadeSoftDeleteDoc,
  type SoftDeleteActor,
} from '@/lib/services/softDelete';

// Stub minimo de DocumentReference — o helper so precisa pra passar pro updateDoc.
const stubRef = {} as DocumentReference;

const ACTOR: SoftDeleteActor = { uid: 'user-123', name: 'Maria Operadora' };

describe('softDeleteDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escreve deletedAt + deletedBy + deletedByName + updatedAt', async () => {
    const result = await softDeleteDoc(stubRef, ACTOR);
    expect(result).toBe(true);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.deletedBy).toBe('user-123');
    expect(payload.deletedByName).toBe('Maria Operadora');
    expect(payload.updatedAt).toEqual(payload.deletedAt);
  });

  it('idempotente: nao reescreve se doc ja tem deletedAt', async () => {
    const result = await softDeleteDoc(stubRef, ACTOR, { deletedAt: '2026-01-01T00:00:00Z' });
    expect(result).toBe(false);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('escreve quando currentData passado mas sem deletedAt', async () => {
    const result = await softDeleteDoc(stubRef, ACTOR, { deletedAt: undefined });
    expect(result).toBe(true);
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('escreve quando currentData tem deletedAt como string vazia', async () => {
    // String vazia eh FALSY em JS — `if (currentData?.deletedAt)` nao entra
    // no ramo de idempotencia, helper escreve normalmente. Defende contra
    // bugs antigos que possam ter setado `deletedAt: ''` em vez de undefined.
    const result = await softDeleteDoc(stubRef, ACTOR, { deletedAt: '' });
    expect(result).toBe(true);
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it('lanca erro se actor sem uid', async () => {
    await expect(
      softDeleteDoc(stubRef, { uid: '', name: 'X' }),
    ).rejects.toThrow(/actor.uid obrigatorio/);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('lanca erro se actor null', async () => {
    await expect(
      softDeleteDoc(stubRef, null as unknown as SoftDeleteActor),
    ).rejects.toThrow(/actor.uid obrigatorio/);
  });

  it('usa uid como fallback quando name vazio', async () => {
    await softDeleteDoc(stubRef, { uid: 'user-456', name: '' });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.deletedByName).toBe('user-456');
  });
});

describe('restoreDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('limpa todos os campos de delete (novos + legados) via deleteField sentinel + atualiza updatedAt', async () => {
    const result = await restoreDoc(stubRef);
    expect(result).toBe(true);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    // Novos (Fase 0)
    expect(payload.deletedAt).toBe('__DELETE_FIELD__');
    expect(payload.deletedBy).toBe('__DELETE_FIELD__');
    expect(payload.deletedByName).toBe('__DELETE_FIELD__');
    // Legados (clients pre-Fase 1 + conversations pre-Fase 2)
    expect(payload.isActive).toBe('__DELETE_FIELD__');
    expect(payload.isDeleted).toBe('__DELETE_FIELD__');
    expect(typeof payload.updatedAt).toBe('string');
  });

  it('nao toca em mergedInto (merge nao deve ser revertido)', async () => {
    await restoreDoc(stubRef);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.mergedInto).toBeUndefined();
  });
});

describe('cascadeSoftDeleteDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escreve campos de delete + cascadeFromParentId', async () => {
    await cascadeSoftDeleteDoc(stubRef, ACTOR, 'parent-board-id');
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.deletedBy).toBe('user-123');
    expect(payload.cascadeFromParentId).toBe('parent-board-id');
  });

  it('lanca erro se actor sem uid', async () => {
    await expect(
      cascadeSoftDeleteDoc(stubRef, { uid: '', name: 'X' }, 'parent-id'),
    ).rejects.toThrow(/actor.uid obrigatorio/);
  });

  it('lanca erro se parentId vazio', async () => {
    await expect(
      cascadeSoftDeleteDoc(stubRef, ACTOR, ''),
    ).rejects.toThrow(/parentId obrigatorio/);
  });
});
