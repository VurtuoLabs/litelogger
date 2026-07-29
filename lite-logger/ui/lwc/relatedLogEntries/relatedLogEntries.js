import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getEntriesForRecord from '@salesforce/apex/LiteLoggerDashboardController.getEntriesForRecord';
import { SEVERITY_ORDER, severityMeta, normalizeEntries, describeError } from 'c/liteLoggerLogUtils';

const SERVER_CAP = 200;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Record-page panel: the log entries captured against this record, as the same
 * severity-gutter stream the console uses, so triage muscle memory transfers.
 *
 * The severity chips are both the summary strip and the filter control - on a
 * record page there is no room for two separate widgets.
 */
export default class RelatedLogEntries extends LightningElement {
    @api recordId;
    @api headline = 'Log entries';
    @api pageSize = 10;

    entries = [];
    loading = true;
    loaded = false;
    refreshing = false;
    error;

    levelFilter = 'ALL';
    searchTerm = '';
    transactionFilter = '';

    wiredResult;
    searchTimeout;

    disconnectedCallback() {
        clearTimeout(this.searchTimeout);
    }

    @wire(getEntriesForRecord, { recordId: '$recordId' })
    wiredEntries(result) {
        this.wiredResult = result;
        if (result.data) {
            this.error = undefined;
            this.entries = normalizeEntries(result.data);
            this.loading = false;
            this.loaded = true;
        } else if (result.error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: getEntriesForRecord failed', result.error);
            this.error = describeError(result.error, 'Log entries for this record could not be loaded.');
            this.entries = [];
            this.loading = false;
        }
    }

    // ------------------------------------------------------------------ summary

    get countsByLevel() {
        const counts = {};
        this.entries.forEach((row) => {
            counts[row.level] = (counts[row.level] || 0) + 1;
        });
        return counts;
    }

    /** "All" chip plus one chip per level actually present. Chips are the filter. */
    get severityChips() {
        const counts = this.countsByLevel;
        const chips = [
            {
                key: 'ALL',
                level: 'ALL',
                isAll: true,
                label: 'All',
                count: this.entries.length,
                selected: this.levelFilter === 'ALL',
                ariaPressed: this.levelFilter === 'ALL' ? 'true' : 'false',
                chipClass: `ll-chip${this.levelFilter === 'ALL' ? ' ll-chip_selected' : ''}`,
                ariaLabel: `Show all ${this.entries.length} entries`
            }
        ];

        SEVERITY_ORDER.forEach((level) => {
            const meta = severityMeta(level);
            const count = counts[meta.label] || 0;
            if (count === 0) {
                return;
            }
            const selected = this.levelFilter === level;
            chips.push({
                key: level,
                level,
                isAll: false,
                label: meta.label,
                count,
                selected,
                ariaPressed: selected ? 'true' : 'false',
                chipClass: `ll-chip ll-chip_${meta.key}${selected ? ' ll-chip_selected' : ''}`,
                ariaLabel: `Show only the ${count} ${meta.label} entries`
            });
        });

        return chips;
    }

    get showChips() {
        return !this.showSkeleton && !this.error && this.entries.length > 0;
    }

    get showSearch() {
        return this.entries.length > 5;
    }

    get errorCount() {
        return this.countsByLevel.ERROR || 0;
    }

    get headerBadge() {
        if (this.showSkeleton) {
            return '';
        }
        return String(this.entries.length);
    }

    get headerDescription() {
        if (this.showSkeleton) {
            return 'Loading entries captured against this record…';
        }
        if (this.error) {
            return 'Hot-tier entries captured against this record.';
        }
        if (this.entries.length === 0) {
            return 'Hot-tier entries captured against this record.';
        }
        if (this.errorCount > 0) {
            const noun = this.errorCount === 1 ? 'error' : 'errors';
            return `${this.errorCount} ${noun} among ${this.entries.length} hot-tier entries for this record.`;
        }
        return `${this.entries.length} hot-tier entries for this record, no errors.`;
    }

    get hasErrors() {
        return this.errorCount > 0;
    }

    get statusPillClass() {
        return `ll-status ll-status_${this.hasErrors ? 'error' : 'ok'}`;
    }

    get statusPillIcon() {
        return this.hasErrors ? 'utility:error' : 'utility:success';
    }

    get statusPillLabel() {
        if (this.hasErrors) {
            return this.errorCount === 1 ? '1 error' : `${this.errorCount} errors`;
        }
        return 'No errors';
    }

    get showStatusPill() {
        return !this.showSkeleton && !this.error && this.entries.length > 0;
    }

    // ------------------------------------------------------------------ filtering

    get filteredEntries() {
        let rows = this.entries;
        if (this.levelFilter !== 'ALL') {
            const label = severityMeta(this.levelFilter).label;
            rows = rows.filter((row) => row.level === label);
        }
        if (this.transactionFilter) {
            rows = rows.filter((row) => row.transactionId === this.transactionFilter);
        }
        if (this.searchTerm) {
            rows = rows.filter((row) => row.searchBlob.includes(this.searchTerm));
        }
        return rows;
    }

    get transactionPillLabel() {
        const id = this.transactionFilter;
        return `Transaction: ${id.length > 12 ? `${id.slice(0, 12)}…` : id}`;
    }

    handleChipClick(event) {
        const level = event.currentTarget.dataset.level;
        this.levelFilter = this.levelFilter === level ? 'ALL' : level;
    }

    handleSearch(event) {
        const value = event.target.value;
        clearTimeout(this.searchTimeout);
        // Debounced; the timer is always cleared in disconnectedCallback.
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this.searchTimeout = setTimeout(() => {
            this.searchTerm = value ? value.trim().toLowerCase() : '';
        }, SEARCH_DEBOUNCE_MS);
    }

    handleTransactionFilter(event) {
        this.transactionFilter = event.detail.transactionId || '';
    }

    handleClearTransaction() {
        this.transactionFilter = '';
    }

    handleClearFilters() {
        this.levelFilter = 'ALL';
        this.transactionFilter = '';
        this.searchTerm = '';
        const input = this.template.querySelector('lightning-input[data-id="search"]');
        if (input) {
            input.value = '';
        }
    }

    // ------------------------------------------------------------------ view state

    get hasEntries() {
        return this.filteredEntries.length > 0;
    }

    /** Skeleton only before the first result; a refresh keeps rows in place. */
    get showSkeleton() {
        return this.loading && !this.loaded;
    }

    get showStream() {
        return this.showSkeleton || (!this.error && this.hasEntries);
    }

    get showEmptyState() {
        return !this.showSkeleton && !this.error && !this.hasEntries;
    }

    get emptyIsFiltered() {
        return this.entries.length > 0;
    }

    get emptyHeading() {
        return this.emptyIsFiltered ? 'No entries match these filters' : 'No log entries for this record';
    }

    get emptyMessage() {
        return this.emptyIsFiltered
            ? 'Clear the filters to see every entry captured against this record.'
            : 'Nothing has been logged against this record. Entries appear here when Apex passes the record id to Logger.';
    }

    get emptyHint() {
        return this.emptyIsFiltered ? undefined : "Logger.error('Payment failed', recordId);";
    }

    get emptyIcon() {
        return this.emptyIsFiltered ? 'utility:filterList' : 'utility:success';
    }

    get emptyTone() {
        return this.emptyIsFiltered ? 'neutral' : 'positive';
    }

    get emptyActionLabel() {
        return this.emptyIsFiltered ? 'Clear filters' : undefined;
    }

    handleEmptyAction() {
        if (this.emptyIsFiltered) {
            this.handleClearFilters();
        }
    }

    get isCapped() {
        return this.entries.length >= SERVER_CAP;
    }

    get refreshTitle() {
        return this.refreshing ? 'Refreshing entries…' : 'Refresh entries';
    }

    get skeletonRows() {
        return 4;
    }

    // ------------------------------------------------------------------ refresh

    async handleRefresh() {
        if (this.refreshing) {
            return;
        }
        this.refreshing = true;
        this.loading = true;
        try {
            await refreshApex(this.wiredResult);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('LiteLogger: refresh failed', error);
            const described = describeError(error, 'The entries could not be refreshed.');
            this.dispatchEvent(
                new ShowToastEvent({ title: 'Refresh failed', message: described.message, variant: 'error' })
            );
        } finally {
            this.refreshing = false;
            this.loading = false;
        }
    }

    handleRetry() {
        this.handleRefresh();
    }

    handleNotify(event) {
        const { variant, title, message } = event.detail;
        this.dispatchEvent(new ShowToastEvent({ title, message, variant, mode: 'dismissable' }));
    }
}
