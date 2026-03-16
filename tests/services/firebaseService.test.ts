import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FirebaseService } from '@/lib/services/api/firebaseService';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
} from 'firebase/firestore';

// Type for test entity
interface TestEntity {
  id: string;
  businessId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

describe('FirebaseService', () => {
  let service: FirebaseService<TestEntity>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FirebaseService<TestEntity>('testCollection');
  });

  // ==========================================
  // Constructor
  // ==========================================
  describe('constructor', () => {
    it('creates a service instance', () => {
      expect(service).toBeInstanceOf(FirebaseService);
    });

    it('uses the provided collection name when accessing ref', () => {
      // Trigger a method that accesses the ref (which calls collection())
      service.getAll('business-1');
      expect(collection).toHaveBeenCalledWith({}, 'testCollection');
    });
  });

  // ==========================================
  // getById
  // ==========================================
  describe('getById', () => {
    it('returns null when document does not exist', async () => {
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => false,
        data: () => null,
        id: 'test-id',
      } as never);

      const result = await service.getById('nonexistent-id');
      expect(result).toBeNull();
      expect(doc).toHaveBeenCalledWith({}, 'testCollection', 'nonexistent-id');
    });

    it('returns the entity when document exists', async () => {
      const mockData = { name: 'Test', businessId: 'biz-1', createdAt: '2024-01-01', updatedAt: '2024-01-01' };
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => true,
        data: () => mockData,
        id: 'doc-1',
      } as never);

      const result = await service.getById('doc-1');
      expect(result).toEqual({ ...mockData, id: 'doc-1' });
    });
  });

  // ==========================================
  // getAll
  // ==========================================
  describe('getAll', () => {
    it('calls query with businessId filter', async () => {
      vi.mocked(getDocs).mockResolvedValueOnce({
        docs: [],
      } as never);

      await service.getAll('business-123');
      expect(where).toHaveBeenCalledWith('businessId', '==', 'business-123');
      expect(query).toHaveBeenCalled();
    });

    it('maps document snapshots to entities', async () => {
      const mockDocs = [
        { id: 'doc-1', data: () => ({ name: 'Entity 1', businessId: 'biz-1' }) },
        { id: 'doc-2', data: () => ({ name: 'Entity 2', businessId: 'biz-1' }) },
      ];
      vi.mocked(getDocs).mockResolvedValueOnce({ docs: mockDocs } as never);

      const result = await service.getAll('biz-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Entity 1', businessId: 'biz-1', id: 'doc-1' });
      expect(result[1]).toEqual({ name: 'Entity 2', businessId: 'biz-1', id: 'doc-2' });
    });

    it('returns an empty array when no documents exist', async () => {
      vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as never);

      const result = await service.getAll('biz-1');
      expect(result).toEqual([]);
    });
  });

  // ==========================================
  // create
  // ==========================================
  describe('create', () => {
    it('adds timestamps (createdAt and updatedAt)', async () => {
      vi.mocked(addDoc).mockResolvedValueOnce({ id: 'new-doc-id' } as never);

      const data = { businessId: 'biz-1', name: 'New Entity' } as Omit<TestEntity, 'id'>;
      const result = await service.create(data);

      expect(addDoc).toHaveBeenCalled();
      const calledWith = vi.mocked(addDoc).mock.calls[0][1] as Record<string, unknown>;
      expect(calledWith).toHaveProperty('createdAt');
      expect(calledWith).toHaveProperty('updatedAt');
      expect(typeof calledWith.createdAt).toBe('string');
      expect(typeof calledWith.updatedAt).toBe('string');
    });

    it('returns the created entity with the generated id', async () => {
      vi.mocked(addDoc).mockResolvedValueOnce({ id: 'generated-id' } as never);

      const data = { businessId: 'biz-1', name: 'New Entity' } as Omit<TestEntity, 'id'>;
      const result = await service.create(data);

      expect(result.id).toBe('generated-id');
      expect(result.name).toBe('New Entity');
      expect(result.businessId).toBe('biz-1');
    });
  });

  // ==========================================
  // update
  // ==========================================
  describe('update', () => {
    it('calls updateDoc with updatedAt timestamp', async () => {
      await service.update('doc-1', { name: 'Updated Name' });

      expect(doc).toHaveBeenCalledWith({}, 'testCollection', 'doc-1');
      expect(updateDoc).toHaveBeenCalled();

      const calledWith = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
      expect(calledWith).toHaveProperty('updatedAt');
      expect(typeof calledWith.updatedAt).toBe('string');
    });

    it('strips the id field from update data', async () => {
      await service.update('doc-1', { id: 'doc-1', name: 'Updated Name' } as Partial<TestEntity>);

      const calledWith = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
      expect(calledWith).not.toHaveProperty('id');
      expect(calledWith).toHaveProperty('name', 'Updated Name');
    });
  });

  // ==========================================
  // delete
  // ==========================================
  describe('delete', () => {
    it('calls deleteDoc with the correct document reference', async () => {
      await service.delete('doc-to-delete');

      expect(doc).toHaveBeenCalledWith({}, 'testCollection', 'doc-to-delete');
      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  // ==========================================
  // subscribe
  // ==========================================
  describe('subscribe', () => {
    it('creates an onSnapshot listener with businessId filter', () => {
      const callback = vi.fn();
      service.subscribe('biz-1', callback);

      expect(where).toHaveBeenCalledWith('businessId', '==', 'biz-1');
      expect(query).toHaveBeenCalled();
      expect(onSnapshot).toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe('biz-1', callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('calls the callback with mapped data when snapshot fires', () => {
      const callback = vi.fn();
      const mockDocs = [
        { id: 'doc-1', data: () => ({ name: 'Item 1', businessId: 'biz-1' }) },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(onSnapshot).mockImplementationOnce((_: any, cb: any) => {
        cb({ docs: mockDocs });
        return vi.fn();
      });

      service.subscribe('biz-1', callback);

      expect(callback).toHaveBeenCalledWith([
        { name: 'Item 1', businessId: 'biz-1', id: 'doc-1' },
      ]);
    });
  });

  // ==========================================
  // batchCreate
  // ==========================================
  describe('batchCreate', () => {
    it('creates a batch and commits it', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(() => Promise.resolve()),
      };
      vi.mocked(writeBatch).mockReturnValueOnce(mockBatch as never);

      const items = [
        { businessId: 'biz-1', name: 'Item 1' },
        { businessId: 'biz-1', name: 'Item 2' },
      ] as Omit<TestEntity, 'id'>[];

      await service.batchCreate(items);

      expect(writeBatch).toHaveBeenCalled();
      expect(mockBatch.set).toHaveBeenCalledTimes(2);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('adds timestamps to each batch item', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(() => Promise.resolve()),
      };
      vi.mocked(writeBatch).mockReturnValueOnce(mockBatch as never);

      const items = [{ businessId: 'biz-1', name: 'Item 1' }] as Omit<TestEntity, 'id'>[];
      await service.batchCreate(items);

      const setData = mockBatch.set.mock.calls[0][1] as Record<string, unknown>;
      expect(setData).toHaveProperty('createdAt');
      expect(setData).toHaveProperty('updatedAt');
    });
  });

  // ==========================================
  // batchDelete
  // ==========================================
  describe('batchDelete', () => {
    it('deletes all specified documents in a batch', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn(() => Promise.resolve()),
      };
      vi.mocked(writeBatch).mockReturnValueOnce(mockBatch as never);

      await service.batchDelete(['id-1', 'id-2', 'id-3']);

      expect(mockBatch.delete).toHaveBeenCalledTimes(3);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });
  });
});
