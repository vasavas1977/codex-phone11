# Isolated Kamailio 5.8.4 TM/HTTP fixture result

Source commit: `aba128b08ac5745b03ab410e991791375db05417`.
The fixture was exported alone to the fresh private host path
`/var/lib/phone11-vm-tm-fixture-aba128b` and mounted at `/work:ro`.
The container used `--rm --network none --memory 256m --pids-limit 96`,
no published ports, no privileged mode and no Docker socket mount. The
pre-existing image ID was verified before execution:
`sha256:f7c3a2412b49f1372c70b2ad06da6f28cb34a044ee3ae408c7b960ef484bb5b7`.
No live Kamailio config, container or call was changed.

Remote SHA-256 after export:

| File | SHA-256 |
| --- | --- |
| `run.py` | `837395dc4ea05252cf551be23576995a74942222a074197f98f752d640461181` |
| `runtime.cfg` | `8b9212a4850e085849839827a84cc178ece1f2eccaf95a6141e152430183f542` |

The runner invoked `kamailio -c` before starting the synthetic SIP listener.
Parser and runtime process exited 0. The bounded run reported:

| Scenario | HTTP requests | Primary branches | Fork branches | FS branches | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| All-branch no-answer timeout | 1 | 1 | 0 | 1 | pass |
| CANCEL before HTTP | 0 | 1 | 0 | 0 | pass |
| CANCEL during HTTP | 1 | 1 | 0 | 0 | pass |
| HTTP reply after TM expiry | 1 | 1 | 0 | 0 | pass |
| 486 Busy only | 0 | 1 | 0 | 0 | pass |
| Fork 486 then 200 | 0 | 1 | 1 | 0 | pass |

The two forked destinations were separately observed on loopback ports 15061
and 15062 with distinct TM branch identifiers. The synthetic FS destination
was port 15063. Kamailio logged two
`t_continue_helper(): active transaction not found` warnings while stale async
callbacks were being exercised; neither produced an FS branch. These results
establish that this exact 5.8.4 fixture supports final-failure-route HTTP
suspension/resume and guards the tested CANCEL/expiry/fork outcomes. They do
not prove live tenant authorization, voicemail media, carrier A-leg behavior
or handset acceptance.
