# عقارتكم للهاتف

تحتوي الحزمة على مشروع Android بلغة Java، ومصادر iOS بلغة Swift مع وصف مشروع XcodeGen. يتصل التطبيق بمنصة عقارتكم المنشورة عبر HTTPS؛ صفحة الويب وقاعدة البيانات لا تصبحان مضمنتين في التطبيق.

نسخة Android 1.0.1 مبنية ومتحقق من توقيعها. تدعم التنقل الآمن داخل نطاق الموقع، الاتصال وواتساب، مشاركة الإعلان، رفع الصور والفيديو من الجهاز، تحديد الموقع للخريطة، كوكيز مشغلات الشبكات الاجتماعية، والفيديو بملء الشاشة. زر الرجوع يغلق مشغل ملء الشاشة أولًا ثم يرجع داخل الموقع.

## Android

المتطلبات: Android SDK 35 وBuild Tools 35، JDK 17، Gradle 8.11.1، وAndroid Gradle Plugin 8.9.2. التطبيق يدعم Android 8.0 فأحدث.

1. مرر عنوان المنصة باستخدام `-PAQARTKOM_URL=https://aqartcom-v93.onrender.com`. استخدم أصل النطاق فقط، دون مسارات أو بيانات دخول.
2. افتح `mobile/android` في Android Studio. لا يوجد Gradle Wrapper ثنائي مضمن؛ مع Gradle 8.11.1 مثبتًا شغّل من مجلد Android:

```sh
gradle wrapper --gradle-version 8.11.1
./gradlew -PAQARTKOM_URL=https://aqartcom-v93.onrender.com assembleDebug
```

بعد نجاح البناء يكون APK في `app/build/outputs/apk/debug/app-debug.apk`. ملفات البناء لا تُضاف إلى Git.

3. اختبر أرقام المعلنين والرفع والخروج والرجوع والفيديو على جهاز فعلي. روابط واتساب تفتح التطبيق إذا كان الجهاز مهيأ لذلك أو صفحة واتساب في المتصفح.
4. قبل إصدار المتجر يلزم حساب Google Play. ملف التثبيت المباشر الحالي موقّع بمفتاح إصدار خاص بعقارتكم.

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
