/**
 * VietQR (Napas 247 / EMVCo QR) payload builder used by the wallet deposit flow.
 *
 * Vietnamese bank apps only accept the Napas template (tag 38), not the
 * generic EMVCo merchant template (tag 26), so the layout below follows the
 * Napas structure exactly:
 *
 *   00 02 01                      payload format indicator
 *   01 02 12                      point of initiation: dynamic (amount embedded)
 *   38 LL                         merchant account information
 *      00 10 A000000727              Napas GUID
 *      01 26  00 06 <BIN>              acquirer id (bank code)
 *             01 12 <account>          beneficiary account number
 *      02 08 QRIBFTTA                 service code: transfer to account
 *   53 03 704                      transaction currency (VND)
 *   54 LL <amount>                 transaction amount (dynamic QR only)
 *   58 02 VN                       country code
 *   62 LL  05 <bill>  08 <memo>      additional data
 *   63 04 <crc>                    CRC16-CCITT checksum
 */

/** Builds a TLV block: tag + length (2 digits) + value. */
function tlv(tag, value) {
  return tag + String(value.length).padStart(2, '0') + value;
}

/** CRC16/CCITT-FALSE over the payload up to (but excluding) the 63 tag. */
function crc16(input) {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Napas GUID that marks the payload as a VietQR transfer. */
const VIETQR_GUID = 'A000000727';
/** Inter-bank fund transfer to a bank account. */
const SERVICE_TRANSFER_TO_ACCOUNT = 'QRIBFTTA';

/**
 * Builds the full VietQR string. `amount` is in VND and gets embedded so the
 * banking app pre-fills the transfer value.
 */
function buildVietQrPayload({ bank, amount, billNumber, memo }) {
  const beneficiary = tlv('00', bank.code) + tlv('01', bank.accountNumber);
  const accountInfo =
    tlv('00', VIETQR_GUID) +
    tlv('01', beneficiary) +
    tlv('02', SERVICE_TRANSFER_TO_ACCOUNT);

  let payload =
    tlv('00', '01') + // payload format indicator
    tlv('01', '12') + // point of initiation: dynamic, the amount is embedded
    tlv('38', accountInfo) +
    tlv('53', '704'); // transaction currency: VND

  if (amount && Number.isFinite(amount) && amount > 0) {
    payload += tlv('54', String(Math.round(amount)));
  }

  payload += tlv('58', 'VN'); // country code

  const additional = tlv('05', billNumber || '') + tlv('08', memo || '');
  payload += tlv('62', additional);

  payload += '6304' + crc16(payload + '6304');

  return payload;
}

module.exports = { buildVietQrPayload, crc16, VIETQR_GUID, SERVICE_TRANSFER_TO_ACCOUNT };
