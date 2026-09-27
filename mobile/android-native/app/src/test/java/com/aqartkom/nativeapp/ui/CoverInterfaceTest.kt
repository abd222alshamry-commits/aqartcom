package com.aqartkom.nativeapp.ui

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.*
import androidx.compose.ui.unit.LayoutDirection
import com.aqartkom.nativeapp.data.*
import com.aqartkom.nativeapp.ui.screens.CoverEditorScreen
import com.aqartkom.nativeapp.ui.screens.PropertyDetailScreen
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [34], qualifiers = "ar-rSA-w393dp-h852dp-xhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CoverInterfaceTest : InterfaceScreenshotTest() {
    private val state = CoverState("revision-1", listOf(CoverMedia("image", "/uploads/one.jpg", "https://example.com/one.jpg", "", "الصورة المرفوعة", false)), "", false)
    private val saved = CoverSaved("https://example.com/one.jpg", "active", "تم الحفظ")

    @Test fun imageSelectionDoesNotSaveUntilVisibleSaveButtonAndFailureCanRetry() {
        val requests = mutableListOf<Pair<CoverChoice, String>>()
        var closed = false
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { AqartkomTheme(false) {
                CoverEditorScreen({ state }, { choice, revision ->
                    requests += choice to revision
                    if (requests.size == 1) throw ApiException("تعذر الاتصال؛ أعد المحاولة", 503)
                    saved
                }, { closed = true }, {})
            } }
        }
        compose.onNodeWithTag("cover-save").assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithTag("cover-media").performScrollToNode(hasTestTag("cover-image-0"))
        compose.onNodeWithTag("cover-image-0").performClick()
        assertTrue(requests.isEmpty())
        compose.onNodeWithTag("cover-save").assertIsDisplayed().assertIsEnabled()
        snapshot("06-cover-save")
        compose.onNodeWithTag("cover-save").performClick()
        compose.onNodeWithTag("cover-error").assertTextEquals("تعذر الاتصال؛ أعد المحاولة")
        assertFalse(closed)
        compose.onNodeWithTag("cover-save").performClick()
        compose.runOnIdle {
            assertTrue(closed)
            assertEquals(2, requests.size)
            assertEquals(CoverChoice("image", "/uploads/one.jpg") to "revision-1", requests.last())
        }
    }

    @Test fun automaticIsDefaultAndNeverRequiresManualFrameSelection() {
        var request: CoverChoice? = null
        compose.setContent { AqartkomTheme(false) { CoverEditorScreen({ state.copy(automatic = true) }, { choice, _ -> request = choice; saved }, {}, {}) } }
        compose.onNodeWithTag("cover-save").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(CoverChoice("auto"), request) }
    }

    @Test fun staleRevisionRequiresReloadAndReselection() {
        var loads = 0
        var saves = 0
        compose.setContent { AqartkomTheme(false) {
            CoverEditorScreen({ loads++; state.copy(revision = "revision-$loads") }, { _, _ -> saves++; throw ApiException("تغيرت الوسائط", 409) }, {}, {})
        } }
        compose.onNodeWithTag("cover-media").performScrollToNode(hasTestTag("cover-image-0"))
        compose.onNodeWithTag("cover-image-0").performClick()
        compose.onNodeWithTag("cover-save").performClick()
        compose.onNodeWithTag("cover-save").assertIsNotEnabled()
        compose.onNodeWithText("تحديث الوسائط وإعادة الاختيار").performClick()
        compose.onNodeWithTag("cover-save").assertIsNotEnabled()
        compose.runOnIdle { assertEquals(2, loads); assertEquals(1, saves) }
    }

    @Test fun detailShowsVideoBeforeUploadedPhotographs() {
        val property = PropertyParser("https://example.com").parse(JSONObject("""{"id":42,"title":"شقة في دمشق","images":[{"url":"/room.jpg"}],"primary_video":{"url":"/tour.mp4","poster_url":"/poster.jpg","title":"جولة في العقار"}}"""))
        compose.setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) { AqartkomTheme(false) {
                PropertyDetailScreen(LoadState.Ready(property), false, {}, {}, {}, {}, {}, {}, false)
            } }
        }
        compose.onNodeWithText("فيديو العقار").assertIsDisplayed()
        val videoTop = compose.onNodeWithTag("detail-videos").fetchSemanticsNode().boundsInRoot.top
        val photoTop = compose.onNodeWithTag("detail-photos").fetchSemanticsNode().boundsInRoot.top
        assertTrue(videoTop < photoTop)
        snapshot("07-video-first")
    }
}
