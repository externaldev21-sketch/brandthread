import ExpoModulesCore
import UIKit

/// Holds the Home Screen quick action the app was opened with, and forwards
/// later ones to JS (`BrandthreadSystem` → `onQuickAction`).
final class QuickActionCenter {
    static let shared = QuickActionCenter()
    private var pending: String?
    var listener: ((String) -> Void)? {
        didSet {
            if let listener, let type = pending {
                pending = nil
                listener(type)
            }
        }
    }

    func receive(_ type: String) {
        if let listener { listener(type) } else { pending = type }
    }

    func takePending() -> String? {
        defer { pending = nil }
        return pending
    }
}

/// App-delegate hooks (registered in expo-module.config.json) for launching
/// from — or tapping, while running — a long-press app icon shortcut.
public class QuickActionsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
    public func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            QuickActionCenter.shared.receive(item.type)
        }
        return true
    }

    public func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        QuickActionCenter.shared.receive(shortcutItem.type)
        completionHandler(true)
    }
}
