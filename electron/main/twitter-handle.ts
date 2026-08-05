const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/

export function normalizeTwitterHandle(input: string) {
  const handle = input.trim().replace(/^@/, '')
  if (!HANDLE_RE.test(handle)) throw new Error('Enter a valid X handle: 1-15 letters, numbers, or underscores.')
  return handle
}
