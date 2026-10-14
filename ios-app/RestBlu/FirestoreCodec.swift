import Foundation

enum FirestoreCodec {
    static func decode(_ value: Any?) -> Any? {
        guard let wrapper = value as? [String: Any] else { return nil }
        if let text = wrapper["stringValue"] as? String { return text }
        if let text = wrapper["timestampValue"] as? String { return text }
        if let integer = wrapper["integerValue"] as? String { return Int(integer) }
        if let double = wrapper["doubleValue"] as? Double { return double }
        if let bool = wrapper["booleanValue"] as? Bool { return bool }
        if let map = (wrapper["mapValue"] as? [String: Any])?["fields"] as? [String: Any] { return fields(map) }
        if let array = wrapper["arrayValue"] as? [String: Any] {
            return (array["values"] as? [Any] ?? []).compactMap(decode)
        }
        return nil
    }

    static func fields(_ raw: [String: Any]) -> [String: Any] {
        raw.reduce(into: [:]) { result, entry in result[entry.key] = decode(entry.value) }
    }

    static func encode(_ value: Any) -> [String: Any] {
        switch value {
        case let text as String: return ["stringValue": text]
        case let bool as Bool: return ["booleanValue": bool]
        case let number as Int: return ["integerValue": String(number)]
        case let number as Double: return ["doubleValue": number]
        case let array as [Any]: return ["arrayValue": ["values": array.map(encode)]]
        case let map as [String: Any]: return ["mapValue": ["fields": wrap(map)]]
        default: return ["stringValue": String(describing: value)]
        }
    }

    static func wrap(_ values: [String: Any]) -> [String: Any] {
        values.mapValues(encode)
    }
}

extension Dictionary where Key == String, Value == Any {
    func text(_ key: String) -> String { self[key] as? String ?? "" }
    func int(_ key: String) -> Int {
        if let number = self[key] as? Int { return number }
        if let number = self[key] as? NSNumber { return number.intValue }
        return Int(text(key)) ?? 0
    }
    func bool(_ key: String) -> Bool { self[key] as? Bool ?? false }
}
