import { LightningElement, api } from 'lwc';
import { severityMeta } from 'c/liteLoggerLogUtils';

/**
 * Severity pill for the LiteLogger console.
 *
 * Accessibility contract: the level is always stated as text and reinforced with
 * an icon and a distinct gutter shape, so it survives greyscale, colour-blindness
 * and high-contrast themes. Hue is the third signal, never the only one.
 */
export default class LiteLoggerSeverityBadge extends LightningElement {
    /** Raw level string from `LogEntry__c.LoggingLevel__c` (ERROR, WARN, INFO, DEBUG, FINE, FINEST). */
    @api severity;
    /** 'small' (dense rows) | 'medium' (headers, KPI cards). */
    @api size = 'small';
    /** Drops the icon in very tight rows; the text label always stays.
     *  (Public booleans must default to false in LWC, hence the negative name.) */
    @api hideIcon = false;
    /** Optional trailing count, used by the severity legend. */
    @api count;
    /** Use the abbreviated 3-letter label (mobile / gutter chips). */
    @api abbreviated = false;

    get meta() {
        return severityMeta(this.severity);
    }

    /** Attributes set in markup arrive as strings, so "false" must stay false. */
    get shouldShowIcon() {
        return this.hideIcon !== true && this.hideIcon !== 'true';
    }

    get isAbbreviated() {
        return this.abbreviated === true || this.abbreviated === 'true';
    }

    get displayLabel() {
        return this.isAbbreviated ? this.meta.short : this.meta.label;
    }

    get iconName() {
        return this.meta.icon;
    }

    get title() {
        return `${this.meta.label} - ${this.meta.description}`;
    }

    get hasCount() {
        return this.count !== undefined && this.count !== null && this.count !== '';
    }

    get badgeClass() {
        return `ll-badge ll-badge_${this.meta.key} ll-badge_${this.size === 'medium' ? 'medium' : 'small'}`;
    }

    get shapeClass() {
        return `ll-badge__shape ll-badge__shape_${this.meta.shape}`;
    }
}
