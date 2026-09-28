import WidgetKit
import SwiftUI

/// Entry point for the widget extension. A widget extension can host
/// several widgets/Live Activities; Brandthread only ships this one today.
@main
struct UploadLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            UploadLiveActivityWidget()
        }
    }
}
