import { LightningElement, api } from 'lwc';

/**
 * Intentional empty state for LiteLogger surfaces.
 *
 * `tone="positive"` matters for a logger: "no errors" is a *good* outcome and must
 * not be styled like a broken or missing panel.
 */
export default class LiteLoggerEmptyState extends LightningElement {
    @api iconName = 'utility:info';
    @api heading = 'Nothing to show';
    @api message;
    /** Optional monospace hint, e.g. the Apex snippet that produces log entries. */
    @api hint;
    @api actionLabel;
    @api actionIcon;
    @api secondaryActionLabel;
    /** 'positive' (healthy silence) | 'neutral' (filtered out) | 'accent' */
    @api tone = 'neutral';
    /** Tighter padding for record-page and in-panel use. */
    @api compact = false;

    get containerClass() {
        return `ll-empty ll-empty_${this.tone}${this.compact ? ' ll-empty_compact' : ''}`;
    }

    get iconWrapClass() {
        return `ll-empty__icon ll-empty__icon_${this.tone}`;
    }

    get hasActions() {
        return Boolean(this.actionLabel || this.secondaryActionLabel);
    }

    handleAction() {
        this.dispatchEvent(new CustomEvent('action'));
    }

    handleSecondaryAction() {
        this.dispatchEvent(new CustomEvent('secondaryaction'));
    }
}
