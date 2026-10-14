package cl.lumastay.huesped.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.ui.screens.AccessScreen
import cl.lumastay.huesped.ui.screens.AiAssistantDialog
import cl.lumastay.huesped.ui.screens.BiometricEnrollmentScreen
import cl.lumastay.huesped.ui.screens.HomeScreen
import cl.lumastay.huesped.ui.screens.ExploreScreen
import cl.lumastay.huesped.ui.screens.ProfileScreen
import cl.lumastay.huesped.ui.screens.PaymentScreen
import cl.lumastay.huesped.ui.screens.PropertyDetailScreen
import cl.lumastay.huesped.ui.screens.ReservationDialog
import cl.lumastay.huesped.ui.screens.ReservationsScreen

@Composable
fun LumaStayRoot(state: LumaStayUiState, viewModel: LumaStayViewModel,
                 onPhoneUnlock: (String) -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    val biometricReservation = state.reservations.firstOrNull { it.id == state.biometricReservationId }
    val paymentReservation = state.reservations.firstOrNull { it.id == state.paymentReservationId }
    val context = androidx.compose.ui.platform.LocalContext.current
    // Abre Webpay en el navegador; la vuelta llega por restblu://webpay.
    LaunchedEffect(state.webpayOpenUrl) {
        if (state.webpayOpenUrl.isNotBlank()) {
            runCatching {
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(state.webpayOpenUrl)))
            }.onSuccess { viewModel.consumeWebpayOpenUrl() }
                .onFailure { viewModel.webpayBrowserFailed() }
        }
    }
    LaunchedEffect(state.message) {
        if (state.message.isNotBlank()) {
            snackbar.showSnackbar(state.message)
            viewModel.consumeMessage()
        }
    }

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val useRail = maxWidth >= 720.dp
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            floatingActionButton = {
                if (biometricReservation == null && paymentReservation == null) {
                    FloatingActionButton(onClick = { viewModel.setAiOpen(true) }) {
                        Icon(Icons.Outlined.SmartToy, "Abrir RestBlu IA")
                    }
                }
            },
            bottomBar = {
                if (!useRail && state.selectedProperty == null && biometricReservation == null && paymentReservation == null) {
                    BottomNavigation(
                        selected = state.section,
                        onSelect = viewModel::selectSection,
                    )
                }
            },
        ) { safePadding ->
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(safePadding),
            ) {
                if (useRail && state.selectedProperty == null && biometricReservation == null && paymentReservation == null) {
                    SideNavigation(selected = state.section, onSelect = viewModel::selectSection)
                }
                Box(modifier = Modifier.weight(1f).fillMaxSize()) {
                    val selected = state.selectedProperty
                    if (biometricReservation != null) {
                        BiometricEnrollmentScreen(
                            reservation = biometricReservation,
                            busy = state.biometricBusy,
                            serverError = state.biometricError,
                            onBack = viewModel::cancelBiometricEnrollment,
                            onSubmit = viewModel::enrollBiometrics,
                        )
                    } else if (paymentReservation != null) {
                        PaymentScreen(
                            reservation = paymentReservation,
                            busy = state.busyReservationId == paymentReservation.id,
                            paymentPending = paymentReservation.id in state.pendingPaymentIds,
                            onBack = viewModel::closePayment,
                            onRefresh = { viewModel.refreshReservation(paymentReservation) },
                            onPay = { viewModel.payWithWebpay(paymentReservation) },
                        )
                    } else if (selected != null) {
                        PropertyDetailScreen(
                            property = selected,
                            search = state.search,
                            onBack = viewModel::closeProperty,
                            onCheckIn = viewModel::setCheckIn,
                            onCheckOut = viewModel::setCheckOut,
                            onGuests = viewModel::setGuests,
                            onReserve = { viewModel.startBooking(selected) },
                            favorite = selected.id in state.favorites,
                            onToggleFavorite = { viewModel.toggleFavorite(selected.id) },
                        )
                    } else {
                        when (state.section) {
                            MainSection.HOME -> HomeScreen(state, viewModel)
                            MainSection.RESERVATIONS -> ReservationsScreen(state, viewModel)
                            MainSection.ACCESS -> AccessScreen(state, viewModel, onPhoneUnlock)
                            MainSection.EXPLORE -> ExploreScreen(viewModel::selectSection, viewModel::setAiOpen)
                            MainSection.PROFILE -> ProfileScreen(state, viewModel)
                        }
                    }
                }
            }
        }
    }
    state.bookingProperty?.let { property ->
        ReservationDialog(
            property = property,
            search = state.search,
            busy = state.busyReservationId.isNotBlank(),
            accountEmail = state.account?.email.orEmpty(),
            profile = state.profile,
            onClose = viewModel::cancelBooking,
            onSubmit = { guest -> viewModel.createReservation(property, guest) },
        )
    }
    if (state.aiOpen) {
        AiAssistantDialog(
            state = state,
            onClose = { viewModel.setAiOpen(false) },
            onAsk = viewModel::askAi,
            onSuggestion = viewModel::openAiSuggestion,
            onFeedback = viewModel::sendAiFeedback,
        )
    }
}

@Composable
private fun BottomNavigation(selected: MainSection, onSelect: (MainSection) -> Unit) {
    BottomAppBar(containerColor = MaterialTheme.colorScheme.surface) {
        MainSection.entries.forEach { section ->
            NavigationBarItem(
                selected = selected == section,
                onClick = { onSelect(section) },
                icon = { Icon(section.icon(), contentDescription = section.label) },
                label = { Text(section.label) },
            )
        }
    }
}

@Composable
private fun SideNavigation(selected: MainSection, onSelect: (MainSection) -> Unit) {
    NavigationRail(containerColor = MaterialTheme.colorScheme.surface) {
        Column(
            modifier = Modifier.weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "RB",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(vertical = 24.dp),
            )
            MainSection.entries.forEach { section ->
                NavigationRailItem(
                    selected = selected == section,
                    onClick = { onSelect(section) },
                    icon = { Icon(section.icon(), contentDescription = section.label) },
                    label = { Text(section.label) },
                )
            }
        }
    }
}

private fun MainSection.icon(): ImageVector = when (this) {
    MainSection.HOME -> Icons.Outlined.Home
    MainSection.RESERVATIONS -> Icons.AutoMirrored.Outlined.ReceiptLong
    MainSection.ACCESS -> Icons.Outlined.Key
    MainSection.EXPLORE -> Icons.Outlined.MoreHoriz
    MainSection.PROFILE -> Icons.Outlined.Person
}
