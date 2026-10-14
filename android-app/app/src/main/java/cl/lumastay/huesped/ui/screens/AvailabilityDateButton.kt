package cl.lumastay.huesped.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import cl.lumastay.huesped.core.model.UnavailableRange
import cl.lumastay.huesped.core.util.AvailabilityDayStatus
import cl.lumastay.huesped.core.util.availabilityDayStatus
import cl.lumastay.huesped.core.util.friendlyDate
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

private val availableBackground = Color(0xFFE5F7ED)
private val availableText = Color(0xFF145D45)
private val occupiedBackground = Color(0xFFFDE9E5)
private val occupiedText = Color(0xFFA84232)
private val checkoutBackground = Color(0xFFFFF1CB)
private val checkoutText = Color(0xFF795507)
private val mutedBackground = Color(0xFFF2F4F4)
private val mutedText = Color(0xFF8A9B9F)

@Composable
internal fun AvailabilityDateButton(
    label: String,
    value: String,
    minDate: String,
    checkIn: String,
    isCheckOut: Boolean,
    unavailableRanges: List<UnavailableRange>,
    onChange: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    var displayedMonth by remember { mutableStateOf(YearMonth.now()) }
    var alert by remember { mutableStateOf("") }
    val earliest = runCatching { LocalDate.parse(minDate) }.getOrElse { LocalDate.now() }

    OutlinedButton(
        onClick = {
            val initial = runCatching { LocalDate.parse(value.ifBlank { minDate }) }
                .getOrElse { earliest }
            displayedMonth = YearMonth.from(initial)
            alert = if (isCheckOut && checkIn.isBlank()) "Selecciona primero el check-in." else ""
            open = true
        },
        modifier = Modifier.fillMaxWidth().height(58.dp),
        shape = RoundedCornerShape(14.dp),
    ) {
        Icon(Icons.Outlined.CalendarMonth, null)
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.Start) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(if (value.isBlank()) "Seleccionar fecha" else friendlyDate(value), fontWeight = FontWeight.Bold)
        }
    }

    if (open) {
        Dialog(onDismissRequest = { open = false }) {
            Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface) {
                Column(modifier = Modifier.fillMaxWidth().padding(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("CALENDARIO DEL ALOJAMIENTO", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            Text("Elige tu $label", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                        IconButton(onClick = { open = false }) { Icon(Icons.Outlined.Close, "Cerrar calendario") }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = { displayedMonth = displayedMonth.minusMonths(1) },
                            enabled = displayedMonth.minusMonths(1) >= YearMonth.from(earliest),
                        ) { Icon(Icons.Outlined.ChevronLeft, "Mes anterior") }
                        Text(
                            displayedMonth.format(DateTimeFormatter.ofPattern("LLLL yyyy", Locale.forLanguageTag("es-CL"))),
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Center,
                            fontWeight = FontWeight.Bold,
                        )
                        IconButton(onClick = { displayedMonth = displayedMonth.plusMonths(1) }) {
                            Icon(Icons.Outlined.ChevronRight, "Mes siguiente")
                        }
                    }
                    Row(modifier = Modifier.fillMaxWidth()) {
                        listOf("L", "M", "X", "J", "V", "S", "D").forEach { weekday ->
                            Text(
                                weekday,
                                modifier = Modifier.weight(1f),
                                textAlign = TextAlign.Center,
                                style = MaterialTheme.typography.labelSmall,
                            )
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    val leading = displayedMonth.atDay(1).dayOfWeek.value - 1
                    val cellCount = ((leading + displayedMonth.lengthOfMonth() + 6) / 7) * 7
                    repeat(cellCount / 7) { week ->
                        Row(modifier = Modifier.fillMaxWidth()) {
                            repeat(7) { weekday ->
                                val dayNumber = week * 7 + weekday - leading + 1
                                if (dayNumber !in 1..displayedMonth.lengthOfMonth()) {
                                    Spacer(Modifier.weight(1f).height(42.dp))
                                } else {
                                    val date = displayedMonth.atDay(dayNumber)
                                    val status = availabilityDayStatus(
                                        date, isCheckOut, checkIn, unavailableRanges, LocalDate.now(),
                                    )
                                    val selectable = status == AvailabilityDayStatus.AVAILABLE ||
                                        status == AvailabilityDayStatus.CHECKOUT_ONLY
                                    val selected = selectable && value == date.toString()
                                    val background = when {
                                        selected -> MaterialTheme.colorScheme.primary
                                        status == AvailabilityDayStatus.AVAILABLE -> availableBackground
                                        status == AvailabilityDayStatus.CHECKOUT_ONLY -> checkoutBackground
                                        status == AvailabilityDayStatus.OCCUPIED || status == AvailabilityDayStatus.BLOCKED -> occupiedBackground
                                        else -> mutedBackground
                                    }
                                    val foreground = when {
                                        selected -> MaterialTheme.colorScheme.onPrimary
                                        status == AvailabilityDayStatus.AVAILABLE -> availableText
                                        status == AvailabilityDayStatus.CHECKOUT_ONLY -> checkoutText
                                        status == AvailabilityDayStatus.OCCUPIED || status == AvailabilityDayStatus.BLOCKED -> occupiedText
                                        else -> mutedText
                                    }
                                    val description = when (status) {
                                        AvailabilityDayStatus.AVAILABLE -> "disponible"
                                        AvailabilityDayStatus.CHECKOUT_ONLY -> "ocupado, salida posible"
                                        AvailabilityDayStatus.OCCUPIED -> "ocupado"
                                        AvailabilityDayStatus.BLOCKED -> "no disponible para esta salida"
                                        AvailabilityDayStatus.UNKNOWN -> "disponibilidad sin verificar"
                                        else -> "fecha no seleccionable"
                                    }
                                    Box(
                                        modifier = Modifier
                                            .weight(1f)
                                            .padding(2.dp)
                                            .height(38.dp)
                                            .clip(RoundedCornerShape(9.dp))
                                            .background(background)
                                            .semantics { contentDescription = "$date, $description" }
                                            .clickable(enabled = status != AvailabilityDayStatus.PAST &&
                                                status != AvailabilityDayStatus.BEFORE_CHECK_IN) {
                                                if (selectable) {
                                                    onChange(date.toString())
                                                    open = false
                                                } else {
                                                    alert = when (status) {
                                                        AvailabilityDayStatus.OCCUPIED -> "Ese día ya está reservado. Selecciona otro día."
                                                        AvailabilityDayStatus.BLOCKED -> "Esa salida atravesaría días ya reservados. Elige una fecha anterior o cambia el check-in."
                                                        else -> "No se pudo comprobar la disponibilidad. Inténtalo cuando el gestor sincronice."
                                                    }
                                                }
                                            },
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Text(
                                            dayNumber.toString(),
                                            color = foreground,
                                            fontWeight = FontWeight.Bold,
                                            textDecoration = if (status == AvailabilityDayStatus.OCCUPIED ||
                                                status == AvailabilityDayStatus.BLOCKED) TextDecoration.LineThrough else null,
                                        )
                                    }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        CalendarLegend("Disponible", availableBackground)
                        CalendarLegend("Ocupado", occupiedBackground)
                        if (isCheckOut) CalendarLegend("Salida posible", checkoutBackground)
                    }
                    if (alert.isNotBlank()) {
                        Spacer(Modifier.height(12.dp))
                        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(10.dp)) {
                            Text(alert, modifier = Modifier.padding(10.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "La salida puede coincidir con la entrada de otra reserva. La disponibilidad se confirma al reservar.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun CalendarLegend(label: String, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(color))
        Spacer(Modifier.width(3.dp))
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}
