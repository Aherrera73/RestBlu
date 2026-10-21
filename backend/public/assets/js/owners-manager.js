import { api } from './services/api.js';
import { escapeHtml } from './shared/formatters.js';

export function createOwnersManager({ onSaved, onNotice }) {
  const $ = (selector) => document.querySelector(selector);
  const data = { owners: [], properties: [], loaded: false, loading: false, saving: false, editingId: null, selected: new Set() };
  const dialog = $('#owner-dialog');
  const errorBox = $('#owner-form-error');
  const propertyById = (id) => data.properties.find((property) => String(property.id) === String(id));

  function setFeedback(message, failed = false) {
    $('#owners-feedback').textContent = message;
    $('#owners-feedback').classList.toggle('failed', failed);
  }

  function render() {
    $('#owners-total').textContent = String(data.owners.length);
    $('#owners-active').textContent = String(data.owners.filter((owner) => owner.active).length);
    $('#owners-assigned').textContent = String(new Set(data.owners.flatMap((owner) => owner.propertyIds || []).map(String)).size);
    const query = $('#owners-search').value.trim().toLocaleLowerCase('es');
    const owners = data.owners.filter((owner) => {
      const properties = (owner.propertyIds || []).map((id) => propertyById(id)?.name || '').join(' ');
      return !query || `${owner.name} ${owner.email} ${owner.phone || ''} ${properties}`.toLocaleLowerCase('es').includes(query);
    });
    $('#owners-table').innerHTML = owners.length ? owners.map((owner) => `
      <tr>
        <td><strong>${escapeHtml(owner.name)}</strong></td>
        <td><span class="owner-contact">${escapeHtml(owner.email)}</span><small class="owner-contact">${escapeHtml(owner.phone || 'Sin teléfono registrado')}</small></td>
        <td><ul class="owner-assigned-list">${(owner.propertyIds || []).map((id) => `<li>${escapeHtml(propertyById(id)?.name || `Alojamiento ${id}`)}</li>`).join('') || '<li class="owner-muted">Sin alojamientos asignados</li>'}</ul></td>
        <td><span class="badge ${owner.active ? 'active' : 'inactive'}">${owner.active ? 'Habilitado' : 'Deshabilitado'}</span></td>
        <td><button type="button" class="small-button owner-edit-button" data-edit-owner="${escapeHtml(String(owner.id))}" aria-label="Editar a ${escapeHtml(owner.name)}">Editar</button></td>
      </tr>`).join('') : `<tr><td colspan="5" class="empty">${query ? 'No hay propietarios que coincidan con la búsqueda.' : 'Todavía no hay propietarios. Registra el primero y asigna sus alojamientos.'}</td></tr>`;
  }

  async function refresh() {
    if (data.loading) return;
    data.loading = true;
    $('#owners-refresh').disabled = true;
    $('#new-owner').disabled = true;
    $('#owners-table').setAttribute('aria-busy', 'true');
    setFeedback('Cargando propietarios y alojamientos…');
    try {
      const [ownersResult, propertiesResult] = await Promise.all([api('/api/admin/owners'), api('/api/admin/properties')]);
      data.owners = ownersResult.owners;
      data.properties = propertiesResult.properties;
      data.loaded = true;
      render();
      setFeedback('Registro actualizado.');
    } catch (error) {
      data.loaded = false;
      $('#owners-table').innerHTML = '<tr><td colspan="5" class="empty">No se pudo cargar el registro. Pulsa Actualizar para intentarlo de nuevo.</td></tr>';
      ['#owners-total', '#owners-active', '#owners-assigned'].forEach((selector) => { $(selector).textContent = '—'; });
      setFeedback(error.message || 'No se pudo cargar el registro de propietarios.', true);
    } finally {
      data.loading = false;
      $('#owners-refresh').disabled = false;
      $('#new-owner').disabled = !data.loaded;
      $('#owners-table').setAttribute('aria-busy', 'false');
    }
  }

  function renderProperties() {
    const query = $('#owner-property-search').value.trim().toLocaleLowerCase('es');
    const properties = data.properties.filter((property) => !query || `${property.name} ${property.place || ''}`.toLocaleLowerCase('es').includes(query));
    $('#owner-properties').innerHTML = properties.length ? properties.map((property) => {
      const otherOwner = data.owners.find((owner) => String(owner.id) !== String(data.editingId) && (owner.propertyIds || []).some((id) => String(id) === String(property.id)));
      return `<label class="owner-property-option${otherOwner ? ' unavailable' : ''}">
        <input type="checkbox" value="${escapeHtml(String(property.id))}" data-owner-property ${data.selected.has(String(property.id)) ? 'checked' : ''} ${otherOwner ? 'disabled' : ''} />
        <span><strong>${escapeHtml(property.name)}</strong><small>${escapeHtml(property.place || 'Sin ubicación')}${property.active ? '' : ' · No publicado'}</small>${otherOwner ? `<small class="owner-property-unavailable">Asignado a ${escapeHtml(otherOwner.name)}</small>` : ''}</span>
      </label>`;
    }).join('') : `<p class="owner-property-empty">${query ? 'No hay alojamientos que coincidan.' : 'Todavía no hay alojamientos. Puedes registrarlos en Espacios y asignarlos después.'}</p>`;
    $('#owner-properties-count').textContent = `${data.selected.size} alojamiento${data.selected.size === 1 ? '' : 's'} seleccionado${data.selected.size === 1 ? '' : 's'}.`;
  }

  function open(owner = null) {
    if (!data.loaded || data.loading) return;
    data.editingId = owner?.id ?? null;
    data.selected = new Set((owner?.propertyIds || []).map(String));
    $('#owner-form').reset();
    errorBox.hidden = true;
    errorBox.textContent = '';
    $('#owner-dialog-title').textContent = owner ? 'Editar propietario' : 'Registrar propietario';
    $('#owner-save').textContent = owner ? 'Guardar cambios' : 'Registrar propietario';
    $('#owner-name').value = owner?.name || '';
    $('#owner-email').value = owner?.email || '';
    $('#owner-email').readOnly = Boolean(owner);
    $('#owner-email-help').textContent = owner ? 'El correo identifica su cuenta y no se puede cambiar desde esta ficha.' : 'Se vincula una cuenta con este correo, o se crea si todavía no existe.';
    $('#owner-phone').value = owner?.phone || '';
    $('#owner-active').checked = owner ? owner.active : true;
    renderProperties();
    dialog.showModal();
    $('#owner-name').focus();
  }

  function close() {
    if (!data.saving) dialog.close();
  }

  $('#owners-search').addEventListener('input', () => { if (data.loaded) render(); });
  $('#owners-refresh').addEventListener('click', () => void refresh());
  $('#new-owner').addEventListener('click', () => open());
  $('#owners-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-edit-owner]');
    if (!button) return;
    const owner = data.owners.find((item) => String(item.id) === button.dataset.editOwner);
    if (owner) open(owner);
  });
  document.querySelectorAll('.close-owner').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('cancel', (event) => { if (data.saving) event.preventDefault(); });
  $('#owner-property-search').addEventListener('input', renderProperties);
  $('#owner-properties').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-owner-property]');
    if (!checkbox) return;
    if (checkbox.checked) data.selected.add(checkbox.value);
    else data.selected.delete(checkbox.value);
    $('#owner-properties-count').textContent = `${data.selected.size} alojamiento${data.selected.size === 1 ? '' : 's'} seleccionado${data.selected.size === 1 ? '' : 's'}.`;
  });
  $('#owner-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (data.saving) return;
    const payload = {
      name: $('#owner-name').value.trim(),
      email: $('#owner-email').value.trim(),
      phone: $('#owner-phone').value.trim(),
      active: $('#owner-active').checked,
      propertyIds: [...data.selected].map(Number),
    };
    errorBox.hidden = true;
    if (!payload.name) {
      errorBox.textContent = 'Escribe el nombre completo del propietario.';
      errorBox.hidden = false;
      $('#owner-name').focus();
      return;
    }
    data.saving = true;
    $('#owner-fields').disabled = true;
    $('#owner-save').disabled = true;
    document.querySelectorAll('.close-owner').forEach((button) => { button.disabled = true; });
    $('#owner-form').setAttribute('aria-busy', 'true');
    $('#owner-save').textContent = 'Guardando…';
    const editing = data.editingId !== null;
    try {
      await api(editing ? `/api/admin/owners/${encodeURIComponent(data.editingId)}` : '/api/admin/owners', {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload),
      });
      dialog.close();
      onNotice(editing ? 'Propietario actualizado.' : 'Propietario registrado. Ya puedes indicarle cómo entrar con su cuenta.');
      await refresh();
      void onSaved().catch((error) => onNotice(error.message));
    } catch (error) {
      errorBox.textContent = error.message || 'No se pudo guardar el propietario. Revisa los datos e inténtalo de nuevo.';
      errorBox.hidden = false;
      errorBox.focus();
    } finally {
      data.saving = false;
      $('#owner-fields').disabled = false;
      $('#owner-save').disabled = false;
      document.querySelectorAll('.close-owner').forEach((button) => { button.disabled = false; });
      $('#owner-form').setAttribute('aria-busy', 'false');
      $('#owner-save').textContent = editing ? 'Guardar cambios' : 'Registrar propietario';
    }
  });

  return { refresh };
}
