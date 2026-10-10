import WidgetKit
import SwiftUI

/// Entry point for Brandthread's widget extension (the target is still named
/// "UploadLiveActivity" so its existing bundle id and provisioning keep
/// working). It hosts every Live Activity and Home Screen widget.
@main
struct UploadLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        SellerTodayWidget()
        BuyerCashWidget()
        if #available(iOS 16.1, *) {
            UploadLiveActivityWidget()
            OrderTrackingWidget()
            LiveStreamWidget()
        }
    }
}
