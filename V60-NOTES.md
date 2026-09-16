# عقارتكم V60 — PWA Mobile App

- تطبيق ويب قابل للتثبيت على Android وiPhone/iPad عبر PWA.
- Web App Manifest عربي RTL مع اختصارات للبحث وإضافة العقار والفنادق.
- Service Worker مع App Shell وOffline fallback وتحديث cache.
- Web Push عبر البنية الموجودة VAPID + web-push، مع زر تفعيل الإشعارات للمستخدم المسجل.
- تجربة standalone، أيقونات 192/512، Apple touch icon وtheme color.
- لا يتم تخزين استجابات `/api/` في cache لتقليل مخاطر عرض بيانات قديمة أو خاصة.
- iOS: التثبيت يتم من Safari > مشاركة > إضافة إلى الشاشة الرئيسية عندما لا يظهر install prompt.
- الإنتاج يتطلب HTTPS وVAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY مضبوطين.
