#!/usr/bin/env python3
"""Describe only the locally loaded CI image; never start or publish it."""
import argparse
import json
import os
import re
import subprocess
import sys

TEMPLATE = '{"imageId":"{{.Id}}","os":"{{.Os}}","architecture":"{{.Architecture}}","revision":"{{index .Config.Labels "org.opencontainers.image.revision"}}"}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.commit) or not os.path.isabs(args.output):
        raise ValueError('Invalid metadata request')
    tag = 'phone11-backend-check:' + args.commit
    result = subprocess.run(['docker', 'image', 'inspect', '--format', TEMPLATE, tag],
                            capture_output=True, timeout=15, check=False)
    if result.returncode or result.stderr or len(result.stdout) > 1024:
        raise ValueError('Local image inspection failed')
    image = json.loads(result.stdout)
    if (set(image) != {'imageId', 'os', 'architecture', 'revision'}
            or not isinstance(image['imageId'], str)
            or not re.fullmatch('sha256:[a-f0-9]{64}', image['imageId'])
            or image['os'] != 'linux' or image['architecture'] != 'amd64'
            or image['revision'] != args.commit):
        raise ValueError('Local image metadata differs')
    value = {'sourceCommit': args.commit, 'platform': 'linux/amd64',
             'imageId': image['imageId'], 'localTag': tag, 'published': False,
             'applicationStarted': False}
    raw = (json.dumps(value, sort_keys=True) + '\n').encode()
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(raw)
        out.flush()
        os.fsync(out.fileno())
    print(raw.decode(), end='')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        print('Local backend image metadata refused', file=sys.stderr)
        raise SystemExit(1)
