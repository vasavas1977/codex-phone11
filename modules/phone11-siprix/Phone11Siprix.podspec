require 'json'

# Validate both build-time environment and Expo-generated settings before enabling
# native PushKit. A bare environment toggle cannot bypass reviewed prebuild.
wake_gate = ENV.fetch('PHONE11_VOIP_WAKE_COMMISSIONED', '0')
wake_environment = ENV['PHONE11_APNS_ENVIRONMENT']
raise 'Phone11 wake gate must be 0 or 1' unless ['0', '1'].include?(wake_gate)
if wake_gate == '1'
  raise 'Phone11 wake pilot requires Siprix and production APNs' unless ENV['EXPO_PUBLIC_SIP_ENGINE'] == 'siprix' && wake_environment == 'production'
elsif wake_environment
  raise 'Phone11 disabled wake cannot configure APNs environment'
end
properties_path = File.join(Pod::Config.instance.installation_root, 'Podfile.properties.json')
properties = File.exist?(properties_path) ? JSON.parse(File.read(properties_path)) : {}
raise 'Phone11 native wake prebuild gate mismatch' unless properties.fetch('phone11.voipWakeCommissioned', '0') == wake_gate
raise 'Phone11 native wake APNs environment mismatch' unless properties['phone11.apnsEnvironment'] == wake_environment

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
  # Swift AppDelegate imports the bootstrap from this Objective-C static pod.
  s.module_name = 'Phone11Siprix'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES',
    'GCC_PREPROCESSOR_DEFINITIONS' => "$(inherited) PHONE11_VOIP_WAKE_COMMISSIONED=#{wake_gate}" }
  s.public_header_files = 'ios/Phone11Siprix.h', 'ios/Phone11VoipPush.h'
  s.requires_arc = true
  s.dependency 'React-Core'
  s.dependency 'RNCallKeep'
  # The parent packaging workstream stages the two EXACT pinned frameworks here.
  # Deliberately no download, sample code, CallKit provider, or PJSIP dependency.
  s.vendored_frameworks = 'vendor/siprix.xcframework', 'vendor/siprixMedia.xcframework'
  s.frameworks = 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'UIKit', 'PushKit'
  s.libraries = 'c++'
end
