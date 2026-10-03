#!/usr/bin/env python3
"""Generate a loopback-only FreeSWITCH configuration from the real dialplan."""

from __future__ import annotations

import argparse
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path


PUBLIC_SOURCE = Path("infra/configs/freeswitch/dialplan/public/02_kamailio_outbound.xml")
DEFAULT_SOURCE = Path("infra/configs/freeswitch/dialplan/default/01_1toall_outbound.xml")
PROTECTED = {
    "X-Phone11-Outbound-ID": "phone11_outbound_id",
    "X-Phone11-Authenticated-User": "phone11_authenticated_user",
    "X-Phone11-Authenticated-Realm": "phone11_authenticated_realm",
}


def verify_source(repo: Path) -> None:
    public = ET.parse(repo / PUBLIC_SOURCE).getroot()
    extensions = public.findall("extension")
    if len(extensions) != 4:
        raise SystemExit(f"expected four public outbound routes, found {len(extensions)}")
    for extension in extensions:
        actions = extension.findall("./condition/action")
        applications = [(a.get("application"), a.get("data", "")) for a in actions]
        transfers = [data for application, data in applications if application == "transfer"]
        if len(transfers) != 1:
            raise SystemExit(f"{extension.get('name')} must retain exactly one transfer")
        transfer_index = applications.index(("transfer", transfers[0]))
        for header, variable in PROTECTED.items():
            set_action = ("set", f"{variable}=${{sip_h_{header}}}")
            unset_action = ("unset", f"sip_h_{header}")
            if set_action not in applications or unset_action not in applications:
                raise SystemExit(f"{extension.get('name')} lacks protected metadata handling")
            if applications.index(set_action) > transfer_index or applications.index(unset_action) > transfer_index:
                raise SystemExit(f"{extension.get('name')} handles protected metadata after transfer")

    default = ET.parse(repo / DEFAULT_SOURCE).getroot()
    bridges = [
        action.get("data", "")
        for action in default.findall("./extension/condition/action")
        if action.get("application") == "bridge"
    ]
    if len(bridges) != 4 or any(not value.startswith("sofia/gateway/1toall-outbound/") for value in bridges):
        raise SystemExit("expected four carrier bridges through the isolated fixture gateway")


FILES = {
    "freeswitch.xml": """<?xml version="1.0"?>
<document type="freeswitch/xml">
  <X-PRE-PROCESS cmd="include" data="vars.xml"/>
  <section name="configuration" description="Fixture configuration">
    <X-PRE-PROCESS cmd="include" data="autoload_configs/*.xml"/>
  </section>
  <section name="dialplan" description="Fixture dialplan">
    <X-PRE-PROCESS cmd="include" data="dialplan/*.xml"/>
  </section>
  <section name="directory" description="Empty fixture directory"/>
  <section name="phrases" description="Empty fixture phrases"/>
</document>
""",
    "vars.xml": """<include>
  <X-PRE-PROCESS cmd="set" data="domain=phone11.test"/>
  <X-PRE-PROCESS cmd="set" data="local_ip_v4=127.0.0.1"/>
  <X-PRE-PROCESS cmd="set" data="external_sip_ip=127.0.0.1"/>
  <X-PRE-PROCESS cmd="set" data="external_rtp_ip=127.0.0.1"/>
</include>
""",
    "autoload_configs/modules.conf.xml": """<configuration name="modules.conf" description="Fixture modules">
  <modules>
    <load module="mod_console"/>
    <load module="mod_commands"/>
    <load module="mod_dptools"/>
    <load module="mod_dialplan_xml"/>
    <load module="mod_event_socket"/>
    <load module="mod_sofia"/>
  </modules>
</configuration>
""",
    "autoload_configs/console.conf.xml": """<configuration name="console.conf" description="Fixture console">
  <mappings><map name="all" value="notice"/></mappings>
  <settings><param name="colorize" value="false"/></settings>
</configuration>
""",
    "autoload_configs/event_socket.conf.xml": """<configuration name="event_socket.conf" description="Fixture ESL">
  <settings>
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="18021"/>
    <param name="password" value="phone11-fixture-only"/>
  </settings>
</configuration>
""",
    "autoload_configs/sofia.conf.xml": """<configuration name="sofia.conf" description="Fixture Sofia">
  <global_settings><param name="log-level" value="0"/></global_settings>
  <profiles>
    <profile name="external">
      <gateways>
        <gateway name="1toall-outbound">
          <param name="proxy" value="127.0.0.1:16080"/>
          <param name="register" value="false"/>
          <param name="caller-id-in-from" value="true"/>
        </gateway>
      </gateways>
      <settings>
        <param name="sip-ip" value="127.0.0.1"/>
        <param name="rtp-ip" value="127.0.0.1"/>
        <param name="sip-port" value="15080"/>
        <param name="dialplan" value="XML"/>
        <param name="context" value="public"/>
        <param name="auth-calls" value="false"/>
        <param name="disable-register" value="true"/>
        <param name="inbound-codec-prefs" value="PCMA"/>
        <param name="outbound-codec-prefs" value="PCMA"/>
        <param name="inbound-late-negotiation" value="true"/>
        <param name="manage-presence" value="false"/>
      </settings>
    </profile>
  </profiles>
</configuration>
""",
    "autoload_configs/switch.conf.xml": """<configuration name="switch.conf" description="Fixture core">
  <settings>
    <param name="colorize-console" value="false"/>
    <param name="rtp-start-port" value="19000"/>
    <param name="rtp-end-port" value="19020"/>
  </settings>
</configuration>
""",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("baseline", "candidate"), required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = args.output.resolve()
    verify_source(repo)
    output.mkdir(parents=True, exist_ok=False)
    for relative, contents in FILES.items():
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(contents, encoding="utf-8")
    for source, context_name, relative, snapshot in (
        (repo / PUBLIC_SOURCE, "public", Path("dialplan/public.xml"), Path("source/public/02_kamailio_outbound.xml")),
        (repo / DEFAULT_SOURCE, "default", Path("dialplan/default.xml"), Path("source/default/01_1toall_outbound.xml")),
    ):
        source_text = source.read_text(encoding="utf-8")
        start = source_text.index("<include>") + len("<include>")
        end = source_text.rindex("</include>")
        source_extensions = source_text[start:end]
        if context_name == "public" and args.mode == "baseline":
            protected_lines = (
                "Keep authenticated recording identity on the A-leg",
                'application="set" data="phone11_outbound_id=',
                'application="set" data="phone11_authenticated_user=',
                'application="set" data="phone11_authenticated_realm=',
                'application="unset" data="sip_h_X-Phone11-Outbound-ID"',
                'application="unset" data="sip_h_X-Phone11-Authenticated-User"',
                'application="unset" data="sip_h_X-Phone11-Authenticated-Realm"',
            )
            original_lines = source_extensions.splitlines(keepends=True)
            source_extensions = "".join(
                line for line in original_lines if not any(marker in line for marker in protected_lines)
            )
            if len(original_lines) - len(source_extensions.splitlines(keepends=True)) != 28:
                raise SystemExit("baseline transform did not remove exactly seven metadata lines from all four routes")
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            f'<include>\n  <context name="{context_name}">{source_extensions}\n  </context>\n</include>\n',
            encoding="utf-8",
        )
        snapshot_target = output / snapshot
        snapshot_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, snapshot_target)


if __name__ == "__main__":
    main()
