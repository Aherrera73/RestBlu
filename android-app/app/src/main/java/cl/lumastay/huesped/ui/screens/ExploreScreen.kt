package cl.lumastay.huesped.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.core.model.MainSection
import cl.lumastay.huesped.ui.components.NetworkImage

private data class Experience(val name: String, val place: String, val image: String)

private val experiences = listOf(
    Experience("Navegación al atardecer", "Algarrobo", "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1000&q=85"),
    Experience("Ruta de viñedos", "Casablanca", "https://images.unsplash.com/photo-1473973266408-ed4e27abdd47?auto=format&fit=crop&w=1000&q=85"),
    Experience("Sendero entre bosques", "Pucón", "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=85"),
)

@Composable
fun ExploreScreen(
    onNavigate: (MainSection) -> Unit,
    onAiOpen: (Boolean) -> Unit,
) {
    var section by rememberSaveable { mutableStateOf("Experiencias") }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column {
                Text("DESCUBRE RESTBLU", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text("Más de tu estadía", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("Experiencias", "Propietarios").forEach { title ->
                    FilterChip(selected = section == title, onClick = { section = title }, label = { Text(title) })
                }
            }
        }
        when (section) {
            "Experiencias" -> {
                item {
                    Text("Una reserva es solo el comienzo. Recomendaciones locales para complementar tu estadía.")
                }
                experiences.forEach { experience ->
                    item(experience.name) {
                        Card {
                            Column {
                                NetworkImage(
                                    url = experience.image,
                                    contentDescription = experience.name,
                                    modifier = Modifier.fillMaxWidth().height(180.dp),
                                    contentScale = ContentScale.Crop,
                                )
                                Column(Modifier.padding(16.dp)) {
                                    Text(experience.place, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                                    Text(experience.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedButton(onClick = { onNavigate(MainSection.HOME) }) {
                                        Text("Buscar alojamiento cercano")
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "Propietarios" -> {
                item {
                    InfoCard("Más reservas. Menos operación manual.", "Centraliza calendarios, tarifas, huéspedes y accesos. RestBlu mantiene cada estadía bajo control desde una sola plataforma.")
                }
                item { InfoCard("Calendario sincronizado", "Evita conflictos con reservas directas y canales OTA.") }
                item { InfoCard("Accesos automáticos", "QR, portón y departamento activos solo cuando corresponde.") }
                item { InfoCard("IA que apoya decisiones", "Alertas, precios sugeridos y respuestas operativas.") }
                item {
                    Button(onClick = { onAiOpen(true) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Consultar con RestBlu IA")
                    }
                }
            }
            else -> Unit
        }
        item { Spacer(Modifier.height(80.dp)) }
    }
}

@Composable
private fun InfoCard(title: String, detail: String) {
    Card {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
