import { LightningElement, api } from 'lwc';

/**
 * Persistent, human-readable error panel with the raw diagnostics kept one click away.
 *
 * Toasts disappear; a failed data load must stay visible, so this renders inline and
 * always offers a retry when retrying is meaningful.
 */
export default class LiteLoggerErrorState extends LightningElement {
    @api heading = 'Could not load data';
    @api message = 'Something went wrong while talking to Salesforce.';
    /** Raw Apex/JS error text: hidden by default, expandable for developers. */
    @api detail;
    @api retryLabel = 'Retry';
    /** Undefined means the retry button shows; public booleans must default to false. */
    @api showRetry;
    /** True while the parent's retry is in flight; swaps the label and disables the button. */
    @api retrying = false;
    @api compact = false;

    detailExpanded = false;

    /** Attributes set in markup arrive as strings, so "false" must stay false. */
    get retryVisible() {
        return this.showRetry !== false && this.showRetry !== 'false';
    }

    get containerClass() {
        return `ll-error${this.compact ? ' ll-error_compact' : ''}`;
    }

    get retryButtonLabel() {
        return this.retrying ? 'Retrying…' : this.retryLabel;
    }

    get detailToggleLabel() {
        return this.detailExpanded ? 'Hide technical details' : 'Show technical details';
    }

    get detailIcon() {
        return this.detailExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get detailExpandedAttr() {
        return this.detailExpanded ? 'true' : 'false';
    }

    toggleDetail() {
        this.detailExpanded = !this.detailExpanded;
    }

    handleRetry() {
        this.dispatchEvent(new CustomEvent('retry'));
    }
}
