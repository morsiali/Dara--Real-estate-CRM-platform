// Fetch wrapper: same-origin cookies, CSRF header, consistent error objects.
export class ApiError extends Error {
  constructor(status, err = {}) {
    super(err.message || 'Request failed.');
    this.status = status; this.code = err.code || 'ERROR'; this.details = err.details || null; this.traceId = err.traceId;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, signal, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'dara', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, { code: 'NETWORK', message: 'Can’t reach the server. Check that Dara is running, then try again.' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) { location.href = '/?signin=expired#signin'; }
    throw new ApiError(res.status, data?.error);
  }
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE', body: {} });
