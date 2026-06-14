const DB_NAME = 'cost_bank_secure_device_v1';
const STORE_NAME = 'secure_keys';
const KEY_ID = 'primary_device_key';

function openDeviceDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('تعذر فتح مخزن الجهاز.'));
  });
}

async function dbGet(key) {
  const db = await openDeviceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbPut(key, value) {
  const db = await openDeviceDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getOrCreateDeviceKey() {
  if (!window.isSecureContext || !crypto?.subtle || !window.indexedDB) {
    throw new Error('يجب فتح البنك عبر رابط HTTPS في متصفح حديث، وليس من داخل تطبيقات المحادثة.');
  }
  let pair = await dbGet(KEY_ID);
  if (!pair?.privateKey || !pair?.publicKey) {
    pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
    await dbPut(KEY_ID, pair);
  }
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { pair, publicKeyJwk };
}

function bytesToB64Url(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function signChallenge(privateKey, challenge) {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(challenge)
  );
  return bytesToB64Url(signature);
}
