package cl.lumastay.huesped.core.data

import cl.lumastay.huesped.core.model.GalleryImage
import cl.lumastay.huesped.core.model.LumaProperty

val sampleCatalog = listOf(
    LumaProperty(
        id = 1,
        name = "Brisa del Pacífico",
        place = "Algarrobo, Chile",
        type = "Vista al mar",
        guests = 5,
        beds = 2,
        baths = 2,
        price = "$148.000",
        rating = "4.9",
        image = "https://images.unsplash.com/photo-1601918774946-25832a4be0d6?auto=format&fit=crop&w=1100&q=85",
        gallery = listOf(
            GalleryImage("https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=85", "Sala luminosa"),
            GalleryImage("https://images.unsplash.com/photo-1600573472550-8090b5e0745e?auto=format&fit=crop&w=900&q=85", "Terraza costera"),
        ),
        tags = listOf("Mar", "Familia"),
    ),
    LumaProperty(
        id = 2,
        name = "Casa Duna",
        place = "Zapallar, Chile",
        type = "Casa completa",
        guests = 8,
        beds = 4,
        baths = 3,
        price = "$265.000",
        rating = "4.8",
        image = "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1100&q=85",
        gallery = listOf(
            GalleryImage("https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=85", "Fachada contemporánea"),
            GalleryImage("https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=900&q=85", "Living y comedor"),
        ),
        tags = listOf("Piscina", "Mascotas"),
    ),
    LumaProperty(
        id = 4,
        name = "Refugio Nativo",
        place = "Puerto Varas, Chile",
        type = "Cabaña privada",
        guests = 6,
        beds = 3,
        baths = 2,
        price = "$172.000",
        rating = "4.7",
        image = "https://images.unsplash.com/photo-1520984032042-162d526883e0?auto=format&fit=crop&w=1100&q=85",
        gallery = listOf(
            GalleryImage("https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=900&q=85", "Cabaña entre árboles"),
            GalleryImage("https://images.unsplash.com/photo-1510798831971-661eb04b3739?auto=format&fit=crop&w=900&q=85", "Refugio junto al lago"),
        ),
        tags = listOf("Naturaleza", "Jacuzzi"),
    ),
)
