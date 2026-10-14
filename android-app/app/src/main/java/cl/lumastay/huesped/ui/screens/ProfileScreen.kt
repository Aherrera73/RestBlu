package cl.lumastay.huesped.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.MarkEmailRead
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import cl.lumastay.huesped.ui.components.RutTextField
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import cl.lumastay.huesped.BuildConfig
import cl.lumastay.huesped.core.model.CustomerProfile
import cl.lumastay.huesped.core.util.formatRut
import cl.lumastay.huesped.core.util.isValidRut
import cl.lumastay.huesped.features.LumaStayUiState
import cl.lumastay.huesped.features.LumaStayViewModel
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

@Composable
fun ProfileScreen(state: LumaStayUiState, viewModel: LumaStayViewModel) {
    val account = state.account
    val dashboard = account?.emailVerified == true && state.profileLoaded && !state.profile?.documentId.isNullOrBlank()
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (dashboard) {
            item { Column(Modifier.fillMaxWidth().widthIn(max = 720.dp)) { AccountDashboard(state, viewModel) } }
        } else item {
            Column(Modifier.fillMaxWidth().widthIn(max = 560.dp)) {
                Text("MI CUENTA", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Text(
                    when {
                        account == null -> "Ingresa a RestBlu"
                        !account.emailVerified -> "Verifica tu correo"
                        state.profileLoaded && state.profile?.documentId.isNullOrBlank() -> "Completa tu registro"
                        else -> "Hola${state.profile?.name?.substringBefore(' ')?.let { ", $it" }.orEmpty()}"
                    },
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.ExtraBold,
                )
                if (state.accountReason.isNotBlank() && !state.readyToBook) {
                    Spacer(Modifier.height(10.dp))
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(14.dp)) {
                        Text(state.accountReason, modifier = Modifier.fillMaxWidth().padding(12.dp), fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        if (!dashboard) item {
            Column(Modifier.fillMaxWidth().widthIn(max = 560.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when {
                    account == null -> AccountAccess(state, viewModel)
                    !account.emailVerified -> VerifyEmail(account.email, state, viewModel)
                    !state.profileLoaded -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text("Cargando tu cuenta…")
                    }
                    else -> {
                        ProfileForm(
                            profile = state.profile,
                            email = account.email,
                            rutLocked = state.reservations.any { it.verified },
                            busy = state.authBusy,
                            submitLabel = if (state.profile?.documentId.isNullOrBlank()) "Completar registro" else "Guardar datos",
                            onSave = viewModel::saveProfile,
                        )
                        AuthMessages(state)
                        OutlinedButton(onClick = viewModel::logout, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.AutoMirrored.Outlined.Logout, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Cerrar sesión")
                        }
                    }
                }
            }
        }
        item {
            Text(
                "RestBlu · Versión ${BuildConfig.VERSION_NAME}",
                modifier = Modifier.fillMaxWidth().padding(12.dp),
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun AuthMessages(state: LumaStayUiState) {
    if (state.authError.isNotBlank()) {
        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp)) {
            Text(state.authError, modifier = Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
        }
    }
    if (state.authInfo.isNotBlank()) {
        Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = RoundedCornerShape(12.dp)) {
            Text(state.authInfo, modifier = Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
        }
    }
}

@Composable
private fun AccountAccess(state: LumaStayUiState, viewModel: LumaStayViewModel) {
    var register by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var rut by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }

    Text(
        "Con tu cuenta reservas sin volver a escribir tus datos y tienes tus reservas y tu QR de acceso en cualquier dispositivo.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    GoogleSignInButton(enabled = !state.authBusy, onToken = viewModel::signInWithGoogle, onError = viewModel::reportAuthError)
    Row(verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f))
        Text("  o con tu correo  ", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider(Modifier.weight(1f))
    }
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        SegmentedButton(selected = !register, onClick = { register = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Ingresar") }
        SegmentedButton(selected = register, onClick = { register = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Crear cuenta") }
    }
    if (register) {
        AccountField(name, { name = it }, "Nombre completo", Icons.Outlined.Person)
        RutTextField(rut, { rut = it }, "RUT chileno", Modifier.fillMaxWidth(), Icons.Outlined.VerifiedUser, isError = rut.isNotBlank() && !isValidRut(rut))
        AccountField(phone, { phone = it }, "Teléfono", Icons.Outlined.Phone, KeyboardType.Phone)
    }
    AccountField(email, { email = it }, "Correo electrónico", Icons.Outlined.Email, KeyboardType.Email)
    AccountField(password, { password = it }, "Contraseña", Icons.Outlined.Key, KeyboardType.Password, password = true)
    if (register) AccountField(confirm, { confirm = it }, "Repite la contraseña", Icons.Outlined.Key, KeyboardType.Password, password = true)
    AuthMessages(state)
    Button(
        onClick = {
            if (register) {
                if (password != confirm) viewModel.reportAuthError("Las contraseñas no coinciden.")
                else viewModel.register(name, rut, phone, email, password)
            } else {
                viewModel.login(email, password)
            }
        },
        enabled = !state.authBusy && email.isNotBlank() && password.isNotBlank(),
        modifier = Modifier.fillMaxWidth().height(50.dp),
    ) {
        if (state.authBusy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else Text(if (register) "Crear cuenta" else "Ingresar")
    }
    if (!register) {
        TextButton(onClick = { viewModel.sendPasswordReset(email) }, modifier = Modifier.fillMaxWidth()) { Text("Olvidé mi contraseña") }
    }
}

@Composable
private fun VerifyEmail(email: String, state: LumaStayUiState, viewModel: LumaStayViewModel) {
    var code by rememberSaveable { mutableStateOf("") }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Outlined.MarkEmailRead, null, modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
        Text("Enviamos un código de 6 dígitos a $email. Escríbelo aquí para activar tu cuenta.", textAlign = TextAlign.Center)
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.filter(Char::isDigit).take(6) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("Código de verificación") },
            textStyle = MaterialTheme.typography.headlineSmall.copy(textAlign = TextAlign.Center, letterSpacing = androidx.compose.ui.unit.TextUnit(8f, androidx.compose.ui.unit.TextUnitType.Sp)),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        )
        AuthMessages(state)
        Button(onClick = { viewModel.verifyCode(code) }, enabled = !state.authBusy && code.length == 6, modifier = Modifier.fillMaxWidth().height(50.dp)) {
            if (state.authBusy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Verificar")
        }
        OutlinedButton(onClick = viewModel::resendVerification, enabled = !state.authBusy, modifier = Modifier.fillMaxWidth()) { Text("Enviar otro código") }
        TextButton(onClick = viewModel::logout) { Text("Usar otra cuenta") }
    }
}

@Composable
private fun ProfileForm(
    profile: CustomerProfile?,
    email: String,
    rutLocked: Boolean,
    busy: Boolean,
    submitLabel: String,
    onSave: (String, String, String) -> Unit,
) {
    var name by rememberSaveable(profile) { mutableStateOf(profile?.name.orEmpty()) }
    var rut by rememberSaveable(profile) { mutableStateOf(profile?.documentId.orEmpty()) }
    var phone by rememberSaveable(profile) { mutableStateOf(profile?.phone.orEmpty()) }
    val lockRut = rutLocked && !profile?.documentId.isNullOrBlank()
    Surface(shape = RoundedCornerShape(24.dp), tonalElevation = 2.dp) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(52.dp)) {
                    Icon(Icons.Outlined.Person, null, modifier = Modifier.padding(13.dp), tint = MaterialTheme.colorScheme.primary)
                }
                Column(Modifier.padding(start = 12.dp)) {
                    Text("Mis datos", fontWeight = FontWeight.Bold)
                    Text(email, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
            }
            Text(
                "Se usan en todas tus reservas: si corriges tu nombre o teléfono, se actualizan también en ellas.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AccountField(name, { name = it }, "Nombre completo", Icons.Outlined.Person)
            RutTextField(
                rut, { rut = it }, "RUT chileno", Modifier.fillMaxWidth(), Icons.Outlined.VerifiedUser,
                readOnly = lockRut, isError = rut.isNotBlank() && !isValidRut(rut),
            )
            if (lockRut) {
                Text("Tienes reservas confirmadas: para corregir el RUT, contáctanos.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            AccountField(phone, { phone = it }, "Teléfono", Icons.Outlined.Phone, KeyboardType.Phone)
            Button(onClick = { onSave(name, rut, phone) }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text(if (busy) "Guardando…" else submitLabel)
            }
        }
    }
}

@Composable
private fun AccountField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    readOnly: Boolean = false,
    isError: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        readOnly = readOnly,
        isError = isError,
        label = { Text(label) },
        leadingIcon = { Icon(icon, null) },
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    )
}

// Acceso con Google mediante Credential Manager: Google entrega un ID token
// que la app canjea por la sesión de Firebase.
@Composable
private fun GoogleSignInButton(enabled: Boolean, onToken: (String) -> Unit, onError: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    OutlinedButton(
        onClick = {
            scope.launch {
                try {
                    val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
                    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
                    val result = CredentialManager.create(context).getCredential(context, request)
                    val credential = result.credential
                    if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                        onToken(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                    } else {
                        onError("Google no entregó una cuenta válida.")
                    }
                } catch (_: GetCredentialCancellationException) {
                    // El usuario cerró la ventana de Google.
                } catch (_: NoCredentialException) {
                    onError("No hay cuentas de Google disponibles en este teléfono.")
                } catch (error: Exception) {
                    onError("No fue posible ingresar con Google. ${error.message.orEmpty()}".trim())
                }
            }
        },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().height(50.dp),
    ) {
        Text("G", fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(10.dp))
        Text("Continuar con Google")
    }
}
