package cl.lumastay.huesped.ui.screens

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.core.util.PdfManager
import cl.lumastay.huesped.core.util.formatCurrency
import cl.lumastay.huesped.core.util.friendlyDate
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.features.PdfPayload
import cl.lumastay.huesped.ui.theme.Success
import cl.lumastay.huesped.ui.theme.Warning

@Composable
fun ReservationsScreen(state: LumaStayUiState, viewModel: LumaStayViewModel) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(330.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                Text("MIS RESERVAS", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("Tus estadías y accesos", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                Text(
                    if (state.account?.emailVerified == true) "Tus reservas en todos tus dispositivos." else "Inicia sesión para ver tus reservas.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (state.reservations.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(shape = RoundedCornerShape(22.dp), tonalElevation = 1.dp) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Outlined.MarkEmailRead, null, modifier = Modifier.size(52.dp), tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(10.dp))
                        if (state.account?.emailVerified != true) {
                            Text("Ingresa a tu cuenta", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Tus reservas y tu QR de acceso quedan guardados en tu cuenta RestBlu.")
                            Spacer(Modifier.height(14.dp))
                            Button(onClick = { viewModel.selectSection(MainSection.PROFILE) }) { Text("Ingresar") }
                        } else if (state.reservationsLoading) {
                            CircularProgressIndicator()
                        } else {
                            Text("Todavía no tienes reservas", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Busca un alojamiento, elige tus fechas y reserva con tu cuenta.")
                            Spacer(Modifier.height(14.dp))
                            Button(onClick = { viewModel.selectSection(MainSection.HOME) }) { Text("Explorar alojamientos") }
                        }
                    }
                }
            }
        }
        items(state.reservations, key = { it.id }) { reservation ->
            ReservationCard(
                reservation = reservation,
                busy = state.busyReservationId == reservation.id,
                paymentPending = reservation.id in state.pendingPaymentIds,
                canContinuePayment = viewModel.canContinueWebpay(reservation.id),
                pdf = state.pdfs[reservation.id],
                onRefresh = { viewModel.refreshReservation(reservation) },
                onPayment = { viewModel.openPayment(reservation) },
                onContinuePayment = { viewModel.continueWebpay(reservation) },
                onAccess = { viewModel.showAccess(reservation) },
                onBiometric = { viewModel.startBiometricEnrollment(reservation) },
            )
        }
    }
}

@Composable
fun PaymentScreen(reservation: Reservation, busy: Boolean, paymentPending: Boolean, onBack: () -> Unit, onRefresh: () -> Unit, onPay: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        OutlinedButton(onClick = onBack) { Text("Volver a mis reservas") }
        Text("PAGO CON WEBPAY", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        Text("Paga tu reserva", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
        Card {
            Column(Modifier.fillMaxWidth().padding(16.dp)) {
                Text(reservation.propertyName, fontWeight = FontWeight.Bold)
                Text("${reservation.id} · ${formatCurrency(reservation.total)}")
                Text("${friendlyDate(reservation.checkIn)} → ${friendlyDate(reservation.checkOut)}")
            }
        }
        if (reservation.verified || reservation.paymentStatus == "aprobado-demo" || reservation.paymentStatus == "reembolso-pendiente") {
            Text("Esta reserva ya registra un pago. Actualiza su estado desde Reservas.")
        } else if (paymentPending && reservation.status.equals("expirada", ignoreCase = true)) {
            Text("La reserva venció sin confirmación del gestor. Si Webpay mostró un cobro, conserva el comprobante y no inicies otro pago.", color = MaterialTheme.colorScheme.error)
        } else if (paymentPending) {
            Text("Ya hay un intento de pago en curso. Vuelve a Reservas y actualiza el estado; no hagas un segundo pago.")
        } else if (reservation.status.equals("pendiente-sincronizacion", ignoreCase = true)) {
            Text("Estamos registrando tu reserva. El pago se habilitará automáticamente cuando el gestor la confirme.")
        } else if (reservation.status.equals("expirada", ignoreCase = true)) {
            Text("El plazo para pagar esta reserva venció y las fechas quedaron disponibles. Haz una nueva reserva.", color = MaterialTheme.colorScheme.error)
        } else {
            Text("Te llevaremos al formulario seguro de Transbank. Al terminar volverás a Reservas para consultar la confirmación del pago y la activación del QR de acceso.")
            Button(onClick = onPay, enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("Pagar ${formatCurrency(reservation.total)} con Webpay")
            }
        }
        OutlinedButton(onClick = onRefresh, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "Consultando…" else "Ya pagué · actualizar estado")
        }
    }
}

@Composable
private fun ReservationCard(
    reservation: Reservation,
    busy: Boolean,
    paymentPending: Boolean,
    canContinuePayment: Boolean,
    pdf: PdfPayload?,
    onRefresh: () -> Unit,
    onPayment: () -> Unit,
    onContinuePayment: () -> Unit,
    onAccess: () -> Unit,
    onBiometric: () -> Unit,
) {
    val context = LocalContext.current
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
    ) {
        if (reservation.propertyImage.isNotBlank()) {
            cl.lumastay.huesped.ui.components.NetworkImage(
                url = reservation.propertyImage,
                contentDescription = reservation.propertyName,
                modifier = Modifier.fillMaxWidth().height(150.dp),
                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
            )
        }
        Column(modifier = Modifier.padding(18.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(reservation.propertyName, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                    Text(reservation.propertyPlace, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                StatusPill(reservation.verified, reservation.status)
            }
            Spacer(Modifier.height(12.dp))
            Text(reservation.id, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text("${friendlyDate(reservation.checkIn)} → ${friendlyDate(reservation.checkOut)}")
            Text("${reservation.nights} noches · ${reservation.guests} huéspedes · ${formatCurrency(reservation.total)}")
            Text(
                when {
                    reservation.paymentStatus == "aprobado-demo" -> "Pagado con Webpay"
                    reservation.paymentStatus == "reembolso-pendiente" -> "Pago aprobado · reembolso en proceso"
                    paymentPending && reservation.status.equals("expirada", ignoreCase = true) -> "Pago sin confirmar · reserva vencida"
                    paymentPending -> "Pago en verificación con Webpay"
                    else -> "Pago pendiente"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(14.dp))
            HorizontalDivider()
            Spacer(Modifier.height(14.dp))
            if (!reservation.verified) {
                val expired = reservation.status.equals("expirada", ignoreCase = true)
                val awaitingSync = reservation.status.equals("pendiente-sincronizacion", ignoreCase = true)
                val alreadyPaid = reservation.paymentStatus == "aprobado-demo" || reservation.paymentStatus == "reembolso-pendiente"
                Text(
                    when {
                        alreadyPaid -> "Esta reserva ya registra un pago. Pulsa Actualizar para consultar su estado."
                        expired && paymentPending -> "El gestor no recibió la confirmación del pago antes del vencimiento. Si Webpay mostró un cobro, conserva el comprobante y no pagues otra vez."
                        paymentPending -> "Estamos esperando la confirmación del pago. No vuelvas a pagar; pulsa Actualizar para consultar el resultado."
                        reservation.syncError.isNotBlank() -> reservation.syncError
                        expired -> "El plazo para pagar venció y las fechas quedaron disponibles. Si Webpay mostró un cobro, conserva el comprobante y no pagues de nuevo."
                        reservation.status.equals("pendiente-sincronizacion", ignoreCase = true) -> "Estamos registrando tu reserva. En unos segundos podrás pagarla."
                        else -> "Completa el pago con Webpay para habilitar tu QR de acceso."
                    },
                    color = if (reservation.syncError.isNotBlank() && !paymentPending) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(10.dp))
                if (paymentPending && canContinuePayment && !expired && !alreadyPaid) {
                    OutlinedButton(onClick = onContinuePayment, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("Continuar el mismo pago en Webpay")
                    }
                    Spacer(Modifier.height(8.dp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!expired && !awaitingSync && !paymentPending && !alreadyPaid) Button(onClick = onPayment, modifier = Modifier.weight(1f)) { Text("Pagar") }
                    OutlinedButton(onClick = onRefresh, enabled = !busy, modifier = Modifier.weight(1f)) {
                        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Outlined.Refresh, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Actualizar")
                    }
                }
            } else {
                Button(onClick = onAccess, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.Key, null)
                    Spacer(Modifier.width(7.dp))
                    Text("Ver pase de acceso")
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = onBiometric,
                    enabled = reservation.biometricStatus != "activa",
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Outlined.Face, null)
                    Spacer(Modifier.width(7.dp))
                    Text(if (reservation.biometricStatus == "activa") "Biometría registrada" else "Registrar biometría")
                }
                if (pdf == null) {
                    Spacer(Modifier.height(8.dp))
                    Surface(
                        color = MaterialTheme.colorScheme.primaryContainer,
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(
                            when {
                                reservation.confirmationEmailSent -> "Te enviamos el comprobante PDF por correo. Pulsa Actualizar para verlo aquí."
                                else -> "Tu pase está habilitado. Pulsa Actualizar para descargar el comprobante."
                            },
                            modifier = Modifier.fillMaxWidth().padding(14.dp),
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                } else {
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PdfActionButton(
                            icon = Icons.AutoMirrored.Outlined.OpenInNew,
                            label = "Abrir",
                            onClick = { PdfManager.open(context, pdf.base64, pdf.fileName) },
                            modifier = Modifier.weight(1f),
                        )
                        PdfActionButton(
                            icon = Icons.Outlined.Download,
                            label = "Guardar",
                            onClick = {
                                val result = runCatching { PdfManager.saveToDownloads(context, pdf.base64, pdf.fileName) }
                                Toast.makeText(context, result.getOrElse { it.message ?: "No se pudo guardar." }, Toast.LENGTH_LONG).show()
                            },
                            modifier = Modifier.weight(1f),
                        )
                        PdfActionButton(
                            icon = Icons.Outlined.Share,
                            label = "Compartir",
                            onClick = { PdfManager.share(context, pdf.base64, pdf.fileName) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PdfActionButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.height(70.dp),
        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 8.dp),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(21.dp))
            Spacer(Modifier.height(3.dp))
            Text(label, maxLines = 1, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun StatusPill(verified: Boolean, status: String) {
    val failed = status.equals("error", ignoreCase = true)
    val awaitingSync = status.equals("pendiente-sincronizacion", ignoreCase = true)
    val color = when {
        verified -> Success
        failed -> MaterialTheme.colorScheme.error
        else -> Warning
    }
    val label = when {
        verified -> "CONFIRMADA"
        failed -> "ERROR"
        awaitingSync -> "EN PROCESO"
        status.equals("expirada", ignoreCase = true) -> "VENCIDA"
        else -> "PAGO PENDIENTE"
    }
    Surface(color = color.copy(alpha = .13f), contentColor = color, shape = RoundedCornerShape(20.dp)) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.ExtraBold,
        )
    }
}
