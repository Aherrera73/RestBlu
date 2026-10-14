package cl.lumastay.huesped.ui.screens

import android.graphics.BitmapFactory
import android.util.Base64
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.DoorFront
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import kotlinx.coroutines.delay
import java.time.Instant
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.ui.components.NetworkImage
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

@Composable
fun AccessScreen(state: LumaStayUiState, viewModel: LumaStayViewModel,
                 onPhoneUnlock: (String) -> Unit) {
    val verifiedReservations = state.reservations.filter { it.verified }
    val reservation = verifiedReservations.firstOrNull { it.id == state.activeReservationId }
        ?: verifiedReservations.firstOrNull()
    // El lector acepta cada QR 10 minutos: mientras esta pantalla está abierta
    // se pide uno nuevo cada minuto.
    LaunchedEffect(reservation?.id) {
        val id = reservation?.id ?: return@LaunchedEffect
        while (true) {
            viewModel.refreshAccessQr(id)
            delay(60_000)
        }
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column {
                Text("PANEL DE ACCESO", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("Tu pase digital", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                Text("Tu QR de acceso aparece al confirmar el pago de tu reserva.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (verifiedReservations.size > 1) {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(verifiedReservations, key = { it.id }) { item ->
                        FilterChip(
                            selected = item.id == reservation?.id,
                            onClick = { viewModel.selectAccessReservation(item.id) },
                            label = { Text(item.propertyName) },
                        )
                    }
                }
            }
        }
        item {
            if (reservation == null) LockedAccess { viewModel.selectSection(MainSection.RESERVATIONS) }
            else ResponsiveAccessPass(reservation, state.doorAccessBusyId == reservation.id,
                onPhoneUnlock, viewModel::openDoorNow)
        }
    }
}

@Composable
private fun LockedAccess(onReservations: () -> Unit) {
    Surface(shape = RoundedCornerShape(24.dp), tonalElevation = 2.dp) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(Icons.Outlined.Lock, null, modifier = Modifier.size(58.dp), tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(12.dp))
            Text("Pase bloqueado", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
            Text("Paga una reserva para habilitar tu QR de acceso.", textAlign = TextAlign.Center)
            Spacer(Modifier.height(16.dp))
            Button(onClick = onReservations) { Text("Ir a mis reservas") }
        }
    }
}

@Composable
private fun ResponsiveAccessPass(reservation: Reservation, doorAccessBusy: Boolean,
                                 onPhoneUnlock: (String) -> Unit, onOpenNow: (String) -> Unit) {
    BoxWithConstraints {
        if (maxWidth >= 700.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Top) {
                AccessDetails(reservation, Modifier.weight(1f))
                PassCard(reservation, Modifier.weight(1f), doorAccessBusy, onPhoneUnlock, onOpenNow)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                AccessDetails(reservation, Modifier.fillMaxWidth())
                PassCard(reservation, Modifier.fillMaxWidth(), doorAccessBusy, onPhoneUnlock, onOpenNow)
            }
        }
    }
}

@Composable
private fun AccessDetails(reservation: Reservation, modifier: Modifier) {
    Card(modifier = modifier, shape = RoundedCornerShape(24.dp), elevation = CardDefaults.cardElevation(2.dp)) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text("RESERVA CONFIRMADA", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text(reservation.propertyName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            Text(reservation.propertyPlace, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            AccessRow("Código", reservation.id)
            AccessRow("Check-in", reservation.checkIn + " · desde las 15:00")
            AccessRow("Check-out", reservation.checkOut + " · hasta las 11:00")
            AccessRow("Huésped", reservation.guestName)
            AccessRow("Personas", reservation.guests.toString())
            Spacer(Modifier.height(12.dp))
            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(16.dp)) {
                Text(
                    "Tu acceso está habilitado hasta el check-out. Muestra el QR en el lector de la entrada.",
                    modifier = Modifier.padding(14.dp),
                )
            }
        }
    }
}

@Composable
private fun AccessRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.weight(1f).padding(start = 12.dp))
    }
}

@Composable
private fun PassCard(reservation: Reservation, modifier: Modifier,
                     doorAccessBusy: Boolean, onPhoneUnlock: (String) -> Unit,
                     onOpenNow: (String) -> Unit) {
    val context = LocalContext.current
    val content = listOf(
        "RESTBLU - PASE DIGITAL",
        "Reserva: ${reservation.id}",
        "Alojamiento: ${reservation.propertyName}",
        "Ubicacion: ${reservation.propertyPlace}",
        "Check-in: ${reservation.checkIn}",
        "Check-out: ${reservation.checkOut}",
        "Huespedes: ${reservation.guests}",
        "Estado: CONFIRMADA",
    ).joinToString("\n")
    val encoded = URLEncoder.encode(content, StandardCharsets.UTF_8.toString())
    val qrUrl = "https://quickchart.io/qr?text=$encoded&size=420&margin=3&dark=0b6871&light=ffffff&ecLevel=M&format=png"
    Card(modifier = modifier, shape = RoundedCornerShape(24.dp), elevation = CardDefaults.cardElevation(2.dp)) {
        Column(modifier = Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.QrCode2, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(7.dp))
                Text("PASE DE ACCESO", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.ExtraBold)
            }
            // El QR de acceso lo genera el gestor: su código abre la puerta y no
            // debe pasar por el servicio externo que dibuja el QR informativo.
            val accessQrFresh = runCatching {
                Instant.parse(reservation.accessQrExpiresAt).isAfter(Instant.now())
            }.getOrDefault(false)
            val accessQrBitmap = if (!accessQrFresh) null else remember(reservation.accessQrImage) {
                runCatching {
                    val bytes = Base64.decode(reservation.accessQrImage, Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                }.getOrNull()
            }
            if (accessQrBitmap != null) {
                Image(
                    bitmap = accessQrBitmap,
                    contentDescription = "Código QR de acceso de la reserva ${reservation.id}",
                    modifier = Modifier.size(270.dp).padding(12.dp),
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                )
                Text(
                    "Muestra este QR en el lector de acceso. Se renueva solo cada pocos minutos.",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(10.dp))
            } else {
                Text(
                    if (reservation.dahuaQrStatus == "activo") "Actualizando el QR de acceso…"
                    else "Tu acceso se está habilitando en el terminal.",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                )
                NetworkImage(
                    url = qrUrl,
                    contentDescription = "Código QR de la reserva ${reservation.id}",
                    modifier = Modifier.size(270.dp).padding(12.dp),
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                )
            }
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = { onOpenNow(reservation.id) },
                enabled = reservation.dahuaQrStatus == "activo" && !doorAccessBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.DoorFront, null)
                Spacer(Modifier.width(8.dp))
                Text(if (doorAccessBusy) "Abriendo puerta…" else "Abrir puerta ahora")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { onPhoneUnlock(reservation.id) },
                enabled = reservation.dahuaQrStatus == "activo" && !doorAccessBusy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Outlined.Fingerprint, null)
                Spacer(Modifier.width(8.dp))
                Text("Abrir con biometría del teléfono")
            }
            Text(
                "Ambas opciones requieren tu reserva vigente, internet y el terminal conectado. La apertura biométrica usa la huella de este teléfono; no se envía a Dahua.",
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
