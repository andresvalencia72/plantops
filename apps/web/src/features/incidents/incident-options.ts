import type { IncidentPriority, IncidentStatus } from './types'

export const statusOptions: { value: IncidentStatus; label: string }[] = [
  { value: 'REPORTED', label: 'Reportada' },
  { value: 'UNDER_REVIEW', label: 'En revisión' },
  { value: 'IN_PROGRESS', label: 'En curso' },
  { value: 'CLOSED', label: 'Cerrada' },
]

export const priorityOptions: { value: IncidentPriority; label: string }[] = [
  { value: 'CRITICAL', label: 'Crítica' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'LOW', label: 'Baja' },
]
