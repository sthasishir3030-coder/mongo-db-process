/** login.js - visitor + admin sign-in */
(async function () {
  const $ = (id) => document.getElementById(id);

  // Already signed in? Go straight to the site.
  if (Auth.token) {
    try { await api('GET', '/api/me'); location.replace('index.html'); return; }
    catch { Auth.token = null; }
  }

  /* tabs */
  const tabs = { visitor: [$('tabVisitor'), $('visitorForm')], admin: [$('tabAdmin'), $('adminForm')] };
  function showTab(name) {
    Object.entries(tabs).forEach(([key, [tab, form]]) => {
      const on = key === name;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on);
      form.classList.toggle('hidden', !on);
    });
    $('visitorError').textContent = '';
    $('adminError').textContent = '';
  }
  $('tabVisitor').addEventListener('click', () => showTab('visitor'));
  $('tabAdmin').addEventListener('click', () => showTab('admin'));

  /* shared submit handler */
  function wire(form, errorEl, getBody, endpoint) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const button = form.querySelector('button[type="submit"]');
      withBusy(button, async () => {
        try {
          const { token } = await api('POST', endpoint, getBody());
          Auth.token = token;
          location.replace('index.html');
        } catch (err) {
          errorEl.textContent = err.message;
        }
      });
    });
  }

  wire($('visitorForm'), $('visitorError'), () => ({
    name: $('vName').value, school: $('vSchool').value, age: $('vAge').value,
  }), '/api/login/visitor');

  wire($('adminForm'), $('adminError'), () => ({
    username: $('aUser').value, password: $('aPass').value,
  }), '/api/login/admin');

  /* show / hide password */
  $('revealPass').addEventListener('click', () => {
    const input = $('aPass');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('revealPass').innerHTML = `<i class="fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
  });

  // ?admin in the address opens the admin tab directly
  if (location.search.includes('admin')) showTab('admin');
})();
