package cl.lumastay.huesped.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.HolidayVillage
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URI

@Composable
fun NetworkImage(
    url: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    var bitmap by remember(url) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var failed by remember(url) { mutableStateOf(url.isBlank()) }
    LaunchedEffect(url) {
        if (url.isBlank()) return@LaunchedEffect
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val connection = URI(url).toURL().openConnection().apply {
                    connectTimeout = 10_000
                    readTimeout = 15_000
                }
                connection.getInputStream().use(BitmapFactory::decodeStream)
            }.getOrNull()
        }
        bitmap = result
        failed = result == null
    }
    Box(
        modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        val loaded = bitmap
        if (loaded != null) {
            Image(
                bitmap = loaded.asImageBitmap(),
                contentDescription = contentDescription,
                modifier = Modifier.fillMaxSize(),
                contentScale = contentScale,
            )
        } else {
            Icon(
                imageVector = Icons.Outlined.HolidayVillage,
                contentDescription = if (failed) "Imagen no disponible" else "Cargando imagen",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
