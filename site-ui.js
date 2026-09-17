(() => {
  'use strict';
  const root = document.documentElement;
  const key = 'aqartkom_theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => value === 'dark' || value === 'light';
  let preference;
  try { preference = localStorage.getItem(key); } catch (_) { /* Private browsing can block storage. */ }
  let toggle;
  const icons = {
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 13.1A9 9 0 0 1 10.9 3.2 9 9 0 1 0 20.8 13.1Z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>',
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 3 2.4 5-2.6 2a15 15 0 0 0 6.7 6.7l2-2.6 5 2.4-.8 3.5c-.2.8-1 1.3-1.8 1.2C10.2 20.3 3.7 13.8 2.8 5.6c-.1-.8.4-1.6 1.2-1.8L7.5 3Z"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3.5A11.8 11.8 0 0 0 12.1 0C5.6 0 .3 5.3.3 11.8c0 2.1.5 4.1 1.6 5.9L.2 24l6.4-1.7a11.8 11.8 0 0 0 5.6 1.4c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.5-8.4Zm-8.4 18.2a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.8 9.8 0 0 1-1.5-5.2c0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8-4.3 9.9-9.7 9.9Zm5.4-7.3c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.2-.2.3-.8.9-1 1.1-.2.2-.4.2-.7.1-.3-.1-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.6.3-.5c.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.4 1.1 2.8 1.2 3c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4Z"/></svg>'
  };
  function applyTheme() {
    const dark = valid(preference) ? preference === 'dark' : systemTheme.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    if (toggle) {
      const label = dark ? 'التصفح النهاري' : 'التصفح الليلي';
      toggle.innerHTML = '<span class="site-icon" aria-hidden="true">' + icons[dark ? 'sun' : 'moon'] + '</span><span class="theme-label">التصفح الليلي</span>';
      toggle.setAttribute('aria-label', 'التصفح الليلي');
      toggle.setAttribute('aria-pressed', String(dark));
      toggle.title = 'تفعيل ' + label;
    }
  }
  // Apply the preference before the body is painted.
  applyTheme();
  systemTheme.addEventListener('change', () => { if (!valid(preference)) applyTheme(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = event.newValue; applyTheme(); }
  });

  function decorateContact(link) {
    const href = link.getAttribute('href') || '';
    let kind = href.startsWith('tel:') ? 'call' : null;
    if (!kind) {
      try { const url = new URL(href, location.href); if (url.protocol === 'https:' && ['wa.me', 'api.whatsapp.com'].includes(url.hostname)) kind = 'whatsapp'; } catch (_) { return; }
    }
    if (!kind) return;
    const other = kind === 'call' ? 'whatsapp' : 'call';
    link.classList.remove('contact-link--' + other);
    link.classList.add('contact-link', 'contact-link--' + kind);
    const existing = link.querySelector('[data-contact-icon]');
    if (existing?.dataset.contactIcon === kind) return;
    existing?.remove();
    const icon = document.createElement('span');
    icon.className = 'site-icon'; icon.dataset.contactIcon = kind; icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = icons[kind];
    if (!link.textContent.trim() && !link.getAttribute('aria-label')) link.setAttribute('aria-label', kind === 'call' ? 'اتصال هاتفي' : 'تواصل عبر واتساب');
    link.prepend(icon);
  }
  function decorateWithin(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches('a[href]')) decorateContact(node);
      node.querySelectorAll('a[href]').forEach(decorateContact);
    }
  }
  function initialize() {
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.id = 'themeToggle'; toggle.className = 'theme-toggle';
    const host = document.getElementById('siteNav') || document.querySelector('header .head-actions,header .view-actions,header .property-actions,header .container.nav,header nav,header > div:not(.brand)') || document.querySelector('header');
    if (host) host.append(toggle);
    else { toggle.classList.add('theme-toggle-floating'); document.body.append(toggle); }
    toggle.addEventListener('click', () => {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, preference); } catch (_) { /* Toggling still works without persistence. */ }
      applyTheme();
    });
    applyTheme();
    if(host&&!document.querySelector('a[href="/sol.html"]')){const link=document.createElement('a');link.href='/sol.html';link.textContent='✦ سول';link.className='sol-entry';host.append(link);}
    decorateWithin(document.body);
    // Contact links also arrive through pagination, property details and modal rendering.
    new MutationObserver(records => {
      for (const record of records) {
        const link = record.target.nodeType === Node.ELEMENT_NODE ? record.target.closest('a[href]') : record.target.parentElement?.closest('a[href]');
        if (link) decorateContact(link);
        record.addedNodes.forEach(decorateWithin);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
