#!/bin/bash
set -e

# =============================================================================
# CloudPhone11 — Flexisip Entrypoint
# =============================================================================
# Substitutes environment variables into the config before starting Flexisip.
# Required env vars:
#   FLEXISIP_FCM_API_KEY    — Firebase Cloud Messaging server key
#   FLEXISIP_APNS_CERT_PATH — Path to APNs certificate (.pem)
#   FLEXISIP_SIP_DOMAIN     — SIP domain (e.g., sip.cloudphone11.io)
#   KAMAILIO_HOST           — Kamailio SIP proxy address
# =============================================================================

CONFIG_FILE="/etc/flexisip/flexisip.conf"

# Substitute environment variables in config
if [ -f "$CONFIG_FILE" ]; then
  sed -i "s|__FCM_API_KEY__|${FLEXISIP_FCM_API_KEY:-}|g" "$CONFIG_FILE"
  sed -i "s|__APNS_CERT_PATH__|${FLEXISIP_APNS_CERT_PATH:-/etc/flexisip/apns/apns-cert.pem}|g" "$CONFIG_FILE"
  sed -i "s|__SIP_DOMAIN__|${FLEXISIP_SIP_DOMAIN:-sip.cloudphone11.io}|g" "$CONFIG_FILE"
  sed -i "s|__KAMAILIO_HOST__|${KAMAILIO_HOST:-kamailio}|g" "$CONFIG_FILE"
fi

echo "[CloudPhone11] Starting Flexisip push gateway..."
echo "[CloudPhone11] SIP Domain: ${FLEXISIP_SIP_DOMAIN:-sip.cloudphone11.io}"
echo "[CloudPhone11] Kamailio:   ${KAMAILIO_HOST:-kamailio}"

exec "$@"
