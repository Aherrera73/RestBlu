package cl.lumastay.huesped.core.util

import java.security.SecureRandom
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID

private val chile = Locale.forLanguageTag("es-CL")
private val secureRandom = SecureRandom()

fun formatCurrency(value: Int): String = NumberFormat.getCurrencyInstance(chile).apply {
    maximumFractionDigits = 0
}.format(value)

fun priceToNumber(value: String): Int = value.filter(Char::isDigit).toIntOrNull() ?: 0

fun makeReservationCode(): String {
    val time = java.lang.Long.toString(System.currentTimeMillis(), 36).takeLast(6).uppercase()
    val suffix = UUID.randomUUID().toString().replace("-", "").take(12).uppercase()
    return "RB-$time-$suffix"
}

fun makeAccessPin(): String = (100_000 + secureRandom.nextInt(900_000)).toString()

fun nightCount(checkIn: String, checkOut: String): Int = runCatching {
    val start = LocalDate.parse(checkIn)
    val end = LocalDate.parse(checkOut)
    java.time.temporal.ChronoUnit.DAYS.between(start, end).toInt().coerceAtLeast(0)
}.getOrDefault(0)

fun datesOverlap(checkIn: String, checkOut: String, occupiedCheckIn: String, occupiedCheckOut: String): Boolean =
    checkIn.isNotBlank() && checkOut.isNotBlank() &&
        checkIn < occupiedCheckOut && checkOut > occupiedCheckIn

fun friendlyDate(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(chile))
}.getOrElse { "Por definir" }

// '2026-10-09' → '09/10'; deja el texto tal cual si no es una fecha.
fun shortDate(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("dd/MM"))
}.getOrDefault(value)

fun todayIso(): String = LocalDate.now().toString()

fun normalizeSearch(value: String): String = value
    .lowercase(chile)
    .replace("á", "a")
    .replace("é", "e")
    .replace("í", "i")
    .replace("ó", "o")
    .replace("ú", "u")
    .trim()

fun formatRut(value: String): String {
    val clean = value.filter { it.isDigit() || it.equals('k', ignoreCase = true) }
        .uppercase()
        .take(9)
    if (clean.length < 2) return clean
    val verifier = clean.last()
    val body = clean.dropLast(1).reversed().chunked(3).joinToString(".").reversed()
    return "$body-$verifier"
}

fun isValidRut(value: String): Boolean {
    val clean = value.filter { it.isDigit() || it.equals('k', ignoreCase = true) }.uppercase()
    if (clean.length < 8) return false
    val body = clean.dropLast(1)
    if (body.any { !it.isDigit() }) return false
    var sum = 0
    var multiplier = 2
    body.reversed().forEach { digit ->
        sum += digit.digitToInt() * multiplier
        multiplier = if (multiplier == 7) 2 else multiplier + 1
    }
    val result = 11 - (sum % 11)
    val expected = when (result) {
        11 -> '0'
        10 -> 'K'
        else -> result.digitToChar()
    }
    return clean.last() == expected
}

fun isValidEmail(value: String): Boolean =
    android.util.Patterns.EMAIL_ADDRESS.matcher(value.trim()).matches()
