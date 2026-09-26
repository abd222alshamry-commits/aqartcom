package com.aqartkom.nativeapp.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SiteAccessTest {
    private val origin = "https://aqartcom-v93.onrender.com"
    @Test fun `only exact HTTPS origin opens inside authenticated app`() {
        assertTrue(SiteAccess.trusted("$origin/host-portal.html", origin))
        assertTrue(SiteAccess.trusted("$origin:443/sol.html", origin))
        for (url in listOf("http://aqartcom-v93.onrender.com/", "https://aqartcom-v93.onrender.com.evil.test/", "https://aqartcom-v93.onrender.com@evil.test/", "https://evil.test@aqartcom-v93.onrender.com/", "$origin:444/", "javascript:alert(1)", "file:///etc/passwd", "intent://anything", "data:text/html,test")) assertFalse(url, SiteAccess.trusted(url, origin))
        assertEquals("$origin/sol.html", SiteAccess.serviceUrl("/sol.html", origin))
        for (path in listOf("//evil.test", "https://evil.test", "/\\evil.test")) assertNull(SiteAccess.serviceUrl(path, origin))
    }
    @Test fun `limited admins see only granted management entries and never team controls`() {
        val reviewer = SiteAccess.user(JSONObject("""{"id":1,"role":"admin","admin_permissions":["offers.read","offers.review"]}"""))
        val paths=SiteAccess.services(reviewer).map { it.path }
        assertTrue(paths.contains("/offer-review.html")); assertFalse(paths.contains("/admin-team.html")); assertFalse(paths.contains("/hotel-partner.html"))
        val hotels=SiteAccess.user(JSONObject("""{"id":2,"role":"admin","admin_permissions":["hotels.read"]}"""))
        assertTrue(SiteAccess.services(hotels).any { it.path=="/hotel-partner.html" }); assertFalse(SiteAccess.can(hotels,"offers.read"))
    }
    @Test fun `missing grants do not accidentally grant full admin and explicit null preserves owner`() {
        assertFalse(SiteAccess.full(SiteAccess.user(JSONObject("""{"id":1,"role":"admin"}"""))))
        assertFalse(SiteAccess.full(SiteAccess.user(JSONObject("""{"id":1,"role":"admin","admin_permissions":[]}"""))))
        val owner=SiteAccess.user(JSONObject("""{"id":1,"role":"admin","admin_permissions":null}"""))
        assertTrue(SiteAccess.full(owner));assertTrue(SiteAccess.services(owner).any { it.path=="/admin-team.html" })
        assertFalse(SiteAccess.full(SiteAccess.user(JSONObject("""{"id":1,"role":"user","admin_permissions":null}"""))))
    }
    @Test fun `public services include latest hotels hosts and Sol without privileged tools`() {
        val services=SiteAccess.services(null);val paths=services.map { it.path }
        for (path in listOf("/sol.html","/hotels.html","/host-portal.html","/request-property.html","/messages.html","/")) assertTrue(path,paths.contains(path))
        assertFalse(paths.any { it.startsWith("/admin") || it=="/offer-review.html" });assertEquals(paths.size,paths.distinct().size)
        services.forEach { assertNotNull(SiteAccess.serviceUrl(it.path,origin)) }
    }

    @Test fun `booking links validate references and put secrets only in fragment`() {
        assertEquals("/hotels.html#booking=AQH-123ABC456", SiteAccess.bookingPath("aqh-123abc456"))
        for (code in listOf("AQH-X", "AQH-123456&token=x", "javascript:alert(1)", "")) assertNull(SiteAccess.bookingPath(code))
    }
    @Test fun `share excludes private checkout and booking capabilities`() {
        assertNull(SiteAccess.shareUrl("$origin/hotel-payment.html#AQH-123456:secret", origin))
        assertNull(SiteAccess.shareUrl("$origin/hotels.html#booking=AQH-123456", origin))
        assertNull(SiteAccess.shareUrl("$origin/admin.html", origin))
        assertNull(SiteAccess.shareUrl("https://evil.test/hotels.html", origin))
        assertEquals("$origin/hotels.html?hotel=8", SiteAccess.shareUrl("$origin/hotels.html?hotel=8&access_token=secret#private", origin))
        assertEquals("$origin/property.html?id=12", SiteAccess.shareUrl("$origin/property.html?id=12", origin))
    }
    @Test fun `printing needs explicit gesture in trusted top level document`() {
        assertTrue(SiteAccess.allowPrint("aqartkom-app://print", "$origin/hotels.html", origin, true, true))
        assertFalse(SiteAccess.allowPrint("aqartkom-app://print", "$origin/hotels.html", origin, true, false))
        assertFalse(SiteAccess.allowPrint("aqartkom-app://print", "$origin/hotels.html", origin, false, true))
        assertFalse(SiteAccess.allowPrint("aqartkom-app://print", "https://evil.test", origin, true, true))
        assertFalse(SiteAccess.allowPrint("aqartkom-app://print?url=secret", "$origin/", origin, true, true))
    }
}
