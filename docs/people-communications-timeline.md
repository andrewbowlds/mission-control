# People Communications Timeline

This update adds a per-contact communications timeline in People detail and backend storage for outreach history.

## Data model

New table: `contact_activities`

Fields captured per record:
- `contact_id`
- `channel` (`call|text|email`)
- `direction` (`inbound|outbound`)
- `timestamp`
- `status`
- `summary` (content snippet)
- `task_id`
- `session_id`
- `message_id`
- `provider_id`
- `provider_name`
- `metadata_json`

## RPC methods

- `mc.people.activities.list`
  - params: `{ personId, channel?, direction?, query?, limit?, before?, after? }`
- `mc.people.activities.create`
  - params: `{ personId, channel, direction, timestamp?, status?, summary?, taskId?, sessionId?, messageId?, providerId?, providerName?, metadataJson? }`

## Auto-logging hook

`mc.tasks.addUpdate` now supports an optional `outreach` object. When supplied with valid `personId` + `channel`, a communication activity is auto-created.

Example payload extension:

```json
{
  "id": "<task-id>",
  "note": "Sent follow-up text",
  "author": "ada",
  "outreach": {
    "personId": "<contact-id>",
    "channel": "text",
    "direction": "outbound",
    "status": "sent",
    "summary": "Checked if they want to tour this weekend",
    "sessionId": "...",
    "messageId": "...",
    "providerName": "twilio"
  }
}
```

If `direction` is omitted, it defaults to:
- `outbound` for non-operator authors
- `inbound` for operator authors

## UI

People detail now includes:
- chronological timeline list
- filters for channel + direction
- search input (status/provider/summary)
- inline form to log communication events
