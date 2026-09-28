import ActivityKit
import WidgetKit
import SwiftUI

/// Brandthread's upload Live Activity: Dynamic Island (compact/expanded/
/// minimal) + Lock Screen presentations for a Thread or Story upload in
/// progress.
///
/// Modeled 1:1 on Instagram's own upload Live Activity (see
/// `docs/polish/screenshots/upload-live-activity/mobbin-reference/` in the
/// main app repo for the reference frames this was built against). The
/// only intentional differences from that reference: a monochrome
/// black/white/gray progress ring and checkmark (Instagram uses a pink →
/// orange → purple gradient ring and a green checkmark), and Brandthread's
/// own copy ("Thread"/"story" instead of "post"/"reel", plus a failure
/// state Instagram's reference doesn't show at all).
@available(iOS 16.1, *)
struct UploadLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: UploadLiveActivityAttributes.self) { context in
            LockScreenCard(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color.white)
                .activitySystemActionForegroundColor(Color.black)
                .widgetURL(deepLinkURL(for: context.state))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Thumbnail(fileName: context.attributes.thumbnailFileName, size: 40)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    ProgressRing(state: context.state, diameter: 34, lineWidth: 3)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    StatusText(kind: context.attributes.kind, state: context.state)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    EmptyView()
                }
            } compactLeading: {
                Thumbnail(fileName: context.attributes.thumbnailFileName, size: 22)
            } compactTrailing: {
                ProgressRing(state: context.state, diameter: 20, lineWidth: 2)
            } minimal: {
                ProgressRing(state: context.state, diameter: 18, lineWidth: 2)
            }
            .widgetURL(deepLinkURL(for: context.state))
            .keylineTint(Color.black)
        }
    }
}

/// Builds the `brandthread://` deep link opened when the person taps a
/// failed upload's Live Activity/Dynamic Island. Mirrors the
/// `ExpoLinking.createURL(...)` convention used elsewhere in the app (see
/// `components/ThreadShareSheet.tsx`) — same `"brandthread"` scheme (see
/// `app.json`'s `"scheme"`), just built natively since this runs outside
/// the JS runtime. Only a failed activity is tappable-to-retry; every
/// other state has no route to send the person to, so tapping it just
/// brings the app to the foreground (default system behavior with no
/// `widgetURL`).
@available(iOS 16.1, *)
private func deepLinkURL(for state: UploadLiveActivityAttributes.ContentState) -> URL? {
    guard state.status == "failed", let route = state.retryRoute, !route.isEmpty else {
        return nil
    }
    let path = route.hasPrefix("/") ? String(route.dropFirst()) : route
    return URL(string: "brandthread://\(path)")
}

// MARK: - Shared subviews

/// Small rounded-corner thumbnail, loaded from the shared App Group
/// container the native module wrote it into before starting the
/// activity (`group.com.brandthread.mobile.liveactivity`). Falls back to a
/// plain placeholder square when there's no thumbnail or it can't be
/// loaded — a Live Activity must never crash or show nothing.
@available(iOS 16.1, *)
private struct Thumbnail: View {
    let fileName: String?
    let size: CGFloat

    var body: some View {
        Group {
            if let uiImage = Self.loadImage(fileName: fileName) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Rectangle()
                    .fill(Color.black.opacity(0.12))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
    }

    private static func loadImage(fileName: String?) -> UIImage? {
        guard let fileName, !fileName.isEmpty,
              let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.brandthread.mobile.liveactivity"
              )
        else { return nil }
        let fileURL = containerURL.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return UIImage(data: data)
    }
}

/// The percentage/checkmark/warning ring shown at every size. Monochrome
/// per the brand-adaptation rule: black stroke and text on the light
/// (expanded/lock screen) backgrounds, white on the black compact/minimal
/// Dynamic Island background — never Instagram's color gradient.
@available(iOS 16.1, *)
private struct ProgressRing: View {
    let state: UploadLiveActivityAttributes.ContentState
    let diameter: CGFloat
    let lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(ringColor.opacity(0.25), lineWidth: lineWidth)
            switch state.status {
            case "success":
                Circle()
                    .stroke(ringColor, lineWidth: lineWidth)
                Image(systemName: "checkmark")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.bold)
                    .frame(width: diameter * 0.42, height: diameter * 0.42)
                    .foregroundStyle(ringColor)
            case "failed":
                Circle()
                    .stroke(ringColor, lineWidth: lineWidth)
                Image(systemName: "exclamationmark")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.bold)
                    .frame(width: diameter * 0.12, height: diameter * 0.4)
                    .foregroundStyle(ringColor)
            default:
                Circle()
                    .trim(from: 0, to: max(0, min(1, state.progress)))
                    .stroke(ringColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                if diameter >= 30 {
                    Text("\(Int((state.progress * 100).rounded()))")
                        .font(.system(size: diameter * 0.38, weight: .semibold))
                        .foregroundStyle(ringColor)
                        .minimumScaleFactor(0.6)
                }
            }
        }
        .frame(width: diameter, height: diameter)
    }

    /// Callers on a black background (compact/minimal Dynamic Island) pass
    /// white via the environment's default foreground already being white
    /// there; the lock screen/expanded island are on a white/clear
    /// background so this stays black. SwiftUI has no reliable "am I on a
    /// dark surface" query for a widget, so each presentation is
    /// responsible for tinting correctly — the compact/minimal Dynamic
    /// Island slots render on black chrome by definition, so `.white` is
    /// correct without a check.
    private var ringColor: Color {
        diameter <= 24 ? .white : .black
    }
}

/// "Your Thread is uploading…" / "Your Thread is posted." / "Your story is
/// uploading…" / "Your story is posted." / "Upload failed. Tap to retry."
/// — the one place all five copy variants are defined, per the owner's
/// naming rules (`docs/creation-flows.md`'s "Thread" convention: this app
/// has no separate "reel" content type).
@available(iOS 16.1, *)
private struct StatusText: View {
    let kind: String
    let state: UploadLiveActivityAttributes.ContentState

    var body: some View {
        Text(Self.copy(kind: kind, state: state))
    }

    static func copy(kind: String, state: UploadLiveActivityAttributes.ContentState) -> String {
        let noun = kind == "story" ? "story" : "Thread"
        switch state.status {
        case "success":
            return kind == "story" ? "Your story is posted." : "Your Thread is posted."
        case "failed":
            return "Upload failed. Tap to retry."
        default:
            return "Your \(noun) is uploading…"
        }
    }
}

/// Lock Screen presentation: white rounded card, thumbnail left, status
/// text center, ring right — matching
/// `06-lockscreen-uploading.webp`/`07-lockscreen-complete.webp` layout
/// exactly, just monochrome.
@available(iOS 16.1, *)
private struct LockScreenCard: View {
    let attributes: UploadLiveActivityAttributes
    let state: UploadLiveActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            Thumbnail(fileName: attributes.thumbnailFileName, size: 40)
            StatusText(kind: attributes.kind, state: state)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.black)
                .lineLimit(1)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            ProgressRing(state: state, diameter: 34, lineWidth: 3)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}
