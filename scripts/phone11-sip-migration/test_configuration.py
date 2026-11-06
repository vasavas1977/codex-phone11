from dataclasses import asdict, replace
import json
import unittest

from configuration import (
    FsSample, KamBinding, KamSample, KAM_MODULES, PgTarget, Selection,
    classify_freeswitch, classify_kamailio,
)
from evidence import Held

HELD = Held("synthetic-private-config-token", True, 1_000)
LATER = replace(HELD, sampled_ns=2_000)
TARGET = PgTarget("pg.fixture.invalid", 5432, "fixture", "old_actor", "new_actor", ("192.0.2.9",))
KAM_TARGETS = dict.fromkeys(KAM_MODULES, TARGET)
SECRET = "SyntheticSecretCanary"
RESTRICTED = f"postgres://new_actor:{SECRET}@pg.fixture.invalid:5432/fixture"
LEGACY = RESTRICTED.replace("new_actor", "old_actor")
OTHER = RESTRICTED.replace("pg.fixture.invalid", "other.fixture.invalid")
FS_RESTRICTED = RESTRICTED.replace("postgres:", "postgresql:")
FS_LEGACY = LEGACY.replace("postgres:", "postgresql:")
FS_OTHER = OTHER.replace("postgres:", "postgresql:")


def switch_xml(core="", sofia="", post_load="", extra=""):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<document type="freeswitch/xml">
  <section name="configuration">
    <configuration name="switch.conf"><settings>{core}</settings></configuration>
    {post_load}
    {sofia}
    {extra}
  </section>
</document>
""".encode()


def core_param(value):
    return f'<param name="core-db-dsn" value="{value}"/>'


def fs_classify(raw):
    return classify_freeswitch(FsSample(HELD, raw), FsSample(LATER, raw), TARGET)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        choices = (RESTRICTED, LEGACY, OTHER, RESTRICTED, LEGACY)
        active = tuple(KamBinding(module, "active", url) for module, url in zip(KAM_MODULES, choices))
        self.kam = KamSample(HELD, (*active, KamBinding("presence_xml", "inactive", None)))

    def test_all_six_kam_modules_with_separately_attested_mode(self):
        after = replace(self.kam, held=LATER, bindings=self.kam.bindings[::-1])
        result = classify_kamailio(self.kam, after, KAM_TARGETS)
        self.assertEqual(tuple(module for module, _ in result.bindings), KAM_MODULES)
        self.assertEqual(
            tuple(selection for _, selection in result.bindings),
            (
                Selection.RESTRICTED, Selection.LEGACY, Selection.OTHER,
                Selection.RESTRICTED, Selection.LEGACY, Selection.INACTIVE,
            ),
        )
        self.assertFalse(result.live_qualified)
        self.assertFalse(result.dispatch_allowed)
        self.check_private(result)

    def test_kam_refuses_missing_duplicate_inactive_with_url_and_drift(self):
        bindings = self.kam.bindings
        for after in (
            self.kam,
            replace(self.kam, held=replace(LATER, complete=False)),
            replace(self.kam, held=replace(LATER, identity="second-epoch")),
            replace(self.kam, held=LATER, bindings=bindings[:-1]),
            replace(self.kam, held=LATER, bindings=(*bindings[:-1], bindings[0])),
            replace(self.kam, held=LATER, bindings=(*bindings[:-1], replace(bindings[-1], db_url=LEGACY))),
            replace(self.kam, held=LATER, bindings=(replace(bindings[0], db_url=LEGACY), *bindings[1:])),
        ):
            self.assertTrue(
                all(kind is Selection.UNKNOWN for _, kind in classify_kamailio(self.kam, after, KAM_TARGETS).bindings)
            )

    def test_kam_macros_overrides_invalid_brackets_and_unsupported_uri_stay_unknown(self):
        for value in (
            "DB_URL", "$" + "{DB_URL}", RESTRICTED.replace(":5432", ""),
            RESTRICTED + "?host=overridden.invalid", RESTRICTED + "?sslmode=disable",
            RESTRICTED.replace(SECRET, "unescaped@password"),
            RESTRICTED.replace("pg.fixture.invalid", "[::1]junk"),
            RESTRICTED.replace("pg.fixture.invalid", "pg.-fixture.invalid"),
            RESTRICTED.replace("pg.fixture.invalid", "127.1"),
            RESTRICTED.replace("postgres:", "mysql:"), RESTRICTED.removesuffix("fixture") + "%ZZ",
            "x" * 4097,
        ):
            first = replace(self.kam, bindings=(replace(self.kam.bindings[0], db_url=value), *self.kam.bindings[1:]))
            result = classify_kamailio(first, replace(first, held=LATER), KAM_TARGETS)
            self.assertIs(dict(result.bindings)["auth_db"], Selection.UNKNOWN)
            self.check_private(result)

    def test_kam_db1_keyword_path_matches_only_a_pinned_hostaddr(self):
        dsn = (
            RESTRICTED.removesuffix("fixture")
            + "dbname=fixture hostaddr=192.0.2.9 sslmode=verify-full sslrootcert=/fixture-ca.crt "
            "channel_binding=require gssencmode=disable ssl_min_protocol_version=TLSv1.2 "
            "connect_timeout=3 passfile=/dev/null application_name=fixture "
            "options='-c default_transaction_read_only=on'"
        )
        for value, expected in (
            (dsn, Selection.RESTRICTED),
            (dsn.replace("192.0.2.9", "192.0.2.10"), Selection.UNKNOWN),
            (dsn + " host=override.invalid", Selection.UNKNOWN),
            (dsn + " dbname=other", Selection.UNKNOWN),
            (dsn + " service=other", Selection.UNKNOWN),
        ):
            bindings = (replace(self.kam.bindings[0], db_url=value), *self.kam.bindings[1:])
            first = KamSample(HELD, bindings, db1_expands_dbname=True)
            result = classify_kamailio(first, replace(first, held=LATER), KAM_TARGETS)
            self.assertIs(dict(result.bindings)["auth_db"], expected)
            self.check_private(result)

        first = replace(self.kam, bindings=(replace(self.kam.bindings[0], db_url=dsn), *self.kam.bindings[1:]))
        result = classify_kamailio(first, replace(first, held=LATER), KAM_TARGETS)
        self.assertIs(dict(result.bindings)["auth_db"], Selection.UNKNOWN)
        for attestation in (True, 1):
            after = replace(first, held=LATER, db1_expands_dbname=attestation)
            result = classify_kamailio(first, after, KAM_TARGETS)
            self.assertTrue(all(kind is Selection.UNKNOWN for _, kind in result.bindings))

    def test_kam_distinguishes_expected_role_per_module(self):
        targets = dict(KAM_TARGETS, dialog=replace(TARGET, restricted_role="dialog_actor"))
        result = classify_kamailio(self.kam, replace(self.kam, held=LATER), targets)
        self.assertIs(dict(result.bindings)["auth_db"], Selection.RESTRICTED)
        self.assertIs(dict(result.bindings)["dialog"], Selection.OTHER)
        del targets["dispatcher"]
        result = classify_kamailio(self.kam, replace(self.kam, held=LATER), targets)
        self.assertTrue(all(kind is Selection.UNKNOWN for _, kind in result.bindings))

    def test_kam_ipv6_literal_endpoint(self):
        url = RESTRICTED.replace("pg.fixture.invalid", "[2001:db8::2]")
        first = replace(self.kam, bindings=(replace(self.kam.bindings[0], db_url=url), *self.kam.bindings[1:]))
        targets = dict(KAM_TARGETS, auth_db=replace(TARGET, host="2001:0db8::2"))
        result = classify_kamailio(first, replace(first, held=LATER), targets)
        self.assertIs(dict(result.bindings)["auth_db"], Selection.RESTRICTED)

    def test_fs_core_keyword_conninfo_and_sofia_projection(self):
        core = core_param(
            f"pgsql://host=pg.fixture.invalid port=5432 dbname=fixture user=old_actor password='{SECRET}'"
        )
        sofia = f"""<configuration name="sofia.conf"><profiles>
          <profile name="private-profile-name"><settings><param name="odbc-dsn" value="{FS_RESTRICTED}"/></settings></profile>
          <profile name="other-profile"><settings><param name="odbc-dsn" value="{FS_OTHER}"/></settings></profile>
          <profile name="default-profile"><settings/></profile>
        </profiles></configuration>"""
        result = fs_classify(switch_xml(core, sofia))
        self.assertIs(result.core, Selection.LEGACY)
        self.assertEqual(
            (result.sofia_profiles, result.sofia_legacy, result.sofia_restricted, result.sofia_other, result.sofia_unknown),
            (3, 0, 1, 1, 1),
        )
        self.assertFalse(result.live_qualified)
        self.assertFalse(result.dispatch_allowed)
        self.check_private(result)

    def test_fs_pg_module_without_core_binding_and_unsupported_values_are_unknown(self):
        for value in ("", "sqlite://file.db", "driver:user:pass", "pgsql://service=fixture", "pgsql://user=old_actor"):
            extra = '<configuration name="modules.conf"><modules><load module="mod_pgsql"/></modules></configuration>'
            self.assertIs(fs_classify(switch_xml(core_param(value), extra=extra)).core, Selection.UNKNOWN)
        self.assertIs(fs_classify(switch_xml()).core, Selection.UNKNOWN)

    def test_fs_uri_rejects_encoded_controls_and_unsupported_options(self):
        for value in (
            FS_RESTRICTED.replace(SECRET, "p%00x"),
            FS_RESTRICTED + "?application_name=x%00y",
            FS_RESTRICTED + "?sslmode=unrecognized",
            FS_RESTRICTED + "?connect_timeout=not_an_integer",
        ):
            self.assertIs(fs_classify(switch_xml(core_param(value))).core, Selection.UNKNOWN)
        value = FS_RESTRICTED.replace(SECRET, "p%25x") + "?sslmode=verify-full"
        self.assertIs(fs_classify(switch_xml(core_param(value))).core, Selection.RESTRICTED)

    def test_fs_refuses_dynamic_markup_conflicting_sources_and_duplicates(self):
        post_load = (
            '<configuration name="post_load_switch.conf"><settings>'
            f'{core_param(FS_LEGACY)}</settings></configuration>'
        )
        for raw in (
            switch_xml(core_param(FS_RESTRICTED), post_load=post_load),
            switch_xml(core_param(FS_RESTRICTED) + core_param(FS_RESTRICTED).replace("core-db-dsn", "CORE-DB-DSN")),
            switch_xml(core_param(FS_RESTRICTED), extra='<X-PRE-PROCESS cmd="include" data="file.xml"/>'),
            switch_xml(core_param(FS_RESTRICTED), extra='<include href="file.xml"/>'),
            switch_xml(core_param(FS_RESTRICTED), extra="<?apply source?>"),
            switch_xml(core_param("$" + "$" + "{dsn}")),
            b'<!DOCTYPE document [<!ENTITY reference SYSTEM "file:///no-read">]>' + switch_xml(core_param(FS_RESTRICTED)),
            switch_xml(core_param(FS_RESTRICTED), extra='<configuration name="switch.conf"><settings/></configuration>'),
            switch_xml(core_param(FS_RESTRICTED))[:-6],
            b"\xff",
            b"X" * (512 * 1024 + 1),
        ):
            result = fs_classify(raw)
            self.assertIs(result.core, Selection.UNKNOWN)
            self.assertEqual(result.sofia_profiles, 0)
            self.check_private(result)

    def test_fs_refuses_changed_bytes_even_if_projected_choice_would_match(self):
        first = FsSample(HELD, switch_xml(core_param(FS_RESTRICTED)))
        self.assertIs(fs_classify(first.expanded_xml).core, Selection.RESTRICTED)
        after = FsSample(LATER, first.expanded_xml + b"\n")
        self.assertIs(classify_freeswitch(first, after, TARGET).core, Selection.UNKNOWN)

    def check_private(self, result):
        public = json.dumps(asdict(result))
        for private in (SECRET, "pg.fixture.invalid", "old_actor", "new_actor", "private-profile-name", "private-config-token"):
            self.assertNotIn(private, public)
