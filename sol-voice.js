(function (root) {
  'use strict';
  // No audio is stored by Sol. Remote browser speech services require opt-in.
  function create({textarea}) {
    const doc = textarea.ownerDocument, $ = id => doc.getElementById(id);
    const mic = $('voiceMic'), stop = $('voiceStop'), status = $('voiceStatus');
    const online = $('voiceOnline'), auto = $('voiceAuto'), language = $('voiceLanguage');
    const install = $('voiceInstall'), synth = root.speechSynthesis;
    const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
    const replies = new WeakMap();
    let session = null, busy = false, checking = false, installing = false;
    let serial = 0, checkSerial = 0, speechSerial = 0, speaking = false, remoteSpeech = false;
    let inputTimer = null, activeUtterance = null;
    const say = text => { status.textContent = text; };
    const connected = () => root.navigator.onLine !== false;
    const allowedRemote = () => online.checked && connected();
    function update() {
      mic.disabled = busy || checking || installing || !Recognition || root.isSecureContext === false;
      mic.textContent = session ? '■ إنهاء الإملاء' : '🎙 تحدث إلى سول';
      mic.setAttribute('aria-pressed', String(!!session));
      stop.hidden = !session && !speaking && !checking;
      language.disabled = !!session || checking || installing;
      install.disabled = installing || !!session || checking || !connected();
    }
    function voices() {
      try { return synth?.getVoices().filter(v => /^ar(?:-|$)/i.test(v.lang)) || []; }
      catch { return []; }
    }
    function chooseVoice() {
      return voices().filter(v => v.localService === true || allowedRemote()).sort((a, b) =>
        Number(b.localService === true) - Number(a.localService === true) ||
        Number(b.lang === language.value) - Number(a.lang === language.value))[0];
    }
    function voiceHint() {
      const v = chooseVoice();
      $('voiceOutput').textContent = !synth || !root.SpeechSynthesisUtterance
        ? 'قراءة الردود غير مدعومة في هذا المتصفح.'
        : v ? (v.localService ? 'الصوت العربي جاهز على جهازك دون إنترنت.' : 'الصوت العربي المتاح يستخدم الإنترنت.')
        : 'لا يوجد صوت عربي متاح حاليًا. ثبّت صوتًا عربيًا من إعدادات النطق في الجهاز، أو اسمح بخدمات الصوت عبر الإنترنت إذا توفر صوت شبكي.';
      auto.disabled = !synth || !root.SpeechSynthesisUtterance;
    }
    async function availability() {
      try {
        if (!Recognition || !('processLocally' in Recognition.prototype) || typeof Recognition.available !== 'function') return 'unavailable';
        return await Recognition.available({langs: [language.value], processLocally: true});
      } catch { return 'unavailable'; }
    }
    async function refresh() {
      const token = ++checkSerial;
      voiceHint();
      const available = await availability();
      if (token !== checkSerial || session || checking || speaking) return;
      install.hidden = available !== 'downloadable' || typeof Recognition?.install !== 'function';
      if (!Recognition) say('الإملاء غير مدعوم هنا. افتح سول في متصفح يدعم الصوت، أو استخدم ميكروفون لوحة مفاتيح هاتفك.');
      else if (root.isSecureContext === false) say('افتح الموقع عبر HTTPS للسماح باستخدام الميكروفون.');
      else if (available === 'available') say('الإملاء العربي جاهز دون إنترنت. اضغط الميكروفون ثم راجع النص قبل إرساله.');
      else if (available === 'downloadable') say('يمكن تنزيل حزمة الإملاء لهذه العربية مرة واحدة للعمل دون إنترنت.');
      else if (available === 'downloading') say('حزمة اللغة قيد التنزيل في المتصفح؛ أعد المحاولة بعد اكتمالها.');
      else say(allowedRemote() ? 'اضغط الميكروفون. قد يعالج مزود المتصفح صوتك عبر الإنترنت.' : 'الإملاء المحلي بهذه العربية غير متاح على جهازك. يمكنك السماح بالصوت عبر الإنترنت عند الاتصال، أو الكتابة.');
      update();
    }
    function cancelInput() {
      serial++; checking = false; clearTimeout(inputTimer); inputTimer = null;
      const current = session; session = null;
      if (current) {
        textarea.readOnly = current.readOnly;
        try { current.recognition.abort(); } catch {}
      }
      update();
    }
    function cancelSpeech() {
      speechSerial++; speaking = false; remoteSpeech = false; activeUtterance = null;
      try { synth?.cancel(); } catch {}
      update();
    }
    function stopAll() { checkSerial++; cancelInput(); cancelSpeech(); say('تم إيقاف الصوت.'); }
    const errors = {
      'not-allowed': 'لم يُسمح بالميكروفون. اسمح به من إعدادات الموقع ثم أعد المحاولة.',
      'service-not-allowed': 'خدمة الإملاء غير متاحة في هذا المتصفح؛ جرّب ميكروفون لوحة المفاتيح.',
      'audio-capture': 'تعذر الوصول إلى الميكروفون. تحقق من توصيله ومن تطبيقات الصوت الأخرى.',
      'no-speech': 'لم أسمع كلامًا واضحًا. اضغط الميكروفون وحاول مجددًا.',
      network: 'تعذر الاتصال بخدمة الإملاء. يمكنك متابعة الكتابة.',
      'language-not-supported': 'خدمة الإملاء لا تدعم العربية المختارة. جرّب اختيارًا آخر.',
      aborted: 'تم إيقاف الإملاء.'
    };
    async function startInput() {
      if (session) {
        try { session.recognition.stop(); say('جارٍ إنهاء الإملاء…'); }
        catch { cancelInput(); }
        return;
      }
      if (busy || checking || installing || !Recognition) return;
      checkSerial++;
      cancelSpeech();
      const token = ++serial;
      checking = true; update(); say('جارٍ تجهيز الميكروفون…');
      const local = await availability();
      if (token !== serial) return;
      checking = false;
      if (local !== 'available' && !allowedRemote()) {
        await refresh(); update(); return;
      }
      try {
        const recognition = new Recognition();
        recognition.lang = language.value;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        if ('processLocally' in recognition) recognition.processLocally = local === 'available';
        const current = {recognition, base: textarea.value.trimEnd(), readOnly: textarea.readOnly, remote: local !== 'available', final: ''};
        session = current; textarea.readOnly = true; update();
        const valid = () => session === current && token === serial;
        const write = text => {
          const limit = textarea.maxLength > 0 ? textarea.maxLength : 1000;
          textarea.value = [current.base, text].filter(Boolean).join(' ').slice(0, limit);
          textarea.dispatchEvent(new root.Event('input', {bubbles: true}));
        };
        recognition.onstart = () => { if (valid()) say(current.remote ? 'أستمع إليك — عبر خدمة المتصفح على الإنترنت…' : 'أستمع إليك — المعالجة على جهازك…'); };
        recognition.onresult = event => {
          if (!valid()) return;
          const final = [], interim = [];
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i], text = result[0]?.transcript || '';
            (result.isFinal ? final : interim).push(text);
          }
          current.final = final.join(' ').trim();
          write([...final, ...interim].join(' ').trim());
        };
        recognition.onerror = event => {
          if (!valid()) return;
          write(current.final);
          const message = errors[event.error] || 'تعذر الإملاء. يمكنك كتابة سؤالك وإرساله.';
          cancelInput(); say(message);
        };
        recognition.onend = () => {
          if (!valid()) return;
          write(current.final);
          session = null; clearTimeout(inputTimer); inputTimer = null;
          textarea.readOnly = current.readOnly; update(); textarea.focus();
          say(current.final ? 'تم تحويل صوتك إلى نص. راجعه ثم اضغط إرسال.' : 'لم يصل نص واضح؛ حاول مجددًا أو اكتب سؤالك.');
        };
        recognition.start();
        inputTimer = setTimeout(() => { if (valid()) { cancelInput(); say('انتهت مهلة الإملاء. راجع النص أو حاول مجددًا.'); } }, 60000);
      } catch (error) {
        cancelInput(); say(error.name === 'NotAllowedError' ? errors['not-allowed'] : 'تعذر تشغيل الميكروفون؛ جرّب متصفحًا آخر أو ميكروفون لوحة المفاتيح.');
      }
    }
    function chunks(text) {
      const words = String(text).replace(/https?:\/\/\S+/g, 'رابط العرض').replace(/\s+/g, ' ').trim().split(' ');
      const parts = []; let part = '';
      for (const word of words) {
        if ((part + ' ' + word).length > 200 && part) { parts.push(part); part = ''; }
        // Keep pathological unbroken strings bounded as well.
        for (let i = 0; i < word.length; i += 200) {
          const segment = word.slice(i, i + 200);
          if (segment.length === 200) { if (part) parts.push(part); parts.push(segment); part = ''; }
          else part += (part ? ' ' : '') + segment;
        }
      }
      if (part) parts.push(part);
      return parts;
    }
    function speak(text) {
      cancelInput(); cancelSpeech();
      if (!synth || !root.SpeechSynthesisUtterance) { say('قراءة الردود غير مدعومة في هذا المتصفح.'); return; }
      const voice = chooseVoice();
      if (!voice) { voiceHint(); say($('voiceOutput').textContent); return; }
      const parts = chunks(text), token = speechSerial;
      if (!parts.length) return;
      speaking = true; remoteSpeech = voice.localService !== true; update();
      say(remoteSpeech ? 'سول يقرأ الرد بصوت عربي عبر خدمة الإنترنت…' : 'سول يقرأ الرد بصوت عربي على جهازك…');
      function next() {
        if (token !== speechSerial) return;
        if (!parts.length) { speaking = false; activeUtterance = null; update(); say('انتهت قراءة الرد.'); return; }
        const utterance = new root.SpeechSynthesisUtterance(parts.shift());
        activeUtterance = utterance;
        utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1;
        utterance.onend = next;
        utterance.onerror = event => {
          if (token !== speechSerial) return;
          cancelSpeech();
          say(event.error === 'not-allowed' ? 'اضغط «اسمع الرد» لتشغيل الصوت؛ المتصفح أوقف التشغيل التلقائي.' : 'تعذرت قراءة الرد. تحقق من الصوت العربي في إعدادات جهازك.');
        };
        try { synth.speak(utterance); } catch { cancelSpeech(); say('تعذر تشغيل الصوت على هذا الجهاز.'); }
      }
      next();
    }
    function addReply(body, automatic = false) {
      let button = replies.get(body);
      if (!button) {
        button = doc.createElement('button'); button.type = 'button'; button.className = 'quiet sol-read';
        button.textContent = '🔊 اسمع الرد'; button.onclick = () => speak(body.textContent);
        body.parentElement.append(button); replies.set(body, button);
      }
      button.disabled = !body.textContent.trim() || !synth || !root.SpeechSynthesisUtterance;
      if (automatic && auto.checked && !doc.hidden) speak(body.textContent);
    }
    mic.onclick = startInput; stop.onclick = stopAll;
    online.onchange = () => { stopAll(); refresh(); };
    language.onchange = () => { stopAll(); refresh(); };
    auto.onchange = () => { if (!auto.checked) cancelSpeech(); };
    install.onclick = async () => {
      if (installing || !connected() || typeof Recognition?.install !== 'function') return;
      installing = true; update(); say('جارٍ تنزيل حزمة الإملاء من خدمة المتصفح…');
      try {
        const ok = await Recognition.install({langs: [language.value], processLocally: true});
        if (ok) await refresh(); else say('لم يكتمل تنزيل حزمة الإملاء. حاول لاحقًا أو استخدم الكتابة.');
      } catch { say('تعذر تنزيل حزمة اللغة؛ قد لا يدعمها المتصفح.'); }
      finally { installing = false; update(); }
    };
    synth?.addEventListener?.('voiceschanged', voiceHint);
    root.addEventListener('offline', () => { if (session?.remote) cancelInput(); if (remoteSpeech) cancelSpeech(); refresh(); });
    root.addEventListener('online', refresh);
    root.addEventListener('pagehide', stopAll);
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopAll(); });
    update(); refresh();
    return {addReply, stop: stopAll, cancelInput, setBusy(value) { busy = value; if (value) cancelInput(); update(); }};
  }
  root.SolVoice = {create};
})(window);
