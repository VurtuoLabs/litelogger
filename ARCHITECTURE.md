# LiteLogger, Architecture

> The lean, low-footprint logger for Salesforce SMBs.

LiteLogger is a deliberate subtraction from enterprise-grade Salesforce logging frameworks. It keeps the one genuinely great idea, **rollback-safe, queryable, unified logging**, and cuts the enterprise machinery (plugin frameworks, CMDT sprawl, governor-tuning knobs) that creates setup friction and cost for small orgs.

## The design thesis: storage is the cost

On Salesforce, **every record on a standard/custom object costs a flat ~2 KB of data storage**, regardless of its actual content, and orgs get a small base allotment (~10 GB) with extra storage priced painfully (~$150/GB/mo list). Enterprise loggers persist **two+ records per logged line** (a `Log__c` header + `LogEntry__c` children + tag junctions). At 1M entries that is 2+ GB of the most expensive storage on the platform.

**LiteLogger's whole reason to exist:** log to **Big Objects**, not custom objects. Big Objects (`__b`) are Salesforce's cheap, massively-scalable store that does **not** count against standard data storage. We make them the *primary* datastore, not an afterthought.

## Two-tier storage (hot / cold)

```
Logger.error('...')                     ← slim, opinionated API
      │  buffers LogEntryEvent__e
Logger.saveLog()  ──publish──►  event bus   (PublishImmediately = rollback-safe)
                                    │
                          LogEntryEvent trigger → LogEntryEventHandler
                                    │  (separate transaction)
                    ┌───────────────┴───────────────┐
                    ▼                                ▼
            HOT tier (small)                 COLD tier (cheap, primary)
            LogEntry__c                      LogEntryArchive__b (Big Object)
            last ~7 days only                full history, denormalized
            → reports, dashboards,           → ~free storage, long retention
              real-time triage               → LogArchiveBatch moves + prunes
```

- **Hot tier, `LogEntry__c` (custom object).** Holds only the last few days. This is what enables native **reports, dashboards, list views, and real-time triage**, the things Big Objects can't do (they only query on their predefined index, with no aggregates or standard reporting).
- **Cold tier, `LogEntryArchive__b` (Big Object).** Flat, denormalized, one row per entry. Where ~99% of the data lives, at ~0 storage cost.
- **`LogArchiveBatch`** runs nightly: copies aged hot rows into the Big Object via `insertImmediate`, then deletes them from standard storage. The hot tier stays small and cheap forever.

### Footprint vs. an enterprise logger (1M entries)

| | Enterprise logger | LiteLogger |
|---|---|---|
| Standard-storage records | ~1.1M | ~a few thousand (hot only) |
| Standard storage used | ~2.2 GB | ~10 MB |
| Long-term store | same expensive storage | Big Object (~free) |
| Est. monthly storage cost | painful for a 10 GB org | negligible |

## Rollback safety (the one enterprise idea we keep)

`LogEntryEvent__e` is a platform event with `publishBehavior = PublishImmediately`. It is published to the event bus the moment `saveLog()` runs, so **even if the original transaction throws and rolls back, the error log survives.** The subscriber then persists records in its own transaction. This solves the classic problem where a failed transaction takes its own logs down with it.

## What we cut vs. enterprise loggers

| Kept (slimmed) | Cut | Replaced with |
|---|---|---|
| Rollback-safe event capture | Plugin framework + handler MDTs |, |
| `Logger` API (~20 methods, not 100s of overloads) | Scenario rules, tag engine, junction objects | one `Tags__c` text field |
| `LogEntryEventBuilder` fluent interface | `LoggerParameter__mdt` feature flags | opinionated hardcoded defaults |
| One hierarchy settings object | Data-mask *rule engine* (CMDT) | `DataMasker` with built-in patterns, on by default |
| Big Object storage (promoted to core) | Retention *rule engine*, field-mapping MDT | single "retention days" setting |
| | Slack plugin, log-status callouts, console app | simple email/Slack alert (roadmap) |

**~215 Apex classes → 8 (+1 test). 23 objects → 4.**

## Components

### Objects (`lite-logger/*/objects`)
- **`LogEntryEvent__e`**, transport platform event (published immediately). Carries the publishing user's directives (`SkipHotTierStorage__c`, `SkipDataMasking__c`) so the subscriber, which runs as the Automated Process user, never reads settings itself. Flags are inverted so bare events (e.g. from an ISV) default to *stored + masked*.
- **`LogEntry__c`**, hot tier; reportable, `UniqueId__c` external id for idempotent upsert.
- **`LogEntryArchive__b`**, cold tier Big Object; index `(Timestamp DESC, TransactionId, TransactionEntryNumber)`, Timestamp leads so retention purges can range-filter on it, and the triple uniquely keys each row (re-archival after a failed delete safely overwrites).
- **`LoggerSettings__c`**, hierarchy custom setting: `IsEnabled`, `LoggingLevel`, `StoreInHotTier`, `HotTierRetentionDays` (7), `ColdTierRetentionDays` (90), `ApplyDataMasking`.

### Apex (`lite-logger/*/classes`, `lite-logger/ui/classes`)
- **`Logger`**, static entry point; buffer, level filtering, `saveLog()`; stamps user settings onto each event.
- **`LogEntryEventBuilder`**, fluent enrichment; no-op when below level.
- **`LogEntryEventHandler`**, subscriber; builds & upserts hot records, masking per event flags.
- **`DataMasker`**, default card/SSN masking, on by default (message, exception message, stack trace).
- **`LogArchiveBatch`**, hot→cold archival. Big Object DML and standard DML can't share a transaction, so it splits phases: batch `execute` writes the Big Object, a chained `HotTierDelete` queueable deletes hot rows, and a self-chaining `ColdTierPurge` queueable (from `finish()`) deletes archive rows past cold retention.
- **`LoggerDataStore`**, mockable seam around `insertImmediate`/`deleteImmediate` (Big Object DML isn't test-safe).
- **`LiteLoggerDashboardController`**, hot-tier summary/recent/related queries for the LWCs.
- **`LiteLoggerSettingsController`**, reads/writes org-default settings (always writing *every* field, so partial records can never silently disable logging) and manages the nightly archive schedule.

### UI (`lite-logger/ui`)
- **`LiteLogger` Lightning app**, three tabs: Home (dashboard), Log Entries (object tab), Settings.
- **`liteLoggerDashboard` LWC**, level summary tiles (7d) + filterable recent-entries table.
- **`relatedLogEntries` LWC**, drop on any record page to see entries captured against that record.
- **`liteLoggerSettings` LWC**, org-default settings form + one-click nightly archive scheduling (no anonymous Apex needed).
- **Permission sets**, `LiteLogger_Admin` (manage/delete, archive read, settings; settings writes also require Customize Application) and `LiteLogger_Viewer` (read-only dashboard). Both include full FLS.

## Roadmap
- One-click Slack / email alert on ERROR.
- LWC / Flow / OmniStudio capture entry points (mirror the Apex API).
- Async-SOQL browsing of the cold tier from the dashboard.

## Getting started (dev)
```bash
sf org create scratch -f config/project-scratch-def.json -a litelogger -d
sf project deploy start -o litelogger
sf org assign permset -n LiteLogger_Admin -o litelogger
sf apex run test -o litelogger -l RunLocalTests -w 10
```
Then open the **LiteLogger** app and use the Settings tab to confirm org defaults and schedule the nightly archive.
