#!/usr/bin/env python3
"""Prepare a directory-only XML-curl candidate. Never install or reload it.

The caller supplies the reviewed live bytes and the existing integration secret
in memory. The result contains credentials and must only be written root-private.
"""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from xml.sax.saxutils import quoteattr

URL = "http://127.0.0.1:3013/api/freeswitch/directory"
USERNAME = "phone11-freeswitch"


class Refused(ValueError):
    pass


def prepare(source: bytes, expected_sha256: str, secret: str) -> bytes:
    if hashlib.sha256(source).hexdigest() != expected_sha256:
        raise Refused("source_changed")
    # FS expands $${...} before parsing XML. Reject expansion syntax rather
    # than allowing a credential to turn into another configuration value.
    if (not isinstance(secret, str) or not 16 <= len(secret) <= 4096 or
            any(ord(c) < 33 or ord(c) > 126 for c in secret) or "$" in secret):
        raise Refused("credential_format")
    try:
        text = source.decode("utf-8")
        root = ET.fromstring(source)
    except (UnicodeError, ET.ParseError) as error:
        raise Refused("source_xml") from error
    if (root.tag != "configuration" or root.get("name") != "xml_curl.conf" or
            "<!DOCTYPE" in text or "<!ENTITY" in text or "X-PRE-PROCESS" in text):
        raise Refused("source_shape")
    bindings = root.findall("./bindings/binding")
    if len(bindings) != 1 or bindings[0].get("name") != "directory":
        raise Refused("binding_scope")
    params = bindings[0].findall("param")
    gateways = [p for p in params if p.get("name") == "gateway-url"]
    if (len(gateways) != 1 or gateways[0].get("bindings") != "directory" or
            any(p.get("name") in {"gateway-credentials", "auth-scheme"} for p in params)):
        raise Refused("gateway_shape")
    # Preserve disabled dialplan comments and every unrelated byte. Restrict
    # replacement to the sole active binding, excluding commented markup.
    comments = list(re.finditer(r"<!--.*?-->", text, re.S))
    def active(match: re.Match) -> bool:
        return not any(c.start() <= match.start() < c.end() for c in comments)
    matches = [m for m in re.finditer(r'<param\s+name="gateway-url"\s+value="[^"<>]*"\s+bindings="directory"\s*/>', text) if active(m)]
    if len(matches) != 1:
        raise Refused("gateway_serialization")
    match = matches[0]
    indent = text[text.rfind("\n", 0, match.start()) + 1:match.start()]
    if indent.strip():
        raise Refused("gateway_line")
    replacement = (
        f'<param name="gateway-url" value="{URL}" bindings="directory"/>\n{indent}'
        f'<param name="gateway-credentials" value={quoteattr(USERNAME + ":" + secret)}/>\n{indent}'
        '<param name="auth-scheme" value="=basic"/>'
    )
    result = (text[:match.start()] + replacement + text[match.end():]).encode()
    new_root = ET.fromstring(result)
    new_binding = new_root.find("./bindings/binding")
    values = {p.get("name"): p.get("value") for p in new_binding.findall("param")}
    if (values.get("gateway-url") != URL or
            values.get("gateway-credentials") != USERNAME + ":" + secret or
            values.get("auth-scheme") != "=basic"):
        raise Refused("candidate_roundtrip")
    # The XML tree must otherwise be identical, including all POST allowlists.
    for p in list(new_binding):
        if p.get("name") in {"gateway-credentials", "auth-scheme"}:
            new_binding.remove(p)
    new_binding.find("param[@name='gateway-url']").set("value", gateways[0].get("value"))
    if ET.tostring(new_root) != ET.tostring(root):
        raise Refused("unrelated_change")
    return result
