/** Main-process HTTP GET (avoids renderer CORS), with fetch fallback. */
export async function httpGet(url: string): Promise<{ status: number; body: string; error?: string }> {
  if (typeof window !== 'undefined' && window.cinevault?.torznab?.get) {
    return window.cinevault.torznab.get(url)
  }
  try {
    const res = await fetch(url)
    return { status: res.status, body: await res.text() }
  } catch (error) {
    return {
      status: 0,
      body: '',
      error: error instanceof Error ? error.message : 'Network request failed'
    }
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const { status, body, error } = await httpGet(url)
  if (status === 0) {
    throw new Error(error || 'Network request failed')
  }
  if (status >= 400) throw new Error(`Request failed (${status})`)
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error('Invalid JSON response')
  }
}
