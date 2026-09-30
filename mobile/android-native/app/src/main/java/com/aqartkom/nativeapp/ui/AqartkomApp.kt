package com.aqartkom.nativeapp.ui

import android.content.Intent
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch
import com.aqartkom.nativeapp.AqartkomApplication
import com.aqartkom.nativeapp.SiteActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import com.aqartkom.nativeapp.AppViewModel
import com.aqartkom.nativeapp.HotelsViewModel
import com.aqartkom.nativeapp.data.*
import com.aqartkom.nativeapp.ui.screens.*

private enum class Destination(val label: String, val icon: ImageVector) {
    Services("الخدمات", Icons.Default.GridView), Sections("الرئيسية", Icons.Default.Apps), Home("العقارات", Icons.Default.HomeWork), Search("البحث", Icons.Default.Search), Hotels("الفنادق", Icons.Default.Hotel),
    Add("أضف", Icons.Default.Add), Map("الخريطة", Icons.Default.Map), Account("حسابي", Icons.Default.PersonOutline)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AqartkomApp(viewModel: AppViewModel, darkMode: Boolean, toggleDarkMode: () -> Unit) {
    var showNotifications by rememberSaveable { mutableStateOf(false) }
    var unreadNotifications by remember { mutableIntStateOf(0) }
    val hotelsViewModel: HotelsViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
    var destination by rememberSaveable { mutableStateOf(Destination.Sections) }
    var coverId by rememberSaveable { mutableStateOf<String?>(null) }
    var collection by rememberSaveable { mutableStateOf<CollectionPage?>(null) }
    var mapFromSearch by rememberSaveable { mutableStateOf(false) }
    var mapProperty by remember { mutableStateOf<Property?>(null) }
    val selected by viewModel.selected.collectAsStateWithLifecycle()
    val home by viewModel.home.collectAsStateWithLifecycle()
    val search by viewModel.properties.collectAsStateWithLifecycle()
    val favorites by viewModel.favorites.collectAsStateWithLifecycle()
    val compared by viewModel.comparison.collectAsStateWithLifecycle()
    val user by viewModel.user.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val busy by viewModel.busy.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val pageState = rememberSaveableStateHolder()
    val focus = LocalFocusManager.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val siteLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { viewModel.refreshAfterSite() }
    fun openSite(path: String) {
        if (path.startsWith("/hotels.html") && !path.startsWith("/hotels.html#booking=") && hotelsViewModel.pending.value != null) {
            hotelsViewModel.history(); destination = Destination.Hotels
            return
        }
        scope.launch {
        try {
            (context.applicationContext as AqartkomApplication).api.prepareSiteSession()
            siteLauncher.launch(Intent(context, SiteActivity::class.java).putExtra("path", path))
        } catch (_: Exception) { viewModel.showMessage("تعذر فتح الخدمة؛ أعد المحاولة") }
    } }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(user?.id, lifecycleOwner) {
        unreadNotifications = 0
        if (user == null) return@LaunchedEffect
        lifecycleOwner.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                try {
                    val result = (context.applicationContext as AqartkomApplication).api.notifications()
                    if (result.optLong("user_id") == user?.id) {
                        unreadNotifications = result.optInt("unread")
                        BookingNotifications.show(context, result)
                    }
                } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (_: Exception) { }
                kotlinx.coroutines.delay(30000)
            }
        }
    }
    if (showNotifications) {
        BackHandler { showNotifications = false }
        BookingNotificationsScreen(onBack = { showNotifications = false }, openInbox = { openSite("/notifications.html") })
        return
    }
    fun searchFor(filters: SearchFilters) { focus.clearFocus(); viewModel.refresh(filters); destination = Destination.Search; collection = null }
    fun showMap(fromSearch: Boolean) { focus.clearFocus(); mapProperty = null; mapFromSearch = fromSearch; destination = Destination.Map }
    fun goHome() { collection = null; mapProperty = null; destination = Destination.Home }

    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); viewModel.clearMessage() } }
    LaunchedEffect(collection) {
        when (collection) {
            CollectionPage.Favorites -> viewModel.loadFavoriteListings()
            CollectionPage.MyAds, CollectionPage.Inbox -> viewModel.loadDashboard()
            else -> Unit
        }
    }
    if (coverId != null) {
        val id = coverId!!
        key(id) {
            CoverEditorScreen(load = { viewModel.loadCover(id) }, save = { choice, revision -> viewModel.saveCover(id, choice, revision) },
                onSaved = { result -> viewModel.coverSaved(id, result); coverId = null }, onBack = { coverId = null })
        }
        return
    }
    if (mapProperty != null) {
        val property = mapProperty!!
        BackHandler { mapProperty = null }
        Scaffold(topBar = { TopAppBar(title = { Text("موقع العقار") }, navigationIcon = { IconButton({ mapProperty = null }) { Icon(Icons.Default.ArrowForward, "العودة إلى الإعلان") } }) }) { padding ->
            MapScreen(Modifier.padding(padding), LoadState.Ready(listOf(property)), { mapProperty = null }, {}, property.id)
        }
        return
    }
    if (selected != null) {
        BackHandler(onBack = viewModel::clearSelected)
        val current = (selected as? LoadState.Ready<Property>)?.value
        var canEdit by remember(current?.id, user?.id) { mutableStateOf(false) }
        LaunchedEffect(current?.id, user?.id) { canEdit = current?.id?.let { if (user != null) viewModel.canEditCover(it) else false } ?: false }
        pageState.SaveableStateProvider("detail-${current?.id ?: "loading"}") {
            PropertyDetailScreen(state = selected!!, favorite = current?.id in favorites,
                onBack = viewModel::clearSelected, onFavorite = { current?.id?.let(viewModel::toggleFavorite) },
                onRetry = viewModel::retrySelected, onMessage = viewModel::showMessage,
                onMap = { p -> mapProperty = p },
                onCompare = viewModel::toggleCompare, compared = compared.any { it.id == current?.id },
                snackbarHost = { SnackbarHost(snackbar) }, canEditCover = canEdit, onEditCover = { coverId = current?.id })
        }
        return
    }
    if (collection != null) {
        BackHandler { collection = null }
        pageState.SaveableStateProvider("collection-${collection!!.name}") {
            CollectionScreen(viewModel, collection!!, { collection = null }, { goHome() }, snackbar)
        }
        return
    }
    BackHandler(enabled = destination != Destination.Sections) {
        destination = when {
            destination == Destination.Map && mapFromSearch -> Destination.Search
            destination == Destination.Home || destination == Destination.Hotels || destination == Destination.Account -> Destination.Sections
            else -> Destination.Home
        }
    }
    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
        if (destination != Destination.Sections) Surface {
            Row(Modifier.fillMaxWidth().statusBarsPadding().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ showNotifications = true }) { BadgedBox(badge = { if (unreadNotifications > 0) Badge { Text(unreadNotifications.toString()) } }) { Icon(Icons.Default.NotificationsNone, "الإشعارات") } }
                IconButton({ destination = Destination.Sections }) { Icon(Icons.Default.Apps, "اختيار القسم") }
                FilterChip(selected = destination in listOf(Destination.Home, Destination.Search, Destination.Add, Destination.Map), onClick = { destination = Destination.Home }, label = { Text("العقارات") })
                FilterChip(selected = destination == Destination.Hotels, onClick = { openSite("/hotels.html") }, label = { Text("الفنادق والحجوزات") })
            }
        }
    }, bottomBar = {
        if (destination != Destination.Sections) {
        Column {
            if (compared.isNotEmpty() && destination != Destination.Hotels) Surface(onClick = { collection = CollectionPage.Compare }, color = Navy, contentColor = Color.White, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), shape = RoundedCornerShape(14.dp)) {
                Row(Modifier.padding(horizontal = 15.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.CompareArrows, null, tint = Gold); Text("مقارنة العقارات (${compared.size}/3)", Modifier.weight(1f).padding(horizontal = 10.dp), style = MaterialTheme.typography.labelLarge); Text("عرض", color = Gold); Icon(Icons.Default.ChevronLeft, null, tint = Gold) }
            }
            Surface(
                modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
                shape = RoundedCornerShape(26.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                shadowElevation = 4.dp
            ) {
            NavigationBar(containerColor = Color.Transparent, tonalElevation = 0.dp, windowInsets = WindowInsets(0, 0, 0, 0)) {
                (if (destination == Destination.Hotels || destination == Destination.Account) listOf(Destination.Sections, Destination.Hotels, Destination.Services, Destination.Account)
                else listOf(Destination.Home, Destination.Search, Destination.Add, Destination.Services, Destination.Account)).forEach { item ->
                    NavigationBarItem(selected = destination == item, onClick = {
                        focus.clearFocus()
                        if (item == Destination.Search && search is LoadState.Loading) viewModel.refresh()
                        if (item == Destination.Map) { mapFromSearch = false; mapProperty = null }
                        if (item == Destination.Hotels) openSite("/hotels.html") else destination = item
                    }, icon = {
                        if (item == Destination.Add) Surface(color = MaterialTheme.colorScheme.primary, shape = RoundedCornerShape(14.dp)) { Icon(item.icon, null, Modifier.padding(8.dp), tint = MaterialTheme.colorScheme.onPrimary) }
                        else Icon(item.icon, null)
                    }, label = { Text(item.label, fontSize = 11.sp, maxLines = 1) }, alwaysShowLabel = true,
                        colors = NavigationBarItemDefaults.colors(indicatorColor = MaterialTheme.colorScheme.primaryContainer, selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer, selectedTextColor = MaterialTheme.colorScheme.primary, unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant, unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant))
                }
            }
            }
        }
        }
    }) { padding ->
        AnimatedContent(targetState = destination, transitionSpec = { fadeIn(tween(160)) togetherWith fadeOut(tween(100)) }, label = "main-navigation") { page ->
            pageState.SaveableStateProvider(page.name) {
                when (page) {
                    Destination.Sections -> SectionsScreen(Modifier.padding(padding), { destination = Destination.Home }, { openSite("/hotels.html") }, { destination = Destination.Account }, { destination = Destination.Services }, { openSite("/sol.html") }, darkMode, toggleDarkMode, ::openSite, { showNotifications = true }, unreadNotifications)
                    Destination.Services -> ServicesScreen(Modifier.padding(padding), user, ::openSite) { hotelsViewModel.history(); destination = Destination.Hotels }
                    Destination.Home -> HomeScreen(Modifier.padding(padding), home, favorites, compared.map { it.id }.toSet(), darkMode, toggleDarkMode,
                        { collection = CollectionPage.Favorites }, viewModel::openProperty, viewModel::toggleFavorite, viewModel::toggleCompare,
                        viewModel::refreshHome, ::searchFor, { showMap(false) }, { destination = Destination.Add })
                    Destination.Hotels -> LegacyBookingsScreen(Modifier.padding(padding), hotelsViewModel, ::openSite) { destination = Destination.Services }
                    Destination.Search -> SearchScreen(Modifier.padding(padding), viewModel, viewModel::openProperty) { showMap(true) }
                    Destination.Map -> MapScreen(Modifier.padding(padding), if (mapFromSearch) search else home, viewModel::openProperty, { if (mapFromSearch) viewModel.refresh() else viewModel.refreshHome() })
                    Destination.Add -> AddPropertyScreen(Modifier.padding(padding), viewModel, user, busy, onLogin = { destination = Destination.Account }) { id -> pageState.removeState(Destination.Add.name); destination = Destination.Home; coverId = id }
                    Destination.Account -> AccountScreen(Modifier.padding(padding), viewModel, user, busy, favorites.size, compared.size, darkMode, toggleDarkMode,
                        { collection = CollectionPage.Favorites }, { collection = CollectionPage.Compare }, { openSite("/my-listings.html") }, { collection = CollectionPage.Inbox }, { destination = Destination.Add }, { openSite("/hotels.html") }, { destination = Destination.Services }, { openSite("/sol.html") })
                }
            }
        }
    }
}
