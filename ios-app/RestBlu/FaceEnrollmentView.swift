import SwiftUI
import UIKit

struct FaceEnrollmentView: View {
    let reservation: Reservation
    @EnvironmentObject private var store: RestBluStore
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?
    @State private var consent = false
    @State private var showingCamera = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Registro facial") {
                    Text("Toma una foto frontal con buena luz. Se cifra en el iPhone antes de enviarla al gestor.")
                    if let image {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 260)
                    }
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Tomar foto") { showingCamera = true }
                    } else {
                        Text("La cámara requiere un iPhone físico.").foregroundStyle(.secondary)
                    }
                }
                Section {
                    Toggle("Autorizo el tratamiento de mi rostro para el acceso a esta estadía y su envío al terminal Dahua.", isOn: $consent)
                    Button("Enviar registro facial") {
                        guard let image, let jpeg = FacePhoto.jpeg(image) else {
                            store.notice = "La imagen es demasiado grande. Toma otra foto."; return
                        }
                        Task { await store.enrollFace(jpeg, reservation: reservation); dismiss() }
                    }
                    .disabled(!consent || image == nil || store.busy)
                } footer: {
                    Text("Este registro se vincula sólo a la reserva \(reservation.id).")
                }
            }
            .navigationTitle("Registrar rostro")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Cerrar") { dismiss() } } }
            .sheet(isPresented: $showingCamera) { CameraCapture(image: $image) }
        }
    }
}

enum FacePhoto {
    static func jpeg(_ image: UIImage) -> Data? {
        let bound: CGFloat = 1000
        let scale = min(1, bound / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let normalized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality: CGFloat in [0.75, 0.6, 0.45, 0.3] {
            if let data = normalized.jpegData(compressionQuality: quality), data.count <= 450_000 { return data }
        }
        return nil
    }
}

struct CameraCapture: UIViewControllerRepresentable {
    @Binding var image: UIImage?
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraDevice = .front
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UINavigationControllerDelegate, UIImagePickerControllerDelegate {
        let parent: CameraCapture
        init(_ parent: CameraCapture) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            parent.image = info[.originalImage] as? UIImage
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
