import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var store: RestBluStore
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var registering = false
    @State private var name = ""
    @State private var rut = ""
    @State private var phone = ""
    @State private var editingProfile = false

    var body: some View {
        Form {
            if let account = store.account {
                Section("Cuenta") {
                    LabeledContent("Correo", value: account.email)
                    LabeledContent("Verificación", value: account.emailVerified ? "Completada" : "Pendiente")
                }
                if !account.emailVerified {
                    Section("Verificar correo") {
                        Text("Recibirás un código de seis dígitos en tu correo.")
                        Button("Enviar código") { Task { await store.sendVerificationCode() } }.disabled(store.busy)
                        TextField("Código de seis dígitos", text: $code)
                            .keyboardType(.numberPad).onChange(of: code) { code = String($0.prefix(6)) }
                        Button("Confirmar código") { Task { await store.verifyCode(code) } }
                            .disabled(store.busy || code.count != 6)
                    }
                }
                Section("Datos personales") {
                    LabeledContent("Nombre", value: store.profile.name)
                    LabeledContent("RUT", value: store.profile.documentID)
                    LabeledContent("Teléfono", value: store.profile.phone)
                    Button("Editar perfil") { editingProfile = true }
                }
                Section { Button("Cerrar sesión", role: .destructive) { Task { await store.logout() } } }
            } else {
                Section(registering ? "Crear cuenta" : "Iniciar sesión") {
                    if registering {
                        TextField("Nombre completo", text: $name)
                            .textContentType(.name)
                        TextField("RUT", text: $rut)
                        TextField("Teléfono", text: $phone).keyboardType(.phonePad)
                    }
                    TextField("Correo electrónico", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Contraseña", text: $password)
                        .textContentType(registering ? .newPassword : .password)
                    Button(registering ? "Crear cuenta" : "Entrar") {
                        Task {
                            if registering { await store.register(name: name, rut: rut, phone: phone, email: email, password: password) }
                            else { await store.login(email: email, password: password) }
                        }
                    }.disabled(store.busy || email.isEmpty || password.isEmpty)
                    Button(registering ? "Ya tengo cuenta" : "Crear una cuenta") { registering.toggle() }
                    if !registering {
                        Button("Recuperar contraseña") { Task { await store.resetPassword(email) } }
                            .disabled(email.isEmpty)
                    }
                }
            }
        }
        .navigationTitle("Mi perfil")
        .sheet(isPresented: $editingProfile) { EditProfileView() }
    }
}

struct EditProfileView: View {
    @EnvironmentObject private var store: RestBluStore
    @Environment(\.dismiss) private var dismiss
    @State private var profile = CustomerProfile()

    var body: some View {
        NavigationStack {
            Form {
                Section("Identidad") {
                    TextField("Nombre completo", text: $profile.name)
                    TextField("RUT", text: $profile.documentID)
                    TextField("Teléfono", text: $profile.phone).keyboardType(.phonePad)
                    TextField("Fecha de nacimiento (AAAA-MM-DD)", text: $profile.birthDate)
                    TextField("Nacionalidad", text: $profile.nationality)
                }
                Section("Contacto de emergencia") {
                    TextField("Nombre", text: $profile.emergencyContactName)
                    TextField("Teléfono", text: $profile.emergencyContactPhone).keyboardType(.phonePad)
                }
                Button("Guardar cambios") {
                    Task { await store.saveProfile(profile); if store.profile.documentID == RestBluFormat.rut(profile.documentID) { dismiss() } }
                }.disabled(store.busy)
            }
            .navigationTitle("Editar perfil")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cerrar") { dismiss() } } }
            .onAppear { profile = store.profile }
        }
    }
}
