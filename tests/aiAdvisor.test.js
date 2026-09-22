const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calendarItem}=require('../services/salesCalendar');
const {answerWithAI}=require('../services/aiAdvisor');
const now=new Date('2026-09-21T03:00:00Z'), DAY=86400000, today=new Date('2026-09-20T17:00:00Z').getTime();
function fixture(days=28){
 const start=today-days*DAY;
 const item={itemId:1,name:'Bia test',unit:'lon',quantity:15,averageDailySales:3,expiryDate:null,windowStart:new Date(start).toISOString()};
 const rows=Array.from({length:days},(_,i)=>{const date=new Date(start+i*DAY+10*3600000);const weekday=date.getUTCDay();return {itemId:1,type:'SALE',unit:'lon',quantityChange:weekday===0||weekday===6?-10:-1,createdAt:date};});
 return {item,rows};
}
test('weekday pattern learns weekends only with 4 observations of every day',()=>{
 const {item,rows}=fixture(); const result=calendarItem(item,rows,2,now);
 assert.equal(result.method,'WEEKDAY');assert.equal(result.weekendRatio,10);
 assert.equal(result.daily[5].expectedSales,10);
 assert.equal(result.recommendation.arrivalDate,'2026-09-27');assert.equal(result.recommendation.orderDate,'2026-09-25');
 const short=fixture(14);assert.equal(calendarItem(short.item,short.rows,2,now).method,'AVERAGE');
});
test('calendar handles insufficient history, expiry and urgent delivery',()=>{
 const {item,rows}=fixture();
 const result=calendarItem({...item,quantity:0},rows,2,now);assert.equal(result.recommendation.urgent,true);assert.equal(result.recommendation.orderDate,'2026-09-21');
 assert.equal(calendarItem({...item,averageDailySales:null},[],2,now).recommendation,null);
 assert.equal(calendarItem({...item,expiryDate:'2026-09-20'},rows,2,now).recommendation.arrivalDate,'2026-09-21');
});
test('AI is explicitly disabled without key; no external request occurs',async()=>{
 const result=await answerWithAI({message:'Cuối tuần nên nhập gì?',calendar:{items:[]},fetcher:()=>{throw new Error('must not call');}});
 assert.equal(result.mode,'RULES');assert.match(result.answer,/Chưa bật AI/);
});
test('AI request excludes credentials and owner details, disables response storage and reads text blocks',async()=>{
 let sent;
 const result=await answerWithAI({message:'Nên nhập gì?',calendar:{items:[{name:'Coca',ownerId:999,passwordHash:'secret',quantity:3}],generatedAt:now.toISOString()},apiKey:'test-key',model:'test-model',fetcher:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Có 3 sản phẩm.'}]}]})};}});
 assert.equal(result.mode,'AI');assert.equal(sent.store,false);assert.equal(JSON.stringify(sent).includes('passwordHash'),false);assert.equal(JSON.stringify(sent).includes('ownerId'),false);
});
test('AI failures fall back honestly without exposing provider response',async()=>{
 const result=await answerWithAI({message:'Xem kho',calendar:{items:[]},apiKey:'test',model:'test',fetcher:async()=>({ok:false})});
 assert.equal(result.mode,'UNAVAILABLE');assert.match(result.answer,/không phản hồi/);
});
