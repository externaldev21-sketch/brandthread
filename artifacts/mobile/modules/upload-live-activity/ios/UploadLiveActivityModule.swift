import ExpoModulesCore
#if canImport(ActivityKit)
import ActivityKit
#endif
import UIKit

/// Expo Modules API bridge for `lib/uploadLiveActivity.ts`. Registered
/// under the name `UploadLiveActivity`, matching that file's
/// `requireOptionalNativeModule('UploadLiveActivity')` call — the two must
/// stay in sync.
///
/// This module owns:
///  - Starting/updating/ending the `Activity<UploadLiveActivityAttributes>`
///    (declared in `ios-extensions/UploadLiveActivity/
///    UploadLiveActivityAttributes.swift`, compiled into this app target
///    by the config plugin alongside the widget extension target).
///  - Copying the caller's thumbnail (a local file uri or remote url) into
///    the shared App Group container so the widget extension process —
///    which cannot read the app's own sandboxed Documents/cache
///    directories — can load it.
///
/// v1 is LOCAL-only: every update comes from `Activity.update(...)` called
/// from this running app process, which needs no push entitlement. See
/// this file's own note further down for what remote (APNs push) updates
/// would additionally require.
public class UploadLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("UploadLiveActivity")

        AsyncFunction("startActivity") { (options: StartActivityOptions) in
            try Self.startActivity(options)
        }

        Function("updateActivity") { (id: String, progress: Double) in
            Self.updateActivity(id: id, progress: progress)
        }

        Function("endActivity") { (id: String, result: EndActivityResult) in
            Self.endActivity(id: id, result: result)
        }
    }

    // MARK: - Records (Expo Modules API argument types)

    struct StartActivityOptions: Record {
        @Field var id: String = ""
        @Field var kind: String = "thread"
        @Field var thumbnailUri: String?
    }

    struct EndActivityResult: Record {
        @Field var status: String = "success"
        @Field var retryRoute: String?
    }

    // MARK: - In-memory registry

    /// Maps the caller-chosen `id` (e.g. a draft/upload id) to the running
    /// `Activity`, so `updateActivity`/`endActivity` can find it without
    /// the JS side ever seeing ActivityKit's own activity id.
    @available(iOS 16.1, *)
    private static var activitiesById = [String: Activity<UploadLiveActivityAttributes>]()

    private static let appGroupIdentifier = "group.com.brandthread.mobile.liveactivity"

    // MARK: - Actions

    private static func startActivity(_ options: StartActivityOptions) throws {
        guard #available(iOS 16.1, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // Person has Live Activities disabled in Settings, or the
            // device doesn't support them. Not an error from the JS side's
            // point of view — the in-app upload UI is the real source of
            // truth either way.
            return
        }

        let thumbnailFileName = writeThumbnailToAppGroup(uriString: options.thumbnailUri, id: options.id)

        let attributes = UploadLiveActivityAttributes(
            kind: options.kind,
            thumbnailFileName: thumbnailFileName
        )
        let initialState = UploadLiveActivityContentState(
            status: "uploading",
            progress: 0,
            retryRoute: nil
        )

        let activity = try Activity.request(
            attributes: attributes,
            content: .init(state: initialState, staleDate: nil)
        )
        activitiesById[options.id] = activity
    }

    private static func updateActivity(id: String, progress: Double) {
        guard #available(iOS 16.1, *), let activity = activitiesById[id] else { return }
        let clamped = max(0, min(1, progress))
        let state = UploadLiveActivityContentState(status: "uploading", progress: clamped, retryRoute: nil)
        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }

    private static func endActivity(id: String, result: EndActivityResult) {
        guard #available(iOS 16.1, *), let activity = activitiesById[id] else { return }
        let state = UploadLiveActivityContentState(
            status: result.status == "failed" ? "failed" : "success",
            progress: result.status == "failed" ? activity.content.state.progress : 1,
            retryRoute: result.retryRoute
        )
        Task {
            // A brief `.after` dismissal policy keeps the final state
            // (checkmark / retry) visible for a moment instead of the
            // activity vanishing the instant it ends, matching the
            // reference screenshots showing a lingering complete state.
            let dismissalDate = Date().addingTimeInterval(result.status == "failed" ? 60 * 60 : 8)
            await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(dismissalDate))
            activitiesById.removeValue(forKey: id)
        }
    }

    /// Copies the caller's thumbnail into the shared App Group container
    /// as a small JPEG so the widget extension process can read it (it
    /// has no access to the app's own sandbox). Returns the file name to
    /// store in `ActivityAttributes.thumbnailFileName`, or nil if there
    /// was no thumbnail or it couldn't be read/encoded — a missing
    /// thumbnail is never a reason to fail starting the activity.
    private static func writeThumbnailToAppGroup(uriString: String?, id: String) -> String? {
        guard let uriString, !uriString.isEmpty,
              let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: appGroupIdentifier
              )
        else { return nil }

        let sourceData: Data?
        if let url = URL(string: uriString), url.isFileURL {
            sourceData = try? Data(contentsOf: url)
        } else if let url = URL(string: uriString) {
            // Remote thumbnail (e.g. a draft reopened from a server-hosted
            // cover image). Synchronous fetch is acceptable here: this
            // runs once, off the JS thread, right before the Live
            // Activity starts, and callers already expect
            // `startUploadActivity` to be fire-and-forget.
            sourceData = try? Data(contentsOf: url)
        } else {
            sourceData = nil
        }

        guard let data = sourceData, let image = UIImage(data: data) else { return nil }

        // Downscale — the ring/card thumbnail never renders larger than
        // ~44pt, and the shared container has a small practical budget
        // shared with the rest of the app's App Group usage.
        let maxDimension: CGFloat = 200
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let targetSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
        guard let jpegData = resized.jpegData(compressionQuality: 0.7) else { return nil }

        let fileName = "thumb-\(id.replacingOccurrences(of: "/", with: "_")).jpg"
        let fileURL = containerURL.appendingPathComponent(fileName)
        do {
            try jpegData.write(to: fileURL, options: .atomic)
            return fileName
        } catch {
            return nil
        }
    }
}
