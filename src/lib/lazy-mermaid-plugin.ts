import type { DiagramPlugin, MermaidConfig, MermaidInstance } from '@streamdown/mermaid'

export const lazyMermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid: (config?: MermaidConfig): MermaidInstance => ({
    initialize: () => {},
    render: async (id: string, source: string) => {
      const { createMermaidPlugin } = await import('@streamdown/mermaid')
      return createMermaidPlugin({ config }).getMermaid(config).render(id, source)
    },
  }),
}
