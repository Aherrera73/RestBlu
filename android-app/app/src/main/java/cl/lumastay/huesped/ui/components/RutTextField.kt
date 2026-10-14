package cl.lumastay.huesped.ui.components

import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import cl.lumastay.huesped.core.util.formatRut

// Campo de RUT con puntos y guion automáticos. Al formatear, el texto crece
// (se agregan "." y "-"): el cursor se deja siempre al final para que el
// siguiente dígito no quede antes del guion.
@Composable
fun RutTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    leadingIcon: ImageVector? = null,
    readOnly: Boolean = false,
    isError: Boolean = false,
) {
    var field by remember { mutableStateOf(TextFieldValue(value, TextRange(value.length))) }
    if (field.text != value) field = TextFieldValue(value, TextRange(value.length))
    OutlinedTextField(
        value = field,
        onValueChange = { input ->
            if (readOnly) return@OutlinedTextField
            val formatted = formatRut(input.text)
            field = TextFieldValue(formatted, TextRange(formatted.length))
            if (formatted != value) onValueChange(formatted)
        },
        modifier = modifier,
        singleLine = true,
        readOnly = readOnly,
        isError = isError,
        label = { Text(label) },
        leadingIcon = leadingIcon?.let { icon -> { Icon(icon, null) } },
    )
}
