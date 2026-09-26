# Supply immutable, independently reviewed image references for all three
# stages. The final image keeps the exact production FreeSWITCH base and adds
# only the local Node and flock executables required by the fixed Lua runner.
ARG FS_BASE_IMAGE
ARG NODE_BASE_IMAGE
ARG FLOCK_BASE_IMAGE

FROM ${NODE_BASE_IMAGE} AS node_runtime
RUN test -x /usr/local/bin/node

FROM ${FLOCK_BASE_IMAGE} AS flock_runtime
RUN test -x /usr/bin/flock

FROM ${FS_BASE_IMAGE}
ARG SOURCE_SHA
ARG FS_BASE_IMAGE
ARG NODE_BASE_IMAGE
ARG FLOCK_BASE_IMAGE
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=flock_runtime /usr/bin/flock /usr/bin/flock
RUN mkdir -p /tmp && chmod 1777 /tmp && \
    test -n "$SOURCE_SHA" && /usr/local/bin/node --version && \
    /usr/bin/flock -n /tmp/phone11-voicemail-build.lock true
LABEL org.opencontainers.image.revision="$SOURCE_SHA" \
      phone11.voicemail.fs-base="$FS_BASE_IMAGE" \
      phone11.voicemail.node-base="$NODE_BASE_IMAGE" \
      phone11.voicemail.flock-base="$FLOCK_BASE_IMAGE"
