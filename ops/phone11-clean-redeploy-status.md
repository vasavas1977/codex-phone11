# Phone11 Clean Backend Redeploy Status

- Time UTC: 2026-05-17T15:02:40+00:00
- Branch: codex/phone11-mobile-pjsip-20260506
- Workflow commit: 82e493a25559ca1c9241849457b7938a75492ab5
- EC2 host: 43.209.112.208
- EC2 instance: i-0cc8f248b08c5f2fb
- Result: success
- Exit code: 0

## Sanitized output
```text
=== Phone11 clean backend redeploy ===
Time: 2026-05-17T14:59:58+00:00
--- Locating EC2 instance ---
Found EC2 instance i-0cc8f248b08c5f2fb in ap-southeast-7b
--- Preparing temporary SSH access ---
{
    "RequestId": "dc777b87-acf5-4d88-a079-f9d8242c209b",
    "Success": true
}
--- Cleaning EC2 Docker cache before rebuild ---
Warning: Permanently added '43.209.112.208' (ED25519) to the list of known hosts.
Disk before cleanup:
Filesystem      Size  Used Avail Use% Mounted on
/dev/root        48G   48G   27M 100% /
/dev/root        48G   48G   27M 100% /
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          41        3         42.61GB   1.26GB (2%)
Containers      3         1         1.087GB   1.087GB (99%)
Local Volumes   0         0         0B        0B
Build Cache     0         0         0B        0B
a9b1bf9ab505 cp11-backend Up 23 minutes (healthy)
DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
            Install the buildx component to build images with BuildKit:
            https://docs.docker.com/go/buildx/

Total reclaimed space: 0B
Deleted Containers:
8f57cd9896a087602d088fd078384d2b6f6a3c916a367ea396ac2452cb5e87cb
795f970c84a6f02f39434cbe584cd168434ac74fb3b6f820861e76dd19bb61f8

Total reclaimed space: 1.087GB
```
