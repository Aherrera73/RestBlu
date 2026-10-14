package cl.lumastay.huesped.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LumaFormatTest {
    @Test
    fun `formatea rut chileno mientras se escribe`() {
        assertEquals("21.649.209-9", formatRut("216492099"))
        assertEquals("12.345.678-5", formatRut("12.345.678-5"))
    }

    @Test
    fun `valida digito verificador del rut`() {
        assertTrue(isValidRut("21.649.209-9"))
        assertTrue(isValidRut("12.345.678-5"))
        assertFalse(isValidRut("21.649.209-8"))
        assertFalse(isValidRut("123"))
    }

    @Test
    fun `calcula noches solo para un rango valido`() {
        assertEquals(6, nightCount("2026-09-24", "2026-09-30"))
        assertEquals(0, nightCount("2026-09-30", "2026-09-24"))
        assertEquals(0, nightCount("", "2026-09-24"))
    }

    @Test
    fun `genera un codigo de reserva aceptado por firestore`() {
        val code = makeReservationCode()
        assertTrue(code.matches(Regex("^(LS|RB)-[A-Z0-9-]{10,50}$")))
    }
}
