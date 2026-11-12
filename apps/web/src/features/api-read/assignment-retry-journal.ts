import type { ApiAssignmentInput } from './api-client'

export type PendingAssignment = Readonly<{
  key: string; fingerprint: string; expectedVersion: number
}>
const prefix = 'plantops:pending-assignment:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[\da-f]{64}$/i

function scope(userId: string, orgId: string, incidentId: string, orderId: string) {
  if (![userId, orgId, incidentId, orderId].every((value) => uuid.test(value))) {
    throw new Error('No se pudo validar el contexto del reintento.')
  }
  return prefix + [userId, orgId, incidentId, orderId]
    .map((value) => value.toLowerCase()).join(':')
}

export async function fingerprintAssignment(incidentId: string, orderId: string,
  input: ApiAssignmentInput) {
  const body = JSON.stringify([incidentId.toLowerCase(), orderId.toLowerCase(),
    input.technicianMembershipId.toLowerCase(), input.expectedVersion,
    input.reason?.trim() || null])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

export function readPendingAssignment(user: string, org: string,
  incident: string, order: string): PendingAssignment | null {
  const raw = sessionStorage.getItem(scope(user, org, incident, order))
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      'key' in value && typeof value.key === 'string' && uuid.test(value.key) &&
      'fingerprint' in value && typeof value.fingerprint === 'string' &&
      sha256.test(value.fingerprint) && 'expectedVersion' in value &&
      Number.isSafeInteger(value.expectedVersion) &&
      (value.expectedVersion as number) >= 0) {
      return { key: value.key, fingerprint: value.fingerprint,
        expectedVersion: value.expectedVersion as number }
    }
  } catch { /* fail closed */ }
  throw new Error('No se pudo comprobar el reintento guardado. Revisa el historial.')
}

export function savePendingAssignment(user: string, org: string,
  incident: string, order: string, pointer: PendingAssignment) {
  if (!uuid.test(pointer.key) || !sha256.test(pointer.fingerprint) ||
    !Number.isSafeInteger(pointer.expectedVersion) || pointer.expectedVersion < 0) {
    throw new Error('Clave o versión de asignación no válida.')
  }
  const stored = readPendingAssignment(user, org, incident, order)
  if (stored && (stored.key !== pointer.key ||
      stored.fingerprint !== pointer.fingerprint ||
      stored.expectedVersion !== pointer.expectedVersion)) {
    throw new Error('Existe otro cambio sin confirmar. Revisa el historial primero.')
  }
  sessionStorage.setItem(scope(user, org, incident, order), JSON.stringify(pointer))
}

export function clearPendingAssignment(user: string, org: string,
  incident: string, order: string) {
  sessionStorage.removeItem(scope(user, org, incident, order))
}
