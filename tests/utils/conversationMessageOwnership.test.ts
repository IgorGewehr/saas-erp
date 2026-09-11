import { describe, it, expect } from 'vitest';
import { messageOwnershipFields } from '@/lib/utils/conversationMessageOwnership';

describe('messageOwnershipFields', () => {
  it('copia channelOwnerType e channelOwnerId quando ambos presentes', () => {
    expect(messageOwnershipFields({ channelOwnerType: 'user', channelOwnerId: 'u1' }))
      .toEqual({ channelOwnerType: 'user', channelOwnerId: 'u1', visibleToUserIds: null });
  });

  it('copia só channelOwnerType quando channelOwnerId ausente (canal business)', () => {
    expect(messageOwnershipFields({ channelOwnerType: 'business' }))
      .toEqual({ channelOwnerType: 'business', visibleToUserIds: null });
  });

  it('visibleToUserIds sempre explícito (null) quando a conversa não tem nenhum campo (legado)', () => {
    expect(messageOwnershipFields({})).toEqual({ visibleToUserIds: null });
  });

  it('não copia channelOwnerId sozinho sem channelOwnerType (nunca deveria acontecer, mas defensivo)', () => {
    expect(messageOwnershipFields({ channelOwnerId: 'u1' })).toEqual({ channelOwnerId: 'u1', visibleToUserIds: null });
  });

  it('copia visibleToUserIds como array quando a conversa está restrita a um setor', () => {
    expect(messageOwnershipFields({ visibleToUserIds: ['u1', 'u2'] }))
      .toEqual({ visibleToUserIds: ['u1', 'u2'] });
  });

  it('copia visibleToUserIds explicitamente como null quando a conversa não tem restrição', () => {
    expect(messageOwnershipFields({ visibleToUserIds: null })).toEqual({ visibleToUserIds: null });
  });

  it('combina ownership + visibilidade no mesmo objeto', () => {
    expect(messageOwnershipFields({ channelOwnerType: 'user', channelOwnerId: 'u1', visibleToUserIds: ['u1'] }))
      .toEqual({ channelOwnerType: 'user', channelOwnerId: 'u1', visibleToUserIds: ['u1'] });
  });
});
