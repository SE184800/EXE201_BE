const { getStoreProfile } = require('./storeService');

// Known landmark / market coordinates for warehouses and districts in Ho Chi Minh City
const KNOWN_COORDINATES = [
  { match: /tan binh|ly thuong kiet/i, lat: 10.7765, lon: 106.6578 },
  { match: /binh tan|binh tri dong/i, lat: 10.7626, lon: 106.6025 },
  { match: /thu duc|cho dau moi thu duc/i, lat: 10.8712, lon: 106.7490 },
  { match: /hoc mon|cho dau moi hoc mon/i, lat: 10.8878, lon: 106.5925 },
  { match: /binh dien|quan 8/i, lat: 10.6975, lon: 106.6342 },
  { match: /quan 5|cho lon|kim bien/i, lat: 10.7538, lon: 106.6560 },
  { match: /quan 12|an phu dong/i, lat: 10.8672, lon: 106.6413 },
  { match: /quan 1|ben thanh/i, lat: 10.7725, lon: 106.6980 },
  { match: /go vap/i, lat: 10.8385, lon: 106.6653 },
  { match: /tan phu/i, lat: 10.7925, lon: 106.6280 },
  { match: /binh thanh/i, lat: 10.8106, lon: 106.7091 },
];

function resolveAddressCoordinates(addressText) {
  if (!addressText || typeof addressText !== 'string') return null;
  const match = KNOWN_COORDINATES.find((item) => item.match.test(addressText));
  if (match) return { lat: match.lat, lon: match.lon };
  return null;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function calculateFeeForOrder({ buyerId, supplier, deliveryAddress }) {
  const storeProfile = getStoreProfile(buyerId);

  // 1. Determine store coordinates
  let storeLat = storeProfile?.latitude;
  let storeLon = storeProfile?.longitude;
  if (!storeLat || !storeLon) {
    const resolved = resolveAddressCoordinates(deliveryAddress || storeProfile?.storeAddress);
    if (resolved) {
      storeLat = resolved.lat;
      storeLon = resolved.lon;
    } else {
      // Default fallback coordinates in HCM center
      storeLat = 10.7626;
      storeLon = 106.6601;
    }
  }

  // 2. Determine supplier warehouse coordinates
  const warehouseAddr = supplier?.warehouseAddress || '';
  const resolvedWarehouse = resolveAddressCoordinates(warehouseAddr);
  const supplierLat = resolvedWarehouse ? resolvedWarehouse.lat : 10.7765; // Tan Binh warehouse
  const supplierLon = resolvedWarehouse ? resolvedWarehouse.lon : 10.6578;

  // 3. Distance calculation
  const distanceKm = haversineDistanceKm(storeLat, storeLon, supplierLat, supplierLon);

  // 4. Delivery pricing model
  // Base fee: first 3 km = 15,000 d (or supplier base fee if configured > 0)
  const supplierConfiguredFee = supplier?.deliveryFee
    ? Number(typeof supplier.deliveryFee.toNumber === 'function' ? supplier.deliveryFee.toNumber() : supplier.deliveryFee)
    : 0;
  const baseFee = supplierConfiguredFee > 0 ? supplierConfiguredFee : 15000;
  const baseKm = 3.0;

  // Extra km fee: 5,000 d / km for distance beyond baseKm
  const extraKm = Math.max(0, distanceKm - baseKm);
  const distanceExtraFee = Math.round(extraKm * 5000);

  // Alley surcharge: +5,000 d if location is inside an alley (requires bike / ba gác transshipment)
  const isAlley = storeProfile?.locationType === 'ALLEY';
  const alleySurcharge = isAlley ? 5000 : 0;

  const totalCalculated = baseFee + distanceExtraFee + alleySurcharge;
  const deliveryFee = Math.round(totalCalculated / 1000) * 1000;

  const supplierRadiusKm = supplier?.deliveryRadiusKm
    ? Number(typeof supplier.deliveryRadiusKm.toNumber === 'function' ? supplier.deliveryRadiusKm.toNumber() : supplier.deliveryRadiusKm)
    : 35.0;

  const exceedsRadius = distanceKm > supplierRadiusKm;

  return {
    distanceKm,
    deliveryFee,
    baseFee,
    distanceExtraFee,
    alleySurcharge,
    isAlley,
    supplierRadiusKm,
    exceedsRadius,
  };
}

module.exports = {
  haversineDistanceKm,
  resolveAddressCoordinates,
  calculateFeeForOrder,
};
