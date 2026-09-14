FROM alpine:3.22.1@sha256:4562b419adf48c5f3c763995d6014c123b3ce1d2e0ef2613b189779caa787192
RUN apk add --no-cache asterisk=20.11.1-r6 iptables=1.8.11-r1 setpriv=2.41.6-r1 && mkdir -p /var/run/asterisk /var/spool/asterisk/outgoing /var/log/asterisk /var/lib/asterisk
COPY entrypoint.sh /usr/local/bin/phone11-pbx
RUN chmod 755 /usr/local/bin/phone11-pbx
ENTRYPOINT ["/usr/local/bin/phone11-pbx"]
