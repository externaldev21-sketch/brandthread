// "How much did I sell today?" — a Siri / Shortcuts / Spotlight answer for
// Brandthread sellers. Compiled into the main app target by
// plugins/with-siri-shortcuts.js.
//
// The app saves today's sales to its standard UserDefaults whenever it
// loads them (lib/siriSalesSnapshot.ts). This intent only reads that
// snapshot, and only answers from it when it is from today; otherwise it
// asks the seller to open the app.

import AppIntents
import Foundation

@available(iOS 16.0, *)
struct SalesTodayIntent: AppIntent {
  static var title: LocalizedStringResource = "Sales today"
  static var description = IntentDescription("Hear how much your Brandthread store has sold today.")
  static var openAppWhenRun: Bool = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let defaults = UserDefaults.standard
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    let today = formatter.string(from: Date())

    guard
      defaults.string(forKey: "bt.salesToday.day") == today,
      let amount = defaults.string(forKey: "bt.salesToday.amount"),
      !amount.isEmpty
    else {
      return .result(dialog: "Open Brandthread to update today's sales.")
    }

    let orders = defaults.integer(forKey: "bt.salesToday.orders")
    if orders == 0 {
      return .result(dialog: "No sales yet today.")
    }
    let noun = orders == 1 ? "order" : "orders"
    return .result(dialog: "You've sold \(amount) across \(orders) \(noun) today.")
  }
}

@available(iOS 16.0, *)
struct BrandthreadShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SalesTodayIntent(),
      phrases: [
        "How much did I sell today in \(.applicationName)",
        "\(.applicationName) sales today",
        "Today's sales in \(.applicationName)",
      ],
      shortTitle: "Sales today",
      systemImageName: "dollarsign.circle"
    )
  }
}
