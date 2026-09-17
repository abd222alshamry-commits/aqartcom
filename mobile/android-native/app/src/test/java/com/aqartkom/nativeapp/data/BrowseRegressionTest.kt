package com.aqartkom.nativeapp.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BrowseRegressionTest {
    private val parser = PropertyParser("https://aqartcom-v93.onrender.com")

    @Test fun newestOrderAndTenItemPagesDoNotLoseOrRepeatListings() {
        val rows = (1..23).map { parser.parse(JSONObject().put("id", it).put("created_at", "2026-09-${it.toString().padStart(2, '0')}T12:00:00Z")) }
        val sorted = newestListings(rows.shuffled() + rows.last())
        assertEquals("23", sorted.first().id)
        assertEquals(listOf(10, 10, 3), (0..2).map { listingPage(sorted, it).size })
        assertEquals((23 downTo 1).map(Int::toString), (0..2).flatMap { listingPage(sorted, it) }.map { it.id })
        assertTrue(listingPage(sorted, 3).isEmpty())
    }

    @Test fun unknownDatesFollowDatedListingsWithoutCrashing() {
        val undated = parser.parse(JSONObject("""{"id":1,"created_at":null}"""))
        val invalid = parser.parse(JSONObject("""{"id":2,"created_at":"unknown"}"""))
        val dated = parser.parse(JSONObject("""{"id":3,"created_at":"2026-09-17 12:00:00"}"""))
        assertEquals(listOf("3", "1", "2"), newestListings(listOf(undated, invalid, dated)).map { it.id })
    }

    @Test fun officeSharesOpenOfficePageAndPhoneUsesInternationalFormat() {
        val office = parser.parse(JSONObject("""{"id":"market-18","source_kind":"office"}"""))
        assertEquals("https://aqartcom-v93.onrender.com/office-property.html?id=18", propertyLink(office))
        assertEquals("963944123456", phoneDigits("٠٩٤٤ ١٢٣ ٤٥٦"))
        assertEquals("+963944123456", dialNumber("٠٩٤٤ ١٢٣ ٤٥٦"))
        assertEquals("966501234567", phoneDigits("+966 50 123 4567"))
        assertEquals("963944123456", phoneDigits("00963-944-123456"))
    }
}
