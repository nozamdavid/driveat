/**
 * Minimal IndexedDB-backed blob store shared by the browser caches.
 *
 * Blobs are stored directly (no base64 inflation) under string keys, and the
 * browser owns eviction under quota pressure. Operations reject on storage
 * failure; callers decide how gracefully to degrade.
 */
export type BlobCacheStore = {
  clear(): Promise<void>;
  get(key: string): Promise<unknown>;
  put(key: string, blob: Blob): Promise<void>;
};

export type IndexedDbBlobCacheOptions = Readonly<{
  database: string;
  store: string;
}>;

let caches: Map<string, BlobCacheStore> | undefined;

function indexedDbFactory(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The cache request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("The cache transaction failed."));
  });
}

const databasePromises = new Map<string, Promise<IDBDatabase>>();

function openDatabase(name: string, storeName: string): Promise<IDBDatabase> {
  const cached = databasePromises.get(name);
  if (cached) return cached;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, 1);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("IndexedDB is unavailable."));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`Opening the ${name} database failed.`));
  });
  // A failed open must not poison future attempts for the session.
  promise.catch(() => {
    if (databasePromises.get(name) === promise) databasePromises.delete(name);
  });
  databasePromises.set(name, promise);
  return promise;
}

export function createIndexedDbBlobCache(options: IndexedDbBlobCacheOptions): BlobCacheStore {
  const registryKey = `${options.database}::${options.store}`;
  const existing = caches?.get(registryKey);
  if (existing) return existing;

  const cache: BlobCacheStore = {
    async clear(): Promise<void> {
      const database = await openDatabase(options.database, options.store);
      const transaction = database.transaction(options.store, "readwrite");
      transaction.objectStore(options.store).clear();
      await transactionDone(transaction);
    },
    async get(key: string): Promise<unknown> {
      const database = await openDatabase(options.database, options.store);
      const transaction = database.transaction(options.store, "readonly");
      return requestAsPromise(transaction.objectStore(options.store).get(key));
    },
    async put(key: string, blob: Blob): Promise<void> {
      const database = await openDatabase(options.database, options.store);
      const transaction = database.transaction(options.store, "readwrite");
      transaction.objectStore(options.store).put(blob, key);
      await transactionDone(transaction);
    },
  };

  caches ??= new Map();
  caches.set(registryKey, cache);
  return cache;
}

export function indexedDbAvailable(): boolean {
  return indexedDbFactory() !== undefined;
}
