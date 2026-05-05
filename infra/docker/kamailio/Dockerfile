# =============================================================================
# CloudPhone11 — Kamailio SIP Proxy
# =============================================================================
# Role: SIP registrar, proxy, load balancer, NAT traversal, TLS termination
# Base: Debian Bookworm (official Kamailio repo)
# Ports: 5060/udp+tcp (SIP), 5061/tcp (SIP-TLS), 7443/tcp (WSS)
# =============================================================================

FROM debian:bookworm-slim

ARG KAMAILIO_VERSION=5.8
ARG DEBIAN_FRONTEND=noninteractive

LABEL maintainer="CloudPhone11 <ops@cloudphone11.io>"
LABEL description="Kamailio SIP proxy for CloudPhone11"
LABEL version="${KAMAILIO_VERSION}"

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg2 \
    ca-certificates \
    curl \
    wget \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# Add Kamailio official repository
RUN curl -fsSL https://deb.kamailio.org/kamailiodebkey.gpg \
    | gpg --dearmor -o /usr/share/keyrings/kamailio.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/kamailio.gpg] \
    http://deb.kamailio.org/kamailio${KAMAILIO_VERSION} $(lsb_release -sc) main" \
    > /etc/apt/sources.list.d/kamailio.list

# Install Kamailio with required modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    kamailio \
    kamailio-tls-modules \
    kamailio-websocket-modules \
    kamailio-postgres-modules \
    kamailio-presence-modules \
    kamailio-json-modules \
    kamailio-utils-modules \
    kamailio-xml-modules \
    kamailio-autheph-modules \
    kamailio-extra-modules \
    kamailio-outbound-modules \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p \
    /etc/kamailio/tls \
    /var/run/kamailio \
    /var/log/kamailio

# Copy configuration

# Set ownership
RUN chown -R kamailio:kamailio \
    /etc/kamailio \
    /var/run/kamailio \
    /var/log/kamailio

# Health check — verify Kamailio is responding to SIP OPTIONS
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD kamcmd core.psx | grep -q "running" || exit 1

# SIP UDP/TCP
EXPOSE 5060/udp
EXPOSE 5060/tcp
# SIP TLS
EXPOSE 5061/tcp
# WebSocket Secure (WSS) for WebRTC
EXPOSE 7443/tcp
# XMLRPC control
EXPOSE 5062/tcp

USER kamailio

ENTRYPOINT ["/usr/sbin/kamailio"]
CMD ["-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]
