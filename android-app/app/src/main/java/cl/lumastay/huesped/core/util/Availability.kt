package cl.lumastay.huesped.core.util

import cl.lumastay.huesped.core.model.UnavailableRange
import java.time.LocalDate

enum class AvailabilityDayStatus {
    AVAILABLE,
    OCCUPIED,
    CHECKOUT_ONLY,
    BLOCKED,
    BEFORE_CHECK_IN,
    PAST,
    UNKNOWN,
}

fun availabilityDayStatus(
    date: LocalDate,
    isCheckOut: Boolean,
    checkIn: String,
    unavailableRanges: List<UnavailableRange>,
    earliestDate: LocalDate,
): AvailabilityDayStatus {
    val ranges = unavailableRanges.map { range ->
        val start = runCatching { LocalDate.parse(range.checkIn) }.getOrNull()
        val end = runCatching { LocalDate.parse(range.checkOut) }.getOrNull()
        if (start == null || end == null || end <= start) return AvailabilityDayStatus.UNKNOWN
        start to end
    }
    if (date < earliestDate) return AvailabilityDayStatus.PAST
    val occupied = ranges.any { (start, end) -> date >= start && date < end }
    if (!isCheckOut) return if (occupied) AvailabilityDayStatus.OCCUPIED else AvailabilityDayStatus.AVAILABLE
    val arrival = runCatching { LocalDate.parse(checkIn) }.getOrNull()
        ?: return AvailabilityDayStatus.BEFORE_CHECK_IN
    if (date <= arrival) return AvailabilityDayStatus.BEFORE_CHECK_IN
    val crossesReservation = ranges.any { (start, end) -> arrival < end && date > start }
    if (crossesReservation) return AvailabilityDayStatus.BLOCKED
    // El día de salida puede coincidir con el check-in de otra reserva.
    return if (occupied) AvailabilityDayStatus.CHECKOUT_ONLY else AvailabilityDayStatus.AVAILABLE
}
