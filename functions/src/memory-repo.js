// @ts-check
/**
 * In-memory repository used by unit tests and demos. The Firestore
 * implementation (firestore-repo.js) provides the same interface.
 *
 * @typedef {import("./shared/types.js").EventConfig} EventConfig
 * @typedef {import("./shared/types.js").Menu} Menu
 * @typedef {{ id: string, eventId: string, displayName?: string, status: string, tokenHash: string, tokenExpiry?: string, revokedAt?: string | null, issuedAt: string, lastUsedAt?: string }} Invitation
 * @typedef {{ id: string, eventId: string, invitationId: string, attendance: string, contactName: string, partyNotes?: string, diners: any[], status: "draft"|"submitted", confirmationId?: string, submittedAt?: string, updatedAt: string, version: number }} Booking
 * @typedef {{ id: string, name: string, address?: string }} Venue
 * @typedef {{ userId: string, organisationId: string, role: "owner"|"organiser" }} Membership
 */

/**
 * @param {{ events?: EventConfig[], menus?: Menu[], invitations?: Invitation[], venues?: (Venue & {id: string})[], memberships?: Membership[] }} seed
 */
export function createMemoryRepo(seed = {}) {
  const events = new Map(
    (seed.events ?? []).map((e) => [e.id, structuredClone(e)]),
  );
  const menus = new Map(
    (seed.menus ?? []).map((m) => [m.id, structuredClone(m)]),
  );
  const invitations = new Map(
    (seed.invitations ?? []).map((i) => [i.id, structuredClone(i)]),
  );
  const memberships = structuredClone(seed.memberships ?? []);
  const venues = new Map((seed.venues ?? []).map((v) => [v.id, v]));
  /** @type {Map<string, Booking>} keyed by invitation id */
  const bookings = new Map();
  /** @type {any[]} */
  const audit = [];

  return {
    audit,
    bookings,
    /** @param {string} tokenHash */
    async findInvitationByTokenHash(tokenHash) {
      return (
        [...invitations.values()].find((i) => i.tokenHash === tokenHash) ?? null
      );
    },
    /** @param {string} id */
    async getInvitation(id) {
      return invitations.get(id) ?? null;
    },
    /** @param {string} id @param {Partial<Invitation>} patch */
    async updateInvitation(id, patch) {
      const current = invitations.get(id);
      if (current) invitations.set(id, { ...current, ...patch });
    },
    /** @param {string} id */
    async getEvent(id) {
      return events.get(id) ?? null;
    },
    /** @param {string} id */
    async getMenu(id) {
      return menus.get(id) ?? null;
    },
    /** @param {Menu} menu */
    async updateMenu(menu) {
      menus.set(menu.id, structuredClone(menu));
    },
    /** @param {string} id */
    async getVenue(id) {
      return venues.get(id) ?? null;
    },
    /** @param {string} invitationId @param {string} [_eventId] */
    async getBooking(invitationId, _eventId) {
      return bookings.get(invitationId) ?? null;
    },
    /**
     * Atomic compare-and-set on the booking version, with a capacity check.
     * @param {Booking} next @param {number} expectedVersion @param {number | undefined} capacity
     * @returns {Promise<{ ok: true, booking: Booking } | { ok: false, reason: "version_conflict" | "capacity_reached" }>}
     */
    async saveBooking(next, expectedVersion, capacity) {
      const current = bookings.get(next.invitationId);
      if ((current?.version ?? 0) !== expectedVersion)
        return { ok: false, reason: "version_conflict" };
      if (capacity !== undefined && next.attendance === "yes") {
        let others = 0;
        for (const b of bookings.values()) {
          if (
            b.eventId === next.eventId &&
            b.invitationId !== next.invitationId &&
            b.attendance === "yes"
          )
            others += b.diners.length;
        }
        if (others + next.diners.length > capacity)
          return { ok: false, reason: "capacity_reached" };
      }
      const saved = { ...next, version: expectedVersion + 1 };
      bookings.set(next.invitationId, saved);
      return { ok: true, booking: saved };
    },
    /** @param {any} entry */
    async addAudit(entry) {
      audit.push(entry);
    },
    /** @param {string} userId */
    async getMemberships(userId) {
      return memberships.filter((m) => m.userId === userId);
    },
    /** @param {string} organisationId */
    async listEvents(organisationId) {
      return [...events.values()].filter(
        (e) => e.organisationId === organisationId,
      );
    },
    /** @param {string} id @param {Partial<EventConfig>} patch */
    async updateEvent(id, patch) {
      const current = events.get(id);
      if (current) events.set(id, { ...current, ...patch });
    },
    /** @param {string} eventId */
    async listInvitations(eventId) {
      return [...invitations.values()].filter((i) => i.eventId === eventId);
    },
    /** @param {Invitation} invitation */
    async createInvitation(invitation) {
      invitations.set(invitation.id, structuredClone(invitation));
    },
    /** @param {string} eventId */
    async listBookings(eventId) {
      return [...bookings.values()].filter((b) => b.eventId === eventId);
    },
    /** @param {string} entityId */
    async listAudit(entityId) {
      return audit.filter((a) => a.entityId === entityId);
    },
    /** Removes an event's invitations and bookings (its personal data). @param {string} eventId */
    async deleteEventPrivateData(eventId) {
      let removedBookings = 0;
      let removedInvitations = 0;
      for (const [key, b] of bookings)
        if (b.eventId === eventId && bookings.delete(key)) removedBookings += 1;
      for (const [key, i] of invitations)
        if (i.eventId === eventId && invitations.delete(key))
          removedInvitations += 1;
      return { bookings: removedBookings, invitations: removedInvitations };
    },
  };
}
