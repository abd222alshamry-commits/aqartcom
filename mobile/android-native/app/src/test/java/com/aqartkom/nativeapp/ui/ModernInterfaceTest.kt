package com.aqartkom.nativeapp.ui

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.LayoutDirection
import com.aqartkom.nativeapp.ui.screens.SectionsScreen
import com.aqartkom.nativeapp.ui.screens.ServicesScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "ar-rSA-w393dp-h852dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ModernInterfaceTest : InterfaceScreenshotTest() {
    @Test fun startScreenKeepsAllEntrypointsAndThemeSwitch() {
        var opened = ""
        compose.setContent {
            var dark by remember { mutableStateOf(false) }
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AqartkomTheme(dark) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        SectionsScreen(Modifier, { opened = "properties" }, { opened = "hotels" }, { opened = "account" }, { opened = "services" }, { opened = "sol" }, dark) { dark = !dark }
                    }
                }
            }
        }
        snapshot("01-start-light")
        compose.onNodeWithContentDescription("تغيير المظهر").performClick()
        compose.onNodeWithText("إقامة تستحقها").assertIsDisplayed()
        compose.onNodeWithContentDescription("حسابي").performClick()
        assertEquals("account", opened)
        tapItem("استكشف العقارات")
        assertEquals("properties", opened)
        tapItem("استكشف الفنادق واحجز")
        assertEquals("hotels", opened)
        tapItem("دع سول يساعدك")
        assertEquals("sol", opened)
        tapItem("الخدمات ولوحات الإدارة")
        assertEquals("services", opened)
    }

    @Test fun guestServicesHaveWorkingDestinationsWithoutAdminTools() {
        var opened = ""
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AqartkomTheme(false) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        ServicesScreen(Modifier, null, { opened = it }, { opened = "history" })
                    }
                }
            }
        }
        snapshot("04-services")
        compose.onNodeWithText("سول — مساعدك الخاص").performClick()
        assertEquals("/sol.html", opened)
        tapItem("بوابة أصحاب الفنادق والمؤجرين")
        assertEquals("/host-portal.html", opened)
        compose.onNodeWithText("لوحة الإدارة").assertDoesNotExist()
        compose.onNodeWithText("المشرفون والصلاحيات").assertDoesNotExist()
        tapItem("الحجوزات المحفوظة في هذا التطبيق")
        assertEquals("history", opened)
    }

    private fun tapItem(label: String) {
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(label))
        compose.onNodeWithText(label).performClick()
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "ar-rSA-w393dp-h852dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DarkInterfaceTest : InterfaceScreenshotTest() {
    @Test fun darkStartScreenRenders() {
        // A separate worker prevents native graphics state from earlier light
        // captures from affecting this baseline. Theme toggling is tested above.
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                AqartkomTheme(true) {
                    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                        SectionsScreen(Modifier, {}, {}, {}, {}, {}, true, {})
                    }
                }
            }
        }
        compose.onNodeWithText("إقامة تستحقها").assertIsDisplayed()
        snapshot("02-start-dark")
    }
}

abstract class InterfaceScreenshotTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    protected fun snapshot(name: String) {
        compose.waitForIdle()
        val target = File("build/outputs/interface-previews", "$name.png")
        target.parentFile?.mkdirs()
        // Request PixelCopy directly: captureToImage's pre-draw wait does not
        // complete on the host. Hardware capture also preserves cached layers.
        var result = -1
        val bitmap = compose.runOnIdle {
            val view = compose.activity.findViewById<View>(android.R.id.content)
            check(view.width > 0 && view.height > 0)
            val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            val xy = IntArray(2)
            view.getLocationInWindow(xy)
            val bounds = Rect(xy[0], xy[1], xy[0] + view.width, xy[1] + view.height)
            PixelCopy.request(compose.activity.window, bounds, bitmap, { result = it }, Handler(Looper.getMainLooper()))
            bitmap
        }
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(PixelCopy.SUCCESS, result)
        target.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
    }
}
