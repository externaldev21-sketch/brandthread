import ActivityKit
import WidgetKit
import SwiftUI

/// Buyer order tracking — the Uber Eats / Amazon delivery pattern:
///  - Lock Screen: item thumbnail, the stage headline and seller, the ETA
///    on the right, and a four-stage progress bar (Ordered · Shipped ·
///    Out for delivery · Delivered) under it.
///  - Dynamic Island compact: a shipping-box symbol + the ETA; minimal: the
///    symbol; expanded: headline, ETA and the progress bar.
/// Monochrome (black card, white/silver ink). Tapping opens the order.
@available(iOS 16.1, *)
struct OrderTrackingWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrderTrackingAttributes.self) { context in
            OrderLockScreen(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Color.white)
                .widgetURL(orderURL(context.attributes.orderId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    OrderGlyph(stage: context.state.stage, size: 22)
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    EtaLabel(state: context.state, compact: false)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.statusText)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        StageBar(stage: context.state.stage)
                        Text("\(context.attributes.sellerName) · \(context.attributes.orderNumber)")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.6))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                OrderGlyph(stage: context.state.stage, size: 16)
            } compactTrailing: {
                EtaLabel(state: context.state, compact: true)
            } minimal: {
                OrderGlyph(stage: context.state.stage, size: 14)
            }
            .widgetURL(orderURL(context.attributes.orderId))
            .keylineTint(Color.white)
        }
    }
}

private let orderStages = ["ordered", "shipped", "out_for_delivery", "delivered"]

private func stageIndex(_ stage: String) -> Int {
    orderStages.firstIndex(of: stage) ?? 0
}

private func orderURL(_ orderId: String) -> URL? {
    let encoded = orderId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? orderId
    return URL(string: "brandthread://buyer-order-detail?id=\(encoded)")
}

@available(iOS 16.1, *)
private struct OrderGlyph: View {
    let stage: String
    let size: CGFloat
    var body: some View {
        Image(systemName: stage == "delivered" ? "checkmark.circle.fill" : stage == "out_for_delivery" ? "box.truck.fill" : "shippingbox.fill")
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Color.white)
    }
}

/// "Today" / "Oct 15" / "Delivered", in the person's locale.
@available(iOS 16.1, *)
private struct EtaLabel: View {
    let state: OrderTrackingContentState
    let compact: Bool
    var body: some View {
        Group {
            if state.stage == "delivered" {
                Text(compact ? "Done" : "Delivered")
            } else if let eta = state.etaEpoch {
                // Carriers give a delivery day, not a time: "Today" or the
                // date (Amazon's "Arriving today" / "Arriving Oct 15").
                let day = Date(timeIntervalSince1970: eta)
                if Calendar.current.isDateInToday(day) {
                    Text("Today")
                } else {
                    Text(day.formatted(.dateTime.month(.abbreviated).day()))
                }
            } else {
                Text(compact ? "" : state.statusText)
            }
        }
        .font(.system(size: compact ? 13 : 15, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(Color.white)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

/// Four segments filled up to the current stage, Amazon-style.
@available(iOS 16.1, *)
private struct StageBar: View {
    let stage: String
    var body: some View {
        let current = stageIndex(stage)
        HStack(spacing: 4) {
            ForEach(0..<orderStages.count, id: \.self) { i in
                Capsule()
                    .fill(i <= current ? Color.white : Color.white.opacity(0.22))
                    .frame(height: 5)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Step \(current + 1) of \(orderStages.count)")
    }
}

@available(iOS 16.1, *)
private struct OrderThumb: View {
    let fileName: String?
    var body: some View {
        Group {
            if let fileName, let image = AppGroupImage.load(fileName) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white.opacity(0.12))
                    .overlay(Image(systemName: "shippingbox.fill").foregroundStyle(Color.white.opacity(0.7)))
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

@available(iOS 16.1, *)
private struct OrderLockScreen: View {
    let attributes: OrderTrackingAttributes
    let state: OrderTrackingContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                OrderThumb(fileName: attributes.thumbnailFileName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.statusText)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                    Text("\(attributes.sellerName) · \(attributes.orderNumber)")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.white.opacity(0.6))
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    if state.stage != "delivered", state.etaEpoch != nil {
                        Text("Arriving")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.6))
                    }
                    EtaLabel(state: state, compact: false)
                }
            }
            StageBar(stage: state.stage)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// Reads an image the app wrote into the shared App Group container.
enum AppGroupImage {
    static let group = "group.com.brandthread.mobile.liveactivity"
    static func load(_ fileName: String) -> UIImage? {
        guard !fileName.isEmpty,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
              let data = try? Data(contentsOf: container.appendingPathComponent(fileName))
        else { return nil }
        return UIImage(data: data)
    }
}
