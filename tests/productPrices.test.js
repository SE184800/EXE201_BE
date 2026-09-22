const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateItem}=require('../routes/inventoryRoutes');
const base={name:'Coca',unit:'lon',quantity:10};
test('VND prices preserve missing fields, distinguish null from zero and reject invalid values',()=>{
 assert.equal(Object.hasOwn(validateItem(base),'purchasePrice'),false);
 assert.equal(validateItem({...base,purchasePrice:null}).purchasePrice,null);
 assert.equal(validateItem({...base,purchasePrice:0,sellingPrice:15000}).purchasePrice,0);
 for(const key of ['purchasePrice','sellingPrice']) {
  for(const invalid of [-1,1.5,'12000',true,2147483648,{},NaN]) assert.equal(validateItem({...base,[key]:invalid}),null);
  assert.equal(validateItem({...base,[key]:2147483647})[key],2147483647);
 }
});
