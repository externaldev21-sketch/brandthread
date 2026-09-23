// App entry. Import order matters: crash reporting and the over-the-air update
// check start before Expo Router evaluates any screen, so start-up crashes are
// reported too. Both are no-ops when they are not configured.
import './lib/bootstrap';
import 'expo-router/entry';
