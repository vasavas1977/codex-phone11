# =============================================================================
# CloudPhone11 — Flexisip Push Gateway
# =============================================================================
# Role: SIP push gateway — wakes mobile devices via FCM/APNs on incoming calls
# Base: Debian Bookworm (Belledonne Communications repo)
# Ports: 5065/udp+tcp (SIP from Kamailio), 8888/tcp (admin API)
# =============================================================================

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
LABEL description="Flexisip push gateway for CloudPhone11"

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg2 \
    ca-certificates \
    curl \
    wget \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Add Belledonne Communications repository for Flexisip
RUN curl -fsSL https://linphone.org/releases/flexisip/apt/flexisip.gpg \
    | gpg --dearmor -o /usr/share/keyrings/flexisip.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/flexisip.gpg] \
    https://linphone.org/releases/flexisip/apt $(lsb_release -sc) main" \
    > /etc/apt/sources.list.d/flexisip.list

# Install Flexisip
RUN apt-get update && apt-get install -y --no-install-recommends \
    flexisip \
    flexisip-pusher \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p \
    /etc/flexisip \
    /etc/flexisip/tls \
    /etc/flexisip/apns \
    /var/log/flexisip \
    /var/run/flexisip \
    /var/lib/flexisip

# Copy configuration

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Health check — verify Flexisip process is running
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD pgrep flexisip > /dev/null || exit 1

# SIP (receives from Kamailio)
EXPOSE 5065/udp
EXPOSE 5065/tcp
# Admin/monitoring API
EXPOSE 8888/tcp

ENTRYPOINT ["/entrypoint.sh"]
CMD ["flexisip", "--daemon=no", "--syslog=no", "--config=/etc/flexisip/flexisip.conf"]
