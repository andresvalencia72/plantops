export type PendingCancellation = Readonly<{ key: string; fingerprint: string }>
const prefix = 'plantops:cancel-retry:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[\da-f]{64}$/i
function scope(user: string, org: string, incident: string, order: string) {
  if (![user, org, incident, order].every((item) => uuid.test(item))) {
    throw new Error('El contexto de cancelación no es válido.')
  }
  return prefix + [user, org, incident, order]
    .map((item) => item.toLowerCase()).join(':')
}
export async function cancellationFingerprint(incident: string, order: string,
  reason: string) {
  const json = JSON.stringify([incident.toLowerCase(), order.toLowerCase(), reason.trim()])
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}
export function readCancellationRetry(user: string, org: string,
  incident: string, order: string): PendingCancellation | null {
  const raw = sessionStorage.getItem(scope(user, org, incident, order))
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      'key' in value && typeof value.key === 'string' && uuid.test(value.key) &&
      'fingerprint' in value && typeof value.fingerprint === 'string' &&
      sha256.test(value.fingerprint)) {
      return { key: value.key, fingerprint: value.fingerprint }
    }
  } catch { /* fail closed */ }
  throw new Error('El intento anterior no se puede validar; revisa el historial.')
}
export function saveCancellationRetry(user: string, org: string,
  incident: string, order: string, pointer: PendingCancellation) {
  if (!uuid.test(pointer.key) || !sha256.test(pointer.fingerprint)) {
    throw new Error('Identificador de reintento inválido.')
  }
  const old = readCancellationRetry(user, org, incident, order)
  if (old && (old.key !== pointer.key || old.fingerprint !== pointer.fingerprint)) {
    throw new Error('Existe una cancelación sin confirmar. No se enviará otra.')
  }
  sessionStorage.setItem(scope(user, org, incident, order), JSON.stringify(pointer))
}
export function clearCancellationRetry(user: string, org: string,
  incident: string, order: string) {
  sessionStorage.removeItem(scope(user, org, incident, order))
}
