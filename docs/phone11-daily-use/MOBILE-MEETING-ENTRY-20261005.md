# Mobile meeting entry — 5 October 2026

Ordinary Meet entry with multiple unlabelled admitted rooms now asks the user to open a named invitation in Team Chat, using the existing `/(tabs)/teamchat` route. It does not expose UUIDs, choose the first room or invent titles. A single admitted room can join without displaying its ID; safe named choices remain explicit. Selected channel/direct invitations retain the existing exact meeting and tenant admission check and optional safe title.

[Conference entry](../../app/conference/index.tsx) passes the existing invitation navigation action to [prejoin](../../components/meetings/meeting-prejoin.tsx). Its active incoming/ongoing Phone-call guard now returns the fixed typed `phone_call_active` reason; prejoin tells the user to finish the Phone call and retry. That refusal requests no meeting admission or media. An explicit retry after the call ends requests fresh admission. Raw exception/provider text is never rendered.

This source change adds no API, storage, host authority, native capture or desktop behavior. Mocked entry/prejoin tests cover none/single/multiple rooms, exact invitations, accessible labels without IDs, active Phone calls, recovery and session cancellation. Build, deployment, provider and device acceptance remain separate gates.
