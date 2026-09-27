package com.aqartkom.nativeapp.data

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class WebUploadPickerTest {
    @Test fun multipleMimeListsOpenDocumentsWithCorrectAndroidFilter() {
        val accepted = arrayOf("image/jpeg,image/png", ".webp")
        val intent = WebUploadPicker.intent(accepted, true, false)
        assertEquals(Intent.ACTION_OPEN_DOCUMENT, intent.action)
        assertEquals("image/*", intent.type)
        assertArrayEquals(arrayOf("image/jpeg", "image/png", "image/webp"), intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        assertTrue(WebUploadPicker.imagesOnly(accepted))
        assertFalse(WebUploadPicker.imagesOnly(arrayOf("image/jpeg", "video/mp4")))
        assertEquals("*/*", WebUploadPicker.intent(arrayOf("image/*", "video/*"), true, false).type)
        assertEquals("image/*", WebUploadPicker.intent(accepted, true, true).type)
    }

    @Test fun clipDataDeliversEveryPhotoAndRejectsPrivateOrNonContentUris() {
        val one = Uri.parse("content://media/images/one")
        val two = Uri.parse("content://media/images/two")
        val clip = ClipData.newRawUri("photo", one)
        clip.addItem(ClipData.Item(two)); clip.addItem(ClipData.Item(one))
        clip.addItem(ClipData.Item(Uri.parse("file:///data/private")))
        clip.addItem(ClipData.Item(Uri.parse("content://app.uploads/photos/private.jpg")))
        val result = Intent().apply { clipData = clip }
        assertArrayEquals(arrayOf(one, two), WebUploadPicker.result(Activity.RESULT_OK, result, "app.uploads", true))
        assertArrayEquals(arrayOf(one), WebUploadPicker.result(Activity.RESULT_OK, result, "app.uploads", false))
        assertTrue(WebUploadPicker.result(Activity.RESULT_CANCELED, result, "app.uploads", true).isEmpty())
        assertArrayEquals(arrayOf(two), WebUploadPicker.result(Activity.RESULT_OK, Intent().setData(two), "app.uploads", true))
    }

    @Test fun largePhonePhotoBecomesReadableJpegForHotelUploadWithoutChangingOriginal() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val directory = File(context.cacheDir, "web-upload-images").apply { mkdirs() }
        val source = File(directory, "phone-original.png")
        val bitmap = Bitmap.createBitmap(3200, 1800, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.BLUE)
        source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
        val original = source.readBytes()
        val uri = FileProvider.getUriForFile(context, context.packageName + ".uploads", source)
        val output = AqartkomApi(context).prepareSitePhoto(uri)
        assertEquals("content", output.scheme)
        assertEquals("image/jpeg", context.contentResolver.getType(output))
        val bytes = context.contentResolver.openInputStream(output)!!.use { it.readBytes() }
        assertTrue(bytes.size in 1..(8 * 1024 * 1024))
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        assertEquals(2560, bounds.outWidth); assertEquals(1440, bounds.outHeight)
        assertArrayEquals(original, source.readBytes())
    }
}
