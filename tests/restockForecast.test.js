const { test } = require('node:test');
const assert = require('node:assert/strict');
const { forecastItem, dayStart } = require('../services/restockForecast');
const now = new Date('2026-09-21T05:00:00Z');
const item = { id: 1, name: 'Test', unit: 'lon', quantity: 10, expiryDate: null, movements: [{ createdAt: '2026-09-06T03:00:00Z' }] };
const sale = { itemId: 1, unit: 'lon', type: 'SALE', quantityChange: -28, createdAt: '2026-09-10T03:00:00Z' };
test('forecast includes zero-sale days, excludes partial days and non-sale movements', () => {
 const result=forecastItem(item,[sale,{...sale,createdAt:'2026-09-21T03:00:00Z'}, {...sale,createdAt:'2026-09-06T03:00:00Z'}, {...sale,type:'ADJUSTMENT'}],7,2,now);
 assert.equal(result.observedDays,14); assert.equal(result.averageDailySales,2); assert.equal(result.daysUntilStockout,5); assert.equal(result.suggestedQuantity,8);
});
test('forecast never fabricates sales for new products or zero sales', () => {
 assert.equal(forecastItem({...item,movements:[]},[sale],7,2,now).suggestedQuantity,null);
 assert.equal(forecastItem(item,[],7,2,now).averageDailySales,null);
});
test('expired stock and near expiry limit usable quantity', () => {
 const expired=forecastItem({...item,expiryDate:new Date('2026-09-20')},[sale],7,2,now);
 assert.equal(expired.usableStock,0); assert.equal(expired.daysUntilStockout,0); assert.equal(expired.suggestedQuantity,18);
 assert.equal(forecastItem({...item,expiryDate:new Date('2026-09-21')},[sale],7,2,now).usableStock,2);
});
test('Vietnam calendar boundary and unit changes are respected', () => {
 assert.equal(new Date(dayStart('2026-09-20T18:00:00Z')).toISOString(),'2026-09-20T17:00:00.000Z');
 const changed=forecastItem(item,[sale,{...sale,unit:'thùng',createdAt:'2026-09-19T03:00:00Z'}],7,2,now);
 assert.equal(changed.observedDays,1); assert.equal(changed.suggestedQuantity,null);
});
