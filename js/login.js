/* login.js - POST /api/auth/login */
(function () {
  if (getToken()) { location.href = 'chat.html'; return; }

  const form = document.getElementById('loginForm');
  const alertBox = document.getElementById('alertBox');
  const button = document.getElementById('submitBtn');

  const params = new URLSearchParams(location.search);
  if (params.get('registered')) showAlert(alertBox, 'Account created. Log in to start chatting.', 'success');
  if (params.get('expired')) showAlert(alertBox, 'Your session expired. Please log in again.', 'error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertBox);

    const usernameOrEmail = document.getElementById('usernameOrEmail').value.trim();
    const password = document.getElementById('password').value;
    if (!usernameOrEmail || !password) {
      showAlert(alertBox, 'Enter your username or email and your password.');
      return;
    }

    setLoading(button, true);
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ usernameOrEmail, password })
      });
      saveSession(data.token, data.user);
      location.href = 'chat.html';
    } catch (err) {
      showAlert(alertBox, err.message);          // e.g. "Invalid username/email or password"
      setLoading(button, false, 'Log in');
    }
  });
})();
