const PREFIX = '[soxial]'

const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const
const currentLevel = (process.env.LOG_LEVEL || 'info') as keyof typeof levels

const sensitiveKey = /api[_-]?key|token|secret|password|cookie|prompt|attachment|content/i

function redactString(value: string): string {
  return value
    .replace(/((?:api[_ -]?key|token|secret|password|cookie)\s*[:=]\s*)\S+/gi, '$1[redacted]')
    .replace(/(authorization\s*:\s*bearer\s+)\S+/gi, '$1[redacted]')
    .slice(0, 2000)
}

function redactData(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[redacted]' : redactData(item),
  ]))
}

function log(level: keyof typeof levels, tag: string, msg: string, data?: any) {
  if (levels[level] < levels[currentLevel]) return
  const ts = new Date().toISOString().slice(11, 23)
  const prefix = `${PREFIX}[${tag}]`
  const safeMessage = redactString(msg)
  if (data !== undefined) {
    console[level === 'error' ? 'error' : 'log'](`${ts} ${prefix} ${safeMessage}`, redactData(data))
  } else {
    console[level === 'error' ? 'error' : 'log'](`${ts} ${prefix} ${safeMessage}`)
  }
}

export const logger = {
  debug: (tag: string, msg: string, data?: any) => log('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: any) => log('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: any) => log('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: any) => log('error', tag, msg, data),
}
