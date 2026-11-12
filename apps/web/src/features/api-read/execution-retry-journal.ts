export type ExecutionAction = 'STARTED' | 'COMPLETED'
export type PendingExecution = Readonly<{ key: string; fingerprint: string }>
const prefix = 'plantops:execution-retry:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i
const sha256 = /^[a-f0-9]{64}$/i
function scope(userId: string, orgId: string, incidentId: string,
  orderId: string, action: ExecutionAction) {
  if (![userId, orgId, incidentId, orderId].every((value) => uuid.test(value))) {
    throw new Error('Contexto de ejecución no válido')
  }
  return prefix + [userId, orgId, incidentId, orderId, action]
    .map((value) => value.toLowerCase()).join(':')
}

/** Same SHA-256(JSON.stringify([incident,order,action,resultOrNull])) as API. */
export async function fingerprintExecution(incident: string, order: string,
  action: ExecutionAction, result?: string) {
  const encoded = new TextEncoder().encode(JSON.stringify([
    incident.toLowerCase(), order.toLowerCase(), action,
    action === 'COMPLETED' ? result?.trim() || null : null,
  ]))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

export function readExecutionRetry(user: string, org: string, incident: string,
  order: string, action: ExecutionAction): PendingExecution | null {
  const raw = sessionStorage.getItem(scope(user, org, incident, order, action))
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) &&
      'key' in value && typeof value.key === 'string' && uuid.test(value.key) &&
      'fingerprint' in value && typeof value.fingerprint === 'string' &&
      sha256.test(value.fingerprint)) {
      return { key: value.key, fingerprint: value.fingerprint }
    }
  } catch { /* unreadable metadata never replaced automatically */ }
  throw new Error('No se pudo validar el intento guardado. Comprueba el historial.')
}

export function saveExecutionRetry(user: string, org: string, incident: string,
  order: string, action: ExecutionAction, pointer: PendingExecution) {
  if (!uuid.test(pointer.key) || !sha256.test(pointer.fingerprint)) {
    throw new Error('Identificador de reintento inválido')
  }
  const previous = readExecutionRetry(user, org, incident, order, action)
  if (previous && (previous.key !== pointer.key ||
      previous.fingerprint !== pointer.fingerprint)) {
    throw new Error('Existe una operación sin confirmar; revísala antes de continuar.')
  }
  sessionStorage.setItem(scope(user, org, incident, order, action),
    JSON.stringify(pointer))
}

export function clearExecutionRetry(user: string, org: string, incident: string,
  order: string, action: ExecutionAction) {
  sessionStorage.removeItem(scope(user, org, incident, order, action))
}
