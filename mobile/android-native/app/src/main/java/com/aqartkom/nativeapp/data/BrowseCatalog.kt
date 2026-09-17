package com.aqartkom.nativeapp.data

import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

val SyrianCities = listOf("دمشق", "حلب", "اللاذقية", "حماة", "طرطوس", "حمص", "ريف دمشق", "درعا", "السويداء", "القنيطرة", "إدلب", "الرقة", "دير الزور", "الحسكة")
const val ListingsPerPage = 10

/** Undated listings stay in their original server order after dated listings. */
fun newestListings(rows: List<Property>): List<Property> = rows.distinctBy { it.id }.sortedByDescending {
    runCatching { Instant.parse(it.createdAt).toEpochMilli() }.getOrElse { _ ->
        runCatching { LocalDateTime.parse(it.createdAt.replace(' ', 'T')).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrDefault(0L)
    }
}

fun listingPage(rows: List<Property>, page: Int): List<Property> = rows.drop(page.coerceAtLeast(0) * ListingsPerPage).take(ListingsPerPage)

fun propertyLink(p: Property): String = if (p.sourceKind == "office" || p.id.startsWith("market-"))
    "https://aqartcom-v93.onrender.com/office-property.html?id=${p.id.removePrefix("market-")}"
else "https://aqartcom-v93.onrender.com/property.html?id=${p.id}"

fun phoneDigits(phone: String): String {
    val digits = phone.map { if (it in '٠'..'٩') ('0'.code + (it - '٠')).toChar() else it }.filter(Char::isDigit).joinToString("")
    return when {
        digits.startsWith("00") -> digits.drop(2)
        digits.startsWith("09") && digits.length == 10 -> "963" + digits.drop(1)
        else -> digits
    }
}

fun dialNumber(phone: String): String = phoneDigits(phone).let { digits ->
    if (digits.length > 10 || phone.trim().startsWith("+")) "+$digits" else digits
}
