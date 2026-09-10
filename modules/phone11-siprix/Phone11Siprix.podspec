require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'Phone11Siprix'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://siprix-voip.com'
  s.license = { :type => 'Proprietary', :text => 'Internal Phone11 bridge. Siprix frameworks remain subject to vendor trial/license terms.' }
  s.author = 'Phone11'
  s.source = { :git => 'https://github.com/vasavas1977/codex-phone11.git', :tag => s.version.to_s }
  s.platform = :ios, '15.1'
  s.source_files = 'ios/**/*.{h,m}'
  s.requires_arc = true
  s.dependency 'React-Core'
  s.dependency 'RNCallKeep'
  # The parent packaging workstream stages the two EXACT pinned frameworks here.
  # Deliberately no download, sample code, CallKit provider, or PJSIP dependency.
  s.vendored_frameworks = 'vendor/siprix.xcframework', 'vendor/siprixMedia.xcframework'
  s.frameworks = 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'UIKit', 'PushKit'
  s.libraries = 'c++'
end
