import { LightningElement, api } from 'lwc';

/**
 * Dense section header: eyebrow, semantic heading, one-line description and an
 * actions slot. Optionally becomes the accordion trigger for the section body
 * (button inside the heading, per the SLDS accordion pattern).
 */
export default class LiteLoggerSectionHeader extends LightningElement {
    @api eyebrow;
    @api heading;
    @api description;
    /** 2 or 3. Keeps the document outline correct wherever the section is nested. */
    @api level = 3;
    @api collapsible = false;
    /** Undefined means expanded; public booleans must default to false in LWC. */
    @api expanded;
    /** id of the region this header controls, for aria-controls. */
    @api controls;
    /** Adds a hairline rule under the header. */
    @api divided = false;

    get isLevel2() {
        return Number(this.level) === 2;
    }

    get isExpanded() {
        return this.expanded === undefined ? true : this.expanded !== false && this.expanded !== 'false';
    }

    get expandedAttr() {
        return this.isExpanded ? 'true' : 'false';
    }

    get toggleIcon() {
        return this.isExpanded ? 'utility:chevrondown' : 'utility:chevronright';
    }

    get containerClass() {
        return `ll-sec${this.divided ? ' ll-sec_divided' : ''}`;
    }

    handleToggle() {
        this.dispatchEvent(new CustomEvent('toggle', { detail: { expanded: !this.isExpanded } }));
    }
}
