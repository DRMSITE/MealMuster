// @ts-check
/**
 * Firestore implementation of the repository interface (see memory-repo.js).
 * Only server code uses this (Admin SDK); client access is denied by rules.
 *
 * Layout:
 *   events/{eventId}, menus/{menuId}, venues/{venueId}, invitations/{invitationId}
 *   events/{eventId}/bookings/{invitationId}
 *   auditEvents/{autoId}
 *   memberships/{organisationId}_{userId}
 */

/** @param {import("firebase-admin/firestore").Firestore} db */
export function createFirestoreRepo(db) {
  /** @param {string} collection @param {string} id */
  const get = async (collection, id) => {
    const snap = await db.collection(collection).doc(id).get();
    return snap.exists
      ? /** @type {any} */ ({ id: snap.id, ...snap.data() })
      : null;
  };

  /** @param {import("firebase-admin/firestore").Query} query */
  const list = async (query) =>
    (await query.get()).docs.map(
      (d) => /** @type {any} */ ({ id: d.id, ...d.data() }),
    );

  return {
    /** @param {string} userId */
    getMemberships: (userId) =>
      list(db.collection("memberships").where("userId", "==", userId)),
    /** @param {string} organisationId */
    listEvents: (organisationId) =>
      list(
        db.collection("events").where("organisationId", "==", organisationId),
      ),
    /** @param {string} id @param {Record<string, unknown>} patch */
    async updateEvent(id, patch) {
      await db
        .collection("events")
        .doc(id)
        .set(JSON.parse(JSON.stringify(patch)), { merge: true });
    },
    /** @param {string} eventId */
    listInvitations: (eventId) =>
      list(db.collection("invitations").where("eventId", "==", eventId)),
    /** @param {{ id: string }} invitation */
    async createInvitation(invitation) {
      const { id, ...data } = invitation;
      await db
        .collection("invitations")
        .doc(id)
        .set(JSON.parse(JSON.stringify(data)));
    },
    /** @param {string} eventId */
    listBookings: (eventId) =>
      list(db.collection("events").doc(eventId).collection("bookings")),
    /** @param {string} entityId */
    async listAudit(entityId) {
      const entries = await list(
        db.collection("auditEvents").where("entityId", "==", entityId),
      );
      return entries.toSorted((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)),
      );
    },
    /** Removes an event's invitations and bookings (its personal data). @param {string} eventId */
    async deleteEventPrivateData(eventId) {
      const bookings = await db
        .collection("events")
        .doc(eventId)
        .collection("bookings")
        .get();
      const invitations = await db
        .collection("invitations")
        .where("eventId", "==", eventId)
        .get();
      const writer = db.bulkWriter();
      for (const doc of [...bookings.docs, ...invitations.docs])
        void writer.delete(doc.ref);
      await writer.close();
      return { bookings: bookings.size, invitations: invitations.size };
    },
    /** @param {string} tokenHash */
    async findInvitationByTokenHash(tokenHash) {
      const snap = await db
        .collection("invitations")
        .where("tokenHash", "==", tokenHash)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      return doc ? /** @type {any} */ ({ id: doc.id, ...doc.data() }) : null;
    },
    /** @param {string} id */
    getInvitation: (id) => get("invitations", id),
    /** @param {string} id @param {Record<string, unknown>} patch */
    async updateInvitation(id, patch) {
      await db.collection("invitations").doc(id).set(patch, { merge: true });
    },
    /** @param {string} id */
    getEvent: (id) => get("events", id),
    /** @param {string} id */
    getMenu: (id) => get("menus", id),
    /** @param {{ id: string }} menu */
    async updateMenu(menu) {
      const { id, ...data } = menu;
      await db
        .collection("menus")
        .doc(id)
        .set(JSON.parse(JSON.stringify(data)));
    },
    /** @param {string} id */
    getVenue: (id) => get("venues", id),
    /**
     * Bookings live under their event; the invitation id is the document id,
     * so a session can only ever address its own booking.
     * @param {string} invitationId
     * @param {string} [eventId]
     */
    async getBooking(invitationId, eventId) {
      const invitation = await get("invitations", invitationId);
      const event = eventId ?? invitation?.eventId;
      if (!event) return null;
      const snap = await db
        .collection("events")
        .doc(event)
        .collection("bookings")
        .doc(invitationId)
        .get();
      return snap.exists
        ? /** @type {any} */ ({ id: snap.id, ...snap.data() })
        : null;
    },
    /**
     * Transactional compare-and-set on version, with an event-wide capacity check.
     * @param {any} next @param {number} expectedVersion @param {number | undefined} capacity
     * @returns {Promise<{ ok: true, booking: any } | { ok: false, reason: "version_conflict" | "capacity_reached" }>}
     */
    async saveBooking(next, expectedVersion, capacity) {
      const bookings = db
        .collection("events")
        .doc(next.eventId)
        .collection("bookings");
      const ref = bookings.doc(next.invitationId);
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if ((current.exists ? current.data()?.version : 0) !== expectedVersion)
          return {
            ok: /** @type {const} */ (false),
            reason: /** @type {const} */ ("version_conflict"),
          };
        if (capacity !== undefined && next.attendance === "yes") {
          const all = await tx.get(bookings.where("attendance", "==", "yes"));
          const others = all.docs
            .filter((d) => d.id !== next.invitationId)
            .reduce((n, d) => n + (d.data().diners?.length ?? 0), 0);
          if (others + next.diners.length > capacity)
            return {
              ok: /** @type {const} */ (false),
              reason: /** @type {const} */ ("capacity_reached"),
            };
        }
        const saved = JSON.parse(
          JSON.stringify({ ...next, version: expectedVersion + 1 }),
        ); // drops undefined
        tx.set(ref, saved);
        return { ok: /** @type {const} */ (true), booking: saved };
      });
    },
    /** @param {Record<string, unknown>} entry */
    async addAudit(entry) {
      await db.collection("auditEvents").add(JSON.parse(JSON.stringify(entry)));
    },
  };
}
