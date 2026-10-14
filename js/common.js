/* ==========================================================
   common.js - shared helpers used by every page
   ========================================================== */

// Backend address comes from js/config.js
const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.API_BASE) || 'http://localhost:8080').replace(/\/+$/, '');
const WS_URL = API_BASE + '/ws';

/* ---- session (JWT token + user profile are kept in localStorage) ---- */
function getToken() { return localStorage.getItem('chat_token'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('chat_user')); } catch (e) { return null; }
}
function saveSession(token, user) {
  localStorage.setItem('chat_token', token);
  localStorage.setItem('chat_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
}

/* ---- fetch wrapper: adds the JWT header, parses JSON, turns errors into Error objects ---- */
async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  } catch (e) {
    throw new Error('Cannot reach the server. Check that the backend is running on port 8080.');
  }

  // Token expired / invalid on a private endpoint -> back to login
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    clearSession();
    location.href = 'login.html?expired=1';
    throw new Error('Your session has expired. Please log in again.');
  }

  let body = null;
  try { body = await res.json(); } catch (e) { /* empty body (204) is fine */ }

  if (!res.ok) {
    const err = new Error((body && body.message) || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.fieldErrors = body && body.fieldErrors;
    throw err;
  }
  return body;
}

/* ---- small UI helpers ---- */
function showAlert(box, message, type) {
  box.textContent = message;
  box.className = 'alert alert-' + (type || 'error');
  box.hidden = false;
}
function hideAlert(box) { box.hidden = true; }

function setLoading(button, loading, idleText) {
  button.disabled = loading;
  button.textContent = loading ? 'Please wait…' : idleText;
}

function initials(name) {
  const parts = (name || '?').trim().split(/\s+/);
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
