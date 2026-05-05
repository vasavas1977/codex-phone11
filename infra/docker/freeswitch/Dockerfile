FROM debian:bookworm-slim AS base
ARG FREESWITCH_VERSION=1.10
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg2 ca-certificates curl wget lsb-release && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg \
    | gpg --dearmor -o /usr/share/keyrings/signalwire-freeswitch-repo.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/signalwire-freeswitch-repo.gpg] \
    https://freeswitch.signalwire.com/repo/deb/debian-release/ $(lsb_release -sc) main" \
    > /etc/apt/sources.list.d/freeswitch.list
RUN apt-get update && apt-get install -y --no-install-recommends \
    freeswitch freeswitch-mod-commands freeswitch-mod-console freeswitch-mod-dptools \
    freeswitch-mod-dialplan-xml freeswitch-mod-event-socket freeswitch-mod-sofia \
    freeswitch-mod-loopback freeswitch-mod-conference freeswitch-mod-voicemail \
    freeswitch-mod-say-en freeswitch-mod-tone-stream freeswitch-mod-local-stream \
    freeswitch-mod-native-file freeswitch-mod-sndfile freeswitch-mod-shout \
    freeswitch-mod-png freeswitch-mod-spandsp freeswitch-mod-opus \
    freeswitch-mod-g723-1 freeswitch-mod-g729 freeswitch-mod-amr freeswitch-mod-b64 \
    freeswitch-mod-flite freeswitch-mod-pgsql freeswitch-mod-curl \
    freeswitch-mod-xml-curl freeswitch-mod-http-cache freeswitch-mod-httapi \
    freeswitch-mod-hash freeswitch-mod-db freeswitch-mod-cdr-pg-csv \
    freeswitch-mod-callcenter freeswitch-mod-fifo freeswitch-mod-valet-parking \
    freeswitch-sounds-en-us-callie-8000 freeswitch-sounds-en-us-callie-16000 \
    freeswitch-music-default && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /var/lib/freeswitch/recordings /var/lib/freeswitch/voicemail \
    /etc/freeswitch/tls /var/log/freeswitch /var/run/freeswitch
EXPOSE 5060/udp 5060/tcp 5061/tcp 8021/tcp
ENTRYPOINT ["/usr/bin/freeswitch"]
CMD ["-nonat", "-nf", "-c"]
