import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Shared ActivityAttributes for a seller's live stream (viewers, sales).
/// Compiled into the app by this module's pod and copied into the widget
/// extension by `plugins/with-upload-live-activity.js`. `ContentState` keys match the
/// API server's APNs payload (`buildLiveStreamActivityPayload`).
#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct LiveStreamAttributes: ActivityAttributes {
    public typealias ContentState = LiveStreamContentState

    var streamId: String
    var title: String
}

@available(iOS 16.1, *)
struct LiveStreamContentState: Codable, Hashable {
    var viewers: Int
    var salesCents: Int
    var ordersCount: Int
    var isLive: Bool
}
#endif
