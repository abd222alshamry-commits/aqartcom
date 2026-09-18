package com.aqartkom.nativeapp.data

import org.json.JSONObject
import java.net.URI

data class SiteService(val title: String, val detail: String, val path: String)

object SiteAccess {
    fun trusted(url: String, origin: String): Boolean = runCatching {
        val target = URI(url); val base = URI(origin)
        target.scheme.equals("https", true) && target.userInfo == null &&
            target.host?.equals(base.host, true) == true &&
            (if (target.port == -1) 443 else target.port) == (if (base.port == -1) 443 else base.port)
    }.getOrDefault(false)
    fun serviceUrl(path: String, origin: String): String? {
        if (!path.startsWith("/") || path.startsWith("//") || path.contains('\\')) return null
        return (origin.trimEnd('/') + path).takeIf { trusted(it, origin) }
    }
    fun user(json: JSONObject): User {
        val permissions = if (json.has("admin_permissions") && json.isNull("admin_permissions")) null
        else json.optJSONArray("admin_permissions")?.let { a -> (0 until a.length()).map { a.optString(it) }.toSet() } ?: emptySet()
        return User(json.optLong("id"), json.optString("name"), json.optString("email"), json.optString("phone"), json.optString("role", "user"), permissions)
    }
    fun full(user: User?) = user?.role == "admin" && user.adminPermissions == null
    fun can(user: User?, permission: String) = full(user) || user?.role == "admin" && user.adminPermissions?.contains(permission) == true
    fun services(user: User?): List<SiteService> = buildList {
        add(SiteService("سول — مساعدك الخاص", "محادثة وذاكرة ومقارنة العروض، مع تنزيل النموذج للعمل دون اتصال", "/sol.html"))
        add(SiteService("الفنادق والشقق المفروشة والمزارع", "الحجوزات والتقييمات وشروط الإقامة والدفع المتاح", "/hotels.html"))
        add(SiteService("بوابة أصحاب الفنادق والمؤجرين", "إضافة منشأة وغرف وصور وفيديوهات وإدارة الحجوزات", "/host-portal.html"))
        add(SiteService("الموقع الكامل", "جميع خدمات عقارتكم بأحدث التعديلات", "/"))
        add(SiteService("طلب عقار", "أرسل احتياجاتك وتابع عروض المكاتب", "/request-property.html"))
        add(SiteService("طلباتي", "حالة الطلب والردود الواردة", "/request-dashboard.html"))
        add(SiteService("الرسائل", "مركز مراسلات طلبات العقارات", "/messages.html"))
        if (user?.role == "agent" || full(user)) add(SiteService("لوحة المكتب", "إعلانات المكتب وطلباته وخدماته", "/office.html"))
        if (user?.role == "admin") add(SiteService("لوحة الإدارة", "الأقسام المسموحة لحسابك", "/admin.html"))
        if (can(user, "hotels.read")) add(SiteService("إدارة الفنادق", "المنشآت والغرف والوسائط والحجوزات", "/hotel-partner.html"))
        if (can(user, "offers.read")) add(SiteService("مراجعة العروض وعروض المكاتب", "عرض ومراجعة وإضافة العروض بحسب صلاحياتك", "/offer-review.html"))
        if (full(user)) add(SiteService("المشرفون والصلاحيات", "إنشاء حسابات إدارة محدودة وتعديل صلاحياتها", "/admin-team.html"))
    }
}
