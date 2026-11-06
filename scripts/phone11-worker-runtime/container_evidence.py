"""Pure fingerprint of the reviewed rollback fields in a held Docker inspect row."""

import hashlib
import json

from rollback_admission import Refused, require, require_hash


def immutable_container_sha256(row, *, original_cid, replacement_cid):
    """Bind an owned container definition, leaving live state to the caller.

    The caller must obtain the complete inspect row in held custody, with
    separate process, restart, network and terminal-state evidence. The digest
    binds potentially private fields without returning their contents.
    """
    require_hash(original_cid)
    require_hash(replacement_cid)
    require(original_cid != replacement_cid, 'ORIGINAL_AND_REPLACEMENT_ALIAS')
    fields = ('Id', 'Image', 'Name', 'HostConfig', 'Config', 'Mounts')
    require(type(row) is dict and all(key in row for key in fields), 'INCOMPLETE_IMMUTABLE_CONTAINER')
    require(row['Id'] in (original_cid, replacement_cid), 'UNBOUND_CONTAINER_ID')
    require(all(type(row[key]) is str and row[key] for key in ('Image', 'Name'))
            and all(type(row[key]) is dict for key in ('HostConfig', 'Config')),
            'INCOMPLETE_IMMUTABLE_CONTAINER')
    immutable = {key: row[key] for key in fields}
    if row['Id'] == replacement_cid:
        host = row['HostConfig']
        require('OomKillDisable' in host, 'REPLACEMENT_OOM_KILL_SETTING_MISSING')
        value = host['OomKillDisable']
        require(value is None or value is False, 'REPLACEMENT_OOM_KILL_SETTING_FORBIDDEN')
        # The isolated Docker probe observed present false on create and
        # present null on exit, even with explicit --oom-kill-disable=false.
        immutable['HostConfig'] = {**host, 'OomKillDisable': False}

    mounts = row['Mounts']
    require(type(mounts) is list and all(
        type(mount) is dict and type(mount.get('Destination')) is str and mount['Destination']
        for mount in mounts
    ), 'INVALID_MOUNT_DESTINATION')
    require(len({mount['Destination'] for mount in mounts}) == len(mounts),
            'DUPLICATE_MOUNT_DESTINATION')
    immutable['Mounts'] = sorted(mounts, key=lambda mount: mount['Destination'])
    try:
        encoded = json.dumps(immutable, separators=(',', ':'), sort_keys=True, allow_nan=False)
    except (TypeError, ValueError, RecursionError):
        raise Refused('IMMUTABLE_CONTAINER_NOT_JSON') from None
    return hashlib.sha256(encoded.encode() + b'\n').hexdigest()
