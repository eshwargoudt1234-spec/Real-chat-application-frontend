const API = import.meta.env.VITE_API_URL;          // CRA: process.env.REACT_APP_API_URL

export async function api(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || 'Something went wrong');
  return body;
}

// Login example: save the token, then use it for every other call
export async function login(usernameOrEmail, password) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ usernameOrEmail, password }),
  });
  localStorage.setItem('token', data.token);       // data = { token, user }
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}