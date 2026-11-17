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

function cleanRawAddress(rawAddress) {
  let text = String(rawAddress || '').replace(/\s+/g, ' ').trim();
  // 1. Strip Google Plus Code prefix (e.g. "QJ73+86P, " or "QJ73+86P ")
  text = text.replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,}\s*,?\s*/i, '');
  // 2. Strip trailing country (e.g. ", Việt Nam", ", Vietnam", ", VN")
  text = text.replace(/,\s*(?:Việt Nam|Vietnam|VN)\s*$/i, '');
  // 3. Strip 5-6 digit postal codes (e.g. "Hồ Chí Minh 100000" -> "Hồ Chí Minh")
  text = text.replace(/\b\d{5,6}\b/g, '').replace(/\s+,/g, ',');
  // 4. Expand common Vietnamese road abbreviations:
  text = text.replace(/\bHL\s*(\d+)\b/gi, (_, n) => `Hương Lộ ${n}`);
  text = text.replace(/\bQL\s*(\d+[a-zA-Z]?)\b/gi, (_, n) => `Quốc Lộ ${n}`);
  text = text.replace(/\bTL\s*(\d+[a-zA-Z]?)\b/gi, (_, n) => `Tỉnh Lộ ${n}`);
  text = text.replace(/\bĐT\s*(\d+[a-zA-Z]?)\b/gi, (_, n) => `Đường Tỉnh ${n}`);
  return text.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();
}

function parseAddress(rawAddress) {
  const cleaned = cleanRawAddress(rawAddress);
  const trimmed = cleaned.replace(/\s+/g, ' ').trim();
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

  const isRural = /^(?:ấp|ap|thôn|thon|xóm|xom|bản|ban|tổ|to|đội|doi|khu\s+dân\s+cư|kdc)\b/i.test(streetSegment);
  const provinceStem = normalizeProvinceStem(provinceSegment);
  const streetTokens = extractStreetTokens(streetSegment);

  if (provinceStem.length < 3 || /^\d+$/.test(provinceStem)) {
    return {
      validFormat: false,
      reason: `Tên Tỉnh/Thành phố "${provinceSegment}" không hợp lệ.`,
    };
  }

  if (streetTokens.length === 0 && !isRural) {
    return {
      validFormat: false,
      reason: 'Vui lòng nhập rõ tên đường/phố hoặc ấp/thôn trong phần đầu địa chỉ.',
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
    isRural,
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

async function queryGoong(query, apiKey, fetchFn) {
  if (!apiKey) return null;
  const url = `https://rsapi.goong.io/v2/geocode?address=${encodeURIComponent(query)}&api_key=${apiKey}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5500) });
  if (!res.ok) throw new Error(`Goong HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0];
    const loc = first.geometry?.location;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
      return {
        verified: true,
        status: 'success',
        lat: Number(loc.lat),
        lon: Number(loc.lng),
        displayName: first.formatted_address || query,
        source: 'goong',
        message: 'Đã xác minh địa chỉ thành công qua Goong Maps.',
      };
    }
  }
  return null;
}

async function queryGoogleMaps(query, apiKey, fetchFn) {
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}&language=vi&region=vn`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5500) });
  if (!res.ok) throw new Error(`Google Maps HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
    const first = data.results[0];
    const loc = first.geometry?.location;
    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
      return {
        verified: true,
        status: 'success',
        lat: Number(loc.lat),
        lon: Number(loc.lng),
        displayName: first.formatted_address || query,
        source: 'google',
        message: 'Đã xác minh địa chỉ thành công qua Google Maps.',
      };
    }
  }
  return null;
}

async function queryGeoapify(query, apiKey, fetchFn) {
  if (!apiKey) return null;
  const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${apiKey}&filter=countrycode:vn&lang=vi`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(5500) });
  if (!res.ok) throw new Error(`Geoapify HTTP ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data.features) && data.features.length > 0) {
    const first = data.features[0];
    const props = first.properties || {};
    const geom = first.geometry || {};
    const coords = Array.isArray(geom.coordinates) ? geom.coordinates : [];
    const lat = Number(props.lat !== undefined ? props.lat : coords[1]);
    const lon = Number(props.lon !== undefined ? props.lon : coords[0]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        verified: true,
        status: 'success',
        lat,
        lon,
        displayName: props.formatted || query,
        source: 'geoapify',
        message: 'Đã xác minh địa chỉ thành công qua Geoapify.',
      };
    }
  }
  return null;
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
      isStreetLevel: ['PointAddress', 'StreetAddress', 'StreetName', 'StreetInt', 'Subaddress', 'POI', 'Locality'].includes(
        a.Addr_type || ''
      ),
      streetTexts: [a.StName, addressParts[0], c.address, a.PlaceName].filter(Boolean),
      provinceTexts: [a.Region, fallbackProvince].filter(Boolean),
      adminTexts: [a.City, a.District, a.Subregion, a.Neighborhood, a.Nbrhd, a.PlaceName].filter(Boolean),
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
          ['street', 'house', 'hamlet', 'village', 'locality'].includes(p.type || '') ||
          ['highway', 'building', 'amenity', 'shop', 'office', 'place'].includes(p.osm_key || ''),
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

  // 1. Try Geoapify API if API key is provided
  const geoapifyApiKey = (options.geoapifyApiKey || process.env.GEOAPIFY_API_KEY || '').trim();
  if (geoapifyApiKey) {
    try {
      const geoapifyResult = await queryGeoapify(parsed.trimmed, geoapifyApiKey, fetchFn);
      if (geoapifyResult) {
        return geoapifyResult;
      }
    } catch {}
  }

  // 2. Try Google Maps API if API key is provided
  const googleApiKey = (options.googleApiKey || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (googleApiKey) {
    try {
      const googleResult = await queryGoogleMaps(parsed.trimmed, googleApiKey, fetchFn);
      if (googleResult) {
        return googleResult;
      }
    } catch {}
  }

  // 3. Try Goong Maps API if API key is provided
  const goongApiKey = (options.goongApiKey || process.env.GOONG_API_KEY || '').trim();
  if (goongApiKey) {
    try {
      const goongResult = await queryGoong(parsed.trimmed, goongApiKey, fetchFn);
      if (goongResult) {
        return goongResult;
      }
    } catch {}
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
    if (!c.isStreetLevel && !parsed.isRural) continue;
    const streetMatched = parsed.isRural || c.streetTexts.some((txt) => wordsInText(parsed.streetTokens, txt));
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

  // If rural address (Ấp/Thôn/Xóm), match against commune/district
  if (parsed.isRural && streetAndProvinceMatches.length > 0) {
    const directAdminMatch = streetAndProvinceMatches.find((c) =>
      adminMatchesCandidate(parsed.districtSegment, parsed.districtStem, c.adminTexts, c.displayName)
    );
    const chosen = directAdminMatch || streetAndProvinceMatches[0];
    return {
      verified: true,
      status: 'success',
      lat: chosen.lat,
      lon: chosen.lon,
      displayName: chosen.displayName,
      message: 'Đã xác minh vị trí địa bàn (Ấp/Xã) trên bản đồ số.',
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
  queryGeoapify,
  cleanRawAddress,
  parseAddress,
  normalizeProvinceStem,
  normalizeAdminStem,
  extractStreetTokens,
};
