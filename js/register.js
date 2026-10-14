/* register.js - POST /api/auth/register */
(function () {
  if (getToken()) { location.href = 'chat.html'; return; }

  const form = document.getElementById('registerForm');
  const alertBox = document.getElementById('alertBox');
  const button = document.getElementById('submitBtn');
  const fields = ['name', 'username', 'email', 'password', 'confirmPassword'];

  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  }
  function setFieldError(field, message) {
    const el = document.querySelector('.field-error[data-for="' + field + '"]');
    if (el) el.textContent = message;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertBox);
    clearFieldErrors();

    const payload = {};
    fields.forEach(f => payload[f] = document.getElementById(f).value);
    payload.name = payload.name.trim();
    payload.username = payload.username.trim();
    payload.email = payload.email.trim();

    // quick checks in the browser (the server validates everything again)
    if (payload.password !== payload.confirmPassword) {
      setFieldError('confirmPassword', 'Passwords do not match');
      return;
    }

    setLoading(button, true);
    try {
      await apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
      location.href = 'login.html?registered=1';
    } catch (err) {
      if (err.fieldErrors) Object.keys(err.fieldErrors).forEach(f => setFieldError(f, err.fieldErrors[f]));
      showAlert(alertBox, err.message);            // e.g. "Username is already taken"
      setLoading(button, false, 'Create account');
    }
  });
})();
