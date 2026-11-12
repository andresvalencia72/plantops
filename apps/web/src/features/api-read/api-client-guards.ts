import type { ApiIncident, ApiWorkOrder, ApiAssignmentEvent,
  ApiExecutionEvent, ApiCancellationEvent, ApiClosureEvent } from './api-client'

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function string(value: unknown): value is string {
  return typeof value === 'string'
}
export function validIncident(value: unknown): value is ApiIncident {
  return record(value) && string(value.id) && string(value.assetId) &&
    string(value.title) && string(value.reportedAt) &&
    Number.isFinite(Date.parse(value.reportedAt)) &&
    ['REPORTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'CLOSED'].includes(String(value.status))
}
export function validWorkOrder(value: unknown): value is ApiWorkOrder {
  return record(value) && string(value.id) && string(value.incidentId) &&
    string(value.assetId) && string(value.title) &&
    string(value.createdAt) && Number.isFinite(Date.parse(value.createdAt)) &&
    ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
      .includes(String(value.status)) &&
    Number.isSafeInteger(value.assignmentVersion) &&
    (value.assignmentVersion as number) >= 0 &&
    (value.responsibleMembershipId === null || string(value.responsibleMembershipId))
}
export function validAssignment(value: unknown): value is ApiAssignmentEvent {
  return record(value) && string(value.id) && string(value.workOrderId) &&
    ['ASSIGNED', 'REASSIGNED'].includes(String(value.action)) &&
    Number.isSafeInteger(value.version) && (value.version as number) > 0 &&
    (value.fromMembershipId === null || string(value.fromMembershipId)) &&
    string(value.toMembershipId) && string(value.actorMembershipId) &&
    (value.reason === null || string(value.reason)) &&
    string(value.occurredAt) && Number.isFinite(Date.parse(value.occurredAt))
}
export function validExecution(value: unknown): value is ApiExecutionEvent {
  return record(value) && string(value.id) && string(value.workOrderId) &&
    ['STARTED', 'COMPLETED'].includes(String(value.action)) &&
    ['ASSIGNED', 'IN_PROGRESS'].includes(String(value.fromStatus)) &&
    ['IN_PROGRESS', 'COMPLETED'].includes(String(value.toStatus)) &&
    string(value.actorMembershipId) &&
    (value.result === null || string(value.result)) &&
    string(value.occurredAt) && Number.isFinite(Date.parse(value.occurredAt))
}
export function validCancellation(value: unknown): value is ApiCancellationEvent {
  return record(value) && string(value.id) && string(value.workOrderId) &&
    string(value.actorMembershipId) &&
    ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(String(value.fromStatus)) &&
    string(value.reason) && value.reason.length >= 10 &&
    string(value.occurredAt) && Number.isFinite(Date.parse(value.occurredAt))
}
export function validClosure(value: unknown): value is ApiClosureEvent {
  return record(value) && string(value.id) && string(value.incidentId) &&
    string(value.actorMembershipId) &&
    ['UNDER_REVIEW', 'IN_PROGRESS'].includes(String(value.fromStatus)) &&
    string(value.reason) && (value.conclusion === null || string(value.conclusion)) &&
    ['orderCount', 'completedCount', 'cancelledCount'].every((key) =>
      Number.isSafeInteger(value[key]) && Number(value[key]) >= 0) &&
    Number(value.completedCount) + Number(value.cancelledCount) === Number(value.orderCount) &&
    string(value.closedAt) && Number.isFinite(Date.parse(value.closedAt))
}
export function invalid(): never {
  throw new Error('Respuesta inesperada del servidor. No se mostraron datos.')
}
