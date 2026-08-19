import type { CodeHighlighterPlugin, ThemeInput } from '@streamdown/code'
import type { BundledLanguage } from 'shiki'
import { createHighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'
import bash from '@shikijs/langs/bash'
import css from '@shikijs/langs/css'
import html from '@shikijs/langs/html'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import markdown from '@shikijs/langs/markdown'
import python from '@shikijs/langs/python'
import sql from '@shikijs/langs/sql'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import xml from '@shikijs/langs/xml'
import yaml from '@shikijs/langs/yaml'
import githubLight from '@shikijs/themes/github-light'
import githubDark from '@shikijs/themes/github-dark'

const CURATED_LANGUAGES = [
  'bash',
  'css',
  'html',
  'javascript',
  'json',
  'markdown',
  'python',
  'sql',
  'tsx',
  'typescript',
  'xml',
  'yaml',
] as const

const LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  js: 'javascript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  md: 'markdown',
  yml: 'yaml',
  ts: 'typescript',
}

const themes: [ThemeInput, ThemeInput] = ['github-light', 'github-dark']
let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null

function normalizeLanguage(language: string): BundledLanguage {
  const normalized = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] || (CURATED_LANGUAGES.includes(normalized as typeof CURATED_LANGUAGES[number])
    ? normalized as BundledLanguage
    : 'text')
}

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      langs: [bash, css, html, javascript, json, markdown, python, sql, tsx, typescript, xml, yaml],
      themes: [githubLight, githubDark],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  }
  return highlighterPromise
}

export const curatedCodePlugin: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => [...CURATED_LANGUAGES] as BundledLanguage[],
  getThemes: () => themes,
  supportsLanguage: (language) => CURATED_LANGUAGES.includes(normalizeLanguage(language) as typeof CURATED_LANGUAGES[number]),
  highlight: (options, callback) => {
    void getHighlighter()
      .then((highlighter) => highlighter.codeToTokens(options.code, {
        lang: normalizeLanguage(options.language),
        themes: {
          light: options.themes[0],
          dark: options.themes[1],
        },
      }))
      .then((result) => callback?.(result))
      .catch(() => {
        // Streamdown keeps the original code block when highlighting fails.
      })
    return null
  },
}
