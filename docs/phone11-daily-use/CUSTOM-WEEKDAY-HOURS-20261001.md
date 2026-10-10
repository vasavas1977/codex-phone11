# Custom weekday business hours — 1 October 2026

The admin hours editor now selects days separately for each time range, including
Saturday and Sunday. It preserves the existing Monday–Friday default, multiple
daily ranges, optional date windows and full-day holiday priority. Empty,
duplicated or invalid days fail validation before submission; hours overlap only
when their days and dates overlap. Existing explicit custom-day rules can be
edited without replacing their day set with Monday–Friday.

This follows [Zoom Phone custom call-handling hours](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0069180)
using the existing PBX `day_of_week` contract (Sunday 0 through Saturday 6).
No server/schema/provider change is required by this editor slice.

Overnight ranges, all-day rules without explicit days, and separate holiday
destinations remain unsupported; existing unsupported fields still disable Save.
The latest PBX writer audit blocks production schema commissioning, so editor
source completion does not establish live call routing. Tests cover custom-day
round trips, malformed/empty selections, disjoint-day overlap and evaluation in
the workspace timezone with holiday precedence. Rendered and live routing
acceptance remain separate.
