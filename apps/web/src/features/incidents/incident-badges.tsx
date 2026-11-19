import { Badge } from '@/components/ui/badge'
import type { IncidentPriority, IncidentStatus } from './types'

const statuses: Record<IncidentStatus, { label: string; className: string }> = {
  REPORTED: { label: 'Reportada', className: 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  UNDER_REVIEW: { label: 'En revisión', className: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  IN_PROGRESS: { label: 'En curso', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  CLOSED: { label: 'Cerrada', className: 'border-border bg-secondary text-muted-foreground' },
}

const priorities: Record<IncidentPriority, { label: string; className: string }> = {
  CRITICAL: { label: 'Crítica', className: 'border-red-400/30 bg-red-500/10 text-red-700 dark:text-red-300' },
  HIGH: { label: 'Alta', className: 'border-orange-400/30 bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  MEDIUM: { label: 'Media', className: 'border-border bg-secondary text-foreground' },
  LOW: { label: 'Baja', className: 'border-border bg-secondary text-muted-foreground' },
}

export function StatusBadge({ value }: { value: IncidentStatus }) {
  const status = statuses[value]
  return <Badge className={status.className} variant="outline">{status.label}</Badge>
}

export function PriorityBadge({ value }: { value: IncidentPriority }) {
  const priority = priorities[value]
  return <Badge className={priority.className} variant="outline">{priority.label}</Badge>
}
