// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// framer-motion's projection layer expects a real browser document. These
// tests assert navigation behaviour, not animation, so collapse motion to
// identity elements.
vi.mock('motion/react', () => import('./helpers/human-ui-mocks').then((m) => m.motionReactMock))
import Sidebar from 'src/components/Sidebar'
import HumanPage from 'src/features/human'

// Sidebar header reads window.api.platform for the macOS inset; HumanPage's
// feed tab now fetches through window.api.humanFeed (stubbed to an empty page).
beforeEach(() => {
  ;(globalThis as any).window = {
    api: {
      platform: 'linux',
      humanFeed: async () => ({ ok: true, data: { items: [], hasMore: false } }),
      humanProfile: async () => ({ ok: true, data: { screenName: 'me', name: 'Me' } }),
      humanProfilePosts: async () => ({ ok: true, data: { items: [], hasMore: false } }),
      humanBookmarks: async () => ({ ok: true, data: { items: [], hasMore: false } }),
      humanVerifySession: async () => ({ ok: true, data: { authenticated: true, user: null } }),
    },
  }
})

// No vitest globals → no RTL auto-cleanup; do it explicitly.
afterEach(cleanup)

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const props = {
    sessions: [{ id: 1, title: 'Chat 1', msg_count: 2, updated_at: '2026-08-27T00:00:00Z' }],
    currentSessionId: 1,
    currentView: 'chat' as const,
    streaming: false,
    profile: { name: 'Test User' },
    scheduledCount: 0,
    mode: 'agent' as const,
    onModeChange: vi.fn(),
    humanTab: 'feed' as const,
    onHumanTabChange: vi.fn(),
    onNewChat: vi.fn(),
    onSelectSession: vi.fn(),
    onDeleteSession: vi.fn(),
    onNavigate: vi.fn(),
    onToggleSidebar: vi.fn(),
    ...overrides,
  }
  render(<Sidebar {...props} />)
  return props
}

describe('Human Mode UI — window API / component seam', () => {
  it('shows the Agent/Human toggle in chat sidebar state and switches modes', () => {
    const props = renderSidebar()
    expect(screen.getByRole('button', { name: /agent/i })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /human/i }))
    expect(props.onModeChange).toHaveBeenCalledWith('human')
  })

  it('shows the Agent/Human toggle in settings sidebar state too', () => {
    renderSidebar({ currentView: 'profile' })
    expect(screen.getByRole('button', { name: /agent/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /human/i })).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('swaps the sidebar body to Human navigation in human mode and switches tabs', () => {
    const props = renderSidebar({ mode: 'human' })
    // Human nav items present, chat session list gone
    expect(screen.getByRole('button', { name: /bookmarks/i })).toBeTruthy()
    expect(screen.queryByText('Chat 1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(props.onHumanTabChange).toHaveBeenCalledWith('search')
  })

  it('locks the toggle and navigation while a rebuild runs', () => {
    renderSidebar({ disabled: true })
    expect(screen.getByText('Navigation locked')).toBeTruthy()
    expect((screen.getByRole('button', { name: /human/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders HumanPage content for the active tab without its own top bar', async () => {
    const { rerender } = render(<HumanPage activeTab="feed" onTabChange={vi.fn()} />)
    expect(await screen.findByText('No posts yet')).toBeTruthy()
    // Navigation now lives in the Sidebar — HumanPage should not render the top tab bar
    expect(screen.queryByRole('button', { name: /^bookmarks$/i })).toBeNull()

    rerender(<HumanPage activeTab="bookmarks" onTabChange={vi.fn()} />)
    expect(await screen.findByText('No bookmarks')).toBeTruthy()

    // disabled prop still renders content (no top-bar to lock)
    rerender(<HumanPage activeTab="bookmarks" disabled />)
    expect(await screen.findByText('No bookmarks')).toBeTruthy()
  })
})
