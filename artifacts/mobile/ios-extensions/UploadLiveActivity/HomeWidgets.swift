import WidgetKit
import SwiftUI

/// Home Screen widgets. The app writes a small JSON snapshot into the shared
/// App Group's UserDefaults (`BrandthreadSystem.setWidgetSnapshot`) and asks
/// WidgetKit to reload; these widgets only read it — no network in the
/// extension, and nothing shown that the app didn't fetch for real.

enum WidgetSnapshots {
    static let suite = "group.com.brandthread.mobile.liveactivity"
    static func read<T: Decodable>(_ key: String, as: T.Type) -> T? {
        guard let defaults = UserDefaults(suiteName: suite),
              let json = defaults.string(forKey: key),
              let data = json.data(using: .utf8)
        else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

struct SellerTodaySnapshot: Decodable {
    var salesCents: Int
    var currency: String?
    var ordersCount: Int
    var toShipCount: Int
    var updatedAt: Double
}

struct BuyerCashSnapshot: Decodable {
    var balanceCents: Int
    var currency: String?
    var streakDays: Int
    var updatedAt: Double
}

private func formatMoney(_ cents: Int, _ currency: String?) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    if let currency { formatter.currencyCode = currency }
    formatter.maximumFractionDigits = 2
    return formatter.string(from: NSNumber(value: Double(cents) / 100)) ?? "\(cents / 100)"
}

// MARK: - Seller: Today's sales + new orders (Shopify's iOS widget)

struct SellerTodayEntry: TimelineEntry {
    let date: Date
    let snapshot: SellerTodaySnapshot?
}

struct SellerTodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> SellerTodayEntry {
        SellerTodayEntry(date: Date(), snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (SellerTodayEntry) -> Void) {
        completion(SellerTodayEntry(date: Date(), snapshot: WidgetSnapshots.read("sellerToday", as: SellerTodaySnapshot.self)))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SellerTodayEntry>) -> Void) {
        let entry = SellerTodayEntry(date: Date(), snapshot: WidgetSnapshots.read("sellerToday", as: SellerTodaySnapshot.self))
        // The app reloads this timeline whenever it fetches fresh numbers;
        // midnight rolls "Today" over so yesterday's total never lingers.
        let midnight = Calendar.current.startOfDay(for: Date()).addingTimeInterval(24 * 60 * 60)
        completion(Timeline(entries: [entry], policy: .after(midnight)))
    }
}

struct SellerTodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SellerTodayEntry

    var body: some View {
        switch family {
        case .accessoryRectangular, .accessoryInline:
            SellerTodayAccessoryView(entry: entry, inline: family == .accessoryInline)
                .widgetURL(SellerWidgetLinks.salesToday)
                .widgetBackgroundBlack()
        default:
            homeScreen
        }
    }

    @ViewBuilder private var homeScreen: some View {
        let isToday = entry.snapshot.map { Calendar.current.isDateInToday(Date(timeIntervalSince1970: $0.updatedAt)) } ?? false
        let sales = isToday ? (entry.snapshot?.salesCents ?? 0) : 0
        let orders = isToday ? (entry.snapshot?.ordersCount ?? 0) : 0
        let newOrders = entry.snapshot?.toShipCount ?? 0  // a backlog, not day-scoped
        VStack(alignment: .leading, spacing: 4) {
            Text("Today")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.6))
            Text(formatMoney(sales, entry.snapshot?.currency))
                .font(.system(size: family == .systemSmall ? 26 : 32, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.white)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text("Total sales")
                .font(.system(size: 12))
                .foregroundStyle(Color.white.opacity(0.6))
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(orders)").font(.system(size: 17, weight: .semibold)).monospacedDigit().foregroundStyle(Color.white)
                    Text(orders == 1 ? "Order" : "Orders").font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.6))
                }
                if family != .systemSmall || newOrders > 0 {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(newOrders)").font(.system(size: 17, weight: .semibold)).monospacedDigit().foregroundStyle(Color.white)
                        Text("To ship").font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.6))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(SellerWidgetLinks.salesToday)
        .widgetBackgroundBlack()
    }
}

struct SellerTodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SellerTodayWidget", provider: SellerTodayProvider()) { entry in
            SellerTodayView(entry: entry)
        }
        .configurationDisplayName("Sales today")
        .description("Sales and orders for your store today.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Seller: lock screen + "To ship" (Shopify's iOS widgets)

/// Where each seller widget opens. "Sales today" → Analytics (today's
/// chart); "To ship" → Orders filtered to unfulfilled.
enum SellerWidgetLinks {
    static let salesToday = URL(string: "brandthread://analytics")
    static let toShip = URL(string: "brandthread://orders?filter=unfulfilled")
}

/// Today's figures, or nil for a snapshot from an earlier day (sales and
/// orders reset at midnight; the to-ship backlog doesn't).
struct SellerFigures {
    let sales: String?
    let orders: Int?
    let toShip: Int?

    init(_ snapshot: SellerTodaySnapshot?) {
        guard let snapshot else {
            sales = nil; orders = nil; toShip = nil
            return
        }
        let isToday = Calendar.current.isDateInToday(Date(timeIntervalSince1970: snapshot.updatedAt))
        sales = formatMoney(isToday ? snapshot.salesCents : 0, snapshot.currency)
        orders = isToday ? snapshot.ordersCount : 0
        toShip = snapshot.toShipCount
    }
}

private func countText(_ n: Int?) -> String { n.map(String.init) ?? "–" }

struct SellerTodayAccessoryView: View {
    let entry: SellerTodayEntry
    let inline: Bool

    var body: some View {
        let f = SellerFigures(entry.snapshot)
        if inline {
            Text("\(f.sales ?? "–") · \(countText(f.orders)) \(f.orders == 1 ? "order" : "orders")")
                .monospacedDigit()
        } else {
            VStack(alignment: .leading, spacing: 1) {
                Text("Sales today").font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text(f.sales ?? "–").font(.system(size: 20, weight: .bold)).monospacedDigit()
                    .minimumScaleFactor(0.6).lineLimit(1)
                Text("\(countText(f.orders)) \(f.orders == 1 ? "order" : "orders")")
                    .font(.system(size: 13)).monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct SellerToShipView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SellerTodayEntry

    var body: some View {
        content
            .widgetURL(SellerWidgetLinks.toShip)
            .widgetBackgroundBlack()
    }

    @ViewBuilder private var content: some View {
        let f = SellerFigures(entry.snapshot)
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(countText(f.toShip)).font(.system(size: 20, weight: .bold)).monospacedDigit()
                        .minimumScaleFactor(0.5).lineLimit(1)
                    Text("to ship").font(.system(size: 10))
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text("To ship").font(.system(size: 13, weight: .semibold)).widgetAccentable()
                Text(countText(f.toShip)).font(.system(size: 20, weight: .bold)).monospacedDigit()
                Text(f.toShip == 1 ? "order" : "orders").font(.system(size: 13))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .accessoryInline:
            Text("\(countText(f.toShip)) to ship").monospacedDigit()
        case .systemMedium:
            HStack(alignment: .top, spacing: 0) {
                figure(title: "To ship", value: countText(f.toShip), big: true)
                figure(title: "Orders today", value: countText(f.orders), big: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            figure(title: "To ship", value: countText(f.toShip), big: true)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func figure(title: String, value: String, big: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.6))
            Text(value)
                .font(.system(size: big ? 40 : 17, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.white)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SellerToShipWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SellerToShipWidget", provider: SellerTodayProvider()) { entry in
            SellerToShipView(entry: entry)
        }
        .configurationDisplayName("To ship")
        .description("Orders waiting to ship.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Buyer: Thread Cash balance + streak

struct BuyerCashEntry: TimelineEntry {
    let date: Date
    let snapshot: BuyerCashSnapshot?
}

struct BuyerCashProvider: TimelineProvider {
    func placeholder(in context: Context) -> BuyerCashEntry { BuyerCashEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (BuyerCashEntry) -> Void) {
        completion(BuyerCashEntry(date: Date(), snapshot: WidgetSnapshots.read("buyerCash", as: BuyerCashSnapshot.self)))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BuyerCashEntry>) -> Void) {
        let entry = BuyerCashEntry(date: Date(), snapshot: WidgetSnapshots.read("buyerCash", as: BuyerCashSnapshot.self))
        completion(Timeline(entries: [entry], policy: .never))
    }
}

/// Thread Cash green — the palette's money accent.
private let threadCashGreen = Color(red: 0.0, green: 0.82, blue: 0.42)

struct BuyerCashView: View {
    let entry: BuyerCashEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Thread Cash")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.6))
            Text(formatMoney(entry.snapshot?.balanceCents ?? 0, entry.snapshot?.currency))
                .font(.system(size: 26, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(threadCashGreen)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let streak = entry.snapshot?.streakDays, streak > 0 {
                Label("\(streak)-day streak", systemImage: "flame.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "brandthread://thread-cash"))
        .widgetBackgroundBlack()
    }
}

struct BuyerCashWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BuyerCashWidget", provider: BuyerCashProvider()) { entry in
            BuyerCashView(entry: entry)
        }
        .configurationDisplayName("Thread Cash")
        .description("Your balance and daily streak.")
        .supportedFamilies([.systemSmall])
    }
}

private extension View {
    /// Solid black widget background: `containerBackground` on iOS 17+
    /// (required there), a plain padded background before that.
    @ViewBuilder
    func widgetBackgroundBlack() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(Color.black, for: .widget)
        } else {
            self.padding(16).background(Color.black)
        }
    }
}
