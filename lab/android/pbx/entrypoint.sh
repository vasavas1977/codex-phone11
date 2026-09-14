#!/bin/sh
set -eu
# Only this container's namespace is modified. The Docker host firewall is untouched.
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p udp --dport 15060 -j ACCEPT
iptables -A INPUT -p tcp --dport 15060 -j ACCEPT
iptables -A INPUT -p udp --dport 16000:16019 -j ACCEPT
# Persist nonsecret rule evidence before removing all Asterisk capabilities.
iptables -S > /tmp/phone11-firewall.txt
exec setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /usr/sbin/asterisk -f -g -C /etc/asterisk/asterisk.conf
