// Only a retry UUID is stored. No session, incident body or protected record.
const prefix = 'plantops:review-attempt:v1:'
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function storageKey(userId: string, orgId: string, incidentId: string): string {
  if (![userId, orgId, incidentId].every((id) => uuid.test(id))) {
    throw new Error('No se pudo validar el contexto de la revisión.')
  }
  return prefix + [userId, orgId, incidentId].map((id) => id.toLowerCase()).join(':')
}

export function reviewRetryKey(userId: string, orgId: string, incidentId: string): string {
  const key = storageKey(userId, orgId, incidentId)
  const saved = sessionStorage.getItem(key)
  if (saved !== null) {
    if (!uuid.test(saved)) throw new Error('La clave del intento anterior no es válida.')
    return saved
  }
  const attempt = crypto.randomUUID()
  sessionStorage.setItem(key, attempt)
  return attempt
}

export function clearReviewRetryKey(userId: string, orgId: string, incidentId: string): void {
  sessionStorage.removeItem(storageKey(userId, orgId, incidentId))
}
