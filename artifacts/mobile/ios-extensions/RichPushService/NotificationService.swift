import UserNotifications

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

    guard let content = content, let imageURL = Self.imageURL(in: request.content.userInfo) else {
      contentHandler(request.content)
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
        let attachment = try UNNotificationAttachment(identifier: "image", url: destination, options: nil)
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
