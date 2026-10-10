import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Shared ActivityAttributes for the buyer's order-tracking Live Activity.
///
/// Compiled into the app by this module's pod (the `BrandthreadSystem`
/// module starts/updates/ends it) and copied into the widget extension by
/// `plugins/with-upload-live-activity.js` (rendered by
/// `OrderTrackingWidget.swift`). Keep this the only copy.
///
/// `ContentState` keys are also the APNs `content-state` contract used by
/// the API server (`artifacts/api-server/src/lib/liveActivityPush.ts`):
/// `{ stage, statusText, etaEpoch }`. Change both sides together.
#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct OrderTrackingAttributes: ActivityAttributes {
    public typealias ContentState = OrderTrackingContentState

    var orderId: String
    var orderNumber: String
    var sellerName: String
    /// Thumbnail of the first item, written into the App Group container.
    var thumbnailFileName: String?
}

@available(iOS 16.1, *)
struct OrderTrackingContentState: Codable, Hashable {
    /// "ordered" | "shipped" | "out_for_delivery" | "delivered".
    var stage: String
    /// Short status line, e.g. "Out for delivery".
    var statusText: String
    /// Estimated delivery, seconds since 1970. nil when unknown.
    var etaEpoch: Double?
}
#endif
