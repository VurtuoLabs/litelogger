# LiteLogger

**The lean, low-footprint logger for Salesforce SMBs.**

Rollback-safe, queryable logging, without the storage bill or the setup burden of enterprise loggers. Install it, and you get durable error logs that don't blow up your Salesforce data storage.

## Why

Native `System.debug()` is ephemeral, not queryable, and lost on rollback. Enterprise loggers fix that but cost a fortune in **data storage** (they write 2+ standard-object records per log line, at ~$150/GB/mo list) and take a Salesforce architect to configure.

LiteLogger keeps the good idea and drops the cost:

- **Big Object primary storage**, full log history at ~0 standard-storage cost.
- **Tiny hot tier**, only the last ~7 days live in a reportable custom object; the rest is auto-archived nightly.
- **Rollback-safe**, logs are published as platform events immediately, so a failed transaction can't take its own error logs down with it.
- **Install-and-go**, opinionated defaults, one settings object, data masking on by default. No CMDT, no plugins, no permission-set matrix.

## Tech stack

| Layer | Technology |
|---|---|
| Language | Apex (API v62.0), 100% native, zero external dependencies |
| Transport | Platform Events (`LogEntryEvent__e`, HighVolume, `PublishImmediately`) |
| Hot storage | Custom object (`LogEntry__c`), reportable, searchable, private OWD |
| Cold storage | Big Object (`LogEntryArchive__b`), composite index, near-zero storage cost |
| Configuration | Hierarchy Custom Setting (`LoggerSettings__c`), org/profile/user overrides |
| Async processing | Batch Apex + chained Queueables (transaction-split Big Object DML) |
| UI | Lightning Web Components + Lightning Base Components (SLDS v2, linter-clean) |
| App shell | Lightning App + FlexiPages (App Pages) + Custom Tabs |
| Access control | 2 Permission Sets with full field-level security |
| Testing | Apex tests (11 methods) with a mockable Big Object DML seam |
| Project format | Salesforce DX source format, single package directory |

## Architecture

```
Logger.error('...')                     ← slim fluent API (Apex)
      │  buffers LogEntryEvent__e in memory
Logger.saveLog()  ──publish──►  Event Bus    PublishImmediately = survives rollback
                                    │
                     LogEntryEvent trigger (separate transaction,
                     runs as Automated Process, reads per-event
                     flags stamped by the publishing user)
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
            HOT TIER                          COLD TIER (primary)
            LogEntry__c                       LogEntryArchive__b (Big Object)
            last ~7 days, reportable         full history, ~free storage
            dashboards / alerts / reports    index: Timestamp DESC, TxnId, EntryNo
                    │                                ▲
                    └── LogArchiveBatch (nightly) ───┘
                        1. batch: insertImmediate → Big Object
                        2. HotTierDelete queueable: delete hot rows
                        3. ColdTierPurge queueable: delete archive rows
                           past cold retention (self-chaining)
```

Big Object DML and standard DML can't share a transaction, the archive pipeline splits each phase into its own transaction, and re-archival is idempotent because archive rows are keyed by their index.

Full design rationale, footprint math, and component inventory: [ARCHITECTURE.md](ARCHITECTURE.md).

### Data model

| Object | Type | Purpose |
|---|---|---|
| `LogEntryEvent__e` | Platform Event | Transport. Carries the publishing user's directives (`SkipHotTierStorage__c`, `SkipDataMasking__c`) so the subscriber never reads settings as the wrong user |
| `LogEntry__c` | Custom Object | Hot tier. `UniqueId__c` external ID makes event redelivery idempotent |
| `LogEntryArchive__b` | Big Object | Cold tier. 15 fields (vs. 140+ in enterprise equivalents) |
| `LoggerSettings__c` | Hierarchy Setting | 6 fields: enabled, level, hot tier on/off, hot/cold retention days, masking |

## Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf` v2+)
- A target org: scratch org, Developer Edition, Trailhead Playground, or sandbox
- Org must support **Big Objects** and **Platform Events** (all modern editions do; scratch orgs need the `BigObjects` feature, already declared in [config/project-scratch-def.json](config/project-scratch-def.json))

## Deployment

### Option A, scratch org

```bash
sf org create scratch -f config/project-scratch-def.json -a litelogger -d
sf project deploy start -o litelogger
sf org assign permset -n LiteLogger_Admin -o litelogger
sf apex run test --class-names LiteLoggerTest -o litelogger --wait 10 --code-coverage
```

### Option B, Dev org / Trailhead Playground / sandbox (manifest deploy)

```bash
# 1. Authenticate (use https://test.salesforce.com for sandboxes)
sf org login web --alias litelogger-dev --set-default \
  --instance-url https://login.salesforce.com

# 2. Generate the manifest from source (or use the committed manifest/package.xml)
sf project generate manifest --source-dir lite-logger --output-dir manifest --name package.xml

# 3. Deploy all 79 components
sf project deploy start --manifest manifest/package.xml -o litelogger-dev --wait 15

# 4. Assign access
sf org assign permset -n LiteLogger_Admin -o litelogger-dev     # full access
sf org assign permset -n LiteLogger_Viewer -o litelogger-dev --on-behalf-of user@example.com  # read-only

# 5. Verify with the test suite (11 tests)
sf apex run test --class-names LiteLoggerTest -o litelogger-dev --wait 10 --code-coverage
```

### Post-deploy configuration (2 minutes)

1. Open the app: `sf org open -o litelogger-dev -p /lightning/app/c__LiteLogger`
2. Go to the **Settings** tab → review org defaults (level, retention, masking) → **Save Org Defaults**
3. Click **Schedule Nightly Archive**, this activates the hot→cold tiering (1 AM daily). Without it, aged entries stay in standard storage and the cost story doesn't kick in.
4. Optional: in App Builder, drop the **Related Log Entries** component onto any record page (Account, Case, custom objects…).

No CMDT records, no remote site settings, no named credentials, no post-install scripts.

### Smoke test

```bash
echo "Logger.error('Deploy check: card 4111 1111 1111 1111').addTag('smoke'); Logger.saveLog();" > /tmp/smoke.apex
sf apex run --file /tmp/smoke.apex -o litelogger-dev
sf data query -q "SELECT LoggingLevel__c, Message__c, Tags__c FROM LogEntry__c ORDER BY Timestamp__c DESC LIMIT 3" -o litelogger-dev
```

Expected: an `ERROR` row whose message reads `...card ***CARD***`, proof the event → subscriber → masking pipeline works.

### Deployment troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Permission Delete depends on permission(s): Edit` | Object perms need Edit granted alongside Delete (already fixed in the shipped permsets) |
| `You cannot deploy to a required field: LogEntryArchive__b.*` | Required Big Object index fields can't carry FLS entries, don't add `fieldPermissions` for `Timestamp__c`, `TransactionId__c`, `TransactionEntryNumber__c` |
| Big Object index errors | Index fields must be `required`, text fields in the index ≤100 chars total, and the index can't be edited after deploy, changing it requires deleting the Big Object first |
| Entries not appearing after `saveLog()` | Platform events deliver asynchronously, allow a few seconds. Check Setup → Platform Events for the subscription state of the `LogEntryEvent` trigger |
| Logging silently off | Check the Settings tab: a settings record with `IsEnabled__c = false` disables logging for that scope (org/profile/user) |

## Usage

### Apex

```apex
// Level methods: error / warn / info / debug / fine, each buffers an entry
Logger.error('Payment failed', paymentId);              // attach a record ID
Logger.warn('Retrying gateway').addTag('billing');      // fluent tagging

try {
    doWork();
} catch (Exception e) {
    Logger.error('doWork() blew up', e);                // captures type/message/stack trace
}

Logger.setScenario('Nightly ERP Sync');                 // group a whole transaction
Logger.saveLog();                                       // publish, survives rollback
```

Entries below the configured level become no-op builders (safe to chain, nothing buffered). Sensitive data (card numbers, SSNs) is masked by default before storage.

### UI

- **LiteLogger app**, Home (summary tiles + filterable recent entries), Log Entries (full object tab: list views, reports), Settings (org defaults + archive scheduling, zero anonymous Apex)
- **Related Log Entries**, record-page component showing entries captured against the current record

## Project structure

```
LiteLogger/
├── manifest/package.xml            # deploy manifest (79 components)
├── config/project-scratch-def.json
└── lite-logger/                    # single package directory (sfdx source format)
    ├── logger-engine/              # capture: Logger, LogEntryEventBuilder, LogEntryEvent__e
    ├── log-management/             # persist: handler+trigger, DataMasker, LogArchiveBatch,
    │                               #          LoggerDataStore, LogEntry__c, LogEntryArchive__b, settings
    ├── ui/                         # app, 3 LWCs, 2 controllers, flexipages, tabs
    ├── config/permissionsets/      # LiteLogger_Admin, LiteLogger_Viewer (full FLS)
    └── tests/                      # LiteLoggerTest (11 methods, mocked Big Object DML)
```

## Status

`v0.2.0`, deployed and verified against a live dev org: 79/79 components, 11/11 tests passing, end-to-end smoke test (publish → subscribe → mask → store) confirmed. Alerting and Flow/LWC capture entry points are on the [roadmap](ARCHITECTURE.md#roadmap).

## License

[MIT](LICENSE) © 2026 VurtuoLabs
