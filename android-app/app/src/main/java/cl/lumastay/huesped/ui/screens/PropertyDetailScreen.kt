package cl.lumastay.huesped.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Bathtub
import androidx.compose.material.icons.outlined.Bed
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Fullscreen
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.ui.components.RutTextField
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cl.lumastay.huesped.core.model.GalleryImage
import cl.lumastay.huesped.core.model.GuestDraft
import cl.lumastay.huesped.core.model.LumaProperty
import cl.lumastay.huesped.core.model.SearchCriteria
import cl.lumastay.huesped.core.util.formatCurrency
import cl.lumastay.huesped.core.util.datesOverlap
import cl.lumastay.huesped.core.util.formatRut
import cl.lumastay.huesped.core.util.friendlyDate
import cl.lumastay.huesped.core.util.isValidEmail
import cl.lumastay.huesped.core.util.isValidRut
import cl.lumastay.huesped.core.util.nightCount
import cl.lumastay.huesped.core.util.priceToNumber
import cl.lumastay.huesped.core.util.todayIso
import cl.lumastay.huesped.ui.components.NetworkImage
import cl.lumastay.huesped.ui.theme.Aqua
import cl.lumastay.huesped.ui.theme.Navy
import kotlinx.coroutines.launch

@Composable
fun PropertyDetailScreen(
    property: LumaProperty,
    search: SearchCriteria,
    onBack: () -> Unit,
    onCheckIn: (String) -> Unit,
    onCheckOut: (String) -> Unit,
    onGuests: (Int) -> Unit,
    onReserve: () -> Unit,
    favorite: Boolean = false,
    onToggleFavorite: () -> Unit = {},
) {
    var fullGallery by remember { mutableStateOf(false) }
    var initialGalleryPage by remember { mutableIntStateOf(0) }
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val wide = maxWidth >= 840.dp
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Volver") }
                    Text("Volver al catálogo", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    IconButton(onClick = onToggleFavorite) {
                        Icon(
                            if (favorite) androidx.compose.material.icons.Icons.Filled.Favorite else androidx.compose.material.icons.Icons.Outlined.FavoriteBorder,
                            contentDescription = if (favorite) "Quitar de favoritos" else "Guardar en favoritos",
                            tint = if (favorite) cl.lumastay.huesped.ui.theme.Heart else MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
            }
            item {
                if (wide) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(22.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(modifier = Modifier.weight(1.6f)) {
                            PropertyGallery(property) { page ->
                                initialGalleryPage = page
                                fullGallery = true
                            }
                            Spacer(Modifier.height(18.dp))
                            PropertyInformation(property)
                        }
                        BookingSummary(
                            property = property,
                            search = search,
                            onCheckIn = onCheckIn,
                            onCheckOut = onCheckOut,
                            onGuests = onGuests,
                            onReserve = onReserve,
                            modifier = Modifier.weight(.8f),
                        )
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        PropertyGallery(property) { page ->
                            initialGalleryPage = page
                            fullGallery = true
                        }
                        PropertyInformation(property)
                        BookingSummary(
                            property = property,
                            search = search,
                            onCheckIn = onCheckIn,
                            onCheckOut = onCheckOut,
                            onGuests = onGuests,
                            onReserve = onReserve,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
    if (fullGallery) {
        FullScreenGallery(
            images = property.allImages,
            initialPage = initialGalleryPage,
            onClose = { fullGallery = false },
        )
    }
}

@Composable
private fun PropertyGallery(property: LumaProperty, onOpen: (Int) -> Unit) {
    val images = property.allImages
    val pager = rememberPagerState(pageCount = { images.size })
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 250.dp, max = 480.dp)
            .aspectRatio(1.55f)
            .clip(RoundedCornerShape(24.dp))
            .clickable { onOpen(pager.currentPage) },
    ) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            NetworkImage(
                url = images[page].src,
                contentDescription = images[page].alt,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
        Surface(
            modifier = Modifier.align(Alignment.BottomEnd).padding(14.dp),
            color = Navy.copy(alpha = .88f),
            contentColor = Color.White,
            shape = RoundedCornerShape(20.dp),
        ) {
            Row(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Icon(Icons.Outlined.Fullscreen, null, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(6.dp))
                Text("Ver ${images.size} fotos")
            }
        }
    }
}

@Composable
private fun PropertyInformation(property: LumaProperty) {
    Column {
        Text(property.type, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
        Text(property.name, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.ExtraBold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.LocationOn, null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
            Text(property.place, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(16.dp))
        HorizontalDivider()
        Spacer(Modifier.height(16.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            Fact(Icons.Outlined.Group, "Huéspedes", property.guests.toString())
            Fact(Icons.Outlined.Bed, "Dormitorios", property.beds.toString())
            Fact(Icons.Outlined.Bathtub, "Baños", property.baths.toString())
        }
        if (property.tags.isNotEmpty()) {
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                property.tags.take(3).forEach { tag ->
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                        Text(tag, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun Fact(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        Text(value, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun BookingSummary(
    property: LumaProperty,
    search: SearchCriteria,
    onCheckIn: (String) -> Unit,
    onCheckOut: (String) -> Unit,
    onGuests: (Int) -> Unit,
    onReserve: () -> Unit,
    modifier: Modifier,
) {
    val nights = nightCount(search.checkIn, search.checkOut)
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(20.dp)) {
            Text("Desde", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text("${property.price} / noche", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(16.dp))
            Text("Selecciona tu estadía", fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            AvailabilityDateButton(
                label = "Check-in",
                value = search.checkIn,
                minDate = todayIso(),
                checkIn = search.checkIn,
                isCheckOut = false,
                unavailableRanges = property.unavailableRanges,
                onChange = { selected ->
                    onCheckIn(selected)
                    if (search.checkOut.isNotBlank() &&
                        (search.checkOut <= selected || property.unavailableRanges.any { range ->
                            datesOverlap(selected, search.checkOut, range.checkIn, range.checkOut)
                        })
                    ) onCheckOut("")
                },
            )
            Spacer(Modifier.height(8.dp))
            AvailabilityDateButton(
                label = "Check-out",
                value = search.checkOut,
                minDate = search.checkIn.ifBlank { todayIso() },
                checkIn = search.checkIn,
                isCheckOut = true,
                unavailableRanges = property.unavailableRanges,
                onChange = onCheckOut,
            )
            if (search.checkIn.isNotBlank() && search.checkOut.isNotBlank() &&
                property.unavailableRanges.any { range ->
                    datesOverlap(search.checkIn, search.checkOut, range.checkIn, range.checkOut)
                }
            ) {
                Spacer(Modifier.height(8.dp))
                Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(10.dp)) {
                    Text(
                        "Las fechas seleccionadas incluyen días ocupados. Elige otro tramo en el calendario.",
                        modifier = Modifier.padding(10.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            GuestSelector(
                value = search.guests.coerceAtMost(property.guests),
                maximum = property.guests,
                onChange = onGuests,
            )
            Spacer(Modifier.height(10.dp))
            HorizontalDivider()
            Spacer(Modifier.height(6.dp))
            SummaryRow("Check-in", friendlyDate(search.checkIn))
            SummaryRow("Check-out", friendlyDate(search.checkOut))
            if (nights > 0) SummaryRow("Total referencial", formatCurrency(priceToNumber(property.price) * nights))
            Spacer(Modifier.height(14.dp))
            Button(onClick = onReserve, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text("Reservar")
            }
            Text(
                "Pago seguro con Webpay. Tu QR de acceso se habilita al confirmar.",
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            TrustLine(Icons.Outlined.VerifiedUser, "Propiedad y anfitrión verificados")
            TrustLine(Icons.Outlined.QrCode2, "QR de acceso al confirmar el pago")
            TrustLine(Icons.Outlined.SupportAgent, "Soporte RestBlu")
        }
    }
}

@Composable
private fun GuestSelector(
    value: Int,
    maximum: Int,
    onChange: (Int) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth().height(58.dp),
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("Huéspedes", style = MaterialTheme.typography.labelSmall)
                Text("$value de $maximum", fontWeight = FontWeight.Bold)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                FilledTonalIconButton(
                    onClick = { onChange((value - 1).coerceAtLeast(1)) },
                    enabled = value > 1,
                    modifier = Modifier.size(42.dp),
                ) { Icon(Icons.Outlined.Remove, "Quitar huésped") }
                FilledTonalIconButton(
                    onClick = { onChange((value + 1).coerceAtMost(maximum)) },
                    enabled = value < maximum,
                    modifier = Modifier.size(42.dp),
                ) { Icon(Icons.Outlined.Add, "Agregar huésped") }
            }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 7.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Bold, textAlign = TextAlign.End, modifier = Modifier.weight(1f).padding(start = 12.dp))
    }
}

@Composable
private fun TrustLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(modifier = Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun FullScreenGallery(images: List<GalleryImage>, initialPage: Int, onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        val pager = rememberPagerState(initialPage = initialPage, pageCount = { images.size })
        val scope = rememberCoroutineScope()
        Box(modifier = Modifier.fillMaxSize().background(Color(0xF20A1A22))) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                NetworkImage(
                    url = images[page].src,
                    contentDescription = images[page].alt,
                    modifier = Modifier.fillMaxSize().padding(vertical = 70.dp, horizontal = 12.dp),
                    contentScale = ContentScale.Fit,
                )
            }
            IconButton(
                onClick = onClose,
                modifier = Modifier.align(Alignment.TopEnd).padding(18.dp).background(Color.Black.copy(alpha = .45f), CircleShape),
            ) { Icon(Icons.Outlined.Close, "Cerrar galería", tint = Color.White) }
            if (pager.currentPage > 0) {
                IconButton(
                    onClick = { scope.launch { pager.animateScrollToPage(pager.currentPage - 1) } },
                    modifier = Modifier.align(Alignment.CenterStart).padding(8.dp).background(Color.Black.copy(alpha = .45f), CircleShape),
                ) { Icon(Icons.Outlined.ChevronLeft, "Foto anterior", tint = Color.White) }
            }
            if (pager.currentPage < images.lastIndex) {
                IconButton(
                    onClick = { scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
                    modifier = Modifier.align(Alignment.CenterEnd).padding(8.dp).background(Color.Black.copy(alpha = .45f), CircleShape),
                ) { Icon(Icons.Outlined.ChevronRight, "Foto siguiente", tint = Color.White) }
            }
            Text(
                "${pager.currentPage + 1} / ${images.size}",
                color = Color.White,
                modifier = Modifier.align(Alignment.BottomCenter).padding(28.dp),
            )
        }
    }
}

@Composable
fun ReservationDialog(
    property: LumaProperty,
    search: SearchCriteria,
    busy: Boolean,
    accountEmail: String,
    profile: cl.lumastay.huesped.core.model.CustomerProfile?,
    onClose: () -> Unit,
    onSubmit: (GuestDraft) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(profile?.name.orEmpty()) }
    var rut by rememberSaveable { mutableStateOf(profile?.documentId.orEmpty()) }
    var email by rememberSaveable { mutableStateOf(accountEmail) }
    var phone by rememberSaveable { mutableStateOf(profile?.phone.orEmpty()) }
    var error by rememberSaveable { mutableStateOf("") }
    val nights = nightCount(search.checkIn, search.checkOut)
    val total = priceToNumber(property.price) * nights

    Dialog(
        onDismissRequest = { if (!busy) onClose() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(modifier = Modifier.fillMaxSize().padding(12.dp), contentAlignment = Alignment.Center) {
            Surface(
                modifier = Modifier.fillMaxWidth().widthIn(max = 760.dp).heightIn(max = 800.dp),
                shape = RoundedCornerShape(26.dp),
                tonalElevation = 6.dp,
            ) {
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth().background(Navy).padding(18.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("CONFIRMAR RESERVA", color = Aqua, fontWeight = FontWeight.Bold)
                            Text("Completa los datos del huésped", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold)
                        }
                        IconButton(onClick = onClose, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar", tint = Color.White) }
                    }
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(18.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        item {
                            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                                Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(property.name, fontWeight = FontWeight.Bold)
                                            Text(property.place, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        Column(horizontalAlignment = Alignment.End) {
                                            Text("Total referencial", style = MaterialTheme.typography.labelSmall)
                                            Text(formatCurrency(total), fontWeight = FontWeight.ExtraBold)
                                        }
                                    }
                                    Text("${friendlyDate(search.checkIn)} → ${friendlyDate(search.checkOut)} · ${search.guests} huéspedes", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                        item {
                            BoxWithConstraints {
                                if (maxWidth >= 560.dp) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        GuestFields(name, { name = it }, rut, { if (profile?.documentId.isNullOrBlank()) rut = formatRut(it) }, email, {}, phone, { phone = it }, Modifier.weight(1f), twoColumns = true)
                                    }
                                } else {
                                    GuestFields(name, { name = it }, rut, { if (profile?.documentId.isNullOrBlank()) rut = formatRut(it) }, email, {}, phone, { phone = it }, Modifier.fillMaxWidth(), twoColumns = false)
                                }
                            }
                        }
                        item {
                            Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(16.dp)) {
                                Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                                    Icon(Icons.Outlined.VerifiedUser, null, tint = MaterialTheme.colorScheme.primary)
                                    Spacer(Modifier.width(10.dp))
                                    Text("Al continuar guardaremos la reserva en tu cuenta y pasarás al pago con Webpay. Tu QR de acceso se habilita apenas se apruebe el pago.")
                                }
                            }
                        }
                        if (error.isNotBlank()) {
                            item {
                                Text(error, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(18.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End),
                    ) {
                        OutlinedButton(onClick = onClose, enabled = !busy) { Text("Cancelar") }
                        Button(
                            onClick = {
                                error = when {
                                    name.trim().length < 2 -> "Ingresa el nombre completo."
                                    !isValidRut(rut) -> "El RUT no es válido. Revisa el dígito verificador."
                                    !isValidEmail(email) -> "Ingresa un correo electrónico válido."
                                    phone.filter(Char::isDigit).length < 8 -> "Ingresa un teléfono válido."
                                    else -> ""
                                }
                                if (error.isBlank()) onSubmit(GuestDraft(name, rut, email, phone))
                            },
                            enabled = !busy,
                        ) {
                            if (busy) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                            } else {
                                Icon(Icons.Outlined.CheckCircle, null)
                                Spacer(Modifier.width(6.dp))
                            }
                            Text(if (busy) "Preparando pago…" else "Pagar ${formatCurrency(total)}")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GuestFields(
    name: String,
    onName: (String) -> Unit,
    rut: String,
    onRut: (String) -> Unit,
    email: String,
    onEmail: (String) -> Unit,
    phone: String,
    onPhone: (String) -> Unit,
    modifier: Modifier,
    twoColumns: Boolean,
) {
    if (twoColumns) {
        Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                GuestTextField(name, onName, "Nombre completo", Icons.Outlined.Person, Modifier.weight(1f))
                RutTextField(rut, onRut, "RUT chileno", Modifier.weight(1f), Icons.Outlined.VerifiedUser)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                GuestTextField(email, onEmail, "Correo electrónico", Icons.Outlined.Email, Modifier.weight(1f), KeyboardType.Email)
                GuestTextField(phone, onPhone, "Teléfono", Icons.Outlined.Phone, Modifier.weight(1f), KeyboardType.Phone)
            }
        }
    } else {
        Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            GuestTextField(name, onName, "Nombre completo", Icons.Outlined.Person, Modifier.fillMaxWidth())
            RutTextField(rut, onRut, "RUT chileno", Modifier.fillMaxWidth(), Icons.Outlined.VerifiedUser)
            Text("El RUT y el correo son los de tu cuenta.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            GuestTextField(email, onEmail, "Correo electrónico", Icons.Outlined.Email, Modifier.fillMaxWidth(), KeyboardType.Email)
            GuestTextField(phone, onPhone, "Teléfono", Icons.Outlined.Phone, Modifier.fillMaxWidth(), KeyboardType.Phone)
        }
    }
}

@Composable
private fun GuestTextField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier,
        singleLine = true,
        label = { Text(label) },
        leadingIcon = { Icon(icon, null) },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    )
}
