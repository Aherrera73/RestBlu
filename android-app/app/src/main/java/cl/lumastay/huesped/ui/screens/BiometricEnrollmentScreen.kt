package cl.lumastay.huesped.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.ui.components.RutTextField
import androidx.core.content.FileProvider
import cl.lumastay.huesped.core.model.Reservation
import cl.lumastay.huesped.core.util.formatRut
import cl.lumastay.huesped.core.util.isValidRut
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

private data class CapturedFace(val bitmap: Bitmap, val jpeg: ByteArray)

private fun prepareFacePhoto(file: File): CapturedFace {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw IllegalArgumentException("La cámara no entregó una imagen válida.")
    }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1_200) sample *= 2
    val decoded = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
        inSampleSize = sample
    }) ?: throw IllegalArgumentException("No fue posible leer la foto.")
    val scale = minOf(1f, 720f / maxOf(decoded.width, decoded.height))
    val resized = if (scale < 1f) {
        Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * scale).toInt().coerceAtLeast(1),
            (decoded.height * scale).toInt().coerceAtLeast(1),
            true,
        ).also { decoded.recycle() }
    } else decoded
    val orientation = runCatching {
        ExifInterface(file.absolutePath).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val rotation = when (orientation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    val oriented = if (rotation != 0f) {
        Bitmap.createBitmap(
            resized, 0, 0, resized.width, resized.height,
            Matrix().apply { postRotate(rotation) }, true,
        ).also { resized.recycle() }
    } else resized
    val edge = minOf(oriented.width, oriented.height)
    val square = Bitmap.createBitmap(
        oriented, (oriented.width - edge) / 2, (oriented.height - edge) / 2, edge, edge,
    )
    if (square !== oriented) oriented.recycle()
    val bitmap = Bitmap.createScaledBitmap(square, 500, 500, true)
    if (bitmap !== square) square.recycle()
    try {
        var bytes = byteArrayOf()
        for (quality in listOf(88, 80, 72, 64, 56, 48)) {
            bytes = ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
                output.toByteArray()
            }
            if (bytes.size <= 98_000) break
        }
        if (bytes.size < 10_000 || bytes.size > 200_000) {
            throw IllegalArgumentException("La foto no cumple el tamaño aceptado por Dahua. Repite la captura.")
        }
        return CapturedFace(bitmap, bytes)
    } catch (error: Exception) {
        bitmap.recycle()
        throw error
    }
}

@Composable
fun BiometricEnrollmentScreen(
    reservation: Reservation,
    busy: Boolean,
    serverError: String,
    onBack: () -> Unit,
    onSubmit: (String, Boolean, ByteArray) -> Unit,
) {
    BackHandler(enabled = !busy) { onBack() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var documentId by rememberSaveable(reservation.id) { mutableStateOf(reservation.documentId) }
    var consent by rememberSaveable(reservation.id) { mutableStateOf(false) }
    var capturePath by rememberSaveable { mutableStateOf("") }
    var photo by remember { mutableStateOf<CapturedFace?>(null) }
    var localError by remember { mutableStateOf("") }
    var preparing by remember { mutableStateOf(false) }

    DisposableEffect(photo) {
        val current = photo
        onDispose {
            current?.jpeg?.fill(0)
            current?.bitmap?.recycle()
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (capturePath.isBlank()) {
            localError = "La captura se interrumpió. Abre la cámara nuevamente."
            return@rememberLauncherForActivityResult
        }
        val file = File(capturePath)
        if (!success) {
            file.delete()
            capturePath = ""
            return@rememberLauncherForActivityResult
        }
        preparing = true
        scope.launch {
            try {
                val prepared = withContext(Dispatchers.Default) { prepareFacePhoto(file) }
                photo = prepared
                localError = ""
            } catch (error: Exception) {
                localError = error.message ?: "No fue posible preparar la captura facial."
            } finally {
                file.delete()
                capturePath = ""
                preparing = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(15.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, enabled = !busy) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Volver a la reserva")
            }
            Text("Volver a mi reserva", fontWeight = FontWeight.Bold)
        }
        Column {
            Text("ACCESO BIOMÉTRICO", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            Text("Registrar mi rostro", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
            Text("${reservation.propertyName} · ${reservation.id}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(16.dp)) {
            Text(
                "La foto se cifra antes de subirla. El gestor la envía al terminal Dahua, elimina la captura temporal y solicita revocar el acceso al terminar la reserva. RestBlu no crea una plantilla facial paralela para esta alta.",
                modifier = Modifier.padding(15.dp),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
        Surface(
            modifier = Modifier.fillMaxWidth().height(250.dp),
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Box(contentAlignment = Alignment.Center) {
                val current = photo
                if (current == null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Outlined.Face, null, modifier = Modifier.size(60.dp))
                        Text("Aún no hay captura")
                    }
                } else {
                    Image(
                        bitmap = current.bitmap.asImageBitmap(),
                        contentDescription = "Captura facial pendiente de confirmación",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                }
            }
        }
        OutlinedButton(
            onClick = {
                val directory = File(context.cacheDir, "biometric")
                if (!directory.exists()) directory.mkdirs()
                runCatching {
                    val file = File.createTempFile("face-", ".jpg", directory)
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                    capturePath = file.absolutePath
                    camera.launch(uri)
                }.onFailure { error ->
                    localError = error.message ?: "No fue posible abrir la cámara del teléfono."
                    if (capturePath.isNotBlank()) File(capturePath).delete()
                    capturePath = ""
                }
            },
            enabled = !busy && !preparing,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.CameraAlt, null)
            Spacer(Modifier.size(8.dp))
            Text(if (photo == null) "Abrir cámara y capturar rostro" else "Repetir captura")
        }
        RutTextField(
            value = documentId,
            onValueChange = { documentId = it },
            label = "RUT del huésped principal",
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.Top) {
            Checkbox(checked = consent, onCheckedChange = { consent = it }, enabled = !busy)
            Text(
                "Autorizo enviar mi fotografía facial al terminal Dahua para registrar y verificar mi acceso durante esta estadía.",
                modifier = Modifier.padding(top = 10.dp),
            )
        }
        Text(
              "Esta captura de registro no hace prueba de vida. El reconocimiento de acceso se realiza en el terminal Dahua.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val error = localError.ifBlank { serverError }
        if (error.isNotBlank()) {
            Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp)) {
                Text(error, modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
        Button(
            onClick = {
                val current = photo
                localError = when {
                    !isValidRut(documentId) -> "Ingresa un RUT chileno válido."
                    formatRut(documentId) != formatRut(reservation.documentId) -> "El RUT no corresponde a esta reserva."
                    current == null -> "Captura tu rostro antes de continuar."
                    !consent -> "Debes autorizar el registro facial en Dahua."
                    else -> ""
                }
                if (localError.isBlank() && current != null) {
                    onSubmit(documentId, consent, current.jpeg.copyOf())
                }
            },
            enabled = !busy && !preparing,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            if (busy) CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            else Icon(Icons.Outlined.CheckCircle, null)
            Spacer(Modifier.size(8.dp))
            Text(if (busy) "Protegiendo fotografía…" else "Registrar rostro en Dahua")
        }
        Spacer(Modifier.height(20.dp))
    }
}
