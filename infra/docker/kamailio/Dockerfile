# =============================================================================
# Phone11 Kamailio SIP proxy
# =============================================================================
# Pin the final vendor-maintained 5.8 release. This exact image contains every
# module loaded by infra/configs/kamailio/kamailio.cfg and has been parser-tested
# with that file. The upstream manifest is amd64-only.
# =============================================================================

ARG KAMAILIO_PLATFORM=linux/amd64
FROM --platform=${KAMAILIO_PLATFORM} ghcr.io/kamailio/kamailio:5.8.8-bookworm@sha256:c34cad7d31b72a715d5cc37c7fd63fde5b555a41bcae4a362b2ce6d902c0395b

LABEL maintainer="Phone11 <ops@phone11.ai>"
LABEL description="Phone11 Kamailio SIP proxy"
LABEL version="5.8.8"

USER root

RUN mkdir -p /etc/kamailio/tls /run/kamailio /var/run/kamailio /var/log/kamailio \
    && chown -R kamailio:kamailio /run/kamailio /var/run/kamailio /var/log/kamailio

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD kamcmd core.psx | grep -q "running" || exit 1

EXPOSE 5060/udp
EXPOSE 5060/tcp
EXPOSE 5061/tcp
EXPOSE 7443/tcp
EXPOSE 5062/tcp

USER kamailio

ENTRYPOINT ["/usr/sbin/kamailio"]
CMD ["-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]
