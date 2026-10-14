import SwiftUI

struct BluView: View {
    @EnvironmentObject private var store: RestBluStore
    @State private var question = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { reader in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if store.aiMessages.isEmpty {
                            RestBluCard {
                                Text("Hola, soy Blu").font(.title2.bold()).foregroundStyle(Brand.navy)
                                Text("Puedo ayudarte con alojamientos, fechas, reservas y acceso.")
                            }
                        }
                        ForEach(store.aiMessages) { message in
                            Text(message.content)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
                                .background(message.role == "user" ? Brand.teal.opacity(0.15) : .white,
                                            in: RoundedRectangle(cornerRadius: 16))
                                .id(message.id)
                        }
                        if store.aiBusy { ProgressView("Blu está respondiendo…") }
                    }.padding()
                }
                .onChange(of: store.aiMessages.count) { _ in
                    if let last = store.aiMessages.last { reader.scrollTo(last.id, anchor: .bottom) }
                }
            }
            HStack {
                TextField("Pregúntale a Blu", text: $question, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                Button {
                    let value = question
                    question = ""
                    Task { await store.askBlu(value) }
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .disabled(store.aiBusy || question.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            }.padding()
                .background(.white)
        }
        .background(Brand.pale)
        .navigationTitle("Blu IA")
    }
}
