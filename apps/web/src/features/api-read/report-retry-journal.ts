import type { ApiReportInput } from './api-client'

/** A tab-scoped recovery pointer: never persist the report body or a session cookie. */
export type PendingReport = Readonly<{ key: string; fingerprint: string }>
const prefix = 'plantops:pending-report:v1:'
const uuidV4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[\da-f]{64}$/i

function scope(userId: string, orgId: string): string {
  if (!uuidV4.test(userId) || !uuidV4.test(orgId)) {
    // Production identifiers are server-issued UUIDs; tests use UUIDs as well.
    throw new Error('Identidad u organización no válida para recuperar el reintento.')
  }
  return prefix + userId.toLowerCase() + ':' + orgId.toLowerCase()
}

export async function fingerprintReport(input: ApiReportInput): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify([
    input.assetId.toLowerCase(), input.title.trim(), input.description.trim(),
  ]))
  const result = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

export function readPendingReport(userId: string, orgId: string): PendingReport | null {
  const raw = sessionStorage.getItem(scope(userId, orgId))
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      'key' in value && typeof value.key === 'string' && uuidV4.test(value.key) &&
      'fingerprint' in value && typeof value.fingerprint === 'string' &&
      sha256.test(value.fingerprint)) {
      return { key: value.key, fingerprint: value.fingerprint }
    }
  } catch {
    // Corrupt persisted metadata must fail closed, not silently generate a new key.
  }
  throw new Error('No se pudo verificar el reintento guardado. Revisa el aviso antes de continuar.')
}

export function savePendingReport(
  userId: string, orgId: string, pending: PendingReport,
): void {
  const previous = readPendingReport(userId, orgId)
  if (previous && (previous.key !== pending.key ||
      previous.fingerprint !== pending.fingerprint)) {
    throw new Error('Ya existe un aviso sin confirmar. Revisa o descarta ese intento.')
  }
  sessionStorage.setItem(scope(userId, orgId), JSON.stringify(pending))
}

export function clearPendingReport(userId: string, orgId: string): void {
  sessionStorage.removeItem(scope(userId, orgId))
}
