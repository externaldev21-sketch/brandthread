import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Shared ActivityAttributes for Brandthread's upload Live Activity.
///
/// This file is compiled into BOTH the main app target (which calls
/// `Activity<UploadLiveActivityAttributes>.request(...)`/`.update(...)`/
/// `.end(...)` from `UploadLiveActivityModule.swift`) and the
/// `UploadLiveActivity` widget extension target (which renders it in
/// `UploadLiveActivityWidget.swift`). The config plugin that adds the
/// widget extension target (`plugins/with-upload-live-activity.js`) adds
/// this file to both targets' "Compile Sources" build phase — do not move
/// it without updating that plugin.
///
/// Brandthread has no separate "reel" content type: a photo, video or
/// slideshow post is one "Thread" (`SellerThreadPost` server-side). A
/// Story is a separate, genuinely distinct feature. `kind` distinguishes
/// the two only for copy purposes ("Your Thread is uploading…" vs "Your
/// story is uploading…") — the visual layout is identical either way.
#if canImport(ActivityKit)
@available(iOS 16.1, *)
struct UploadLiveActivityAttributes: ActivityAttributes {
    /// "thread" | "story". Kept as a plain String (rather than a Swift
    /// enum) so it round-trips through the Expo Modules API bridge, which
    /// hands JS string values straight through, with no risk of a decode
    /// failure if the two sides ever drift.
    public typealias ContentState = UploadLiveActivityContentState

    var kind: String
    /// File name (not a full path) of the thumbnail JPEG the module wrote
    /// into the shared App Group container
    /// (`group.com.brandthread.mobile.liveactivity`) before starting the
    /// activity. Static (fixed for the activity's lifetime) rather than
    /// part of `ContentState` because the thumbnail never changes once an
    /// upload starts, and ActivityKit's content-state payload has a small
    /// size budget — better spent on the thumbnail once, at start, via the
    /// App Group file, than resent on every progress update. `nil` when
    /// the caller started the activity without a thumbnail.
    var thumbnailFileName: String?
}

@available(iOS 16.1, *)
struct UploadLiveActivityContentState: Codable, Hashable {
    /// "uploading" | "success" | "failed".
    var status: String
    /// 0.0-1.0. Meaningless once `status != "uploading"`, but always
    /// present so `ContentState` stays a single flat, Codable struct.
    var progress: Double
    /// Deep-link route to retry, e.g. "/create-post?editId=...". Only set
    /// when `status == "failed"`. Carries no scheme/host — the widget
    /// builds the full `brandthread://` URL when the person taps it.
    var retryRoute: String?
}
#endif
