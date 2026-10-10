FROM ghcr.io/kamailio/kamailio-ci@sha256:8eebac744905d360d04bd871ee46a3de0908aa30989649c00fd590914cb35fa0
USER root
RUN apk add --no-cache python3
ENTRYPOINT []
