package com.aqartkom.nativeapp.data

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap

/** Normalize WebView accept lists before passing them to Android's document picker. */
object WebUploadPicker {
    fun mimeTypes(accepted: Array<String>): Array<String> = accepted.flatMap { it.split(',') }.mapNotNull {
        val value = it.trim().lowercase()
        if (value.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(value.drop(1))
        else value.takeIf { type -> Regex("[a-z0-9.+*-]+/[a-z0-9.+*-]+").matches(type) }
    }.distinct().toTypedArray()

    fun imagesOnly(accepted: Array<String>): Boolean = mimeTypes(accepted).let { types -> types.isNotEmpty() && types.all { it.startsWith("image/") } }

    fun intent(accepted: Array<String>, multiple: Boolean, normalizePhotos: Boolean): Intent {
        val types = if (normalizePhotos) arrayOf("image/*") else mimeTypes(accepted)
        val families = types.map { it.substringBefore('/') }.distinct()
        val type = when { types.isEmpty() -> "*/*"; types.size == 1 -> types[0]; families.size == 1 -> "${families[0]}/*"; else -> "*/*" }
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            setType(type)
            if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types)
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
    }

    fun result(resultCode: Int, data: Intent?, appAuthority: String, multiple: Boolean): Array<Uri> {
        if (resultCode != Activity.RESULT_OK || data == null) return emptyArray()
        val clip = data.clipData
        val values = if (clip != null) (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri } else listOfNotNull(data.data)
        // A picker must not be able to make the WebView upload our own private provider data.
        return values.filter { it.scheme == "content" && !it.authority.isNullOrBlank() && it.authority != appAuthority }
            .distinct().let { if (multiple) it else it.take(1) }.toTypedArray()
    }
}
