// @ts-check
/**
 * Domain types (JSDoc). IDs, never names, are used for references. Money is
 * integer minor units.
 *
 * @typedef {{ id: string, title: string, description?: string, priceModifierMinor?: number }} OptionChoice
 * @typedef {{ id: string, title: string, min: number, max: number, choices: OptionChoice[] }} ItemOptionGroup
 * @typedef {{ id: string, name: string, description?: string, priceMinor?: number, printedPriceMinor?: number, tags: string[], allergenInfoStatus: "unverified"|"venue_confirmed", available: boolean, sortOrder: number, verification?: string, optionGroups?: ItemOptionGroup[] }} MenuItem
 * @typedef {{ id: string, name: string, order: number, sectionType: "course"|"category"|"addon", items: MenuItem[] }} MenuSection
 * @typedef {{ id: string, organisationId: string, title: string, source?: string, status: "draft"|"approved"|"archived", currency: string, importWarning?: string, sections: MenuSection[], approvedAt?: string, approvedBy?: string }} Menu
 * @typedef {{ sectionId?: string, minSelections: number, maxSelections: number, required: boolean, perDiner: boolean }} MenuRule
 * @typedef {"set_meal"|"a_la_carte"|"rsvp_only"} OrderingMode
 * @typedef {{ id: string, organisationId: string, title: string, status: "draft"|"open"|"closed", orderingMode: OrderingMode, currency: string, menuId?: string, description?: string, startAt?: string, timezone?: string, venueId?: string, instructions?: string, organiserContact?: string, retentionDays?: number, privateDataDeletedAt?: string, rsvpDeadline?: string, orderDeadline?: string, capacity?: number, guestLimit?: number, allowContactNotAttending: boolean, showPrices: boolean, fixedPricePerPersonMinor?: number, rules: MenuRule[] }} EventConfig
 * @typedef {{ menuItemId: string, optionIds?: string[], quantity: number, notes?: string }} Selection
 * @typedef {{ id: string, name: string, isContact: boolean, dietaryNotes?: string, selections: Selection[] }} Diner
 * @typedef {{ attendance: "yes"|"no"|"undecided", contactName: string, partyNotes?: string, diners: Diner[] }} BookingInput
 */
export {};
