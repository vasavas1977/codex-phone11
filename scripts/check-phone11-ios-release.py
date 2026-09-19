#!/usr/bin/env python3
"""Read-only signed-app gate; never prints credentials or signing identities."""
import argparse
import datetime
import hashlib
import json
import plistlib
import subprocess
import sys
from pathlib import Path

BASE_HASH = 'e009bb13feec8b856eba8815917026a7e7a9976ffc1992afe3eae73d9b3fea66'
BUNDLE = 'space.manus.phone11ai.t20260425073427'
BASE_RUNTIME = '1.0.0-siprix-daily-pilot-1'
RUNTIME = '1.0.0-siprix-daily-pilot-chat-media-2'


def command(*args):
    result = subprocess.run(args, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Verification command failed')
    return result.stdout


def plist(path):
    return plistlib.loads(path.read_bytes())


def entitlements(app):
    return plistlib.loads(command('codesign', '-d', '--entitlements', ':-', str(app)))


def profile(app):
    return plistlib.loads(command('security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path, help='Unpacked signed Phone11 .app directory')
    parser.add_argument('--baseline-app', required=True, type=Path, help='Unpacked known-good Build 49 app')
    parser.add_argument('--baseline-ipa', required=True, type=Path, help='Original signed Build 49 IPA, verified against its pinned SHA256')
    parser.add_argument('--allow-baseline', action='store_true', help='Allow build 49 only for testing this gate')
    args = parser.parse_args()
    app = args.app.resolve()
    baseline_app = args.baseline_app.resolve()
    baseline_ipa = args.baseline_ipa.resolve()
    results = []

    def check(name, predicate):
        try:
            passed = bool(predicate())
        except Exception:
            passed = False
        results.append({'check': name, 'passed': passed})

    try:
        base = plist(baseline_app / 'Info.plist')
        info = plist(app / 'Info.plist')
        base_expo = plist(baseline_app / 'Expo.plist')
        expo = plist(app / 'Expo.plist')
        base_ent = entitlements(baseline_app)
        ent = entitlements(app)
    except Exception:
        print(json.dumps({'passed': False, 'checks': [{'check': 'Readable signed app and baseline metadata', 'passed': False}]}))
        return 1

    check('Known Build 49 IPA hash', lambda: hashlib.sha256(baseline_ipa.read_bytes()).hexdigest() == BASE_HASH)
    check('Expected bundle identity', lambda: info.get('CFBundleIdentifier') == base.get('CFBundleIdentifier') == BUNDLE)
    check('Expected application version', lambda: info.get('CFBundleShortVersionString') == base.get('CFBundleShortVersionString') == '1.0.0')
    check('Build increases from 49', lambda: int(base['CFBundleVersion']) == 49 and (int(info['CFBundleVersion']) > 49 or (args.allow_baseline and int(info['CFBundleVersion']) == 49)))
    check('Siprix daily runtime retained', lambda: base_expo.get('EXUpdatesRuntimeVersion') == BASE_RUNTIME and expo.get('EXUpdatesRuntimeVersion') == (BASE_RUNTIME if args.allow_baseline else RUNTIME))
    check('Over-the-air updates disabled', lambda: expo.get('EXUpdatesEnabled') is False and base_expo.get('EXUpdatesEnabled') is False)
    for key in ('Phone11WakeCommissioned', 'Phone11ChatNotificationsCommissioned'):
        check(key + ' enabled', lambda key=key: str(info.get(key)) == str(base.get(key)) == '1')
    # Chat media plugins must not remove shared calling permissions. Older
    # baseline validation still requires microphone; the new media
    # candidate also requires camera and Photo Library access.
    permissions = ['NSMicrophoneUsageDescription']
    if not args.allow_baseline:
        permissions.extend(['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription'])
    for key in permissions:
        check(key + ' present', lambda key=key: isinstance(info.get(key), str) and bool(info[key].strip()))
    check('Calling background modes retained', lambda: {'audio', 'voip', 'remote-notification'} <= set(info.get('UIBackgroundModes', [])))
    check('Wake API origin retained', lambda: info.get('Phone11WakeOrigin') == base.get('Phone11WakeOrigin') == 'https://api.phone11.ai')
    check('Signed production APNs', lambda: ent.get('aps-environment') == base_ent.get('aps-environment') == 'production')
    check('Signed team retained', lambda: bool(base_ent.get('com.apple.developer.team-identifier')) and ent.get('com.apple.developer.team-identifier') == base_ent.get('com.apple.developer.team-identifier'))
    check('Signed application identity retained', lambda: ent.get('application-identifier') == base_ent.get('application-identifier') == base_ent.get('com.apple.developer.team-identifier', '') + '.' + BUNDLE)
    check('Signed debugging disabled', lambda: ent.get('get-task-allow') is False and base_ent.get('get-task-allow') is False)
    check('Deep strict code signature', lambda: command('codesign', '--verify', '--deep', '--strict', str(app)) is not None)
    check('Embedded JavaScript bundle', lambda: (app / 'main.jsbundle').is_file() and (app / 'main.jsbundle').stat().st_size > 0)
    for framework in ('siprix', 'siprixMedia'):
        check(framework + ' framework present', lambda framework=framework: (app / 'Frameworks' / (framework + '.framework') / framework).is_file())

    def check_provisioning():
        old = profile(baseline_app)
        current = profile(app)
        expiration = current.get('ExpirationDate')
        if not isinstance(expiration, datetime.datetime):
            return False
        expiration = expiration.replace(tzinfo=datetime.timezone.utc) if expiration.tzinfo is None else expiration
        current_ent = current.get('Entitlements', {})
        return (expiration > datetime.datetime.now(datetime.timezone.utc)
                and set(old.get('ProvisionedDevices', [])) <= set(current.get('ProvisionedDevices', []))
                and bool(old.get('ProvisionedDevices'))
                and current_ent.get('application-identifier') == ent.get('application-identifier')
                and current_ent.get('com.apple.developer.team-identifier') == ent.get('com.apple.developer.team-identifier')
                and current_ent.get('aps-environment') == 'production'
                and current_ent.get('get-task-allow') is False)

    check('Valid provisioning retains baseline handset coverage and signing identity', check_provisioning)
    passed = all(item['passed'] for item in results)
    print(json.dumps({'passed': passed, 'checks': results}, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
