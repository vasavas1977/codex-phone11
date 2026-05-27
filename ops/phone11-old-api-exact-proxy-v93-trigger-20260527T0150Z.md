# Trigger V93 exact old API proxy to live backend

Purpose: rerun the exact-block Nginx proxy patch on the old api.phone11.ai EC2 host so public https://api.phone11.ai reaches the live backend on 43.210.122.111.

Evidence before this trigger:
- iOS app registration fails with 401 Unauthorized while using SIP password fingerprint 2b847b074c0ba53a.
- Live SIP subscriber password proof previously showed fingerprint 6ed481a55a18a945.
- V90 proved live backend on 43.210.122.111 is current, but public api.phone11.ai still resolved/served the old backend build 7b0c678eeff3893ce53c964f17a88d76327299ab.
- Route53 permanent DNS update is blocked by missing route53 permissions on phone11-github-deploy.

Requested action: patch only the exact old Nginx server block with server_name api.phone11.ai to proxy_pass http://43.210.122.111, reload Nginx, then verify public API via old IP returns the live backend build.
