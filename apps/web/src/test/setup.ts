import '@testing-library/jest-dom/vitest'

// Node 25 exposes a global Storage accessor that throws without --localstorage-file.
// Explicitly provide a deterministic browser-like store for component tests.
const items = new Map<string, string>()
const storage: Storage = {
  get length() { return items.size },
  clear() { items.clear() },
  getItem(key) { return items.get(key) ?? null },
  key(index) { return [...items.keys()][index] ?? null },
  removeItem(key) { items.delete(key) },
  setItem(key, value) { items.set(key, String(value)) },
}
Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
