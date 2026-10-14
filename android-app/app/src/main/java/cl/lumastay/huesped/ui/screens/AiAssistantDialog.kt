package cl.lumastay.huesped.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import cl.lumastay.huesped.core.model.AiMessage
import cl.lumastay.huesped.core.model.AiSuggestion
import cl.lumastay.huesped.core.util.shortDate
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.ui.theme.Navy

@Composable
fun AiAssistantDialog(
    state: LumaStayUiState,
    onClose: () -> Unit,
    onAsk: (String) -> Unit,
    onSuggestion: (AiSuggestion) -> Unit,
    onFeedback: (requestId: String, positive: Boolean) -> Unit,
) {
    var question by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val suggestions = listOf(
        "¿Qué alojamiento me recomiendas?",
        "¿Cómo hago una reserva?",
        "Muéstrame opciones según mis fechas",
    )
    val itemCount = state.aiMessages.size +
        (if (state.aiMessages.size == 1) 1 else 0) +
        (if (state.aiBusy) 1 else 0) +
        (if (state.aiError.isNotBlank()) 1 else 0)
    LaunchedEffect(itemCount, state.aiPartial.length) {
        if (itemCount > 0) listState.animateScrollToItem(itemCount - 1)
    }
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(.96f).fillMaxHeight(.84f),
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column {
                Surface(color = Navy, contentColor = androidx.compose.ui.graphics.Color.White) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.SmartToy, null)
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text("RestBlu IA", fontWeight = FontWeight.ExtraBold)
                            Text("Asistente de reservas", style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(onClick = onClose) { Icon(Icons.Outlined.Close, "Cerrar asistente") }
                    }
                }
                Text(
                    "Sólo usa catálogo y disponibilidad pública",
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 9.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                LazyColumn(
                    state = listState,
                    modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    itemsIndexed(state.aiMessages) { _, message ->
                        if (message.role == "user") {
                            ChatBubble(message.content, fromUser = true)
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                ChatBubble(message.content, fromUser = false)
                                message.suggestions.forEach { suggestion ->
                                    SuggestionButton(suggestion, onClick = { onSuggestion(suggestion) })
                                }
                                // Sólo las respuestas del gestor (con solicitud) admiten opinión.
                                if (message.requestId.isNotBlank()) {
                                    FeedbackRow(message, onFeedback = { positive -> onFeedback(message.requestId, positive) })
                                }
                            }
                        }
                    }
                    if (state.aiMessages.size == 1) {
                        item {
                            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                suggestions.forEach { suggestion ->
                                    OutlinedButton(onClick = { onAsk(suggestion) }, enabled = !state.aiBusy) {
                                        Text(suggestion)
                                    }
                                }
                            }
                        }
                    }
                    if (state.aiBusy && state.aiPartial.isNotBlank()) {
                        // Respuesta en curso: crece a medida que Blu escribe.
                        item { ChatBubble(state.aiPartial, fromUser = false) }
                    } else if (state.aiBusy) {
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(modifier = Modifier.width(18.dp).height(18.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("Blu está revisando las opciones…")
                            }
                        }
                    }
                    if (state.aiError.isNotBlank()) {
                        item {
                            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp)) {
                                Text(
                                    state.aiError,
                                    modifier = Modifier.padding(12.dp),
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                )
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = question,
                        onValueChange = { question = it.take(1_500) },
                        modifier = Modifier.weight(1f),
                        label = { Text("Escribe tu pregunta") },
                        maxLines = 3,
                    )
                    Button(
                        onClick = { onAsk(question); question = "" },
                        enabled = !state.aiBusy && question.trim().length >= 2,
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Send, "Enviar pregunta")
                    }
                }
                Text(
                    "La respuesta es orientativa; la disponibilidad se valida al reservar.",
                    modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 10.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ChatBubble(text: String, fromUser: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (fromUser) Arrangement.End else Arrangement.Start,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(.88f),
            shape = RoundedCornerShape(16.dp),
            color = if (fromUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
            contentColor = if (fromUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
        ) {
            Text(text, modifier = Modifier.padding(13.dp))
        }
    }
}

// Con fechas disponibles invita a reservar; si no, abre la ficha.
@Composable
private fun SuggestionButton(suggestion: AiSuggestion, onClick: () -> Unit) {
    val datesSet = suggestion.checkIn.isNotBlank() && suggestion.checkOut.isNotBlank()
    val modifier = Modifier.fillMaxWidth(.88f)
    when {
        datesSet && suggestion.available == true -> Button(onClick = onClick, modifier = modifier) {
            Icon(Icons.Outlined.EventAvailable, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text(
                "Reservar ${suggestion.name} · ${shortDate(suggestion.checkIn)} → ${shortDate(suggestion.checkOut)}",
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        suggestion.available == false -> OutlinedButton(onClick = onClick, modifier = modifier) {
            Icon(Icons.Outlined.EventBusy, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("${suggestion.name} · no disponible en esas fechas", maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        else -> OutlinedButton(onClick = onClick, modifier = modifier) {
            Text("Ver ${suggestion.name}", maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun FeedbackRow(message: AiMessage, onFeedback: (Boolean) -> Unit) {
    val sent = message.feedback.isNotBlank()
    val enabled = !sent && !message.feedbackBusy
    Row(verticalAlignment = Alignment.CenterVertically) {
        FeedbackButton(
            selected = message.feedback == "up",
            enabled = enabled,
            outlined = Icons.Outlined.ThumbUp,
            filled = Icons.Filled.ThumbUp,
            description = "Respuesta útil",
            onClick = { onFeedback(true) },
        )
        FeedbackButton(
            selected = message.feedback == "down",
            enabled = enabled,
            outlined = Icons.Outlined.ThumbDown,
            filled = Icons.Filled.ThumbDown,
            description = "Respuesta no útil",
            onClick = { onFeedback(false) },
        )
        when {
            message.feedbackBusy -> CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
            sent -> Text(
                "¡Gracias por tu opinión!",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
            )
            message.feedbackError.isNotBlank() -> Text(
                message.feedbackError,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

@Composable
private fun FeedbackButton(
    selected: Boolean,
    enabled: Boolean,
    outlined: ImageVector,
    filled: ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.size(36.dp).semantics { this.selected = selected },
    ) {
        // La opción elegida conserva el color aunque los botones queden deshabilitados.
        Icon(
            if (selected) filled else outlined,
            contentDescription = description,
            modifier = Modifier.size(18.dp),
            tint = if (selected) MaterialTheme.colorScheme.primary else LocalContentColor.current,
        )
    }
}
