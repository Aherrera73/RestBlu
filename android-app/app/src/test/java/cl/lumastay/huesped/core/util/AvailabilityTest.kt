package cl.lumastay.huesped.core.util

import cl.lumastay.huesped.core.model.UnavailableRange
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class AvailabilityTest {
    private val occupied = listOf(UnavailableRange("2026-10-10", "2026-10-12"))
    private val earliest = LocalDate.parse("2026-10-01")

    @Test
    fun `marca como ocupadas solo las noches reservadas`() {
        assertEquals(AvailabilityDayStatus.AVAILABLE, state("2026-10-09"))
        assertEquals(AvailabilityDayStatus.OCCUPIED, state("2026-10-10"))
        assertEquals(AvailabilityDayStatus.OCCUPIED, state("2026-10-11"))
        assertEquals(AvailabilityDayStatus.AVAILABLE, state("2026-10-12"))
    }

    @Test
    fun `permite salir cuando entra la siguiente reserva pero no atravesarla`() {
        assertEquals(AvailabilityDayStatus.CHECKOUT_ONLY, state("2026-10-10", true, "2026-10-09"))
        assertEquals(AvailabilityDayStatus.BLOCKED, state("2026-10-11", true, "2026-10-09"))
        assertEquals(AvailabilityDayStatus.BLOCKED, state("2026-10-12", true, "2026-10-09"))
        assertEquals(AvailabilityDayStatus.AVAILABLE, state("2026-10-13", true, "2026-10-12"))
    }

    @Test
    fun `no habilita fechas anteriores ni rangos invalidos`() {
        assertEquals(AvailabilityDayStatus.PAST, state("2026-09-30"))
        assertEquals(AvailabilityDayStatus.BEFORE_CHECK_IN, state("2026-10-09", true, "2026-10-09"))
        assertEquals(
            AvailabilityDayStatus.UNKNOWN,
            availabilityDayStatus(
                LocalDate.parse("2026-10-09"), false, "",
                listOf(UnavailableRange("fecha-incorrecta", "2026-10-12")), earliest,
            ),
        )
    }

    private fun state(date: String, isCheckOut: Boolean = false, checkIn: String = "") =
        availabilityDayStatus(LocalDate.parse(date), isCheckOut, checkIn, occupied, earliest)
}
