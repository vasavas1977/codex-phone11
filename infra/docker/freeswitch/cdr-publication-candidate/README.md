# Call-record publication candidate — not deployed

This directory preserves an independently reviewed upstream FreeSWITCH v1.10.12 prototype. It is deliberately not referenced by the production Dockerfile or switch configuration. No replay process is enabled.

See [DESIGN.md](DESIGN.md) for the opt-in publication contract, tested failure paths, and the missing deployed-module source/build provenance. The source manifest and validation record describe the original local preparation; they are not production acceptance.

Local helper validation (owned synthetic files only):

```sh
python3 -m unittest discover -s infra/docker/freeswitch/cdr-publication-candidate -p test_publication.py -v
```

These checks compile the native helper on the current OS. They do not compile the full switch or qualify Linux, the installed module, target-filesystem power-loss behavior, or real call delivery. Preserve the 60-second trial; Android and phone testing remain deferred.
