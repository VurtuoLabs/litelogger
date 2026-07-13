/**
 * Subscribes to LiteLogger's transport platform event and persists the hot tier.
 * This runs in a separate transaction from the publisher - the mechanism behind
 * rollback-safe logging.
 */
trigger LogEntryEvent on LogEntryEvent__e(after insert) {
  new LogEntryEventHandler().run();
}
