require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'UploadLiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { ios: '16.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.{h,m,mm,swift}'

  # UploadLiveActivityAttributes.swift is shared with the widget extension
  # target (see plugins/with-upload-live-activity.js, which adds
  # ios-extensions/UploadLiveActivity/UploadLiveActivityAttributes.swift to
  # BOTH targets' Compile Sources). It is intentionally not duplicated
  # here — this podspec only builds this module's own ios/ sources, which
  # reference that type by name once the app target compiles it in.
end
