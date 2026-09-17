package com.aqartkom.nativeapp.data

/** Retries retain the listing id and skip files acknowledged by the server. */
internal class UploadSession(val propertyId: String, items: List<String>) {
    private val items = items.distinct()
    private val acknowledged = mutableSetOf<String>()
    val total: Int get() = items.size
    val uploaded: Int get() = acknowledged.size
    val remaining: List<String> get() = items.filterNot { it in acknowledged }
    fun acknowledge(item: String) { require(item in items); acknowledged.add(item) }
}

data class UploadProgress(val savedProperty: Boolean = false, val uploaded: Int = 0, val total: Int = 0, val error: String? = null)
