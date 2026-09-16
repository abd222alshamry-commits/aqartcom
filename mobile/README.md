# نسختا عقارتكم للهاتف — مصادر تجريبية

تحتوي الحزمة على مشروع Android بلغة Java، ومصادر iOS بلغة Swift مع وصف مشروع XcodeGen. لا تحتوي على ملفات تثبيت، ولم تُختبر على محاكي أو هاتف. تتطلبان منصة منشورة تعمل عبر HTTPS؛ صفحة الويب وقاعدة البيانات لا تصبحان مضمنتين في التطبيق.

المتاح في المصدر: التنقل داخل النطاق المحدد فقط، فتح الروابط الخارجية في تطبيق مناسب، الاتصال عبر لوحة الطلب دون إذن إجراء مكالمات، واتساب عبر رابط HTTPS، مشاركة رابط الإعلان، الرجوع والرئيسية والتحديث، رسالة خطأ اتصال. اختيار ملفات الرفع يحتاج اختبار جهاز؛ الكاميرا وGPS والإشعارات الأصلية ليست ميزات مكتملة.

## Android

المتطلبات المثبتة لهذا المشروع: Android SDK 35 وBuild Tools 35، JDK 17، Gradle 8.11.1، وAndroid Gradle Plugin 8.9.2. هذه إعدادات نسخة اختبار؛ يجب مراجعة متطلبات Google Play وقت النشر وتحديثها عند الحاجة.

1. انشر المنصة وأصلح اختبارات البيانات أولًا.
2. أضف `AQARTKOM_URL=https://YOUR_REAL_DOMAIN` في إعدادات Gradle المحلية للمستخدم، أو مرره باستخدام `-PAQARTKOM_URL=https://YOUR_REAL_DOMAIN`. استخدم أصل النطاق فقط، دون مسارات أو بيانات دخول.
3. افتح `mobile/android` في Android Studio. لا يوجد Gradle Wrapper ثنائي مضمن؛ مع Gradle 8.11.1 مثبتًا شغّل من مجلد Android:

```sh
gradle wrapper --gradle-version 8.11.1
./gradlew assembleDebug
```

بعد نجاح البناء يكون APK التجريبي في `app/build/outputs/apk/debug/app-debug.apk`. هذا مسار ناتج متوقع، وليس ملفًا موجودًا في الحزمة.

4. اختبر أرقام المعلنين والرفع والخروج والرجوع وروابط target=_blank وعدم الاتصال على جهاز فعلي. روابط واتساب تفتح التطبيق إذا كان الجهاز مهيأ لذلك أو صفحة واتساب في المتصفح.
5. قبل إصدار المتجر اختر applicationId النهائي، وأيقونات الإصدار، وإعدادات التوقيع الخاصة بك. لا يوجد مفتاح توقيع إنتاج في المشروع.

## iPhone وiPad

1. يلزم Mac مع Xcode وأدوات XcodeGen. عدّل `AqartkomURL` في `ios/project.yml` إلى أصل النطاق HTTPS الحقيقي؛ التطبيق يرفض `configure.invalid`.
2. من مجلد `mobile/ios`:

```sh
xcodegen generate
open Aqartkom.xcodeproj
```

3. اختر فريق التوقيع وBundle Identifier النهائي داخل Xcode، وأضف AppIcon كاملًا قبل الأرشفة. لم تُضمّن شهادات أو حساب مطوّر أو أيقونات متجر نهائية.
4. ابنِ على المحاكي أولًا ثم الجهاز، واختبر الرفع والاتصال وواتساب ومشاركة الروابط وتدوير الشاشة والجلسات. افحص تحذيرات البناء ومراجعة الخصوصية قبل TestFlight.
5. Archive وTestFlight/App Store خطوات لاحقة بحساب صاحب التطبيق. قبول المتجر غير مضمون، خصوصًا للتطبيقات التي تعيد عرض موقع دون تجربة كافية خاصة بالتطبيق.

## بوابة قبول مشتركة

- لا تتجاوز أخطاء شهادة TLS ولا تسمح بـHTTP أو بـJavaScript bridge عام.
- تحقق من رفض روابط النطاقات المقلدة وjavascript وfile وintent.
- اختبر المستخدم المسجل وغير المسجل والخروج وانتهاء الجلسة والرفع الملغى وفشل الشبكة.
- تحقق من حفظ الكوكيز وبقاء نفس سياسة صلاحيات الخادم؛ لا تضف رموز جلسات إلى روابط المشاركة.
- لا تعتمد على نجاح اختبارات JavaScript لإثبات أن المشروعين الأصليين يبنيان أو يعملان.

المراجع: [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)، [توافق AGP 8.9](https://developer.android.com/build/releases/agp-8-9-0-release-notes)، [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)، [XcodeGen](https://github.com/yonaskolb/XcodeGen)، [متطلبات مراجعة Apple](https://developer.apple.com/app-store/review/guidelines/).
