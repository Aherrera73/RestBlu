package cl.lumastay.huesped.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val Navy = Color(0xFF103D50)
val Teal = Color(0xFF0B7D82)
val Aqua = Color(0xFF55D8CB)
val Mist = Color(0xFFF3F8F7)
val Ink = Color(0xFF123744)
val Muted = Color(0xFF64808A)
val Success = Color(0xFF147D64)
val Warning = Color(0xFFC87816)
val Deep = Color(0xFF0B2435)
val Lime = Color(0xFFDFF568)
val Heart = Color(0xFFE5485D)

// Degradado de marca para cabeceras (azul profundo → marino → verde azulado).
val BrandGradient = Brush.linearGradient(listOf(Deep, Navy, Color(0xFF0B6871)))

private val base = Typography()
private val RestBluTypography = Typography(
    displaySmall = base.displaySmall.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
    headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
    headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.3).sp),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.Bold),
    labelLarge = base.labelLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = 0.6.sp),
    labelSmall = base.labelSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
    bodyLarge = base.bodyLarge.copy(lineHeight = 24.sp),
    bodyMedium = base.bodyMedium.copy(lineHeight = 21.sp),
)

private val RestBluShapes = Shapes(
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(26.dp),
)

// Etiqueta en mayúsculas sobre los títulos de sección.
val EyebrowStyle = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, letterSpacing = 1.6.sp)

private val LightColors = lightColorScheme(
    primary = Teal,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD8F3EF),
    onPrimaryContainer = Navy,
    secondary = Navy,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDCECF0),
    onSecondaryContainer = Ink,
    background = Mist,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE7F0EF),
    onSurfaceVariant = Muted,
    outline = Color(0xFFB8CDCF),
    error = Color(0xFFB3261E),
)

private val DarkColors = darkColorScheme(
    primary = Aqua,
    onPrimary = Navy,
    secondary = Color(0xFFB6D9DF),
    background = Color(0xFF071E28),
    onBackground = Color(0xFFE4F2F2),
    surface = Color(0xFF0E2B37),
    onSurface = Color(0xFFE4F2F2),
    surfaceVariant = Color(0xFF183D47),
    onSurfaceVariant = Color(0xFFB5CDD1),
    outline = Color(0xFF78949A),
)

@Composable
fun LumaStayTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = RestBluTypography,
        shapes = RestBluShapes,
        content = content,
    )
}
