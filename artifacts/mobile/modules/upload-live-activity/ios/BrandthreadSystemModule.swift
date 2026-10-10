import ExpoModulesCore
import UIKit
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// iOS system surfaces for Brandthread, registered as `BrandthreadSystem`
/// (see `lib/nativeSystem.ts`, which reaches it through
/// `requireOptionalNativeModule('BrandthreadSystem')`, so Expo Go / web /
/// Android simply get `null` and every feature quietly stays off):
///  - Live Activities: buyer order tracking, seller live stream
///  - Home Screen widget snapshots (App Group UserDefaults + reload)
///  - Home Screen quick actions (long-press the app icon)
public class BrandthreadSystemModule: Module {
    static let appGroup = "group.com.brandthread.mobile.liveactivity"

    public func definition() -> ModuleDefinition {
        Name("BrandthreadSystem")

        Events("onQuickAction", "onLiveActivityPushToken")

        OnStartObserving {
            QuickActionCenter.shared.listener = { [weak self] type in
                self?.sendEvent("onQuickAction", ["type": type])
            }
            LiveActivityTokens.shared.listener = { [weak self] kind, targetId, token in
                self?.sendEvent("onLiveActivityPushToken", ["kind": kind, "targetId": targetId, "token": token])
            }
        }

        OnStopObserving {
            QuickActionCenter.shared.listener = nil
            LiveActivityTokens.shared.listener = nil
        }

        Function("areLiveActivitiesEnabled") { () -> Bool in
            if #available(iOS 16.2, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        // MARK: Order tracking

        AsyncFunction("startOrderActivity") { (options: OrderActivityOptions) in
            guard #available(iOS 16.2, *) else { return }
            try OrderActivities.start(options)
        }

        AsyncFunction("updateOrderActivity") { (orderId: String, state: OrderStateRecord) in
            guard #available(iOS 16.2, *) else { return }
            await OrderActivities.update(orderId: orderId, state: state, end: false)
        }

        AsyncFunction("endOrderActivity") { (orderId: String, state: OrderStateRecord) in
            guard #available(iOS 16.2, *) else { return }
            await OrderActivities.update(orderId: orderId, state: state, end: true)
        }

        Function("activeOrderActivityIds") { () -> [String] in
            guard #available(iOS 16.2, *) else { return [] }
            return Activity<OrderTrackingAttributes>.activities.map { $0.attributes.orderId }
        }

        // MARK: Live stream

        AsyncFunction("startLiveStreamActivity") { (streamId: String, title: String, state: LiveStateRecord) in
            guard #available(iOS 16.2, *) else { return }
            try LiveStreamActivities.start(streamId: streamId, title: title, state: state)
        }

        AsyncFunction("updateLiveStreamActivity") { (streamId: String, state: LiveStateRecord) in
            guard #available(iOS 16.2, *) else { return }
            await LiveStreamActivities.update(streamId: streamId, state: state, end: false)
        }

        AsyncFunction("endLiveStreamActivity") { (streamId: String, state: LiveStateRecord) in
            guard #available(iOS 16.2, *) else { return }
            await LiveStreamActivities.update(streamId: streamId, state: state, end: true)
        }

        // MARK: Widgets

        Function("setWidgetSnapshot") { (key: String, json: String, widgetKind: String) in
            UserDefaults(suiteName: Self.appGroup)?.set(json, forKey: key)
            WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        }

        Function("clearWidgetSnapshot") { (key: String, widgetKind: String) in
            UserDefaults(suiteName: Self.appGroup)?.removeObject(forKey: key)
            WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        }

        // MARK: Quick actions

        Function("setQuickActions") { (items: [QuickActionRecord]) in
            let shortcuts = items.map { item in
                UIApplicationShortcutItem(
                    type: item.type,
                    localizedTitle: item.title,
                    localizedSubtitle: nil,
                    icon: UIApplicationShortcutIcon(systemImageName: item.symbol),
                    userInfo: nil
                )
            }
            DispatchQueue.main.async {
                UIApplication.shared.shortcutItems = shortcuts
            }
        }

        Function("takeInitialQuickAction") { () -> String? in
            QuickActionCenter.shared.takePending()
        }
    }

    // MARK: - Records

    struct OrderActivityOptions: Record {
        @Field var orderId: String = ""
        @Field var orderNumber: String = ""
        @Field var sellerName: String = ""
        @Field var thumbnailUri: String?
        @Field var stage: String = "shipped"
        @Field var statusText: String = ""
        @Field var etaEpoch: Double?
    }

    struct OrderStateRecord: Record {
        @Field var stage: String = "shipped"
        @Field var statusText: String = ""
        @Field var etaEpoch: Double?
    }

    struct LiveStateRecord: Record {
        @Field var viewers: Int = 0
        @Field var salesCents: Int = 0
        @Field var ordersCount: Int = 0
        @Field var isLive: Bool = true
    }

    struct QuickActionRecord: Record {
        @Field var type: String = ""
        @Field var title: String = ""
        @Field var symbol: String = "circle"
    }
}

// MARK: - Push tokens

/// Forwards each Live Activity's APNs push token to JS, which registers it
/// with the API (`POST /live-activities/tokens`) so the server can update
/// the activity while the app is closed.
final class LiveActivityTokens {
    static let shared = LiveActivityTokens()
    var listener: ((String, String, String) -> Void)?

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    func observe<A: ActivityAttributes>(_ activity: Activity<A>, kind: String, targetId: String) {
        Task {
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                DispatchQueue.main.async { self.listener?(kind, targetId, token) }
            }
        }
    }
    #endif
}

#if canImport(ActivityKit)
/// Requests with a push token when the app has the push entitlement, and
/// falls back to a local-only activity when it doesn't.
@available(iOS 16.2, *)
private func requestActivity<A: ActivityAttributes>(_ attributes: A, state: A.ContentState) throws -> (Activity<A>, Bool) {
    do {
        let activity = try Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil), pushType: .token)
        return (activity, true)
    } catch {
        let activity = try Activity.request(attributes: attributes, content: .init(state: state, staleDate: nil), pushType: nil)
        return (activity, false)
    }
}

@available(iOS 16.2, *)
enum OrderActivities {
    static func find(_ orderId: String) -> Activity<OrderTrackingAttributes>? {
        Activity<OrderTrackingAttributes>.activities.first { $0.attributes.orderId == orderId }
    }

    static func start(_ o: BrandthreadSystemModule.OrderActivityOptions) throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = OrderTrackingContentState(stage: o.stage, statusText: o.statusText, etaEpoch: o.etaEpoch)
        if let existing = find(o.orderId) {
            Task { await existing.update(.init(state: state, staleDate: nil)) }
            LiveActivityTokens.shared.observe(existing, kind: "order", targetId: o.orderId)
            return
        }
        let attributes = OrderTrackingAttributes(
            orderId: o.orderId,
            orderNumber: o.orderNumber,
            sellerName: o.sellerName,
            thumbnailFileName: AppGroupThumbnails.write(uriString: o.thumbnailUri, id: "order-\(o.orderId)")
        )
        let (activity, pushable) = try requestActivity(attributes, state: state)
        if pushable { LiveActivityTokens.shared.observe(activity, kind: "order", targetId: o.orderId) }
    }

    static func update(orderId: String, state s: BrandthreadSystemModule.OrderStateRecord, end: Bool) async {
        guard let activity = find(orderId) else { return }
        let state = OrderTrackingContentState(stage: s.stage, statusText: s.statusText, etaEpoch: s.etaEpoch)
        if end {
            // Delivered: keep the final state on the Lock Screen for a while,
            // like Uber Eats / Amazon, then let it go.
            await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(4 * 60 * 60)))
        } else {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }
}

@available(iOS 16.2, *)
enum LiveStreamActivities {
    static func find(_ streamId: String) -> Activity<LiveStreamAttributes>? {
        Activity<LiveStreamAttributes>.activities.first { $0.attributes.streamId == streamId }
    }

    static func start(streamId: String, title: String, state s: BrandthreadSystemModule.LiveStateRecord) throws {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, find(streamId) == nil else { return }
        let state = LiveStreamContentState(viewers: s.viewers, salesCents: s.salesCents, ordersCount: s.ordersCount, isLive: true)
        let (activity, pushable) = try requestActivity(LiveStreamAttributes(streamId: streamId, title: title), state: state)
        if pushable { LiveActivityTokens.shared.observe(activity, kind: "live", targetId: streamId) }
    }

    static func update(streamId: String, state s: BrandthreadSystemModule.LiveStateRecord, end: Bool) async {
        guard let activity = find(streamId) else { return }
        let state = LiveStreamContentState(viewers: s.viewers, salesCents: s.salesCents, ordersCount: s.ordersCount, isLive: !end && s.isLive)
        if end {
            await activity.end(.init(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
        } else {
            await activity.update(.init(state: state, staleDate: nil))
        }
    }
}
#endif

/// Writes a small JPEG of a local or remote image into the App Group
/// container so the widget extension (which can't read the app sandbox)
/// can show it. A missing thumbnail never blocks an activity.
enum AppGroupThumbnails {
    static func write(uriString: String?, id: String) -> String? {
        guard let uriString, !uriString.isEmpty, let url = URL(string: uriString),
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: BrandthreadSystemModule.appGroup),
              let data = try? Data(contentsOf: url),
              let image = UIImage(data: data)
        else { return nil }
        let maxDimension: CGFloat = 200
        let scale = min(1, maxDimension / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.7) else { return nil }
        let fileName = "thumb-\(id.replacingOccurrences(of: "/", with: "_")).jpg"
        do {
            try jpeg.write(to: container.appendingPathComponent(fileName), options: .atomic)
            return fileName
        } catch {
            return nil
        }
    }
}
