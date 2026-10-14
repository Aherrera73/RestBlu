import Foundation
import Security

struct PhoneSignature {
    let publicKey: String
    let signature: String
}

enum PhoneAccessKey {
    private static func tag(_ uid: String) -> Data { Data("cl.restblu.phone-access.\(uid)".utf8) }

    private static func existing(_ uid: String) -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag(uid),
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
            kSecUseOperationPrompt as String: "Confirma tu identidad para abrir la puerta de RestBlu",
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? SecKey
    }

    private static func create(_ uid: String) throws -> SecKey {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                           [.privateKeyUsage, .biometryCurrentSet], &error) else {
            throw RestBluError.message("No se pudo proteger la clave con Face ID o Touch ID.")
        }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag(uid),
                kSecAttrAccessControl as String: access,
            ],
        ]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            throw RestBluError.message("Este iPhone necesita Face ID o Touch ID configurado para abrir la puerta.")
        }
        return key
    }

    static func sign(payload: String, ownerUID: String) throws -> PhoneSignature {
        let privateKey = try existing(ownerUID) ?? create(ownerUID)
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else { throw RestBluError.message("No se pudo leer la clave del iPhone.") }
        var error: Unmanaged<CFError>?
        guard let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?, raw.count == 65, raw.first == 0x04 else {
            throw RestBluError.message("La clave del iPhone tiene un formato incompatible.")
        }
        // SubjectPublicKeyInfo DER para prime256v1, igual al formato que envía Android.
        let prefix: [UInt8] = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02,
                               0x01, 0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00]
        let spki = Data(prefix) + raw
        guard let signature = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256,
                                                   Data(payload.utf8) as CFData, &error) as Data? else {
            throw RestBluError.message("La verificación biométrica se canceló o no pudo firmar la apertura.")
        }
        return PhoneSignature(publicKey: spki.base64EncodedString(), signature: signature.base64EncodedString())
    }
}
