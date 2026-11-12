import type { IncidentPriority } from './types'

// Only the severity line uses strong color; the status label remains textual.
export const priorityMarker: Record<IncidentPriority, string> = {
  CRITICAL: 'bg-red-500',
  HIGH: 'bg-amber-500',
  MEDIUM: 'bg-border',
  LOW: 'bg-border',
}
