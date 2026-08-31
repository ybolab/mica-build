import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MonitorCog, Power, RefreshCcw, RotateCcw } from 'lucide-react'
import { api, errorMessage, json } from '@/lib/api'
import type { TaskAccepted, UiStatus } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { Status } from '@/components/ui/status'
import { TaskProgress } from '@/components/task-progress'

function SystemPage() {
  return (
    <div className="page">
      <header className="page-head"><div><p className="eyebrow">Appliance</p><h1>System</h1><p>Identity, UI selection and explicit power actions.</p></div></header>
      <div className="split-grid"><HostnamePanel /><UiPanel /></div>
      <PowerPanel />
    </div>
  )
}

function HostnamePanel() {
  const queryClient = useQueryClient()
  const hostname = useQuery({ queryKey: ['settings', 'hostname'], queryFn: () => api<string>('/api/v1/settings/hostname') })
  const [draft, setDraft] = useState<string>()
  const update = useMutation({
    mutationFn: (value: string) => api<TaskAccepted>('/api/v1/settings/hostname', json('PUT', value)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'hostname'] }),
  })
  const value = draft ?? hostname.data ?? ''
  return (
    <Card>
      <CardHeader title="Device identity" description="Hostname used by local services and discovery." />
      <form className="grid gap-4" onSubmit={(event: FormEvent) => { event.preventDefault(); update.mutate(value) }}>
        <Field label="Hostname"><Input value={value} onChange={(event) => setDraft(event.target.value)} required /></Field>
        <Button type="submit" disabled={update.isPending || !draft}>Save hostname</Button>
        <TaskProgress taskId={update.data?.taskId} />
        {update.error ? <p className="callout error" role="alert">{errorMessage(update.error)}</p> : null}
      </form>
    </Card>
  )
}

function UiPanel() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['ui-status'], queryFn: () => api<UiStatus>('/api/v1/ui') })
  const deactivate = useMutation({
    mutationFn: () => api<UiStatus>('/api/v1/ui/active', { method: 'DELETE' }),
    onSuccess: (value) => queryClient.setQueryData(['ui-status'], value),
  })
  const custom = status.data?.custom
  return (
    <Card>
      <CardHeader title="User interface" description="The built-in SPA always remains available at /ui." action={<MonitorCog className="size-5 text-muted-foreground" />} />
      <div className="service-state"><Status ok={status.data?.mode === 'builtIn'}>{status.data?.mode === 'custom' ? 'custom UI active' : 'built-in UI active'}</Status></div>
      {custom ? <dl className="details"><div><dt>Bundle</dt><dd>{custom.name ?? `generation ${custom.generation}`} {custom.version}</dd></div><div><dt>Index</dt><dd>{custom.indexReadable ? 'readable' : 'unreadable'}</dd></div><div><dt>Digest</dt><dd>{custom.digestMatches === false ? 'changed' : 'verified'}</dd></div></dl> : null}
      {status.data?.mode === 'custom' ? <Button variant="secondary" onClick={() => deactivate.mutate()} disabled={deactivate.isPending}><RotateCcw className="size-4" /> Use built-in UI at root</Button> : null}
      {deactivate.error ? <p className="callout error" role="alert">{errorMessage(deactivate.error)}</p> : null}
    </Card>
  )
}

function PowerPanel() {
  const action = useMutation({ mutationFn: (name: 'reboot' | 'poweroff') => api<void>(`/api/v1/actions/${name}`, { method: 'POST' }) })
  const run = (name: 'reboot' | 'poweroff') => {
    const message = name === 'reboot' ? 'Reboot this appliance now?' : 'Power off this appliance now?'
    if (window.confirm(message)) action.mutate(name)
  }
  return (
    <Card>
      <CardHeader title="Power" description="These actions are dispatched immediately. The connection may close before the device changes state." action={<Power className="size-5 text-muted-foreground" />} />
      <div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={() => run('reboot')} disabled={action.isPending}><RefreshCcw className="size-4" /> Reboot</Button><Button variant="danger" onClick={() => run('poweroff')} disabled={action.isPending}><Power className="size-4" /> Power off</Button></div>
      {action.isSuccess ? <p className="callout success" role="status">Power action accepted.</p> : null}
      {action.error ? <p className="callout error" role="alert">{errorMessage(action.error)}</p> : null}
    </Card>
  )
}

export const Route = createFileRoute('/system')({ component: SystemPage })
