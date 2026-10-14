package cl.lumastay.huesped.core.data

import cl.lumastay.huesped.core.model.AiSuggestion
import cl.lumastay.huesped.core.util.shortDate
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FirestoreValuesTest {
    // Documento tal como lo entrega la API REST de Firestore.
    private val fields = JSONObject(
        """
        {
          "syncStatus": {"stringValue": "processed"},
          "elapsedMs": {"integerValue": "1843"},
          "suggestions": {"arrayValue": {"values": [
            {"mapValue": {"fields": {
              "propertyId": {"integerValue": "3"},
              "name": {"stringValue": "Cabaña del Lago"},
              "checkIn": {"stringValue": "2026-10-09"},
              "checkOut": {"stringValue": "2026-10-12"},
              "guests": {"integerValue": "2"},
              "available": {"booleanValue": true}
            }}},
            {"mapValue": {"fields": {
              "propertyId": {"integerValue": "5"},
              "name": {"stringValue": "Loft Centro"},
              "checkIn": {"stringValue": ""},
              "checkOut": {"stringValue": ""},
              "guests": {"integerValue": "4"},
              "available": {"nullValue": null}
            }}},
            {"mapValue": {"fields": {"name": {"stringValue": "Sin id"}}}}
          ]}}
        }
        """.trimIndent(),
    )

    @Test
    fun `decodifica enteros, nulos y listas de mapas`() {
        assertEquals(1843, fields.value("elapsedMs"))
        val list = fields.value("suggestions") as List<*>
        assertEquals(3, list.size)
        val second = list[1] as Map<*, *>
        assertNull(second["available"])
        assertEquals(true, second.containsKey("available"))
        assertNull(fields.value("noExiste"))
    }

    @Test
    fun `convierte las sugerencias de Blu y descarta las que no tienen alojamiento`() {
        assertEquals(
            listOf(
                AiSuggestion(3, "Cabaña del Lago", "2026-10-09", "2026-10-12", 2, true),
                AiSuggestion(5, "Loft Centro", "", "", 4, null),
            ),
            fields.aiSuggestions(),
        )
        assertEquals(emptyList<AiSuggestion>(), JSONObject().aiSuggestions())
    }

    @Test
    fun `formatea fechas cortas para los botones`() {
        assertEquals("09/10", shortDate("2026-10-09"))
        assertEquals("", shortDate(""))
    }
}
