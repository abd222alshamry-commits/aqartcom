(function (root) {
  'use strict';
  function normalizePhone(value) {
    let number = String(value || '').trim().replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[\s().-]/g, '');
    if (number.startsWith('00')) number = '+' + number.slice(2);
    if (!/^\+?[0-9]{7,15}$/.test(number)) return null;
    return { tel: 'tel:' + number, display: number, whatsapp: /^\+[1-9][0-9]{6,14}$/.test(number) ? number.slice(1) : null };
  }
  root.advertiserContactLinks = function (value, title, url) {
    const phone = normalizePhone(value);
    if (!phone) return null;
    return { ...phone, whatsappUrl: phone.whatsapp ? 'https://wa.me/' + phone.whatsapp + '?text=' + encodeURIComponent('مرحبًا، أود الاستفسار عن العقار: ' + title + '\n' + url) : null };
  };
  root.installAdvertiserContact = function () {
    const panel = document.querySelector('.layout aside .panel');
    const call = panel && panel.querySelector('a.call');
    const wa = panel && panel.querySelector('a.whatsapp');
    if (!call) return;
    const links = root.advertiserContactLinks(call.getAttribute('href').replace(/^tel:/, ''), document.querySelector('h1')?.textContent || '', location.origin + location.pathname + '?id=' + encodeURIComponent(new URLSearchParams(location.search).get('id') || ''));
    if (!links) { call.remove(); if (wa) wa.remove(); return; }
    call.href = links.tel;
    call.textContent = 'اتصل بالمعلن';
    const number = document.createElement('a');
    number.className = 'advertiser-number'; number.href = links.tel;
    number.dir = 'ltr'; number.textContent = links.display;
    number.setAttribute('aria-label', 'رقم المعلن ' + links.display);
    panel.querySelector('.owner').after(number);
    if (wa && links.whatsappUrl) { wa.href = links.whatsappUrl; wa.rel = 'noopener noreferrer'; wa.textContent = 'تواصل عبر واتساب'; }
    else if (wa) { wa.remove(); const hint = document.createElement('p'); hint.textContent = 'واتساب غير متاح: يلزم أن يضيف المعلن رقمًا بصيغة دولية مع رمز الدولة.'; panel.append(hint); }
    const dock = document.createElement('nav'); dock.className = 'advertiser-contact-dock'; dock.setAttribute('aria-label', 'التواصل المباشر مع المعلن');
    const tel = call.cloneNode(true); tel.removeAttribute('id'); dock.append(tel);
    if (wa && links.whatsappUrl) { const chat = wa.cloneNode(true); chat.removeAttribute('id'); dock.append(chat); }
    document.body.append(dock); document.body.classList.add('has-advertiser-contact');
  };
})(globalThis);
