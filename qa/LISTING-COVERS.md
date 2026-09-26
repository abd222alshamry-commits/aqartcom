# Real listing covers and video ordering

Release verification, 2026-09-27 (Damascus).

- Property cards now use the selected cover, uploaded photo or saved video poster. Stock property images are not used as listing media.
- The new-property attachment picker retains the selected image/video time through upload retries and saves the cover after the media is committed.
- Existing property, office and stay listings expose an authorized cover chooser. Hotel choices include room media. Uploaded video frames are extracted at the selected timestamp, stored through the existing media storage provider and audited.
- Cover changes recheck permissions and a media revision before commit. Office-owner edits return to moderation. Arbitrary URLs are not fetched by the frame service; it accepts only media attached to the authorized listing and validated storage keys.
- R2 processing streams at most 100 MiB from the configured bucket into a temporary file, then removes it. Failed saves roll back generated files.
- Property videos precede the photo gallery. Shared hotel/room galleries sort all videos before photos while retaining image navigation and video playback.

Validation:

- 51 focused backend and UI tests passed before the final video-order addition, including actual FFmpeg extraction from a two-color fixture to verify the requested timestamp, persistence, stale revision handling, ownership, storage rollback and retry without duplicate upload.
- 16 targeted tests passed after the video-order addition, including video-before-photo DOM order and removal of fabricated property gallery images.
- DOM/HTTP audit: 48 page scenarios and 109 checks, no page or server errors. This is not a physical phone test.
- No production listings or bookings were created for tests.

The native Android booking/management WebView uses these live website changes. This release does not rebuild the native Android property screens.

Follow-up save/apply fix, 2026-09-27 (Damascus):

- Cover selection now stages the choice. A persistent “حفظ وتطبيق” footer saves it, closes the dialog and immediately refreshes the displayed listing. A failed save retains the selection for retry; duplicate submissions are disabled.
- Without an explicit cover, the saved video poster takes priority over listing photos. The cover editor displays this actual automatic image and reset returns to this mode. New-ad guidance explains automatic selection and saving with publication.
- 18 targeted cover, attachment and gallery tests passed, including explicit-save staging, failure/retry, automatic video priority, reset persistence and dialog close/apply.
