package cl.lumastay.huesped.core.data

import cl.lumastay.huesped.core.model.AiSuggestion
import org.json.JSONArray
import org.json.JSONObject

// Lectura de valores de la API REST de Firestore ("fields" de un documento).
internal fun JSONObject.value(key: String): Any? = optJSONObject(key)?.decodedValue()

internal fun JSONObject.decodedValue(): Any? = when {
    has("nullValue") -> null
    has("stringValue") -> optString("stringValue")
    has("integerValue") -> optString("integerValue").toIntOrNull() ?: 0
    has("doubleValue") -> optDouble("doubleValue")
    has("booleanValue") -> optBoolean("booleanValue")
    has("timestampValue") -> optString("timestampValue")
    has("mapValue") -> {
        val fields = optJSONObject("mapValue")?.optJSONObject("fields") ?: JSONObject()
        fields.keys().asSequence().associateWith { fields.getJSONObject(it).decodedValue() }
    }
    has("arrayValue") -> {
        val values = optJSONObject("arrayValue")?.optJSONArray("values") ?: JSONArray()
        buildList { for (index in 0 until values.length()) add(values.getJSONObject(index).decodedValue()) }
    }
    else -> null
}

// Alojamientos sugeridos por Blu. available queda en null cuando el usuario
// no indicó fechas; se descartan las sugerencias sin alojamiento.
internal fun JSONObject.aiSuggestions(): List<AiSuggestion> =
    (value("suggestions") as? List<*>).orEmpty().mapNotNull { item ->
        val map = item as? Map<*, *> ?: return@mapNotNull null
        val propertyId = (map["propertyId"] as? Number)?.toInt() ?: return@mapNotNull null
        if (propertyId <= 0) return@mapNotNull null
        AiSuggestion(
            propertyId = propertyId,
            name = map["name"]?.toString().orEmpty().ifBlank { "Alojamiento" },
            checkIn = map["checkIn"]?.toString().orEmpty(),
            checkOut = map["checkOut"]?.toString().orEmpty(),
            guests = (map["guests"] as? Number)?.toInt() ?: 0,
            available = map["available"] as? Boolean,
        )
    }
