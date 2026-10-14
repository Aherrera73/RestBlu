export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

export async function uploadImage(file) {
  if (!file) return '';
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
    throw new Error('Usa una imagen JPG, PNG, WEBP o GIF.');
  }
  if (file.size > 8_000_000) throw new Error(`${file.name} supera el máximo de 8 MB.`);
  const response = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo guardar la imagen.');
  return data.url;
}
