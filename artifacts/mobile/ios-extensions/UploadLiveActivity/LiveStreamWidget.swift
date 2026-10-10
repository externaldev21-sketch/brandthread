import ActivityKit
import WidgetKit
import SwiftUI

/// A seller's live stream: LIVE badge (the one LIVE red the palette
/// allows), viewers and sales on the Lock Screen; compact Dynamic Island
/// shows the red LIVE dot and the viewer count. Tapping brings the app (and
/// the broadcast it is running) back to the foreground.
@available(iOS 16.1, *)
struct LiveStreamWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveStreamAttributes.self) { context in
            LiveLockScreen(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveBadge(isLive: context.state.isLive).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Label("\(context.state.viewers)", systemImage: "eye.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(Color.white)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveStats(state: context.state).padding(.horizontal, 6)
                }
            } compactLeading: {
                Circle().fill(liveRed).frame(width: 8, height: 8)
            } compactTrailing: {
                Text("\(context.state.viewers)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color.white)
            } minimal: {
                Circle().fill(liveRed).frame(width: 8, height: 8)
            }
            .keylineTint(liveRed)
        }
    }
}

/// LIVE red — the palette's one live accent.
private let liveRed = Color(red: 1.0, green: 0.23, blue: 0.19)

private func money(_ cents: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.maximumFractionDigits = cents % 100 == 0 ? 0 : 2
    return formatter.string(from: NSNumber(value: Double(cents) / 100)) ?? "$\(cents / 100)"
}

@available(iOS 16.1, *)
private struct LiveBadge: View {
    let isLive: Bool
    var body: some View {
        Text(isLive ? "LIVE" : "ENDED")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(isLive ? liveRed : Color.white.opacity(0.22)))
    }
}

@available(iOS 16.1, *)
private struct LiveStats: View {
    let state: LiveStreamContentState
    var body: some View {
        HStack(spacing: 18) {
            stat(value: "\(state.viewers)", label: "Watching")
            // Sales only once there are some — never a placeholder zero.
            if state.salesCents > 0 || state.ordersCount > 0 {
                stat(value: money(state.salesCents), label: "Sales")
                stat(value: "\(state.ordersCount)", label: state.ordersCount == 1 ? "Order" : "Orders")
            }
            Spacer(minLength: 0)
        }
    }
    private func stat(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.system(size: 17, weight: .semibold)).monospacedDigit().foregroundStyle(Color.white)
            Text(label).font(.system(size: 12)).foregroundStyle(Color.white.opacity(0.6))
        }
    }
}

@available(iOS 16.1, *)
private struct LiveLockScreen: View {
    let attributes: LiveStreamAttributes
    let state: LiveStreamContentState
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                LiveBadge(isLive: state.isLive)
                Text(attributes.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            LiveStats(state: state)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}
