# Security

LiteLogger is a lean, low-footprint logger for Salesforce.

## Reporting a vulnerability

Report security issues privately to **aimperiale@vurtuolabs.com**. Do not open a public
issue for anything you believe is exploitable.

Include the version or commit you tested, the org edition and configuration if relevant,
what you observed, and the smallest set of steps that reproduces it. A proof of concept is
welcome but not required.

What to expect:

| Stage | Target |
|---|---|
| Acknowledgement that the report was received | 3 working days |
| Initial assessment, including whether it is accepted | 10 working days |
| Fix or documented mitigation for an accepted issue | 30 days, sooner where severity warrants |

We will tell you which way the assessment went either way. If a report is not accepted you
will get the reasoning, not silence. Credit is offered on any accepted report unless you ask
us not to.

## Supported versions

Security fixes land on the default branch. There are no long-lived release branches and no
backports to older commits, so the supported version is the current `main`.

## The security model in one paragraph

This package runs inside your Salesforce org, in the session of the user who invokes it.
It does not introduce an identity of its own, it does not hold credentials, and it does
not create a path to data that the running user could not already reach through the
standard UI or API. Everything below is detail on how that is enforced and where the
deliberate exceptions are.

## Record and field access

Two mechanisms do different jobs, and conflating them is the usual way data leaks:

- **`with sharing` on a class** governs **which records** the running user can see. It
  applies row-level sharing: ownership, role hierarchy, sharing rules, manual shares.
- **`WITH USER_MODE` on a query** enforces **object and field-level security** for that
  query. It applies CRUD and FLS.

`with sharing` alone does not give you field-level security. A class can be `with
sharing` and still hand a user the contents of a field their profile hides from them.
Both are required, and this package uses both.

Measured against the current commit:

| Control | Count |
|---|---|
| Production Apex classes | 8 |
| Classes declared `with sharing` | 6 |
| Classes declared `without sharing` | 1 |
| Production SOQL queries | 8 |
| Queries carrying an explicit enforcement clause | 4 |
| Queries deliberately running in system mode | 4 |
| Apex test methods | 12 |

4 production queries do not carry an enforcement clause. Every one is
listed here with the reason, and there are no others:

| Location | Queries | Why system mode is correct there |
|---|---|---|
| `LogArchiveBatch` | 3 | A scheduled archive job runs with no interactive user, so there is no subject for user mode to enforce against. It moves log rows the platform owns. |
| `LiteLoggerSettingsController` | 1 | Reads `CronTrigger`, a setup object describing platform job state rather than customer data. User mode errors there for users without setup access, which would break the settings page for everyone. |

These are the only exceptions. Any other unenforced query is a defect, not a design
decision.

### Classes that opt out of sharing

**`LogEntryEventHandler`** is `without sharing` deliberately. It is the platform-event subscriber that persists log entries, and a logger that only recorded events the running user had sharing access to would silently drop the entries most worth having. It writes log rows only; it never reads or returns customer data to a user.

## Secrets and credentials

This package makes no authenticated outbound calls and stores no credentials.

No API keys, tokens, passwords, certificates or session identifiers are committed to
this repository. Test fixtures use obviously fake values.

## What this package deliberately does not do

- It does not transmit logs anywhere. Entries stay in your org.
- It does not capture record payloads automatically. What gets logged is what the caller passes.
- It does not call any external service.

## Your responsibilities as the deploying admin

This package inherits your org's configuration. It cannot compensate for it.

- Grant access through the permission set
  (2 shipped in this repository), not by widening profiles.
- Field-level security is yours to define. This package enforces what you configure; it
  does not decide what a role should see.
- Review the sharing model on any custom object this package creates before you load
  production data into it.
- Anyone who can see the data can see it through this package too. That is the intent,
  and it is worth confirming it matches your expectations before rollout.

## How these claims are checked

The counts in this document are measured from source, not asserted from memory. They are
reproduced with:

```bash
# production queries (test classes excluded)
grep -rn "\[\s*SELECT" --include="*.cls" force-app | wc -l

# queries carrying an explicit enforcement clause
grep -rn "WITH USER_MODE" --include="*.cls" force-app | wc -l

# classes that opt out of sharing
grep -rn "without sharing" --include="*.cls" force-app
```

If you find a query in this repository that lacks an enforcement clause and is not listed as
a documented exception above, that is a defect. Report it.

## License and warranty

Released under the MIT License. It is provided without warranty of any kind, including
any warranty of security or fitness for a particular purpose. See [LICENSE](LICENSE).

Copyright (c) 2026 VurtuoLabs
