import UserNotifications
import ImageIO
import WidgetKit

/// Notification Service Extension: downloads the product image a push names
/// and attaches it, so iOS shows it in the banner and expanded notification
/// (Android does this natively from Expo's `richContent.image`).
///
/// The server (api-server lib/push.ts buildExpoPushMessages) sends the image
/// as Expo `richContent: { image }` with `mutableContent: true`, and mirrors
/// short URLs into the push data as `imageUrl`. Expo delivers that data under
/// the `body` key of the APNs payload, so every known location is checked.
/// Only https URLs are used. Any failure delivers the original notification.
final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?
  private var downloadTask: URLSessionDownloadTask?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content = (request.content.mutableCopy() as? UNMutableNotificationContent)
    bestAttemptContent = content

    // Seller sale ping (new_order_received): stack consecutive sales in one
    // group on the Lock Screen and Apple Watch, and move the seller widgets
    // even while the app is closed.
    let data = Self.pushData(request.content.userInfo)
    let isNewOrder = (data["type"] as? String) == "new_order_received"
    if isNewOrder {
      content?.threadIdentifier = "new-orders"
      SellerWidgetDelta.apply(data)
    }

    guard let content = content, let imageURL = Self.imageURL(in: request.content.userInfo) else {
      contentHandler(content ?? request.content)
      return
    }

    downloadTask = URLSession.shared.downloadTask(with: imageURL) { [weak self] location, response, _ in
      guard let self = self else { return }
      defer { self.finish() }
      guard
        let location = location,
        let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
      else { return }
      let ext = Self.fileExtension(for: response?.mimeType, url: imageURL)
      let destination = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString)
        .appendingPathExtension(ext)
      do {
        try FileManager.default.moveItem(at: location, to: destination)
        // Apple Watch shows the attachment best as a small JPEG (WebP/HEIC
        // product photos may not render there); fall back to the original.
        let file = isNewOrder ? (Self.jpegThumbnail(of: destination) ?? destination) : destination
        let attachment = try UNNotificationAttachment(identifier: "image", url: file, options: nil)
        content.attachments = [attachment]
      } catch {
        // Deliver without the image.
      }
    }
    downloadTask?.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    // iOS is about to give up on us: deliver what we have, without the image.
    downloadTask?.cancel()
    finish()
  }

  private func finish() {
    guard let handler = contentHandler, let content = bestAttemptContent else { return }
    contentHandler = nil
    handler(content)
  }

  static func imageURL(in userInfo: [AnyHashable: Any]) -> URL? {
    var candidates: [Any?] = []
    if let rich = userInfo["richContent"] as? [String: Any] { candidates.append(rich["image"]) }
    if let body = userInfo["body"] as? [String: Any] {
      if let rich = body["richContent"] as? [String: Any] { candidates.append(rich["image"]) }
      if let rich = body["_richContent"] as? [String: Any] { candidates.append(rich["image"]) }
      candidates.append(body["imageUrl"])
    }
    candidates.append(userInfo["imageUrl"])
    for case let value as String in candidates.compactMap({ $0 }) {
      if let url = URL(string: value), url.scheme?.lowercased() == "https", url.host != nil {
        return url
      }
    }
    return nil
  }

  /// Expo nests the push's `data` under `body`; merge both levels.
  static func pushData(_ userInfo: [AnyHashable: Any]) -> [String: Any] {
    var merged: [String: Any] = [:]
    for (key, value) in userInfo { if let key = key as? String { merged[key] = value } }
    if let body = userInfo["body"] as? [String: Any] { merged.merge(body) { _, inner in inner } }
    return merged
  }

  /// A JPEG at most 400 px on the long side, or nil when ImageIO can't read it.
  static func jpegThumbnail(of url: URL, maxPixels: Int = 400) -> URL? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let output = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("jpg")
    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.jpeg" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? output : nil
  }

  static func fileExtension(for mimeType: String?, url: URL) -> String {
    switch mimeType?.lowercased() {
    case "image/png": return "png"
    case "image/gif": return "gif"
    case "image/heic": return "heic"
    case "image/webp": return "webp"
    case "image/jpeg", "image/jpg": return "jpg"
    default:
      let ext = url.pathExtension.lowercased()
      return ["png", "gif", "jpg", "jpeg", "heic", "webp"].contains(ext) ? ext : "jpg"
    }
  }
}

/// Adds a new order to the seller widgets' snapshot (the same App Group
/// UserDefaults key the app writes, see lib/nativeSystem.ts) and reloads
/// them. The push carries `widgetDelta` only while the nativeSurfaces flag is
/// on. With no snapshot (signed out, buyer, flag off) nothing is written; the
/// app corrects the numbers from the server the next time it opens.
enum SellerWidgetDelta {
  static let suite = "group.com.brandthread.mobile.liveactivity"
  static let key = "sellerToday"

  static func apply(_ data: [String: Any], now: Date = Date()) {
    guard
      let delta = data["widgetDelta"] as? [String: Any],
      let defaults = UserDefaults(suiteName: suite),
      let json = defaults.string(forKey: key),
      let stored = json.data(using: .utf8),
      var snapshot = (try? JSONSerialization.jsonObject(with: stored)) as? [String: Any]
    else { return }

    func int(_ value: Any?) -> Int { (value as? NSNumber)?.intValue ?? 0 }
    let updatedAt = (snapshot["updatedAt"] as? NSNumber)?.doubleValue ?? 0
    // Sales and orders are today's; a snapshot from an earlier day starts over.
    let sameDay = Calendar.current.isDate(Date(timeIntervalSince1970: updatedAt), inSameDayAs: now)
    snapshot["salesCents"] = (sameDay ? int(snapshot["salesCents"]) : 0) + max(0, int(delta["salesCents"]))
    snapshot["ordersCount"] = (sameDay ? int(snapshot["ordersCount"]) : 0) + max(0, int(delta["orders"]))
    snapshot["toShipCount"] = int(snapshot["toShipCount"]) + max(0, int(delta["toShip"]))
    snapshot["updatedAt"] = now.timeIntervalSince1970

    guard
      let encoded = try? JSONSerialization.data(withJSONObject: snapshot),
      let string = String(data: encoded, encoding: .utf8)
    else { return }
    defaults.set(string, forKey: key)
    WidgetCenter.shared.reloadAllTimelines()
  }
}
