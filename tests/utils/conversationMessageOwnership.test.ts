import { describe, it, expect } from 'vitest';
import { messageOwnershipFields } from '@/lib/utils/conversationMessageOwnership';

describe('messageOwnershipFields', () => {
  it('copia channelOwnerType e channelOwnerId quando ambos presentes', () => {
    expect(messageOwnershipFields({ channelOwnerType: 'user', channelOwnerId: 'u1' }))
      .toEqual({ channelOwnerType: 'user', channelOwnerId: 'u1' });
  });

  it('copia só channelOwnerType quando channelOwnerId ausente (canal business)', () => {
    expect(messageOwnershipFields({ channelOwnerType: 'business' }))
      .toEqual({ channelOwnerType: 'business' });
  });

  it('devolve objeto vazio quando a conversa não tem nenhum campo (legado)', () => {
    expect(messageOwnershipFields({})).toEqual({});
  });

  it('não copia channelOwnerId sozinho sem channelOwnerType (nunca deveria acontecer, mas defensivo)', () => {
    expect(messageOwnershipFields({ channelOwnerId: 'u1' })).toEqual({ channelOwnerId: 'u1' });
  });
});
