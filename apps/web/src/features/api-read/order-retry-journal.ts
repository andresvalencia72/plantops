import type { ApiCreateOrderInput } from './api-client'

/** Only a tab-scoped UUID + payload fingerprint; no work order text or cookies. */
export type PendingOrder = Readonly<{ key: string; fingerprint: string }>
const prefix = 'plantops:pending-corrective:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[\da-f]{64}$/i

function scope(userId: string, orgId: string, incidentId: string) {
  if (![userId, orgId, incidentId].every((id) => uuid.test(id))) {
    throw new Error('No se pudo validar el contexto de la orden.')
  }
  return prefix + [userId, orgId, incidentId].map((id) => id.toLowerCase()).join(':')
}

/** Must agree with backend SHA-256(JSON.stringify([incidentId, title, description])). */
export async function fingerprintOrder(incidentId: string, input: ApiCreateOrderInput) {
  const encoded = new TextEncoder().encode(JSON.stringify([
    incidentId.toLowerCase(), input.title.trim(), input.description.trim(),
  ]))
  const result = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

export function readPendingOrder(userId: string, orgId: string,
  incidentId: string): PendingOrder | null {
  const raw = sessionStorage.getItem(scope(userId, orgId, incidentId))
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      'key' in value && typeof value.key === 'string' && uuid.test(value.key) &&
      'fingerprint' in value && typeof value.fingerprint === 'string' &&
      sha256.test(value.fingerprint)) {
      return { key: value.key, fingerprint: value.fingerprint }
    }
  } catch {
    // Do not replace an unknown attempt with a new key automatically.
  }
  throw new Error('No se pudo verificar el intento guardado. Revisa las órdenes antes de continuar.')
}

export function savePendingOrder(userId: string, orgId: string,
  incidentId: string, pointer: PendingOrder): void {
  if (!uuid.test(pointer.key) || !sha256.test(pointer.fingerprint)) {
    throw new Error('La clave de reintento no es válida.')
  }
  const old = readPendingOrder(userId, orgId, incidentId)
  if (old && (old.key !== pointer.key || old.fingerprint !== pointer.fingerprint)) {
    throw new Error('Existe una orden sin confirmar. Revisa o descarta ese intento.')
  }
  sessionStorage.setItem(scope(userId, orgId, incidentId), JSON.stringify(pointer))
}

export function clearPendingOrder(userId: string, orgId: string,
  incidentId: string): void {
  sessionStorage.removeItem(scope(userId, orgId, incidentId))
}
