# Android 1.7.0 verification — 2026-09-26

- Application: `com.aqartkom.mobileapp.v2`, versionCode 170, versionName 1.7.0, minSdk 26, targetSdk 35, ARM64.
- Built source: `022718135cff730a0b89916a3f3d6f426451450b`; [CI run](https://github.com/abd222alshamry-commits/aqartcom/actions/runs/36276272739), [PR 7](https://github.com/abd222alshamry-commits/aqartcom/pull/7).
- CI release build and 28 JVM/Compose tests passed with zero failures, errors or skipped tests.
- Arabic phone previews at 393×852dp reviewed in light and dark modes. Stay shortcuts and services have visible labels and tested destinations.
- Companion website commit `9e9048304b130661d3e366e87c8d7b03ffedd092` is live on Render deployment `dep-das4e48ae00c73aqhnc0`. Published HTML/JS matched the tested local files byte-for-byte.
- 17 focused website tests passed: native restart recovery uses the original request/key, storage failure prevents submission, receipt fragment navigation, checkout back behavior, manual payment states, saved media, nightly availability/pricing and idempotent cancellation. Database mutation tests use local PGlite, not production.
- Live browser checked search and My Bookings open/close after deployment stabilized; no new application console errors in that check.
- Signed output: `Aqartkom-1.7.0-Samsung.apk`, 19,274,696 bytes.
- APK SHA-256: `0e24be0ffc5579912d887f20996be6b156704ea6cfbd3bdd351a7eb98348aab4`.
- APK v2/v3 signatures and 16 KiB ZIP alignment verified. Release is not debuggable.
- Certificate SHA-256: `c899ea84a10c8249a244997b58da265f34c2e2728e5ba489c11fbea50c6d22e9`; matches the existing 1.6 APK. Same package/certificate allows an in-place update of 1.5/1.6.
- No keystore or password was uploaded to GitHub or included in the APK.
- Device receipts are lost if app data is cleared or the app is uninstalled. Account-linked bookings remain available from the server.
- Limits: no connected Android/Samsung hardware was available. Installation, device permissions, IME behavior and native print-dialog behavior have not been physically tested. This is an APK release, not a Google Play publication.

