ARG KAMAILIO_IMAGE=ghcr.io/kamailio/kamailio-ci@sha256:8eebac744905d360d04bd871ee46a3de0908aa30989649c00fd590914cb35fa0
FROM ${KAMAILIO_IMAGE}
USER root
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache python3; \
    else \
      apt-get update && \
      apt-get install -y --no-install-recommends python3 && \
      rm -rf /var/lib/apt/lists/*; \
    fi
ENTRYPOINT []
WORKDIR /work
