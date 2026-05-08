# Interface Standards - Phase 1

This file is the phase-local contract for how API, frontend, CLI, and mobile surfaces exchange data and errors.

## Surface Profile

- **api:** enabled
- **frontend:** enabled
- **cli:** not in scope
- **mobile:** enabled

## API Standard

Success envelope:

```json
{
  "ok": true,
  "data": "object|array|null",
  "message": "optional user-facing success message",
  "meta": "optional paging/summary metadata",
  "request_id": "optional correlation id"
}
```

Error envelope:

```json
{
  "ok": false,
  "error": {
    "code": "stable machine-readable string",
    "message": "safe default user-facing message",
    "user_message": "optional localized/user-facing override",
    "details": "optional object for diagnostics",
    "field_errors": "optional map field -> message[]",
    "request_id": "optional correlation id"
  }
}
```

Rules:
- `error.code` is stable and machine-readable.
- `error.message` is safe to show to users.
- `error.user_message` overrides `error.message` when localized/domain-specific copy exists.
- `error.field_errors` maps validation failures to form fields.
- HTTP status/statusText is transport metadata, not UI copy.

## Frontend Error Handling Standard

Message priority:
1. `error.user_message`
2. `error.message`
3. `message`
4. `network_fallback`

Required behavior:
- Toast/banner/form errors must show the API-provided message when one exists.
- Do not show raw AxiosError.message, Response.statusText, HTTP status code text, or `Request failed with status ...` as the primary user message.
- Field validation uses `error.field_errors`; non-field API errors use toast/banner/alert.
- Network/no-body failures use the configured network fallback.

## CLI Standard

- Success: exit 0; `--json` emits `ok:true,data,meta`.
- Error: non-zero exit; stderr emits `CODE: message`; `--json` emits `ok:false,error:{code,message,details?}`.
- Commands used by automation must support machine-readable output.

## Harness Enforcement

- Blueprint: contracts must cite this standard before build.
- Build: executors receive this standard in their prompt context.
- Review: runtime error-message lens compares API body message to visible UI message.
- Test: generated tests assert message priority on negative/mutation paths.

## Machine Readable

```json
{
  "schema": "interface-standards.v1",
  "phase": "1",
  "profile": "web-fullstack",
  "generated_at": "2026-05-08T07:07:56Z",
  "surfaces": {
    "api": true,
    "frontend": true,
    "cli": false,
    "mobile": true
  },
  "api": {
    "enabled": true,
    "request": {
      "content_type": "application/json",
      "correlation_id_header": "X-Request-Id",
      "auth_header": "Authorization: Bearer <token> when required",
      "validation": "Reject invalid body/query/path before side effects."
    },
    "success_envelope": {
      "required_shape": {
        "ok": true,
        "data": "object|array|null",
        "message": "optional user-facing success message",
        "meta": "optional paging/summary metadata",
        "request_id": "optional correlation id"
      },
      "http_policy": "2xx status must match the completed operation; do not hide domain failures in 200 responses."
    },
    "error_envelope": {
      "required_shape": {
        "ok": false,
        "error": {
          "code": "stable machine-readable string",
          "message": "safe default user-facing message",
          "user_message": "optional localized/user-facing override",
          "details": "optional object for diagnostics",
          "field_errors": "optional map field -> message[]",
          "request_id": "optional correlation id"
        }
      },
      "required_fields": [
        "error.code",
        "error.message",
        "error.user_message",
        "error.field_errors",
        "error.request_id"
      ],
      "legacy_compact_error_shape": "{ error: { code: string, message: string } } is accepted only when endpoint docs explicitly declare it; FE message priority still applies.",
      "message_priority": [
        "error.user_message",
        "error.message",
        "message",
        "network_fallback"
      ],
      "http_status_policy": "HTTP status is transport/classification only; UI must not display statusText or generic HTTP messages when API error message exists."
    }
  },
  "frontend": {
    "enabled": true,
    "api_error_message_priority": [
      "error.user_message",
      "error.message",
      "message",
      "network_fallback"
    ],
    "http_status_text_banned": true,
    "toast_rule": "Show error.user_message || error.message || message; never show AxiosError.message, Response.statusText, or 'Request failed with status ...' when the API body has a message.",
    "field_error_rule": "Bind error.field_errors to form fields; non-field errors go to toast/banner/alert.",
    "network_fallback": "Network error - check connection",
    "loading_rule": "Mutations set loading before request, disable submit while pending, and clear loading in finally."
  },
  "cli": {
    "enabled": false,
    "success": "Exit 0. Human stdout is concise; --json emits a stable object with ok:true,data,meta.",
    "error": "Exit non-zero. stderr includes CODE: message; --json emits ok:false,error:{code,message,details?}.",
    "machine_mode": "--json must be supported for commands used by automation."
  },
  "harness": {
    "blueprint": "API-CONTRACTS.md must cite this artifact and use the API error envelope/message priority.",
    "build": "Executors must receive this artifact before coding API clients, handlers, forms, or CLI commands.",
    "review": "Runtime lenses must compare API error body messages with visible toast/form errors.",
    "test": "Generated tests must assert API error-message semantics for negative/mutation paths."
  }
}
```
