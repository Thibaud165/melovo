// Client API minimal : JSON par défaut, FormData supporté, erreurs en français.

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) {
    opts.body = body; // le navigateur pose le boundary multipart lui-même
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('Serveur injoignable. Vérifiez la connexion au Pi.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) {
    // Session expirée -> retour à l'écran de connexion (sauf pendant le login lui-même)
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      document.dispatchEvent(new CustomEvent('melovo:unauthorized'));
    }
    throw new ApiError(data?.error ?? `Erreur ${res.status}`, res.status);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};
