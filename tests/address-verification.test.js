const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const nodemailer = require('nodemailer');

const {
  verifyAddressOnline,
  parseAddress,
  normalizeProvinceStem,
} = require('../services/addressVerificationService');
const { createProfileRoutes } = require('../routes/profileRoutes');

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

describe('Address Verification & Gmail Verification Delivery Tests', () => {
  it('1. Rejects invalid address format & preserves exact province stem without substring truncation', () => {
    const shortParse = parseAddress('abc xyz');
    assert.equal(shortParse.validFormat, false);

    assert.equal(normalizeProvinceStem('TP. Hồ Chí Minh'), 'ho chi minh');
    assert.equal(normalizeProvinceStem('TPHCM'), 'ho chi minh');
    assert.equal(normalizeProvinceStem('TP.Hồ Chí'), 'ho chi');
    assert.notEqual(normalizeProvinceStem('TP.Hồ Chí'), normalizeProvinceStem('Hồ Chí Minh'));
  });

  it('2. Accepts valid Vietnamese address & rejects truncated city ("TP.Hồ Chí")', async () => {
    const mockFetch = async (url) => {
      if (String(url).includes('geocode.arcgis.com')) {
        return jsonResponse({
          candidates: [
            {
              address: '221 Đường Trịnh Đình Trọng, Phú Trung, Tân Phú, Hồ Chí Minh, 72016',
              location: { x: 106.639959, y: 10.775263 },
              score: 99.5,
              attributes: {
                Addr_type: 'PointAddress',
                StName: 'Trịnh Đình Trọng',
                District: '',
                City: 'Tân Phú',
                Subregion: '',
                Region: 'Hồ Chí Minh',
              },
            },
          ],
        });
      }
      return jsonResponse({ features: [] });
    };

    const validResult = await verifyAddressOnline('221 Đường Trịnh Đình Trọng, Tân Phú, TP. Hồ Chí Minh', {
      fetchImpl: mockFetch,
    });
    assert.equal(validResult.verified, true);
    assert.equal(validResult.status, 'success');
    assert.equal(validResult.lat, 10.775263);
    assert.equal(validResult.lon, 106.639959);

    const truncatedResult = await verifyAddressOnline('221 Đường Trịnh Đình Trọng, Tân Phú, TP.Hồ Chí', {
      fetchImpl: mockFetch,
    });
    assert.equal(truncatedResult.verified, false);
    assert.equal(truncatedResult.status, 'not_found');
    assert.equal(truncatedResult.lat, null);
    assert.match(truncatedResult.message, /chưa đầy đủ|không khớp/i);
  });

  it('3. Rejects nonexistent street returning Locality fallback & rejects mismatched district', async () => {
    const fakeStreetFetch = async (url) => {
      if (String(url).includes('geocode.arcgis.com')) {
        return jsonResponse({
          candidates: [
            {
              address: 'Tân Phú, Hồ Chí Minh',
              location: { x: 106.636, y: 10.783 },
              score: 74,
              attributes: {
                Addr_type: 'Locality',
                StName: '',
                City: 'Tân Phú',
                Region: 'Hồ Chí Minh',
              },
            },
          ],
        });
      }
      return jsonResponse({ features: [] });
    };

    const fakeResult = await verifyAddressOnline('999999 Đường Không Tồn Tại, Tân Phú, TP. Hồ Chí Minh', {
      fetchImpl: fakeStreetFetch,
    });
    assert.equal(fakeResult.verified, false);
    assert.equal(fakeResult.status, 'not_found');

    const wrongDistrictFetch = async (url) => {
      const text = decodeURIComponent(String(url));
      if (text.includes('Quận 1, TP. Hồ Chí Minh') && !text.includes('Trịnh Đình Trọng')) {
        return jsonResponse({
          candidates: [
            {
              address: 'Quận 1, Hồ Chí Minh',
              location: { x: 106.69854, y: 10.7725 },
              score: 94,
              attributes: {
                Addr_type: 'Locality',
                City: '',
                Subregion: 'Quận Một',
                Region: 'Hồ Chí Minh',
              },
            },
          ],
        });
      }
      if (String(url).includes('geocode.arcgis.com')) {
        return jsonResponse({
          candidates: [
            {
              address: '221 Đường Trịnh Đình Trọng, Phú Trung, Tân Phú, Hồ Chí Minh, 72016',
              location: { x: 106.639959, y: 10.775263 },
              score: 92,
              attributes: {
                Addr_type: 'PointAddress',
                StName: 'Trịnh Đình Trọng',
                City: 'Tân Phú',
                Region: 'Hồ Chí Minh',
              },
            },
          ],
        });
      }
      return jsonResponse({ features: [] });
    };

    const mismatchResult = await verifyAddressOnline('221 Đường Trịnh Đình Trọng, Quận 1, TP. Hồ Chí Minh', {
      fetchImpl: wrongDistrictFetch,
    });
    assert.equal(mismatchResult.verified, false);
    assert.equal(mismatchResult.status, 'not_found');
    assert.match(mismatchResult.message, /Tân Phú/);
  });

  it('4. Accepts Vietnam 2025 ward naming when street is physically within declared district centroid', async () => {
    const wardReorgFetch = async (url) => {
      const decoded = decodeURIComponent(String(url));
      if (String(url).includes('geocode.arcgis.com')) {
        if (decoded.includes('123 Lê Lợi')) {
          return jsonResponse({
            candidates: [
              {
                address: '123 Đường Lê Lợi, Bến Thành, Hồ Chí Minh, 71009',
                location: { x: 106.699716, y: 10.772411 },
                score: 84,
                attributes: {
                  Addr_type: 'PointAddress',
                  StName: 'Lê Lợi',
                  City: 'Bến Thành',
                  Region: 'Hồ Chí Minh',
                },
              },
            ],
          });
        }
        return jsonResponse({
          candidates: [
            {
              address: 'Quận 1, Hồ Chí Minh',
              location: { x: 106.69854, y: 10.7725 },
              score: 94,
              attributes: {
                Addr_type: 'Locality',
                City: '',
                Subregion: 'Quận Một',
                Region: 'Hồ Chí Minh',
              },
            },
          ],
        });
      }
      return jsonResponse({ features: [] });
    };

    const result = await verifyAddressOnline('123 Lê Lợi, Quận 1, TP. Hồ Chí Minh', {
      fetchImpl: wardReorgFetch,
    });
    assert.equal(result.verified, true);
    assert.equal(result.status, 'success');
  });

  it('5. Returns status=error when all external geocoders fail', async () => {
    const failingFetch = async () => {
      throw new TypeError('fetch failed');
    };
    const result = await verifyAddressOnline('221 Đường Trịnh Đình Trọng, Tân Phú, TP. Hồ Chí Minh', {
      fetchImpl: failingFetch,
    });
    assert.equal(result.verified, false);
    assert.equal(result.status, 'error');
  });

  it('6. GET /api/profile/verify-address validates query length & rejects malformed queries', async () => {
    const app = express();
    const fakeAuth = (req, _res, next) => {
      req.auth = { user: { id: 1, role: 'STORE_OWNER' } };
      next();
    };
    app.use('/api/profile', createProfileRoutes({}, fakeAuth));

    const emptyRes = await request(app).get('/api/profile/verify-address');
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.body.verified, false);

    const shortRes = await request(app).get('/api/profile/verify-address').query({ q: 'abc' });
    assert.equal(shortRes.status, 200);
    assert.equal(shortRes.body.verified, false);
    assert.equal(shortRes.body.status, 'not_found');
  });

  it('7. verificationMailService reads GMAIL_APP_PASSWORD cleanly (stripping inline comments & spaces)', async () => {
    const prevUser = process.env.GMAIL_USER;
    const prevAppPass = process.env.GMAIL_APP_PASSWORD;
    const prevPass = process.env.GMAIL_PASS;
    const prevCreateTransport = nodemailer.createTransport;

    let capturedTransportOpts = null;
    let sentMailCount = 0;

    nodemailer.createTransport = (opts) => {
      capturedTransportOpts = opts;
      return {
        async sendMail(mail) {
          sentMailCount += 1;
          assert.ok(mail.to);
          assert.ok(mail.subject);
          return { messageId: 'mock-id' };
        },
      };
    };

    delete require.cache[require.resolve('../services/verificationMailService')];
    const {
      sendVerificationApprovedEmail,
      sendVerificationRejectedEmail,
    } = require('../services/verificationMailService');

    try {
      process.env.GMAIL_USER = 'demo.sender@gmail.com';
      delete process.env.GMAIL_PASS;
      process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop # inline env comment';

      const approved = await sendVerificationApprovedEmail({
        to: 'store@gmail.com',
        recipientName: 'Tiệm Demo',
        roleLabel: 'Chủ tạp hóa',
      });
      assert.equal(approved.sent, true);
      assert.equal(approved.method, 'gmail');
      assert.equal(capturedTransportOpts.auth.user, 'demo.sender@gmail.com');
      assert.equal(capturedTransportOpts.auth.pass, 'abcdefghijklmnop');

      const rejected = await sendVerificationRejectedEmail({
        to: 'store@gmail.com',
        recipientName: 'Tiệm Demo',
        roleLabel: 'Chủ tạp hóa',
        reason: 'Mã số thuế không trùng khớp',
      });
      assert.equal(rejected.sent, true);
      assert.equal(rejected.method, 'gmail');
      assert.equal(sentMailCount, 2);
    } finally {
      nodemailer.createTransport = prevCreateTransport;
      if (prevUser === undefined) delete process.env.GMAIL_USER;
      else process.env.GMAIL_USER = prevUser;
      if (prevAppPass === undefined) delete process.env.GMAIL_APP_PASSWORD;
      else process.env.GMAIL_APP_PASSWORD = prevAppPass;
      if (prevPass === undefined) delete process.env.GMAIL_PASS;
      else process.env.GMAIL_PASS = prevPass;
    }
  });
});
