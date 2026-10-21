import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID, FIREBASE_SESSION_KEY, FIRESTORE_DOCUMENTS, LOCAL_FIREBASE_AUTH } from '../config';
import type { CustomerAccount, FirebaseSession } from '../domain/types';
import { ensureFirebaseSession, firestoreDocumentData, firestoreFields } from './firebase';
import { firebaseIdentityUrl, firebaseTokenUrl } from './firebase-auth-endpoints';

// Cuentas RestBlu con correo y contraseña sobre Firebase Authentication (REST).
// La sesión se guarda en el mismo lugar que la sesión anónima.

export const ACCOUNT_CHANGED_EVENT = 'restblu:account-changed';

const AUTH_ERRORS: Record<string, string> = {
  EMAIL_EXISTS: 'Ya existe una cuenta con ese correo. Inicia sesión.',
  EMAIL_NOT_FOUND: 'Correo o contraseña incorrectos.',
  INVALID_PASSWORD: 'Correo o contraseña incorrectos.',
  INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
  INVALID_EMAIL: 'El correo no es válido.',
  USER_DISABLED: 'Esta cuenta fue deshabilitada.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'Por seguridad, vuelve a iniciar sesión.',
  OPERATION_NOT_ALLOWED: 'El inicio de sesión con correo no está habilitado.',
};

function authErrorMessage(code: string) {
  if (code.startsWith('WEAK_PASSWORD')) return 'La contraseña debe tener al menos 6 caracteres.';
  return AUTH_ERRORS[code] || 'No fue posible completar la operación. Inténtalo nuevamente.';
}

async function identityRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(firebaseIdentityUrl(path, FIREBASE_API_KEY, LOCAL_FIREBASE_AUTH), {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No fue posible conectar con el servicio de cuentas. Revisa tu conexión.');
  }
  const data = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(authErrorMessage(String(data.error?.message || '')));
  return data;
}

type TokenResponse = { idToken: string; refreshToken: string; localId: string; expiresIn?: string };

function storeSession(data: TokenResponse, notify = true) {
  const session: FirebaseSession = {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    uid: data.localId,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  localStorage.setItem(FIREBASE_SESSION_KEY, JSON.stringify(session));
  if (notify) window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
  return session;
}

function storedSession(): FirebaseSession | null {
  try {
    return JSON.parse(localStorage.getItem(FIREBASE_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// Los datos de la cuenta se leen del propio token. Sólo sirven para la
// interfaz: el gestor y las reglas de Firestore verifican el token.
function accountFromToken(idToken: string): CustomerAccount | null {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(window.atob(payload), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      user_id?: string; email?: string; email_verified?: boolean;
    };
    if (!claims.user_id || !claims.email) return null;
    return { uid: claims.user_id, email: claims.email, emailVerified: claims.email_verified === true };
  } catch {
    return null;
  }
}

export function currentAccount(): CustomerAccount | null {
  const session = storedSession();
  return session?.idToken ? accountFromToken(session.idToken) : null;
}

// Sesión de la cuenta con un token vigente (se renueva si está por vencer).
export async function accountSession() {
  const session = await ensureFirebaseSession();
  const account = accountFromToken(session.idToken);
  if (!account) throw new Error('Inicia sesión con tu cuenta RestBlu para continuar.');
  return { session, account };
}

// Crea la cuenta y guarda su perfil. Si el perfil no se puede guardar (por
// ejemplo, el RUT ya pertenece a otra cuenta) la cuenta recién creada se
// elimina, para no dejar cuentas sin RUT.
export async function registerAccount(email: string, password: string, saveProfile: () => Promise<void>) {
  // Se crea la cuenta directamente: con la protección contra enumeración de
  // correos de Firebase no se puede asignar un correo a la sesión anónima.
  if (currentAccount()) logoutAccount();
  const created = await identityRequest<TokenResponse>('accounts:signUp', {
    email: email.trim().toLowerCase(),
    password,
    returnSecureToken: true,
  });
  const session = storeSession(created, false);
  try {
    await saveProfile();
  } catch (failure) {
    await identityRequest('accounts:delete', { idToken: session.idToken }).catch(() => {});
    localStorage.removeItem(FIREBASE_SESSION_KEY);
    throw failure;
  }
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
  await requestVerificationCode().catch(() => {});
  return accountFromToken(session.idToken);
}

// Verificación con código de 6 dígitos: el gestor lo envía por correo y, si
// es correcto, marca la cuenta como verificada en Firebase.
async function accountVerificationRequest(action: 'send' | 'verify', code = '') {
  const { session } = await accountSession();
  const id = crypto.randomUUID();
  const endpoint = `${FIRESTORE_DOCUMENTS}/account_verification_requests`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.idToken}` };
  const created = await fetch(`${endpoint}?documentId=${encodeURIComponent(id)}&key=${encodeURIComponent(FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fields: firestoreFields({ action, code, ownerUid: session.uid, syncStatus: 'pending', createdAt: new Date().toISOString() }) }),
  });
  if (!created.ok) throw new Error('No fue posible procesar la verificación. Inténtalo nuevamente.');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    const result = await fetch(`${endpoint}/${encodeURIComponent(id)}?key=${encodeURIComponent(FIREBASE_API_KEY)}`, { cache: 'no-store', headers });
    if (!result.ok) continue;
    const data = firestoreDocumentData(await result.json()) as { syncStatus?: string; error?: string; sentTo?: string; verified?: boolean };
    if (data.syncStatus === 'error') throw new Error(data.error || 'No fue posible verificar el correo.');
    if (data.syncStatus === 'processed') return data;
  }
  throw new Error('El servicio de verificación no responde. Inténtalo en unos minutos.');
}

export async function requestVerificationCode() {
  return accountVerificationRequest('send');
}

export async function verifyAccountCode(code: string) {
  await accountVerificationRequest('verify', code);
  return refreshAccount();
}

export async function loginAccount(email: string, password: string) {
  const data = await identityRequest<TokenResponse>('accounts:signInWithPassword', {
    email: email.trim().toLowerCase(),
    password,
    returnSecureToken: true,
  });
  return accountFromToken(storeSession(data).idToken);
}

export function logoutAccount() {
  localStorage.removeItem(FIREBASE_SESSION_KEY);
  window.dispatchEvent(new Event(ACCOUNT_CHANGED_EVENT));
}

export async function sendVerificationEmail() {
  const { session } = await accountSession();
  await identityRequest('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken: session.idToken });
}

export async function sendPasswordReset(email: string) {
  await identityRequest('accounts:sendOobCode', {
    requestType: 'PASSWORD_RESET',
    email: email.trim().toLowerCase(),
  });
}

// Fuerza un token nuevo para conocer si el correo ya se verificó.
export async function refreshAccount() {
  const session = storedSession();
  if (!session?.refreshToken) return null;
  let response: Response;
  try {
    response = await fetch(
      firebaseTokenUrl(FIREBASE_API_KEY, LOCAL_FIREBASE_AUTH),
      {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
      },
    );
  } catch {
    throw new Error('No fue posible conectar con el servicio de cuentas.');
  }
  const data = await response.json() as {
    id_token?: string; refresh_token?: string; user_id?: string; expires_in?: string;
  };
  if (!response.ok || !data.id_token) throw new Error('Tu sesión venció. Vuelve a iniciar sesión.');
  const refreshed = storeSession({
    idToken: data.id_token,
    refreshToken: data.refresh_token || session.refreshToken,
    localId: data.user_id || session.uid,
    expiresIn: data.expires_in,
  });
  return accountFromToken(refreshed.idToken);
}

// Acceso con Google mediante la ventana de Firebase (signInWithPopup). Se
// carga sólo al pulsar el botón. Firebase entrega la sesión de la cuenta y
// RestBlu la guarda en el mismo formato que el acceso con correo. Google
// informa si el correo está verificado; si no, se pide verificarlo.
export async function signInWithGoogle() {
  const [{ initializeApp, getApps }, auth] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
  ]);
  const app = getApps().find((item) => item.name === 'restblu-google') || initializeApp({
    apiKey: FIREBASE_API_KEY,
    authDomain: `${FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: FIREBASE_PROJECT_ID,
  }, 'restblu-google');
  const firebaseAuth = auth.getAuth(app);
  // La sesión la guarda RestBlu; el SDK no debe conservar otra copia.
  await auth.setPersistence(firebaseAuth, auth.inMemoryPersistence);
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let result;
  try {
    result = await auth.signInWithPopup(firebaseAuth, provider);
  } catch (failure) {
    const code = (failure as { code?: string }).code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Cerraste la ventana de Google antes de terminar.');
    }
    if (code === 'auth/popup-blocked') throw new Error('El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.');
    if (code === 'auth/account-exists-with-different-credential') {
      throw new Error('Ya existe una cuenta con ese correo. Ingresa con tu contraseña.');
    }
    if (code === 'auth/unauthorized-domain') throw new Error('Este sitio no está autorizado en Firebase para ingresar con Google.');
    throw new Error('No fue posible ingresar con Google. Inténtalo nuevamente.');
  }
  const idToken = await result.user.getIdToken();
  const session = storeSession({
    idToken,
    refreshToken: result.user.refreshToken,
    localId: result.user.uid,
    expiresIn: '3600',
  });
  await auth.signOut(firebaseAuth).catch(() => {});
  return accountFromToken(session.idToken);
}

// Cambia la contraseña de una cuenta con correo y contraseña.
export async function changePassword(newPassword: string) {
  const { session } = await accountSession();
  const data = await identityRequest<TokenResponse>('accounts:update', {
    idToken: session.idToken,
    password: newPassword,
    returnSecureToken: true,
  });
  storeSession({ ...data, localId: data.localId || session.uid });
}

// Indica si la cuenta usa contraseña (las de Google no la tienen).
export async function accountProviders(): Promise<string[]> {
  const { session } = await accountSession();
  const data = await identityRequest<{ users?: { providerUserInfo?: { providerId?: string }[] }[] }>('accounts:lookup', { idToken: session.idToken });
  return (data.users?.[0]?.providerUserInfo || []).map((item) => String(item.providerId || ''));
}

// Elimina la cuenta de Firebase y cierra la sesión.
export async function deleteAccount() {
  const { session } = await accountSession();
  await identityRequest('accounts:delete', { idToken: session.idToken });
  logoutAccount();
}
