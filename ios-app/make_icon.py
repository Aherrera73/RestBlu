"""Crea el icono de RestBlu. Requiere Pillow sólo al regenerarlo."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

size = 1024
canvas = Image.new("RGB", (size, size))
pixels = canvas.load()
for y in range(size):
    for x in range(size):
        t = (x + y) / (2 * (size - 1))
        pixels[x, y] = (
            round(11 + 5 * t),
            round(43 + 92 * t),
            round(63 + 56 * t),
        )

draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((105, 105, 919, 919), radius=210, outline=(91, 219, 206), width=22)
font_paths = [Path("C:/Windows/Fonts/segoeuib.ttf"), Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")]
font = next((ImageFont.truetype(str(path), 420) for path in font_paths if path.exists()), ImageFont.load_default())
box = draw.textbbox((0, 0), "RB", font=font)
draw.text(((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1] - 25),
          "RB", fill=(245, 255, 252), font=font)
draw.rounded_rectangle((330, 755, 694, 785), radius=15, fill=(91, 219, 206))
output = Path(__file__).parent / "RestBlu" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon.png"
canvas.save(output, optimize=True)
print(output)
