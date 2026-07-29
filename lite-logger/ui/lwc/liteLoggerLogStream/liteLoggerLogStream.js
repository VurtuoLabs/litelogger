import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

const DEFAULT_PAGE_SIZE = 25;

/**
 * The LiteLogger log stream: a scannable severity-gutter list, not a record table.
 *
 * Why this is custom rather than `lightning-datatable`:
 *  - a fixed severity gutter (colour + shape) must run the full height of every row,
 *    which a datatable cell cannot express;
 *  - each row expands in place to show the full message, exception type, transaction
 *    id and tags - datatable has no row-detail region;
 *  - on small screens the row has to reflow into a stacked card; datatable only
 *    scrolls horizontally, which is unusable for long log messages.
 * Everything else (sorting, paging, hover/selected states, keyboard traversal,
 * row action menus) is implemented here so callers stay thin.
 *
 * Performance: only `pageSize` rows are ever in the DOM, and a single row's detail
 * region at a time, so a full 200-row hot-tier page renders 25 rows.
 */
export default class LiteLoggerLogStream extends NavigationMixin(LightningElement) {
    /** Rows produced by `normalizeEntries` in c/liteLoggerLogUtils, already filtered. */
    @api
    get entries() {
        return this._entries;
    }
    set entries(value) {
        this._entries = Array.isArray(value) ? value : [];
        // A new result set (refresh, filter, search) always starts at page 1 with
        // nothing expanded, so the viewport is never scrolled to a stale row.
        this._page = 0;
        this._expandedId = undefined;
    }

    @api loading = false;
    @api pageSize = DEFAULT_PAGE_SIZE;
    /** Record-page variant: tighter rows, no user column. */
    @api dense = false;
    /** Number of skeleton rows to draw while loading. */
    @api skeletonRows = 6;

    _entries = [];
    _page = 0;
    _expandedId;

    sortBy = 'time';
    sortDir = 'desc';

    // ---------------------------------------------------------------- layout

    get rootClass() {
        return `ll-stream-root${this.dense ? ' ll-stream-root_dense' : ''}`;
    }

    // ---------------------------------------------------------------- sorting

    get sortedRows() {
        const rows = [...this._entries];
        const dir = this.sortDir === 'asc' ? 1 : -1;
        const key = this.sortBy;
        rows.sort((a, b) => {
            let delta;
            if (key === 'severity') {
                delta = a.severityOrdinal - b.severityOrdinal || b.timeValue - a.timeValue;
                // Severity ascending means "most severe first", which is what operators expect.
                return dir === 1 ? delta : -delta;
            }
            delta = a.timeValue - b.timeValue;
            return delta * dir;
        });
        return rows;
    }

    get timeSortIcon() {
        if (this.sortBy !== 'time') {
            return 'utility:sort';
        }
        return this.sortDir === 'desc' ? 'utility:arrowdown' : 'utility:arrowup';
    }

    get severitySortIcon() {
        if (this.sortBy !== 'severity') {
            return 'utility:sort';
        }
        return this.sortDir === 'desc' ? 'utility:arrowdown' : 'utility:arrowup';
    }

    get timeSortLabel() {
        if (this.sortBy !== 'time') {
            return 'Time, not sorted. Activate to sort newest first.';
        }
        return this.sortDir === 'desc'
            ? 'Time, sorted newest first. Activate to sort oldest first.'
            : 'Time, sorted oldest first. Activate to sort newest first.';
    }

    get severitySortLabel() {
        if (this.sortBy !== 'severity') {
            return 'Level, not sorted. Activate to sort most severe first.';
        }
        return this.sortDir === 'desc'
            ? 'Level, sorted least severe first. Activate to sort most severe first.'
            : 'Level, sorted most severe first. Activate to sort least severe first.';
    }

    handleSort(event) {
        const next = event.currentTarget.dataset.sort;
        if (this.sortBy === next) {
            this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            this.sortBy = next;
            this.sortDir = next === 'severity' ? 'asc' : 'desc';
        }
        this._page = 0;
    }

    // ---------------------------------------------------------------- paging

    get total() {
        return this._entries.length;
    }

    get entryNoun() {
        return this.total === 1 ? 'entry' : 'entries';
    }

    get effectivePageSize() {
        const size = Number(this.pageSize);
        return size > 0 ? size : DEFAULT_PAGE_SIZE;
    }

    get pageCount() {
        return Math.max(1, Math.ceil(this.total / this.effectivePageSize));
    }

    get pageNumber() {
        return Math.min(this._page, this.pageCount - 1) + 1;
    }

    get rangeStart() {
        return this.total === 0 ? 0 : (this.pageNumber - 1) * this.effectivePageSize + 1;
    }

    get rangeEnd() {
        return Math.min(this.pageNumber * this.effectivePageSize, this.total);
    }

    get isFirstPage() {
        return this.pageNumber <= 1;
    }

    get isLastPage() {
        return this.pageNumber >= this.pageCount;
    }

    get showPager() {
        return this.total > this.effectivePageSize;
    }

    handlePrev() {
        if (!this.isFirstPage) {
            this._page = this.pageNumber - 2;
            this._expandedId = undefined;
        }
    }

    handleNext() {
        if (!this.isLastPage) {
            this._page = this.pageNumber;
            this._expandedId = undefined;
        }
    }

    // ---------------------------------------------------------------- rows

    get visibleRows() {
        const start = (this.pageNumber - 1) * this.effectivePageSize;
        return this.sortedRows.slice(start, start + this.effectivePageSize).map((row) => {
            const isExpanded = row.id === this._expandedId;
            return {
                ...row,
                isExpanded,
                ariaExpanded: isExpanded ? 'true' : 'false',
                detailId: `ll-detail-${row.id}`,
                itemClass: `ll-item ll-item_${row.severityKey}${isExpanded ? ' ll-item_expanded' : ''}`,
                gutterClass: `ll-gutter ll-gutter_${row.severityKey} ll-gutter_${row.severityShape}`,
                toggleActionLabel: isExpanded ? 'Collapse details' : 'Expand details',
                hasTags: row.tags && row.tags.length > 0,
                ariaLabel: this.buildAriaLabel(row, isExpanded)
            };
        });
    }

    buildAriaLabel(row, isExpanded) {
        const when = row.timeValue ? new Date(row.timeValue).toLocaleString() : 'unknown time';
        const message = row.message.length > 140 ? `${row.message.slice(0, 139)}…` : row.message;
        return `${row.level} at ${when}. ${message}. ${isExpanded ? 'Collapse' : 'Expand'} details.`;
    }

    handleRowClick(event) {
        this.toggleRow(event.currentTarget.dataset.id);
    }

    toggleRow(id) {
        this._expandedId = this._expandedId === id ? undefined : id;
    }

    /** Up/Down arrows walk the stream without leaving the keyboard. */
    handleKeyDown(event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        const rows = [...this.template.querySelectorAll('button.ll-row')];
        if (rows.length === 0) {
            return;
        }
        const current = rows.indexOf(this.template.activeElement);
        if (current === -1) {
            return;
        }
        event.preventDefault();
        const nextIndex = event.key === 'ArrowDown' ? current + 1 : current - 1;
        if (nextIndex >= 0 && nextIndex < rows.length) {
            rows[nextIndex].focus();
        }
    }

    // ---------------------------------------------------------------- actions

    findRow(id) {
        return this._entries.find((row) => row.id === id);
    }

    handleMenuSelect(event) {
        const id = event.currentTarget.dataset.id;
        const row = this.findRow(id);
        if (!row) {
            return;
        }
        switch (event.detail.value) {
            case 'toggle':
                this.toggleRow(id);
                break;
            case 'open':
                this.openRecord(row);
                break;
            case 'transaction':
                this.emitTransactionFilter(row);
                break;
            case 'copy':
                this.copyDiagnostics(row);
                break;
            default:
                break;
        }
    }

    handleOpenRecord(event) {
        const row = this.findRow(event.currentTarget.dataset.id);
        if (row) {
            this.openRecord(row);
        }
    }

    handleFilterTransaction(event) {
        const row = this.findRow(event.currentTarget.dataset.id);
        if (row) {
            this.emitTransactionFilter(row);
        }
    }

    handleCopy(event) {
        const row = this.findRow(event.currentTarget.dataset.id);
        if (row) {
            this.copyDiagnostics(row);
        }
    }

    openRecord(row) {
        if (!row.recordId) {
            return;
        }
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: row.recordId, actionName: 'view' }
        });
    }

    emitTransactionFilter(row) {
        this.dispatchEvent(
            new CustomEvent('transactionfilter', {
                detail: { transactionId: row.transactionId }
            })
        );
    }

    async copyDiagnostics(row) {
        const lines = [
            `Level:       ${row.level}`,
            `Timestamp:   ${row.timestamp || ''}`,
            `Origin:      ${row.origin || '-'}`,
            `Logged by:   ${row.loggedBy || '-'}`,
            `Scenario:    ${row.scenario || '-'}`,
            `Exception:   ${row.exceptionType || '-'}`,
            `Transaction: ${row.transactionId || '-'}`,
            `Record:      ${row.recordId || '-'}`,
            `Tags:        ${row.tags && row.tags.length ? row.tags.join(', ') : '-'}`,
            '',
            row.message
        ].join('\n');

        try {
            await navigator.clipboard.writeText(lines);
            this.notify('success', 'Diagnostics copied', 'The entry details are on your clipboard.');
        } catch (error) {
            // Clipboard access can be blocked by the browser or unavailable on mobile.
            // eslint-disable-next-line no-console
            console.error('LiteLogger: clipboard write failed', error);
            this.notify(
                'warning',
                'Could not copy automatically',
                'Your browser blocked clipboard access. Expand the entry and select the message to copy it manually.'
            );
        }
    }

    notify(variant, title, message) {
        this.dispatchEvent(
            new CustomEvent('notify', {
                detail: { variant, title, message }
            })
        );
    }
}
