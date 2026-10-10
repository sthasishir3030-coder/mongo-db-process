/**
 * app.js - main page.
 * Checks the sign-in, shows the right top-right controls (visitor chip or
 * admin panel button), loads projects only if allowed, and runs the contact form.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let me = null; // the signed-in user

  /* ---------- small helpers ---------- */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v; // only used with trusted, hard-coded markup
      else if (k.includes('-')) node.setAttribute(k, v); // data-* and aria-*
      else node[k] = v;
    });
    [].concat(children).forEach((c) => c && node.appendChild(c));
    return node;
  }
  const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

  function signOut(redirect = true) {
    api('POST', '/api/logout').catch(() => {}).finally(() => {
      Auth.token = null;
      if (redirect) location.replace('login.html');
    });
  }

  function showFatal(message) {
    document.body.classList.remove('is-loading');
    document.body.innerHTML = '';
    document.body.appendChild(el('div', { class: 'fatal' }, [
      el('i', { class: 'fa-solid fa-plug-circle-exclamation' }),
      el('h2', { text: 'Could not load the site' }),
      el('p', { text: message }),
      el('button', { class: 'btn btn-primary', text: 'Try again', onclick: () => location.reload() }),
    ]));
  }

  /* ---------- top-right controls ---------- */
  function renderNav() {
    const box = $('navUser');
    box.innerHTML = '';

    if (me.role === 'admin') {
      const btn = el('button', { class: 'nav-admin', id: 'adminBtn', title: 'Open admin panel' }, [
        el('i', { class: 'fa-solid fa-user-shield' }),
        el('span', { text: 'Admin' }),
        el('span', { class: 'pending-dot hidden', id: 'pendingDot' }),
      ]);
      btn.addEventListener('click', openDrawer);
      box.append(btn);
    } else {
      box.append(el('div', { class: 'user-chip', title: `${me.name} · ${me.school}` }, [
        el('span', { class: 'avatar-mini', text: initials(me.name) }),
        el('span', { class: 'user-chip-name', text: me.name.split(' ')[0] }),
        el('i', { class: `fa-solid ${me.hasAccess ? 'fa-lock-open' : 'fa-lock'} user-chip-lock` }),
      ]));
    }
    box.append(el('button', { class: 'icon-btn', title: 'Sign out', 'aria-label': 'Sign out', onclick: () => signOut() },
      [el('i', { class: 'fa-solid fa-right-from-bracket' })]));
  }

  /* ---------- projects (server only sends them if you have access) ---------- */
  async function renderProjects() {
    const area = $('projectsArea');
    area.innerHTML = '';

    if (!me.hasAccess) {
      const ghost = el('div', { class: 'projects-grid ghost' });
      for (let i = 0; i < 4; i++) {
        ghost.append(el('div', { class: 'project-card shadow-card' }, [
          el('div', { class: 'project-banner' }),
          el('div', { class: 'project-body' }, [
            el('div', { class: 'ghost-line w60' }), el('div', { class: 'ghost-line' }), el('div', { class: 'ghost-line w80' }),
          ]),
        ]));
      }
      const recheck = el('button', { class: 'btn btn-secondary', id: 'recheck' }, [
        el('i', { class: 'fa-solid fa-rotate' }), el('span', { class: 'btn-label', text: 'Check access again' }),
      ]);
      recheck.addEventListener('click', () => withBusy(recheck, async () => {
        const { user } = await api('GET', '/api/me');
        me = user;
        renderNav();
        await renderProjects();
      }).catch((e) => { note.textContent = e.message; }));
      const note = el('p', { class: 'lock-note' });
      area.append(el('div', { class: 'locked-wrap' }, [
        ghost,
        el('div', { class: 'locked-card shadow-card' }, [
          el('div', { class: 'lock-icon' }, [el('i', { class: 'fa-solid fa-lock' })]),
          el('h3', { text: 'Projects are private' }),
          el('p', { text: `Hi ${me.name.split(' ')[0]}, your details have been saved. Sishir needs to give you access before you can view the project work.` }),
          recheck, note,
        ]),
      ]));
      return;
    }

    try {
      const { projects } = await api('GET', '/api/projects');
      const grid = el('div', { class: 'projects-grid' });
      projects.forEach((p) => {
        grid.append(el('div', { class: 'project-card shadow-card' }, [
          el('div', { class: `project-banner ${p.banner || ''}` }, [el('i', { class: `fa-solid ${p.icon}` })]),
          el('div', { class: 'project-body' }, [
            el('h3', { text: p.title }),
            el('p', { text: p.description }),
            el('div', { class: 'project-tech' }, p.tech.map((t) => el('span', { text: t }))),
          ]),
        ]));
      });
      area.append(grid);
    } catch (e) {
      area.append(el('p', { class: 'lock-note', text: e.message }));
    }
  }

  /* ---------- admin drawer ---------- */
  let visitors = [];
  const say = (msg, isError = false) => {
    const m = $('adminMsg');
    m.textContent = msg;
    m.classList.toggle('error', isError);
  };

  function openDrawer() {
    $('adminDrawer').classList.add('open');
    $('drawerBackdrop').classList.add('open');
    $('adminDrawer').setAttribute('aria-hidden', 'false');
    loadVisitors();
  }
  function closeDrawer() {
    $('adminDrawer').classList.remove('open');
    $('drawerBackdrop').classList.remove('open');
    $('adminDrawer').setAttribute('aria-hidden', 'true');
  }

  async function loadVisitors() {
    try {
      ({ visitors } = await api('GET', '/api/admin/visitors'));
      renderAdmin();
    } catch (e) { say(e.message, true); }
  }

  function renderAdmin() {
    const withAccess = visitors.filter((v) => v.hasAccess).length;
    const pending = visitors.length - withAccess;

    $('adminStats').innerHTML = '';
    [['Signed in', visitors.length], ['Have access', withAccess], ['Waiting', pending]].forEach(([label, n]) =>
      $('adminStats').append(el('div', { class: 'stat' }, [el('strong', { text: n }), el('span', { text: label })])));
    $('pendingDot').classList.toggle('hidden', pending === 0);

    // "choose" dropdown: only people without access yet
    const select = $('grantSelect');
    select.innerHTML = '';
    const waiting = visitors.filter((v) => !v.hasAccess);
    if (!waiting.length) {
      select.append(el('option', { text: 'No one is waiting', value: '' }));
    } else {
      select.append(el('option', { text: 'Choose a person...', value: '' }));
      waiting.forEach((v) => select.append(el('option', { value: v.id, text: `${v.name} - ${v.school} (${v.age})` })));
    }
    select.disabled = $('grantBtn').disabled = !waiting.length;

    // list
    const q = $('visitorSearch').value.trim().toLowerCase();
    const list = $('visitorList');
    list.innerHTML = '';
    const shown = visitors.filter((v) => !q || `${v.name} ${v.school}`.toLowerCase().includes(q));
    if (!shown.length) list.append(el('li', { class: 'empty', text: visitors.length ? 'No matches.' : 'Nobody has signed in yet.' }));
    shown.forEach((v) => {
      list.append(el('li', { class: 'visitor' }, [
        el('span', { class: 'avatar-mini', text: initials(v.name) }),
        el('div', { class: 'visitor-info' }, [
          el('strong', { text: v.name }),
          el('small', { text: `${v.school} · age ${v.age} · joined ${fmtDate(v.createdAt)}` }),
        ]),
        el('button', {
          class: `pill ${v.hasAccess ? 'on' : 'off'}`, 'data-act': 'toggle', 'data-id': v.id,
          title: v.hasAccess ? 'Click to remove access' : 'Click to give access',
          text: v.hasAccess ? 'Has access' : 'Give access',
        }),
        el('button', { class: 'icon-btn danger', 'data-act': 'delete', 'data-id': v.id, title: 'Remove person', 'aria-label': `Remove ${v.name}` },
          [el('i', { class: 'fa-solid fa-trash' })]),
      ]));
    });
  }

  async function grant(id, value) {
    try {
      await api('PATCH', `/api/admin/visitors/${id}`, { hasAccess: value });
      say(value ? 'Access granted.' : 'Access removed.');
      await loadVisitors();
    } catch (e) { say(e.message, true); }
  }

  function initAdmin() {
    $('drawerClose').addEventListener('click', closeDrawer);
    $('drawerBackdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    $('visitorSearch').addEventListener('input', renderAdmin);

    $('grantBtn').addEventListener('click', () => {
      const id = $('grantSelect').value;
      if (!id) return say('Choose a person first.', true);
      withBusy($('grantBtn'), () => grant(id, true));
    });

    $('visitorList').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const v = visitors.find((x) => x.id === btn.dataset.id);
      if (!v) return;
      if (btn.dataset.act === 'toggle') grant(v.id, !v.hasAccess);
      if (btn.dataset.act === 'delete' && confirm(`Remove ${v.name} completely?`)) {
        api('DELETE', `/api/admin/visitors/${v.id}`).then(() => { say('Person removed.'); loadVisitors(); }).catch((err) => say(err.message, true));
      }
    });

    $('addPersonForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      withBusy(btn, async () => {
        try {
          const { visitor } = await api('POST', '/api/admin/visitors', {
            name: $('apName').value, school: $('apSchool').value, age: $('apAge').value,
          });
          say(`${visitor.name} added with project access.`);
          e.target.reset();
          await loadVisitors();
        } catch (err) { say(err.message, true); }
      });
    });

    $('passwordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      withBusy(btn, async () => {
        try {
          const { token } = await api('POST', '/api/admin/password', { current: $('pwCurrent').value, next: $('pwNew').value });
          Auth.token = token;
          say('Password updated.');
          e.target.reset();
          $('defaultPwWarn')?.remove();
        } catch (err) { say(err.message, true); }
      });
    });

    if (me.isDefaultPassword) {
      $('adminStats').before(el('div', { class: 'warn', id: 'defaultPwWarn' }, [
        el('i', { class: 'fa-solid fa-triangle-exclamation' }),
        el('span', { text: 'You are using the default password. Please change it below.' }),
      ]));
    }
    loadVisitors(); // fills the "waiting" dot right away
  }

  /* ---------- contact form ---------- */
  function initContact() {
    const form = $('contactForm');
    const status = $('cfStatus');
    const btn = $('cfSubmit');
    const msg = $('cfMessage');

    if (me.role === 'visitor') $('cfName').value = me.name;

    msg.addEventListener('input', () => { $('cfCounter').textContent = `${msg.value.length} / 600`; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      status.className = 'cf-status';
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      data.subject = `${data.subject_prefix}: ${data.subject || 'New message'}`;
      if (me.role === 'visitor') data.message += `\n\n-- Sent by ${me.name}, ${me.school}, age ${me.age}`;
      delete data.subject_prefix;

      withBusy(btn, async () => {
        try {
          const res = await fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json();
          if (!res.ok || !json.success) throw new Error(json.message || 'Could not send.');
          status.textContent = 'Thank you! Your message was sent.';
          status.className = 'cf-status ok';
          form.reset();
          if (me.role === 'visitor') $('cfName').value = me.name;
          $('cfCounter').textContent = '0 / 600';
        } catch (err) {
          status.textContent = 'Sorry, the message could not be sent. Please try again.';
          status.className = 'cf-status bad';
        }
      });
    });
  }

  /* ---------- page extras ---------- */
  function initPhoto() {
    $('photoUploader').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => { $('profileImage').src = ev.target.result; };
      reader.readAsDataURL(file);
    });
  }

  function initNavBehaviour() {
    const links = document.querySelector('.nav-links');
    $('menuToggle').addEventListener('click', () => links.classList.toggle('open'));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) links.classList.remove('open'); });

    const anchors = [...links.querySelectorAll('a')];
    const sections = anchors.map((a) => document.querySelector(a.getAttribute('href')));
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        anchors.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => s && obs.observe(s));
  }

  /* ---------- start ---------- */
  (async function start() {
    if (!Auth.token) return location.replace('login.html');
    try {
      ({ user: me } = await api('GET', '/api/me'));
    } catch (e) {
      if (e.network) return showFatal(e.message);
      Auth.token = null;
      return location.replace('login.html');
    }
    renderNav();
    initPhoto();
    initNavBehaviour();
    initContact();
    await renderProjects();
    if (me.role === 'admin') initAdmin();
    document.body.classList.remove('is-loading');
  })();
})();
