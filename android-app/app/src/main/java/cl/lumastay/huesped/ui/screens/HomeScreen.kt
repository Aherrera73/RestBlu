package cl.lumastay.huesped.ui.screens

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.LumaProperty
import cl.lumastay.huesped.core.model.SearchCriteria
import cl.lumastay.huesped.core.util.todayIso
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import cl.lumastay.huesped.ui.components.NetworkImage
import cl.lumastay.huesped.ui.theme.Aqua
import cl.lumastay.huesped.ui.theme.Navy
import cl.lumastay.huesped.ui.theme.BrandGradient
import cl.lumastay.huesped.ui.theme.Heart
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.IconButton
import androidx.compose.ui.graphics.Brush
import java.time.LocalDate

@Composable
fun HomeScreen(state: LumaStayUiState, viewModel: LumaStayViewModel) {
    val properties = viewModel.filteredProperties()
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = 270.dp),
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            HeroAndSearch(
                search = state.search,
                onQuery = viewModel::setQuery,
                onCheckIn = viewModel::setCheckIn,
                onCheckOut = viewModel::setCheckOut,
                onGuests = viewModel::setGuests,
                onClear = viewModel::clearSearch,
            )
        }
        if (state.catalogNotice.isNotBlank()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Text(
                        state.catalogNotice,
                        modifier = Modifier.padding(14.dp),
                        color = MaterialTheme.colorScheme.onSecondaryContainer,
                    )
                }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column {
                    Text("ALOJAMIENTOS", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text(
                        if (state.search.query.isBlank()) "Encuentra tu próximo refugio" else "Resultados disponibles",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.ExtraBold,
                    )
                }
                if (state.catalogLoading) CircularProgressIndicator(modifier = Modifier.size(28.dp))
                else FilledTonalIconButton(onClick = viewModel::loadCatalog) {
                    Icon(Icons.Outlined.Refresh, "Actualizar catálogo y disponibilidad")
                }
            }
        }
        if (!state.catalogLoading && properties.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Surface(shape = RoundedCornerShape(18.dp), tonalElevation = 1.dp) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text("No encontramos alojamientos", style = MaterialTheme.typography.titleLarge)
                        Text("Prueba otra ciudad o reduce la cantidad de huéspedes.")
                        Spacer(Modifier.height(12.dp))
                        OutlinedButton(onClick = viewModel::clearSearch) { Text("Limpiar búsqueda") }
                    }
                }
            }
        }
        items(properties, key = { it.id }) { property ->
            PropertyCard(
                property = property,
                favorite = property.id in state.favorites,
                onFavorite = { viewModel.toggleFavorite(property.id) },
                onClick = { viewModel.showProperty(property) },
            )
        }
        item(span = { GridItemSpan(maxLineSpan) }) { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun HeroAndSearch(
    search: SearchCriteria,
    onQuery: (String) -> Unit,
    onCheckIn: (String) -> Unit,
    onCheckOut: (String) -> Unit,
    onGuests: (Int) -> Unit,
    onClear: () -> Unit,
) {
    Surface(
        color = Color.Transparent,
        contentColor = Color.White,
        shape = RoundedCornerShape(28.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().background(BrandGradient).padding(22.dp)) {
            Text(
                "ESTADÍAS VERIFICADAS · ACCESO INTELIGENTE",
                color = Aqua,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Reserva un lugar increíble.\nLlega con todo resuelto.",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.ExtraBold,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                "Alojamientos seleccionados, pago seguro con Webpay y acceso con QR.",
                color = Color.White.copy(alpha = .82f),
            )
            Spacer(Modifier.height(18.dp))
            SearchPanel(search, onQuery, onCheckIn, onCheckOut, onGuests, onClear)
        }
    }
}

@Composable
private fun SearchPanel(
    search: SearchCriteria,
    onQuery: (String) -> Unit,
    onCheckIn: (String) -> Unit,
    onCheckOut: (String) -> Unit,
    onGuests: (Int) -> Unit,
    onClear: () -> Unit,
) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = RoundedCornerShape(20.dp),
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
            val compact = maxWidth < 620.dp
            if (compact) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    SearchFields(search, onQuery, onCheckIn, onCheckOut, onGuests, onClear, compact = true)
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    SearchFields(search, onQuery, onCheckIn, onCheckOut, onGuests, onClear, compact = false)
                }
            }
        }
    }
}

@Composable
private fun SearchFields(
    search: SearchCriteria,
    onQuery: (String) -> Unit,
    onCheckIn: (String) -> Unit,
    onCheckOut: (String) -> Unit,
    onGuests: (Int) -> Unit,
    onClear: () -> Unit,
    compact: Boolean,
) {
    val keyboard = LocalSoftwareKeyboardController.current
    val fieldModifier = if (compact) Modifier.fillMaxWidth() else Modifier.width(220.dp)
    OutlinedTextField(
        value = search.query,
        onValueChange = onQuery,
        modifier = fieldModifier,
        singleLine = true,
        label = { Text("Destino") },
        placeholder = { Text("Nombre, ciudad o tipo") },
        leadingIcon = { Icon(Icons.Outlined.LocationOn, null) },
    )
    if (compact) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            DateField("Check-in", search.checkIn, todayIso(), onCheckIn, Modifier.weight(1f))
            DateField(
                "Check-out",
                search.checkOut,
                search.checkIn.ifBlank { todayIso() },
                onCheckOut,
                Modifier.weight(1f),
            )
        }
    } else {
        DateField("Check-in", search.checkIn, todayIso(), onCheckIn, Modifier.width(150.dp))
        DateField(
            "Check-out",
            search.checkOut,
            search.checkIn.ifBlank { todayIso() },
            onCheckOut,
            Modifier.width(150.dp),
        )
    }
    GuestCounter(search.guests, onGuests, if (compact) Modifier.fillMaxWidth() else Modifier.width(190.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = if (compact) Modifier.fillMaxWidth() else Modifier) {
        Button(onClick = { keyboard?.hide() }, modifier = if (compact) Modifier.weight(1f) else Modifier) {
            Icon(Icons.Outlined.Search, null)
            Spacer(Modifier.width(6.dp))
            Text("Buscar")
        }
        OutlinedButton(onClick = onClear) { Text("Limpiar") }
    }
}

@Composable
private fun DateField(
    label: String,
    value: String,
    minDate: String,
    onChange: (String) -> Unit,
    modifier: Modifier,
) {
    val context = LocalContext.current
    Box(modifier = modifier.clickable {
        val current = runCatching { LocalDate.parse(value.ifBlank { minDate }) }.getOrElse { LocalDate.now() }
        DatePickerDialog(
            context,
            { _, year, month, day -> onChange(LocalDate.of(year, month + 1, day).toString()) },
            current.year,
            current.monthValue - 1,
            current.dayOfMonth,
        ).apply {
            datePicker.minDate = runCatching { LocalDate.parse(minDate).toEpochDay() * 86_400_000 }.getOrDefault(0)
        }.show()
    }) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            enabled = false,
            singleLine = true,
            label = { Text(label) },
            placeholder = { Text("Seleccionar") },
            leadingIcon = { Icon(Icons.Outlined.CalendarMonth, null) },
            colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                disabledTextColor = MaterialTheme.colorScheme.onSurface,
                disabledBorderColor = MaterialTheme.colorScheme.outline,
                disabledLabelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                disabledLeadingIconColor = MaterialTheme.colorScheme.primary,
                disabledPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        )
    }
}

@Composable
private fun GuestCounter(value: Int, onChange: (Int) -> Unit, modifier: Modifier) {
    Surface(modifier = modifier.height(56.dp), shape = RoundedCornerShape(12.dp), tonalElevation = 1.dp) {
        Row(
            modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("Huéspedes", style = MaterialTheme.typography.labelSmall)
                Text("$value personas", fontWeight = FontWeight.Bold)
            }
            Row {
                FilledTonalIconButton(onClick = { onChange(value - 1) }, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.Outlined.Remove, "Quitar huésped")
                }
                FilledTonalIconButton(onClick = { onChange(value + 1) }, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.Outlined.Add, "Agregar huésped")
                }
            }
        }
    }
}

@Composable
private fun PropertyCard(property: LumaProperty, favorite: Boolean, onFavorite: () -> Unit, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(230.dp)) {
            NetworkImage(
                url = property.image,
                contentDescription = property.name,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
            // Degradado inferior para que el nombre se lea sobre la foto.
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color(0xD90B2435)),
                ),
            )
            Surface(
                modifier = Modifier.align(Alignment.TopStart).padding(12.dp),
                shape = RoundedCornerShape(20.dp),
                color = Color.White.copy(alpha = .95f),
            ) {
                Row(modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Star, null, tint = Color(0xFFE3A11A), modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(3.dp))
                    Text(property.rating, color = Navy, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                }
            }
            Surface(
                modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
                shape = RoundedCornerShape(50),
                color = Color.White.copy(alpha = .95f),
            ) {
                IconButton(onClick = onFavorite, modifier = Modifier.size(40.dp)) {
                    Icon(
                        if (favorite) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                        contentDescription = if (favorite) "Quitar de favoritos" else "Guardar en favoritos",
                        tint = if (favorite) Heart else Navy,
                    )
                }
            }
            Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
                Text(property.type.uppercase(), color = Aqua, style = MaterialTheme.typography.labelSmall)
                Text(
                    property.name,
                    style = MaterialTheme.typography.titleLarge,
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.LocationOn, null, tint = Color.White.copy(alpha = .85f), modifier = Modifier.size(15.dp))
                    Text(property.place, color = Color.White.copy(alpha = .85f), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("${property.guests} huéspedes · ${property.beds} dorm. · ${property.baths} baños", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${property.price} / noche", fontWeight = FontWeight.ExtraBold)
        }
    }
}
