#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Install pnpm first, then run this script again."
  exit 1
fi

echo "Node: $(node -v 2>/dev/null || echo missing)"
echo "pnpm: $(pnpm -v 2>/dev/null || echo missing)"
echo "pnpm registry: $(pnpm config get registry 2>/dev/null || echo unknown)"
echo "npm registry: $(npm config get registry 2>/dev/null || echo unknown)"

echo "Installing Phone11 native development build dependencies..."
pnpm add expo-dev-client@~6.0.20
pnpm add react-native-callkeep@4.3.16
pnpm add -D @config-plugins/react-native-callkeep@12.0.0

cat <<'EOF'

Phone11 development-client dependencies are installed.

Next one-time steps:
  1. Log in to Expo/EAS:
     npx eas-cli@latest login

  2. Link this repo to an EAS project:
     npx eas-cli@latest init

  3. Build installable dev clients:
     pnpm eas:dev:android
     pnpm eas:dev:ios

  4. Start Metro for the installed Phone11 dev client:
     pnpm dev:client

Notes:
  - iPhone device builds require a paid Apple Developer account.
  - Use a real device for PJSIP, CallKeep, audio route, and background-call testing.
EOF
