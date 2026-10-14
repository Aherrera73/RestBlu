package cl.lumastay.huesped.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Gavel
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Cake
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.CustomerProfile
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.core.util.formatCurrency
import cl.lumastay.huesped.core.util.friendlyDate
import cl.lumastay.huesped.core.util.isValidRut
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.ui.components.NetworkImage
import cl.lumastay.huesped.ui.components.RutTextField
import cl.lumastay.huesped.ui.theme.Aqua
import cl.lumastay.huesped.ui.theme.BrandGradient
import cl.lumastay.huesped.ui.theme.EyebrowStyle
import cl.lumastay.huesped.ui.theme.Heart
import cl.lumastay.huesped.ui.theme.Navy
import java.time.LocalDate

private const val SUPPORT_EMAIL = "aherrera.bitfot@gmail.com"

private enum class AccountTab(val label: String) { SUMMARY("Resumen"), FAVORITES("Favoritos"), DETAILS("Mis datos"), SECURITY("Seguridad y ayuda") }

@Composable
fun AccountDashboard(state: LumaStayUiState, viewModel: LumaStayViewModel) {
    var tab by rememberSaveable { mutableStateOf(AccountTab.SUMMARY) }
    val account = state.account ?: return
    val profile = state.profile
    val today = LocalDate.now().toString()
    val confirmed = state.reservations.filter { it.verified }
    val upcoming = confirmed.filter { it.checkOut >= today }.sortedBy { it.checkIn }
    val past = confirmed.filter { it.checkOut < today }
    val nights = confirmed.sumOf { it.nights }
    val favorites = state.properties.filter { it.id in state.favorites }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        // Cabecera
        Surface(shape = RoundedCornerShape(28.dp), color = Color.Transparent) {
            Column(Modifier.fillMaxWidth().background(BrandGradient).padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier.size(64.dp).clip(RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp, bottomStart = 32.dp, bottomEnd = 10.dp)).background(Aqua),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(initials(profile?.name.orEmpty(), account.email), color = Navy, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                    }
                    Column(Modifier.weight(1f).padding(start = 14.dp)) {
                        Text("MI CUENTA RESTBLU", color = Aqua, style = EyebrowStyle)
                        Text(
                            "Hola${profile?.name?.substringBefore(' ')?.let { ", $it" }.orEmpty()}",
                            color = Color.White, style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        Text(account.email, color = Color.White.copy(alpha = .75f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                Spacer(Modifier.height(18.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    StatBox("Reservas", confirmed.size.toString(), Modifier.weight(1f))
                    StatBox("Noches", nights.toString(), Modifier.weight(1f))
                    StatBox("Favoritos", state.favorites.size.toString(), Modifier.weight(1f))
                }
                if (upcoming.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Surface(color = Color.White.copy(alpha = .12f), shape = RoundedCornerShape(16.dp)) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.CalendarMonth, null, tint = Aqua)
                            Spacer(Modifier.width(10.dp))
                            Text("Próxima estadía: ${friendlyDate(upcoming.first().checkIn)}", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AccountTab.entries.forEach { item ->
                FilterChip(selected = tab == item, onClick = { tab = item }, label = { Text(item.label, fontWeight = FontWeight.Bold) })
            }
        }

        when (tab) {
            AccountTab.SUMMARY -> {
                SectionCard("Próxima estadía") {
                    val next = upcoming.firstOrNull()
                    if (next == null) {
                        EmptyText("No tienes estadías próximas.")
                        Button(onClick = { viewModel.selectSection(MainSection.HOME) }, modifier = Modifier.fillMaxWidth()) { Text("Buscar alojamiento") }
                    } else {
                        TripRow(next, highlight = true) { viewModel.showAccess(next) }
                    }
                }
                if (past.isNotEmpty()) {
                    SectionCard("Estadías anteriores") {
                        past.forEach { TripRow(it) { viewModel.selectSection(MainSection.RESERVATIONS) } }
                    }
                }
                OutlinedButton(onClick = { viewModel.selectSection(MainSection.RESERVATIONS) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Ver todas mis reservas")
                }
            }
            AccountTab.FAVORITES -> SectionCard("Favoritos") {
                if (favorites.isEmpty()) EmptyText("Toca el corazón en un alojamiento para guardarlo aquí.")
                favorites.forEach { property ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable { viewModel.showProperty(property) }.padding(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        NetworkImage(property.image, property.name, Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)), ContentScale.Crop)
                        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                            Text(property.name, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(property.place, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("${property.price} / noche", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                        }
                        androidx.compose.material3.IconButton(onClick = { viewModel.toggleFavorite(property.id) }) {
                            Icon(Icons.Filled.Favorite, "Quitar de favoritos", tint = Heart)
                        }
                    }
                }
            }
            AccountTab.DETAILS -> DetailsForm(
                profile = profile,
                rutLocked = confirmed.isNotEmpty(),
                busy = state.authBusy,
                onSave = viewModel::saveProfileDetails,
            )
            AccountTab.SECURITY -> SecurityPanel(state, viewModel, hasUpcoming = upcoming.isNotEmpty())
        }
        AccountMessages(state)
    }
}

private fun initials(name: String, email: String): String {
    val parts = name.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    return if (parts.isNotEmpty()) (parts[0].take(1) + parts.getOrNull(1)?.take(1).orEmpty()).uppercase() else email.take(2).uppercase()
}

@Composable
private fun StatBox(label: String, value: String, modifier: Modifier) {
    Surface(color = Color.White.copy(alpha = .12f), shape = RoundedCornerShape(16.dp), modifier = modifier) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(label.uppercase(), color = Aqua, style = MaterialTheme.typography.labelSmall)
            Text(value, color = Color.White, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(2.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@Composable
private fun EmptyText(text: String) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun TripRow(reservation: Reservation, highlight: Boolean = false, onClick: () -> Unit) {
    Surface(
        color = if (highlight) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
        shape = RoundedCornerShape(18.dp),
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (reservation.propertyImage.isNotBlank()) {
                NetworkImage(reservation.propertyImage, reservation.propertyName, Modifier.size(64.dp).clip(RoundedCornerShape(14.dp)), ContentScale.Crop)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(reservation.propertyName, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${friendlyDate(reservation.checkIn)} → ${friendlyDate(reservation.checkOut)}", style = MaterialTheme.typography.bodySmall)
                Text("${reservation.nights} noches · ${formatCurrency(reservation.total)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun DetailsForm(profile: CustomerProfile?, rutLocked: Boolean, busy: Boolean, onSave: (CustomerProfile) -> Unit) {
    var name by rememberSaveable(profile) { mutableStateOf(profile?.name.orEmpty()) }
    var rut by rememberSaveable(profile) { mutableStateOf(profile?.documentId.orEmpty()) }
    var phone by rememberSaveable(profile) { mutableStateOf(profile?.phone.orEmpty()) }
    var birthDate by rememberSaveable(profile) { mutableStateOf(profile?.birthDate.orEmpty()) }
    var nationality by rememberSaveable(profile) { mutableStateOf(profile?.nationality.orEmpty().ifBlank { "Chile" }) }
    var emergencyName by rememberSaveable(profile) { mutableStateOf(profile?.emergencyContactName.orEmpty()) }
    var emergencyPhone by rememberSaveable(profile) { mutableStateOf(profile?.emergencyContactPhone.orEmpty()) }
    val lockRut = rutLocked && !profile?.documentId.isNullOrBlank()
    SectionCard("Mis datos") {
        Text("Se usan en todas tus reservas: si corriges tu nombre o teléfono, se actualizan también en ellas.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        DetailField(name, { name = it }, "Nombre completo", Icons.Outlined.Person)
        RutTextField(rut, { rut = it }, "RUT chileno", Modifier.fillMaxWidth(), Icons.Outlined.VerifiedUser, readOnly = lockRut, isError = rut.isNotBlank() && !isValidRut(rut))
        if (lockRut) Text("Tienes reservas confirmadas: para corregir el RUT, contáctanos.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        DetailField(phone, { phone = it }, "Teléfono", Icons.Outlined.Phone, KeyboardType.Phone)
        DetailField(birthDate, { birthDate = it.filter { c -> c.isDigit() || c == '-' }.take(10) }, "Fecha de nacimiento (AAAA-MM-DD)", Icons.Outlined.Cake, KeyboardType.Number)
        DetailField(nationality, { nationality = it }, "Nacionalidad", Icons.Outlined.Public)
        HorizontalDivider()
        Text("CONTACTO DE EMERGENCIA", style = EyebrowStyle, color = MaterialTheme.colorScheme.primary)
        DetailField(emergencyName, { emergencyName = it }, "Nombre", Icons.Outlined.Person)
        DetailField(emergencyPhone, { emergencyPhone = it }, "Teléfono", Icons.Outlined.Phone, KeyboardType.Phone)
        Button(
            onClick = {
                onSave(CustomerProfile(
                    name = name, documentId = rut, phone = phone, birthDate = birthDate, nationality = nationality,
                    emergencyContactName = emergencyName, emergencyContactPhone = emergencyPhone,
                ))
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(50.dp),
        ) { Text(if (busy) "Guardando…" else "Guardar datos") }
    }
}

@Composable
private fun DetailField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    icon: ImageVector,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        label = { Text(label) },
        leadingIcon = { Icon(icon, null) },
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    )
}

@Composable
private fun SecurityPanel(state: LumaStayUiState, viewModel: LumaStayViewModel, hasUpcoming: Boolean) {
    val context = LocalContext.current
    var password by rememberSaveable { mutableStateOf("") }
    var confirmText by rememberSaveable { mutableStateOf("") }
    var legal by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { viewModel.loadSecurityInfo() }

    SectionCard("Contraseña") {
        when (state.usesPassword) {
            null -> EmptyText("Cargando…")
            false -> EmptyText("Ingresas con tu cuenta de Google, así que tu contraseña se administra en Google.")
            true -> {
                DetailField(password, { password = it }, "Nueva contraseña", Icons.Outlined.Key, KeyboardType.Password, password = true)
                Button(onClick = { viewModel.changePassword(password); password = "" }, enabled = !state.authBusy, modifier = Modifier.fillMaxWidth()) { Text("Cambiar contraseña") }
                TextButton(onClick = { viewModel.sendPasswordReset(state.account?.email.orEmpty()) }) { Text("Enviarme un enlace por correo") }
            }
        }
    }
    SectionCard("Ayuda") {
        MenuRow(Icons.AutoMirrored.Outlined.HelpOutline, "Escríbenos a $SUPPORT_EMAIL") {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$SUPPORT_EMAIL?subject=Ayuda%20RestBlu")))
            }
        }
        MenuRow(Icons.Outlined.Gavel, "Términos y condiciones") { legal = if (legal == "terminos") "" else "terminos" }
        MenuRow(Icons.Outlined.Lock, "Política de privacidad") { legal = if (legal == "privacidad") "" else "privacidad" }
        if (legal.isNotBlank()) {
            Surface(color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(14.dp)) {
                Text(
                    if (legal == "terminos") {
                        "Al reservar aceptas las condiciones del alojamiento, los horarios de check-in y check-out y el uso personal del QR de acceso, válido solo durante tu estadía. Los pagos se procesan con Webpay (Transbank)."
                    } else {
                        "Usamos tu nombre, RUT, correo y teléfono para gestionar tus reservas y habilitar tu acceso. La fotografía facial, si la registras, se envía cifrada al terminal de acceso y no se conserva en nuestros servidores."
                    },
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
    SectionCard("Sesión") {
        OutlinedButton(onClick = viewModel::logout, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.AutoMirrored.Outlined.Logout, null)
            Spacer(Modifier.width(8.dp))
            Text("Cerrar sesión")
        }
    }
    SectionCard("Eliminar cuenta") {
        if (hasUpcoming) {
            EmptyText("Tienes estadías próximas. Podrás eliminar tu cuenta cuando terminen.")
        } else {
            Text("Se borrarán tu perfil y tu acceso. El historial de reservas pagadas se conserva por razones contables. Escribe ELIMINAR para confirmar.", style = MaterialTheme.typography.bodySmall)
            DetailField(confirmText, { confirmText = it }, "Escribe ELIMINAR", Icons.Outlined.DeleteOutline)
            Button(
                onClick = viewModel::deleteAccount,
                enabled = !state.authBusy && confirmText == "ELIMINAR",
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Eliminar mi cuenta") }
        }
    }
}

@Composable
private fun MenuRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 12.dp, horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Text(label, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AccountMessages(state: LumaStayUiState) {
    if (state.authError.isNotBlank()) {
        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(14.dp)) {
            Text(state.authError, modifier = Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
    if (state.authInfo.isNotBlank()) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(14.dp)) {
            Text(state.authInfo, modifier = Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}
