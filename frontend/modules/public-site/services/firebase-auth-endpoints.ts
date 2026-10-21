const identityActions = new Set([
  'accounts:signUp', 'accounts:signInWithPassword', 'accounts:sendOobCode',
  'accounts:delete', 'accounts:update', 'accounts:lookup',
]);

// En desarrollo, Vite reenvía sólo estas rutas a Firebase con TLS. El navegador
// usa el mismo origen de RestBlu; en producción se conserva el acceso directo.
export function firebaseIdentityUrl(action: string, apiKey: string, local = false) {
  if (!identityActions.has(action)) throw new Error('Operación de cuenta no permitida.');
  const base = local ? '/__restblu/firebase/identity' : 'https://identitytoolkit.googleapis.com/v1';
  return `${base}/${action}?key=${encodeURIComponent(apiKey)}`;
}

export function firebaseTokenUrl(apiKey: string, local = false) {
  const base = local ? '/__restblu/firebase/token' : 'https://securetoken.googleapis.com/v1/token';
  return `${base}?key=${encodeURIComponent(apiKey)}`;
}
