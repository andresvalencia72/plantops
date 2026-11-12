export type PendingClosure = Readonly<{ key: string; fingerprint: string }>
const prefix = 'plantops:closure-retry:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[\da-f]{64}$/i
function scope(user: string, org: string, incident: string) {
  if (![user, org, incident].every((id) => uuid.test(id))) {
    throw new Error('El contexto de cierre no es válido.')
  }
  return prefix + [user, org, incident].map((id) => id.toLowerCase()).join(':')
}
export async function closureFingerprint(incident: string,
  reason: string, conclusion?: string) {
  const json = JSON.stringify([incident.toLowerCase(), reason.trim(),
    conclusion?.trim() || null])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}
export function readClosureRetry(user: string, org: string,
  incident: string): PendingClosure | null {
  const raw = sessionStorage.getItem(scope(user, org, incident))
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
  throw new Error('No se pudo validar el cierre anterior. Consulta el historial.')
}
export function saveClosureRetry(user: string, org: string,
  incident: string, pointer: PendingClosure) {
  if (!uuid.test(pointer.key) || !sha256.test(pointer.fingerprint)) {
    throw new Error('Identificador de cierre inválido.')
  }
  const old = readClosureRetry(user, org, incident)
  if (old && (old.key !== pointer.key || old.fingerprint !== pointer.fingerprint)) {
    throw new Error('Existe otro cierre sin confirmar. Comprueba su resultado.')
  }
  sessionStorage.setItem(scope(user, org, incident), JSON.stringify(pointer))
}
export function clearClosureRetry(user: string, org: string, incident: string) {
  sessionStorage.removeItem(scope(user, org, incident))
}
