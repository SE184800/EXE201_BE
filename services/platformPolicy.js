function activeAccountWhere(now = new Date()) {
  return { isActive: true, OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: now } }] };
}
function accountAvailable(user, now = new Date()) {
  return user && user.isActive && (!user.suspendedUntil || user.suspendedUntil <= now);
}
function visibleSupplierWhere() {
  return { verificationStatus: 'APPROVED', user: { ...activeAccountWhere(), role: { code: 'SUPPLIER' } } };
}
function audit(tx, actorId, action, entityType, entityId, details = {}) {
  return tx.auditLog.create({ data: { actorId, action, entityType, entityId: String(entityId), details: JSON.stringify(details) } });
}
const problem = (status, message) => Object.assign(new Error(message), { status });
function httpsDocument(value) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && value.length <= 1000 && url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
function verificationComplete(profile) {
  return profile.region && profile.taxCode && profile.legalRepresentative && httpsDocument(profile.verificationDocumentUrl);
}
module.exports = { activeAccountWhere, accountAvailable, visibleSupplierWhere, audit, problem, httpsDocument, verificationComplete };
