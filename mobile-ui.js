(() => {
  const mobile = window.matchMedia('(max-width: 800px)');
  const menus = new Set();
  function closeMenus(except) {
    if (!mobile.matches) return;
    for (const menu of menus) {
      if (!menu.isConnected) { menus.delete(menu); continue; }
      if (menu !== except) menu.open = false;
    }
  }
  function register(menu) {
    menus.add(menu);
    menu.open = !mobile.matches;
    menu.addEventListener('toggle', () => { if (menu.open) closeMenus(menu); });
    menu.addEventListener('click', event => {
      if (mobile.matches && event.target.closest('a,button')) menu.open = false;
    });
  }
  function enhanceSections() {
    document.querySelectorAll('.tabs,.dash-tabs').forEach(panel => {
      if (panel.parentElement.matches('.mobile-section-menu') || panel.querySelectorAll('button').length < 5) return;
      const menu = document.createElement('details');
      menu.className = 'mobile-section-menu';
      const summary = document.createElement('summary');
      summary.textContent = 'أقسام الصفحة';
      panel.before(menu);
      menu.append(summary, panel);
      register(menu);
    });
  }
  document.querySelectorAll('.mobile-nav').forEach(register);
  enhanceSections();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; enhanceSections(); });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', event => {
    if (mobile.matches) for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !mobile.matches) return;
    for (const menu of menus) {
      if (menu.open && menu.contains(document.activeElement)) menu.querySelector('summary').focus();
    }
    closeMenus();
  });
  const reset = () => { for (const menu of menus) menu.open = !mobile.matches; };
  mobile.addEventListener('change', reset);
  ['pageshow','pagehide','popstate','hashchange'].forEach(name => window.addEventListener(name, reset));

  function dismissPanel(buttonId, panelSelector, closeId) {
    const button = document.getElementById(buttonId);
    const panel = document.querySelector(panelSelector);
    if (!button || !panel) return;
    if (!panel.id) panel.id = buttonId + 'Panel';
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', String(panel.classList.contains('open')));
    const close = () => { panel.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); };
    button.addEventListener('click', () => button.setAttribute('aria-expanded', String(panel.classList.contains('open'))));
    document.getElementById(closeId)?.addEventListener('click', close);
    document.addEventListener('pointerdown', event => {
      if (mobile.matches && !panel.contains(event.target) && !button.contains(event.target)) close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mobile.matches && panel.classList.contains('open')) { close(); button.focus(); }
    });
    panel.addEventListener('click', event => {
      if (mobile.matches && event.target.closest('a,#draw,#circle')) close();
    });
    ['pageshow','pagehide','popstate','hashchange'].forEach(name => window.addEventListener(name, close));
    mobile.addEventListener('change', close);
  }
  dismissPanel('mobileFilters', '.filters', 'closeFilters');
  dismissPanel('assistantFab', '#assistantPanel', 'assistantClose');
})();
