# Phone11 Team Chat to Super Number / LINE OA adapter boundary

`server/chat/integration-contract.ts` is an intentionally unmounted,
side-effect-free contract for a future integration owned by Super Number. It
does not add a router, a queue, provider configuration, credentials, webhook,
or message-delivery code. Current Phone11 Team Chat behavior is unchanged.

## Identity and tenancy

An adapter must obtain an explicit active mapping from an authorized,
server-side resolver. The mapping binds all four values:

- Phone11 tenant and sending account;
- Super Number tenant and account.

The contract rejects a mapping for another Phone11 tenant, a different sender,
or an inactive record. It never infers a workspace from a number, email,
extension, browser state, or LINE Official Account.

## Stable replay identity

The persisted Phone11 message UUID is the canonical source identifier. The
future Super Number event ID and idempotency key are both:

```
phone11.chat.message.v1:<phone11-message-uuid>
```

The event also carries the Phone11 conversation ID, original client retry ID,
monotonic message sequence, and creation time. A delivery worker must save the
event ID before attempting external work and treat a retry as the same event;
it must never manufacture a replacement message ID.

## Privacy and LINE OA

Phone11 Team Chat is internal by default. A private recording follow-up is
rejected unless the owner records an explicit `owner_shared` decision in the
source message context. The mapping contract does not decide consent on behalf
of an owner.

The LINE OA function creates only a metadata reference with
`delivery: "not_requested"`. It deliberately excludes text, sender name,
customer details, and routes. A Super Number-owned delivery adapter needs its
own verified customer conversation, tenant mapping, consent/policy check,
audit record, and recipient-safe send before it can deliver any content to
LINE OA.

## Activation prerequisites

Before mounting an adapter, establish and test:

1. durable account/tenant mappings and revocation behavior;
2. a transaction/outbox that persists the stable event before delivery;
3. replay/de-duplication across Phone11 and Super Number;
4. owner-share, customer-consent, retention, audit, and deletion rules;
5. separate staging tests for an authorized internal sync and LINE OA route.

No current source, unit test, or local preview proves an external message send,
recipient delivery, customer consent, or a deployed LINE OA integration.
