// Shared in-memory store for active supervision sessions.
// Keys: userId (string) → { since: ISO string }
// Imported by both the controller and injectCompany middleware.
const activeSupervisions = new Map();
module.exports = { activeSupervisions };
