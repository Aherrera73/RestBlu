package cl.lumastay.huesped.core.util

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.util.Base64

object PdfManager {
    fun open(context: Context, base64: String, fileName: String) {
        val file = cacheFile(context, base64, fileName)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Abrir comprobante"))
    }

    fun share(context: Context, base64: String, fileName: String) {
        val file = cacheFile(context, base64, fileName)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Comprobante de reserva RestBlu")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Compartir comprobante"))
    }

    fun saveToDownloads(context: Context, base64: String, fileName: String): String {
        val bytes = Base64.getDecoder().decode(base64)
        val safeName = fileName.ifBlank { "Comprobante-RestBlu.pdf" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RestBlu")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("No fue posible crear el archivo PDF.")
            context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                ?: error("No fue posible escribir el archivo PDF.")
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
            return "Descargado en Descargas/RestBlu/$safeName"
        }
        val directory = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
            ?: context.filesDir
        val file = File(directory, safeName)
        file.writeBytes(bytes)
        return "Guardado en ${file.absolutePath}"
    }

    private fun cacheFile(context: Context, base64: String, fileName: String): File {
        val directory = File(context.cacheDir, "pdf").apply { mkdirs() }
        return File(directory, fileName.ifBlank { "Comprobante-RestBlu.pdf" }).apply {
            writeBytes(Base64.getDecoder().decode(base64))
        }
    }
}
