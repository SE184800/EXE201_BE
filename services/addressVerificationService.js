const dns = require('node:dns');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const PROVINCE_ALIASES = {
  tphcm: 'ho chi minh',
  'tp hcm': 'ho chi minh',
  hcm: 'ho chi minh',
  'sai gon': 'ho chi minh',
  saigon: 'ho chi minh',
  hn: 'ha noi',
  tphn: 'ha noi',
  'tp hn': 'ha noi',
  dn: 'da nang',
  'tp dn': 'da nang',
  ct: 'can tho',
  'tp ct': 'can tho',
  hp: 'hai phong',
  'tp hp': 'hai phong',
  brvt: 'ba ria vung tau',
  'br vt': 'ba ria vung tau',
};

const STREET_STOP_WORDS = new Set([
  'duong',
  'pho',
  'ngo',
  'hem',
  'ngach',
  'khu',
  'kp',
  'ap',
  'thon',
  'to',
  'lo',
]);

const VN_NUMBERS = {
  mot: '1',
  hai: '2',
  ba: '3',
  bon: '4',
  tu: '4',
  nam: '5',
  sau: '6',
  bay: '7',
  tam: '8',
  chin: '9',
  muoi: '10',
  'muoi mot': '11',
  'muoi hai': '12',
};

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeSpace(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[.,;()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProvinceStem(rawProvince) {
  let clean = normalizeSpace(rawProvince);
  if (!clean) return '';
  if (PROVINCE_ALIASES[clean]) return PROVINCE_ALIASES[clean];
  clean = clean.replace(/^(?:thanh\s+pho|tinh|tp)\s+/, '').trim();
  if (PROVINCE_ALIASES[clean]) return PROVINCE_ALIASES[clean];
  return clean;
}

function normalizeAdminStem(rawAdmin) {
  let clean = normalizeSpace(rawAdmin)
    .replace(/^(?:quan|huyen|thi\s+xa|thanh\s+pho|tp|phuong|xa|thi\s+tran|tx|q|p|h)\s+/, '')
    .trim();
  if (VN_NUMBERS[clean]) clean = VN_NUMBERS[clean];
  return clean;
}

function extractStreetTokens(streetSegment) {
  let clean = normalizeSpace(streetSegment);
  // Strip house number or lot prefix (e.g. "221", "456/12A", "so nha 15")
  clean = clean
    .replace(/^(?:so\s+nha|so|lo)\s+\d+(?:[\/\-][0-9a-z]+)*(?:\s+[a-z])?\b\s*/i, '')
    .replace(/^\d+(?:[\/\-][0-9a-z]+)*(?:\s+[a-z])?\b\s*/i, '')
    .trim();
  // Strip street type prefix but keep "so X" for numbered streets like "Duong So 4"
  clean = clean.replace(/^(?:duong|pho|ngo|hem|ngach|khu\s+pho|kp|ap|thon|to|dai\s+lo|quoc\s+lo|tinh\s+lo)\s+/, '').trim();
  const rawTokens = clean.split(/[\s\/\-]+/).filter(Boolean);
  return rawTokens.filter((token) => !STREET_STOP_WORDS.has(token) && (token.length >= 2 || /^\d+$/.test(token)));
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseAddress(rawAddress) {
  const trimmed = String(rawAddress || '').replace(/\s+/g, ' ').trim();
  const segments = trimmed
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean);

  if (trimmed.length < 10 || segments.length < 2) {
    return {
      validFormat: false,
      reason: 'Vui lòng nhập đầy đủ địa chỉ theo dạng: Số nhà Tên đường, Phường/Quận, Tỉnh/Thành phố.',
    };
  }

  const streetSegment = segments[0];
  const provinceSegment = segments[segments.length - 1];
  const middleSegments = segments.slice(1, -1);

  const provinceStem = normalizeProvinceStem(provinceSegment);
  const streetTokens = extractStreetTokens(streetSegment);

  if (provinceStem.length < 3 || /^\d+$/.test(provinceStem)) {
    return {
      validFormat: false,
      reason: `Tên Tỉnh/Thành phố "${provinceSegment}" không hợp lệ.`,
    };
  }

  if (streetTokens.length === 0) {
    return {
      validFormat: false,
      reason: 'Vui lòng nhập rõ tên đường/phố trong phần đầu địa chỉ.',
    };
  }

  // Pick district-level segment (prefer explicit Quan/Huyen/Thi xa/TP, else last middle segment)
  const districtSegment =
    [...middleSegments]
      .reverse()
      .find((seg) => /^(?:quận|huyện|thị xã|thành phố|tp\.?|q\.?|h\.?|tx\.?)\s+/i.test(seg)) ||
    middleSegments[middleSegments.length - 1] ||
    '';

  return {
    validFormat: true,
    trimmed,
    segments,
    streetSegment,
    provinceSegment,
    provinceStem,
    middleSegments,
    districtSegment,
    districtStem: districtSegment ? normalizeAdminStem(districtSegment) : '',
    streetTokens,
  };
}

function wordsInText(tokens, text) {
  const hayWords = new Set(normalizeSpace(text).split(/[\s\/\-]+/).filter(Boolean));
  if (tokens.length === 0) return false;
  return tokens.every((tok) => hayWords.has(tok));
}

function adminMatchesCandidate(declaredRaw, declaredStem, adminTexts, fullAddressText) {
  if (!declaredStem) return true;
  const normDeclaredFull = normalizeSpace(declaredRaw);
  const isNumericOnly = /^\d+$/.test(declaredStem);

  for (const raw of adminTexts) {
    if (!raw) continue;
    const rawStem = normalizeAdminStem(raw);
    if (rawStem && rawStem === declaredStem) return true;
    const rawNorm = normalizeSpace(raw);
    if (rawNorm === normDeclaredFull) return true;
  }

  if (!isNumericOnly) {
    const commaParts = String(fullAddressText || '')
      .split(',')
      .map((p) => normalizeAdminStem(p))
      .filter(Boolean);
    if (commaParts.includes(declaredStem)) return true;
  } else {
    const addrNorm = normalizeSpace(fullAddressText);
    const qRegex = new RegExp(`\\b(?:quan|q|phuong|p)\\s+${declaredStem}\\b`);
    if (qRegex.test(addrNorm)) return true;
  }

  return false;
}

async function queryArcGis(query, fetchFn) {
  const url =
    'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
    `?f=json&countryCode=VN&outFields=Addr_type,StName,AddNum,Neighborhood,District,City,Subregion,Region&maxLocations=5&SingleLine=${encodeURIComponent(query)}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5500) });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data.candidates) ? data.candidates : [];
  return list.map((c) => {
    const a = c.attributes || {};
    const addressParts = String(c.address || '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && !/^\d{5,6}$/.test(p));
    const fallbackProvince = addressParts[addressParts.length - 1] || '';
    return {
      source: 'arcgis',
      lat: Number(c.location?.y),
      lon: Number(c.location?.x),
      displayName: c.address || query,
      score: Number(c.score || 0),
      addrType: a.Addr_type || '',
      isStreetLevel: ['PointAddress', 'StreetAddress', 'StreetName', 'StreetInt', 'Subaddress', 'POI'].includes(
        a.Addr_type || ''
      ),
      streetTexts: [a.StName, addressParts[0], c.address].filter(Boolean),
      provinceTexts: [a.Region, fallbackProvince].filter(Boolean),
      adminTexts: [a.City, a.District, a.Subregion, a.Neighborhood].filter(Boolean),
      cityValue: a.City || '',
    };
  });
}

async function queryPhoton(query, fetchFn) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5500) });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];
  return features
    .filter((f) => {
      const cc = f.properties?.countrycode;
      return !cc || String(cc).toUpperCase() === 'VN';
    })
    .map((f) => {
      const p = f.properties || {};
      const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : [];
      const displayParts = [p.housenumber && p.street ? `${p.housenumber} ${p.street}` : null, p.name, p.street, p.locality, p.district, p.city, p.state]
        .filter(Boolean);
      const uniqueDisplay = [...new Set(displayParts)].join(', ');
      return {
        source: 'photon',
        lat: Number(coords[1]),
        lon: Number(coords[0]),
        displayName: uniqueDisplay || query,
        score: 85,
        addrType: p.type || p.osm_key || '',
        isStreetLevel:
          ['street', 'house'].includes(p.type || '') ||
          ['highway', 'building', 'amenity', 'shop', 'office'].includes(p.osm_key || ''),
        streetTexts: [p.street, p.name].filter(Boolean),
        provinceTexts: [p.state, p.city, p.county].filter(Boolean),
        adminTexts: [p.district, p.locality, p.county, p.city].filter(Boolean),
        cityValue: p.district || p.city || '',
      };
    });
}

async function verifyAddressOnline(rawAddress, options = {}) {
  const fetchFn = options.fetchImpl || global.fetch;
  if (typeof fetchFn !== 'function') {
    return {
      verified: false,
      status: 'error',
      lat: null,
      lon: null,
      displayName: null,
      message: 'Môi trường máy chủ chưa hỗ trợ fetch để xác minh bản đồ.',
    };
  }

  const parsed = parseAddress(rawAddress);
  if (!parsed.validFormat) {
    return {
      verified: false,
      status: 'not_found',
      lat: null,
      lon: null,
      displayName: null,
      message: parsed.reason,
    };
  }

  // Also try a simplified fallback query if full query adds a house number/ward OSM omits
  const simplifiedQuery = parsed.districtSegment
    ? `${parsed.streetSegment.replace(/^\s*\d+(?:[\/\-][0-9a-z]+)*\s+/, '')}, ${parsed.districtSegment}, ${parsed.provinceSegment}`
    : `${parsed.streetSegment}, ${parsed.provinceSegment}`;

  const [arcRes, phoRes] = await Promise.allSettled([
    queryArcGis(parsed.trimmed, fetchFn),
    queryPhoton(parsed.trimmed, fetchFn),
  ]);

  let hadNetworkSuccess = arcRes.status === 'fulfilled' || phoRes.status === 'fulfilled';
  let candidates = [
    ...(arcRes.status === 'fulfilled' ? arcRes.value : []),
    ...(phoRes.status === 'fulfilled' ? phoRes.value : []),
  ].filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));

  if (candidates.length === 0 && simplifiedQuery !== parsed.trimmed) {
    const fallbackPho = await queryPhoton(simplifiedQuery, fetchFn).catch(() => null);
    if (fallbackPho) {
      hadNetworkSuccess = true;
      candidates.push(...fallbackPho.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon)));
    }
  }

  if (!hadNetworkSuccess) {
    return {
      verified: false,
      status: 'error',
      lat: null,
      lon: null,
      displayName: null,
      message: 'Không thể kết nối dịch vụ bản đồ số lúc này. Vui lòng thử lại sau.',
    };
  }

  let rejectionReason = '';

  // Evaluate street + province matches first
  const streetAndProvinceMatches = [];
  for (const c of candidates) {
    if (!c.isStreetLevel) continue;
    const streetMatched = c.streetTexts.some((txt) => wordsInText(parsed.streetTokens, txt));
    if (!streetMatched) continue;

    const provinceMatched = c.provinceTexts.some((prov) => normalizeProvinceStem(prov) === parsed.provinceStem);
    if (!provinceMatched) {
      const actualProv = c.provinceTexts[0] || '';
      if (!rejectionReason && actualProv) {
        rejectionReason = `Tên Tỉnh/Thành phố "${parsed.provinceSegment}" chưa đầy đủ hoặc không khớp với "${actualProv}".`;
      }
      continue;
    }

    streetAndProvinceMatches.push(c);
  }

  if (streetAndProvinceMatches.length === 0) {
    return {
      verified: false,
      status: 'not_found',
      lat: null,
      lon: null,
      displayName: null,
      message:
        rejectionReason ||
        'Không tìm thấy địa chỉ hợp lệ trên bản đồ số. Vui lòng kiểm tra lại số nhà, tên đường, quận/huyện và ghi đầy đủ Tỉnh/Thành phố.',
    };
  }

  // Check district/ward consistency if user provided middle administrative divisions
  if (parsed.districtSegment && parsed.districtStem) {
    const directAdminMatch = streetAndProvinceMatches.find((c) =>
      adminMatchesCandidate(parsed.districtSegment, parsed.districtStem, c.adminTexts, c.displayName)
    );
    if (directAdminMatch) {
      return {
        verified: true,
        status: 'success',
        lat: directAdminMatch.lat,
        lon: directAdminMatch.lon,
        displayName: directAdminMatch.displayName,
        message: 'Đã xác minh địa chỉ trên bản đồ số.',
      };
    }

    // Check against geocoded district location (covers Vietnam 2025 ward reorganization)
    try {
      const districtResults = await queryArcGis(`${parsed.districtSegment}, ${parsed.provinceSegment}`, fetchFn);
      const districtRef = districtResults.find((d) =>
        d.provinceTexts.some((prov) => normalizeProvinceStem(prov) === parsed.provinceStem)
      );
      if (districtRef) {
        for (const c of streetAndProvinceMatches) {
          const sameCityAdmin =
            districtRef.cityValue &&
            c.cityValue &&
            normalizeAdminStem(districtRef.cityValue) === normalizeAdminStem(c.cityValue);
          const km = haversineKm(c.lat, c.lon, districtRef.lat, districtRef.lon);
          if (sameCityAdmin || km <= 4.0) {
            return {
              verified: true,
              status: 'success',
              lat: c.lat,
              lon: c.lon,
              displayName: c.displayName,
              message: 'Đã xác minh địa chỉ trên bản đồ số.',
            };
          }
        }
        const first = streetAndProvinceMatches[0];
        const actualArea = first.cityValue || first.adminTexts[0] || first.displayName;
        return {
          verified: false,
          status: 'not_found',
          lat: null,
          lon: null,
          displayName: null,
          message: `Tuyến đường tìm thấy thuộc "${actualArea}", không khớp với khu vực "${parsed.districtSegment}" bạn đã nhập.`,
        };
      }
    } catch {}

    const first = streetAndProvinceMatches[0];
    const actualArea = first.cityValue || first.adminTexts[0] || first.displayName;
    return {
      verified: false,
      status: 'not_found',
      lat: null,
      lon: null,
      displayName: null,
      message: `Không xác nhận được khu vực "${parsed.districtSegment}" khớp với địa chỉ "${actualArea}".`,
    };
  }

  const best = streetAndProvinceMatches[0];
  return {
    verified: true,
    status: 'success',
    lat: best.lat,
    lon: best.lon,
    displayName: best.displayName,
    message: 'Đã xác minh địa chỉ trên bản đồ số.',
  };
}

module.exports = {
  verifyAddressOnline,
  parseAddress,
  normalizeProvinceStem,
  normalizeAdminStem,
  extractStreetTokens,
};
