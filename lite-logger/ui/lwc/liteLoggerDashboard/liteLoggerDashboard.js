import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getSummary from '@salesforce/apex/LiteLoggerDashboardController.getSummary';
import getRecentEntries from '@salesforce/apex/LiteLoggerDashboardController.getRecentEntries';
import { SEVERITY_ORDER, severityMeta, normalizeEntries, describeError, share } from 'c/liteLoggerLogUtils';

const LOWER_LEVELS = ['DEBUG', 'FINE', 'FINEST'];
const SEARCH_DEBOUNCE_MS = 250;

/**
 * LiteLogger monitoring console.
 *
 * The single most decision-critical fact for an operator is "is anything failing
 * right now?", so the ERROR count for the selected window is the hero metric and
 * everything else is subordinate to it.
 *
 * Server contract is unchanged: getSummary(lastNDays) and getRecentEntries(level, max).
 * The trailing-window trend is derived by asking for a double-length window and
 * subtracting, which needs no new Apex.
 */
export default class LiteLoggerDashboard extends LightningElement {
    /** Optional override so admins can retitle the console in App Builder. */
    @api headline = 'Log Console';
    /** Initial trailing window in days (1, 3, 7 or 30). */
    @api defaultWindowDays = 7;
    /** Initial server-side row limit (25, 50, 100 or 200). */
    @api defaultRowLimit = 50;
    /** Rows per page in the stream. */
    @api pageSize = 25;

    // --- wire params (plain fields: reactive wire params cannot be getters) ---
    windowDays = 7;
    priorWindowDays = 14;
    levelFilter = 'ALL';
    rowLimit = 50;

    // --- client-side filters ---
    searchTerm = '';
    transactionFilter = '';

    // --- state ---
    summaryLoading = true;
    entriesLoading = true;
    // Skeletons are for first paint only. Once data has arrived, a refresh keeps the
    // current values on screen (stale-while-revalidating) so nothing shifts or jumps.
    summaryLoaded = false;
    entriesLoaded = false;
    refreshing = false;
    summaryError;
    entriesError;
    lastUpdated;
    mixExpanded = true;

    summaryCounts = {};
    priorCounts = {};
    entries = [];

    wiredSummaryResult;
    wiredPriorSummaryResult;
    wiredEntriesResult;
    searchTimeout;

    connectedCallback() {
        const days = Number(this.defaultWindowDays);
        if ([1, 3, 7, 30].includes(days)) {
            this.windowDays = days;
            this.priorWindowDays = days * 2;
        }
        const limit = Number(this.defaultRowLimit);
        if ([25, 50, 100, 200].includes(limit)) {
            this.rowLimit = limit;
        }
    }

    disconnectedCallback() {
        clearTimeout(this.searchTimeout);
    }

    // ------------------------------------------------------------------ data

    @wire(getSummary, { lastNDays: '$windowDays' })
    wiredSummary(result) {
        this.wiredSummaryResult = result;
        if (result.data) {
            this.summaryError = undefined;
            this.summaryCounts = this.toCountMap(result.data);
            this.summaryLoading = false;
            this.summaryLoaded = true;
            this.lastUpdated = new Date();
        } else if (result.error) {
            // Keep the raw error for developers, show a sentence to the operator.
            // eslint-disable-next-line no-console
            console.error('LiteLogger: getSummary failed', result.error);
            this.summaryError = describeError(result.error, 'The log summary could not be loaded.');
            this.summaryCounts = {};
            this.summaryLoading = false;
        }
    }

    /** Double-length window; prior period = this minus the current window. */
    @wire(getSummary, { lastNDays: '$priorWindowDays' })
    wiredPriorSummary(result) {
        this.wiredPriorSummaryResult = result;
        if (result.data) {
            this.priorCounts = this.toCountMap(result.data);
        } else if (result.error) {
            // A missing trend is not worth an error panel: hide the trend instead.
            // eslint-disable-next-line no-console
            console.error('LiteLogger: trend summary failed', result.error);
            this.priorCounts = {};
        }
    }

    @wire(getRecentEntries, { level: '$levelFilter', maxRecords: '$rowLimit' })
    wiredEntries(result) {
        this.wiredEntriesResult = result;
        if (result.data) {
            this.entriesError = undefined;
            this.entries = normalizeEntries(result.data);
            this.entriesLoading = false;
            this.entriesLoaded = true;
            this.lastUpdated = new Date();
        } else if (result.error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: getRecentEntries failed', result.error);
            this.entriesError = describeError(result.error, 'Log entries could not be loaded.');
            this.entries = [];
            this.entriesLoading = false;
        }
    }

    toCountMap(rows) {
        const counts = {};
        rows.forEach((row) => {
            counts[String(row.level || '').toUpperCase()] = row.total;
        });
        return counts;
    }

    // ------------------------------------------------------------------ metrics

    get windowTotal() {
        return Object.values(this.summaryCounts).reduce((sum, count) => sum + count, 0);
    }

    get priorTotal() {
        const doubled = Object.values(this.priorCounts).reduce((sum, count) => sum + count, 0);
        return Math.max(0, doubled - this.windowTotal);
    }

    count(level) {
        return this.summaryCounts[level] || 0;
    }

    priorCount(level) {
        const doubled = this.priorCounts[level] || 0;
        return Math.max(0, doubled - this.count(level));
    }

    /** Percentage change vs the previous window of equal length, or undefined. */
    trendFor(level) {
        const current = level ? this.count(level) : this.windowTotal;
        const prior = level ? this.priorCount(level) : this.priorTotal;
        if (!this.hasTrendBaseline) {
            return undefined;
        }
        if (prior === 0) {
            return current === 0 ? 0 : 100;
        }
        return Math.round(((current - prior) / prior) * 100);
    }

    get hasTrendBaseline() {
        return Object.keys(this.priorCounts).length > 0;
    }

    get trendLabel() {
        return `vs prior ${this.windowLabelShort}`;
    }

    get errorCount() {
        return this.count('ERROR');
    }

    get warnCount() {
        return this.count('WARN');
    }

    get infoCount() {
        return this.count('INFO');
    }

    get lowerCount() {
        return LOWER_LEVELS.reduce((sum, level) => sum + this.count(level), 0);
    }

    get errorLabel() {
        return this.windowDays === 1 ? 'Errors · 24 h' : `Errors · ${this.windowDays} d`;
    }

    get totalLabel() {
        return 'All entries';
    }

    get errorSelected() {
        return this.levelFilter === 'ERROR';
    }

    get warnSelected() {
        return this.levelFilter === 'WARN';
    }

    get infoSelected() {
        return this.levelFilter === 'INFO';
    }

    get totalSelected() {
        return this.levelFilter === 'ALL';
    }

    get hasWindowEntries() {
        return this.windowTotal > 0;
    }

    get mixDescription() {
        if (!this.hasWindowEntries) {
            return `Distribution by logging level for the ${this.windowLabelLong}.`;
        }
        return `${this.windowTotal.toLocaleString()} entries in the ${this.windowLabelLong}, by logging level.`;
    }

    get errorSupportingText() {
        if (this.windowTotal === 0) {
            return 'No entries captured in this window';
        }
        if (this.errorCount === 0) {
            return `0% of ${this.windowTotal.toLocaleString()} entries - no failures captured`;
        }
        return `${share(this.errorCount, this.windowTotal)}% of ${this.windowTotal.toLocaleString()} entries`;
    }

    get errorTone() {
        return this.errorCount > 0 ? 'error' : 'positive';
    }

    get errorTrendTone() {
        const trend = this.trendFor('ERROR');
        if (trend === undefined || trend === 0) {
            return 'neutral';
        }
        return trend > 0 ? 'negative' : 'positive';
    }

    get errorTrend() {
        return this.trendFor('ERROR');
    }

    get warnTrend() {
        return this.trendFor('WARN');
    }

    get totalTrend() {
        return this.trendFor(null);
    }

    get errorShare() {
        return share(this.errorCount, this.windowTotal);
    }

    get warnShare() {
        return share(this.warnCount, this.windowTotal);
    }

    get infoShare() {
        return share(this.infoCount, this.windowTotal);
    }

    get lowerShare() {
        return share(this.lowerCount, this.windowTotal);
    }

    get warnSupportingText() {
        return this.windowTotal ? `${this.warnShare}% of all entries` : 'No entries in this window';
    }

    get infoSupportingText() {
        return this.windowTotal ? `${this.infoShare}% of all entries` : 'No entries in this window';
    }

    get lowerSupportingText() {
        const parts = LOWER_LEVELS.filter((level) => this.count(level) > 0).map(
            (level) => `${level} ${this.count(level).toLocaleString()}`
        );
        return parts.length ? parts.join(' · ') : 'No verbose entries captured';
    }

    get totalSupportingText() {
        return `Hot tier · ${this.windowLabelLong}`;
    }

    /** Stacked distribution bar + legend rows. */
    get severityMix() {
        const total = this.windowTotal;
        return SEVERITY_ORDER.map((level) => {
            const meta = severityMeta(level);
            const value = this.count(level);
            const pct = share(value, total);
            return {
                level,
                key: meta.key,
                label: meta.label,
                value,
                valueLabel: value.toLocaleString(),
                pct,
                pctLabel: total ? `${pct}%` : '-',
                segmentClass: `ll-mix__seg ll-mix__seg_${meta.key} ll-mix__seg_${meta.shape}`,
                segmentStyle: `flex-grow: ${value};`,
                barClass: `ll-legend__bar ll-legend__bar_${meta.key}`,
                barStyle: `width: ${total ? Math.max(pct, value > 0 ? 1.5 : 0) : 0}%;`,
                hasValue: value > 0
            };
        });
    }

    get mixSegments() {
        return this.severityMix.filter((row) => row.hasValue);
    }

    get mixAriaLabel() {
        if (!this.windowTotal) {
            return 'No entries to distribute.';
        }
        return `Severity distribution: ${this.mixSegments
            .map((row) => `${row.label} ${row.valueLabel} (${row.pctLabel})`)
            .join(', ')}.`;
    }

    // ------------------------------------------------------------------ window / filters

    get windowOptions() {
        return [
            { label: 'Last 24 hours', value: '1' },
            { label: 'Last 3 days', value: '3' },
            { label: 'Last 7 days', value: '7' },
            { label: 'Last 30 days', value: '30' }
        ];
    }

    get windowValue() {
        return String(this.windowDays);
    }

    get windowLabelLong() {
        return this.windowDays === 1 ? 'last 24 hours' : `last ${this.windowDays} days`;
    }

    get windowLabelShort() {
        return this.windowDays === 1 ? '24 h' : `${this.windowDays} d`;
    }

    get levelOptions() {
        return [
            { label: 'All levels', value: 'ALL' },
            ...SEVERITY_ORDER.map((level) => ({ label: severityMeta(level).label, value: level }))
        ];
    }

    get rowLimitOptions() {
        return [
            { label: '25 rows', value: '25' },
            { label: '50 rows', value: '50' },
            { label: '100 rows', value: '100' },
            { label: '200 rows', value: '200' }
        ];
    }

    get rowLimitValue() {
        return String(this.rowLimit);
    }

    handleWindowChange(event) {
        const days = Number(event.detail.value);
        this.windowDays = days;
        this.priorWindowDays = days * 2;
        this.summaryLoading = true;
    }

    handleLevelChange(event) {
        this.levelFilter = event.detail.value;
        this.entriesLoading = true;
    }

    handleRowLimitChange(event) {
        this.rowLimit = Number(event.detail.value);
        this.entriesLoading = true;
    }

    handleSearch(event) {
        const value = event.target.value;
        clearTimeout(this.searchTimeout);
        // Debounced so typing does not re-filter (and re-render) on every keystroke.
        // The timer is always cleared in disconnectedCallback, so nothing leaks.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this.searchTimeout = setTimeout(() => {
            this.searchTerm = value ? value.trim().toLowerCase() : '';
        }, SEARCH_DEBOUNCE_MS);
    }

    handleTileSelect(event) {
        const severity = event.detail.severity;
        this.levelFilter = this.levelFilter === severity ? 'ALL' : severity || 'ALL';
        this.entriesLoading = true;
    }

    handleTransactionFilter(event) {
        this.transactionFilter = event.detail.transactionId || '';
    }

    handleClearLevel() {
        this.levelFilter = 'ALL';
        this.entriesLoading = true;
    }

    handleClearSearch() {
        this.searchTerm = '';
        const input = this.template.querySelector('lightning-input[data-id="search"]');
        if (input) {
            input.value = '';
        }
    }

    handleClearTransaction() {
        this.transactionFilter = '';
    }

    handleClearAllFilters() {
        this.transactionFilter = '';
        this.handleClearSearch();
        if (this.levelFilter !== 'ALL') {
            this.handleClearLevel();
        }
    }

    get filteredEntries() {
        let rows = this.entries;
        if (this.transactionFilter) {
            rows = rows.filter((row) => row.transactionId === this.transactionFilter);
        }
        if (this.searchTerm) {
            rows = rows.filter((row) => row.searchBlob.includes(this.searchTerm));
        }
        return rows;
    }

    get hasActiveFilters() {
        return this.levelFilter !== 'ALL' || Boolean(this.searchTerm) || Boolean(this.transactionFilter);
    }

    get levelPillLabel() {
        return `Level: ${severityMeta(this.levelFilter).label}`;
    }

    get searchPillLabel() {
        return `Search: ${this.searchTerm}`;
    }

    get transactionPillLabel() {
        const id = this.transactionFilter;
        return `Transaction: ${id.length > 12 ? `${id.slice(0, 12)}…` : id}`;
    }

    get showLevelPill() {
        return this.levelFilter !== 'ALL';
    }

    // ------------------------------------------------------------------ view state

    get hasEntries() {
        return this.filteredEntries.length > 0;
    }

    /** Skeletons only before the first result; refreshes keep the rows in place. */
    get showSummarySkeleton() {
        return this.summaryLoading && !this.summaryLoaded;
    }

    get showStreamSkeleton() {
        return this.entriesLoading && !this.entriesLoaded;
    }

    get isBusy() {
        return this.refreshing || this.summaryLoading || this.entriesLoading;
    }

    get stripClass() {
        return `ll-console__section${this.isBusy ? ' ll-console__section_busy' : ''}`;
    }

    get showStream() {
        return this.showStreamSkeleton || (!this.entriesError && this.hasEntries);
    }

    get showEmptyState() {
        return !this.showStreamSkeleton && !this.entriesError && !this.hasEntries;
    }

    get emptyIsFiltered() {
        return this.hasActiveFilters;
    }

    get emptyHeading() {
        return this.emptyIsFiltered ? 'No entries match these filters' : 'No log entries in the hot tier';
    }

    get emptyMessage() {
        return this.emptyIsFiltered
            ? 'The hot tier has entries, but none match the current level, search or transaction filter.'
            : 'Nothing has been logged recently - for a logger, that is the healthy state. Entries appear here seconds after Logger.saveLog() runs.';
    }

    get emptyHint() {
        return this.emptyIsFiltered ? undefined : "Logger.error('Payment failed'); Logger.saveLog();";
    }

    get emptyTone() {
        return this.emptyIsFiltered ? 'neutral' : 'positive';
    }

    get emptyIcon() {
        return this.emptyIsFiltered ? 'utility:filterList' : 'utility:success';
    }

    get emptyActionLabel() {
        return this.emptyIsFiltered ? 'Clear filters' : 'Refresh';
    }

    handleEmptyAction() {
        if (this.emptyIsFiltered) {
            this.handleClearAllFilters();
        } else {
            this.handleRefresh();
        }
    }

    get streamDescription() {
        const scope = this.levelFilter === 'ALL' ? 'all levels' : severityMeta(this.levelFilter).label;
        return `Newest ${this.rowLimit} hot-tier entries, ${scope}. Select a row to expand the full message.`;
    }

    get isCapped() {
        return this.entries.length >= this.rowLimit;
    }

    get cappedMessage() {
        return `Showing the newest ${this.rowLimit} entries only. Narrow the level filter or raise the row limit to see more.`;
    }

    get refreshLabel() {
        return this.refreshing ? 'Refreshing…' : 'Refresh';
    }

    get lastUpdatedLabel() {
        if (!this.lastUpdated) {
            return 'Loading…';
        }
        return `Updated ${this.lastUpdated.toLocaleTimeString()}`;
    }

    get skeletonRows() {
        return Math.min(this.pageSize, 8);
    }

    get mixSectionId() {
        return 'll-mix-section';
    }

    handleToggleMix() {
        this.mixExpanded = !this.mixExpanded;
    }

    // ------------------------------------------------------------------ refresh / retry

    async handleRefresh() {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        this.summaryLoading = true;
        this.entriesLoading = true;
        try {
            await Promise.all([
                refreshApex(this.wiredSummaryResult),
                refreshApex(this.wiredPriorSummaryResult),
                refreshApex(this.wiredEntriesResult)
            ]);
            this.lastUpdated = new Date();
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: refresh failed', error);
            const described = describeError(error, 'The console could not be refreshed.');
            this.showToast('Refresh failed', described.message, 'error');
        } finally {
            this.refreshing = false;
            this.summaryLoading = false;
            this.entriesLoading = false;
        }
    }

    handleRetry() {
        this.handleRefresh();
    }

    handleNotify(event) {
        const { variant, title, message } = event.detail;
        this.showToast(title, message, variant);
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant, mode: 'dismissable' }));
    }
}
