import { useEffect, useReducer, useState } from 'react'
import type { DemoOrganization } from '@/app/types'
import { mockIncidentRepository } from './mock-repository'
import type { IncidentView } from './types'

interface IncidentState {
  organization: DemoOrganization
  records: IncidentView[]
  loading: boolean
  error: string | null
}

export function useIncidents(organization: DemoOrganization) {
  const [revision, refresh] = useReducer((current: number) => current + 1, 0)
  const [state, setState] = useState<IncidentState>({
    organization, records: [], loading: true, error: null,
  })

  useEffect(() => {
    let active = true
    void mockIncidentRepository.list(organization).then((records) => {
      if (active) setState({ organization, records, loading: false, error: null })
    }).catch(() => {
      if (active) setState({ organization, records: [], loading: false, error: 'No se pudo cargar la información.' })
    })
    return () => { active = false }
  }, [organization, revision])

  // Prevent a previous organization's rows from flashing during a context change.
  if (state.organization !== organization) {
    return { records: [], loading: true, error: null, refresh }
  }
  return { records: state.records, loading: state.loading, error: state.error, refresh }
}
