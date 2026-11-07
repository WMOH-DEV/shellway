import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { CONTAINERS, DISK_USAGE, IMAGES, STATE_GROUP } from '@/utils/server/docker/fixtures/output'
import { parseContainers } from '@/utils/server/docker/containers'
import { parseImages } from '@/utils/server/docker/images'
import { parseDiskUsage } from '@/utils/server/docker/resources'
import { parseDockerState } from '@/utils/server/docker/state'
import type { ServerSectionContext } from '../types'
import { DockerSection } from './DockerSection'

const launch = vi.fn()
vi.mock('@/components/server/action', () => ({ useActionLauncher: () => ({ launch }) }))

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 0 })

const ctx: ServerSectionContext = {
  tabId: 'tab-1',
  connectionId: 'conn-1',
  sessionId: 'session-1',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'docker' },
  active: true,
  navigate: vi.fn()
}

function mockServer(facts: ServerFacts) {
  Object.defineProperty(window, 'novadeck', {
    configurable: true,
    value: {
      deploy: { list: vi.fn().mockResolvedValue({ success: true, data: [{ config: { name: 'status.example.com', path: '/srv/status' } }] }) },
      server: {
        scan: vi.fn().mockResolvedValue({ success: true, data: facts }),
        onFacts: () => () => {},
        docker: { startLogs: vi.fn(), stopLogs: vi.fn(), onLogData: () => () => {}, onLogEnd: () => () => {}, manifest: vi.fn() }
      }
    }
  })
}

describe('DockerSection', () => {
  beforeEach(() => launch.mockClear())

  it('offers to install Docker when it is missing', async () => {
    mockServer({ 'docker.state': ok(parseDockerState('@@missing\n')) })
    render(<DockerSection ctx={ctx} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Install Docker' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'software.install', params: { component: 'docker' } }))
  })

  it('groups stacks, links the site and warns about public ports', async () => {
    mockServer({
      'docker.state': ok(parseDockerState(STATE_GROUP)),
      'docker.containers': ok(parseContainers(CONTAINERS)),
      'docker.images': ok(parseImages(IMAGES)),
      'docker.df': ok(parseDiskUsage(DISK_USAGE))
    })
    render(<DockerSection ctx={ctx} />)
    expect(await screen.findByRole('region', { name: 'status' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'status.example.com' })).toBeInTheDocument()
    expect(screen.getByText('A container is open to the internet')).toBeInTheDocument()
    expect(screen.getByText('Docker 27.3.1 · Compose v2.29.7 · 3.5 GB of images')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'docker.container', params: { op: 'restart', name: 'web' } }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Pull & recreate' })[0])
    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'docker.compose', params: { op: 'pull', project: 'status' } }))
  })

  it('previews the run command before running', async () => {
    mockServer({ 'docker.state': ok(parseDockerState(STATE_GROUP)), 'docker.containers': ok(parseContainers(CONTAINERS)) })
    render(<DockerSection ctx={ctx} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run an image' }))
    fireEvent.change(screen.getByLabelText('Image and tag'), { target: { value: 'acme/api:2.1' } })
    fireEvent.blur(screen.getByLabelText('Image and tag'))
    fireEvent.change(screen.getByLabelText('Server port'), { target: { value: '8081' } })
    fireEvent.change(screen.getByLabelText('Container port'), { target: { value: '8080' } })
    expect(screen.getByText('docker run -d --name api --restart unless-stopped -p 127.0.0.1:8081:8080 acme/api:2.1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'docker.run', params: expect.objectContaining({ name: 'api', image: 'acme/api', tag: '2.1' }) }))
  })
})
