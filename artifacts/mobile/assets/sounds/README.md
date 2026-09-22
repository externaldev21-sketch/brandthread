# Brandthread notification sound

Add the user-provided custom order sound at exactly:

`artifacts/mobile/assets/sounds/order_received.wav`

The supported drop-in filename is `order_received.wav`. The Expo
`expo-notifications` plugin registers this asset for iOS and Android EAS
builds, and seller new-order pushes reference the same filename plus the
`orders` Android notification channel.

Do not rename the file or place it under `assets/images`. Android resource
filenames may only use lowercase letters, numbers, and underscores. Message
notifications intentionally continue to use the platform default sound.