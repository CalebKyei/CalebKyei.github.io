// Lists public, non-fork GitHub repositories live from the GitHub API (60 requests/hour per
// visitor, no token). The section stays hidden when there is nothing to show or the API fails.
(() => {
  'use strict';
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  const section = document.getElementById('code');
  const list = document.getElementById('repos');
  if (!section || !list || !window.fetch) return;

  const user = 'CalebKyei';
  const site = (user + '.github.io').toLowerCase();
  const el = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  fetch('https://api.github.com/users/' + user + '/repos?per_page=100&sort=pushed', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((repos) => {
      const shown = repos
        .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== site)
        .filter((r) => /^https:\/\/github\.com\//.test(r.html_url))
        .slice(0, 6);
      for (const r of shown) {
        const card = el('a', null, 'repo');
        card.href = r.html_url;
        card.append(el('strong', r.name), el('p', r.description || ''));
        const bits = [
          r.language,
          r.stargazers_count ? '★ ' + r.stargazers_count : null,
          'updated ' + new Date(r.pushed_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' }),
        ];
        card.append(el('small', bits.filter(Boolean).join(' · ')));
        list.append(card);
      }
      section.hidden = shown.length === 0;
    })
    .catch(() => { /* keep the section hidden */ });
})();
