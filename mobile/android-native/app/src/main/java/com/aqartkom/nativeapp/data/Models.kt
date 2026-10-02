package com.aqartkom.nativeapp.data

data class PropertyVideo(
    val id: Long = 0,
    val url: String = "",
    val posterUrl: String = "",
    val title: String = "فيديو العقار",
    val sourceType: String = "upload",
    val primary: Boolean = false
)

data class PropertyImage(val id: Long = 0, val url: String = "")

data class Advertiser(
    val name: String = "معلن عقاري",
    val phone: String = "",
    val role: String = "user"
)

data class Property(
    val id: String,
    val title: String,
    val type: String,
    val mode: String,
    val city: String,
    val district: String,
    val price: Double,
    val currency: String,
    val area: Double?,
    val rooms: Int?,
    val baths: Int?,
    val description: String,
    val imageUrl: String,
    val featured: Boolean,
    val sponsored: Boolean,
    val latitude: Double?,
    val longitude: Double?,
    val views: Int,
    val images: List<PropertyImage> = emptyList(),
    val videos: List<PropertyVideo> = emptyList(),
    val primaryVideo: PropertyVideo? = null,
    val owner: Advertiser? = null,
    val sourceKind: String = "property",
    val createdAt: String = "",
    val status: String = "active"
)

data class Inquiry(val id: String, val propertyTitle: String, val name: String, val phone: String, val message: String, val status: String)
data class OwnerDashboard(val properties: List<Property>, val inquiries: List<Inquiry>)

data class User(
    val id: Long,
    val name: String,
    val email: String,
    val phone: String,
    val role: String,
    val adminPermissions: Set<String>? = emptySet()
)

data class SearchFilters(
    val query: String = "",
    val city: String = "",
    val type: String = "",
    val mode: String = "",
    val minPrice: String = "",
    val maxPrice: String = "",
    val rooms: String = ""
)

data class PropertyDraft(
    val title: String,
    val type: String,
    val mode: String,
    val city: String,
    val district: String,
    val price: String,
    val currency: String,
    val area: String,
    val rooms: String,
    val baths: String,
    val description: String,
    val latitude: String = "",
    val longitude: String = ""
)

sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>
    data class Ready<T>(val value: T) : LoadState<T>
    data class Error(val message: String) : LoadState<Nothing>
}
