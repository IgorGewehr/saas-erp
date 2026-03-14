import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  DocumentSnapshot,
  QueryConstraint,
  Timestamp,
  writeBatch,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/config/firebase';

// Generic CRUD service for Firestore
export class FirebaseService<T extends { id: string }> {
  constructor(private collectionName: string) {}

  private get ref() {
    return collection(db, this.collectionName);
  }

  private toFirestore(data: Partial<T>): Record<string, unknown> {
    const { ...rest } = data as Record<string, unknown>;
    delete rest.id;
    return {
      ...rest,
      updatedAt: new Date().toISOString(),
    };
  }

  private fromFirestore(docSnap: DocumentSnapshot): T {
    const data = docSnap.data();
    return { ...data, id: docSnap.id } as T;
  }

  async getById(id: string): Promise<T | null> {
    const docRef = doc(db, this.collectionName, id);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return null;
    return this.fromFirestore(docSnap);
  }

  async getAll(businessId: string, constraints: QueryConstraint[] = []): Promise<T[]> {
    const q = query(
      this.ref,
      where('businessId', '==', businessId),
      ...constraints
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => this.fromFirestore(d));
  }

  async getFiltered(constraints: QueryConstraint[]): Promise<T[]> {
    const q = query(this.ref, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => this.fromFirestore(d));
  }

  async getPaginated(
    businessId: string,
    pageSize: number,
    lastDoc?: DocumentSnapshot,
    constraints: QueryConstraint[] = []
  ): Promise<{ data: T[]; lastDoc: DocumentSnapshot | null }> {
    const queryConstraints: QueryConstraint[] = [
      where('businessId', '==', businessId),
      ...constraints,
      limit(pageSize),
    ];

    if (lastDoc) {
      queryConstraints.push(startAfter(lastDoc));
    }

    const q = query(this.ref, ...queryConstraints);
    const snapshot = await getDocs(q);
    const data = snapshot.docs.map((d) => this.fromFirestore(d));
    const newLastDoc = snapshot.docs[snapshot.docs.length - 1] || null;

    return { data, lastDoc: newLastDoc };
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    const docData = {
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const docRef = await addDoc(this.ref, docData);
    return { ...docData, id: docRef.id } as unknown as T;
  }

  async update(id: string, data: Partial<T>): Promise<void> {
    const docRef = doc(db, this.collectionName, id);
    await updateDoc(docRef, this.toFirestore(data));
  }

  async delete(id: string): Promise<void> {
    const docRef = doc(db, this.collectionName, id);
    await deleteDoc(docRef);
  }

  async batchCreate(items: Omit<T, 'id'>[]): Promise<void> {
    const batch = writeBatch(db);
    items.forEach((item) => {
      const docRef = doc(this.ref);
      batch.set(docRef, {
        ...item,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    await batch.commit();
  }

  async batchUpdate(updates: { id: string; data: Partial<T> }[]): Promise<void> {
    const batch = writeBatch(db);
    updates.forEach(({ id, data }) => {
      const docRef = doc(db, this.collectionName, id);
      batch.update(docRef, this.toFirestore(data));
    });
    await batch.commit();
  }

  async batchDelete(ids: string[]): Promise<void> {
    const batch = writeBatch(db);
    ids.forEach((id) => {
      const docRef = doc(db, this.collectionName, id);
      batch.delete(docRef);
    });
    await batch.commit();
  }

  subscribe(
    businessId: string,
    callback: (data: T[]) => void,
    constraints: QueryConstraint[] = []
  ): Unsubscribe {
    const q = query(
      this.ref,
      where('businessId', '==', businessId),
      ...constraints
    );
    return onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((d) => this.fromFirestore(d));
      callback(data);
    });
  }
}
