const {test}=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const {readConfig}=require('../config/env');
const {createApp}=require('../app');
const secret='deployment-test-secret-only-not-a-real-key';
test('Vercel accepts only the project and exact deployment origins', () => {
 const config=readConfig({JWT_SECRET:secret,NODE_ENV:'production',VERCEL:'1',VERCEL_PROJECT_PRODUCTION_URL:'supplymind.vercel.app',VERCEL_URL:'supplymind-preview-123.vercel.app'});
 assert.deepEqual(config.allowedOrigins,['https://supplymind.vercel.app','https://supplymind-preview-123.vercel.app']);
 assert.equal(config.allowedOrigins.includes('https://attacker.vercel.app'),false);
});
test('production requires HTTPS origin, rejects local origin and bounds proxy trust',()=>{
 assert.throws(()=>readConfig({JWT_SECRET:secret,NODE_ENV:'production'}));
 assert.throws(()=>readConfig({JWT_SECRET:secret,NODE_ENV:'production',FRONTEND_URL:'http://example.com'}));
 assert.throws(()=>readConfig({JWT_SECRET:secret,TRUST_PROXY_HOPS:'true'}));
 const config=readConfig({JWT_SECRET:secret,NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://test.onrender.com',TRUST_PROXY_HOPS:'1'});
 assert.deepEqual(config.allowedOrigins,['https://test.onrender.com']);assert.equal(config.trustProxyHops,1);
});
test('single origin deployment serves SPA and static assets without swallowing API or secret paths',async()=>{
 const config=readConfig({JWT_SECRET:secret,NODE_ENV:'production',FRONTEND_URL:'https://test.onrender.com',SERVE_WEB:'true',TRUST_PROXY_HOPS:'1'});
 const app=createApp({},config);
 await request(app).get('/api/health').expect(200,{status:'ok'});
 await request(app).get('/login').set('Accept','text/html').expect(200).expect('Content-Type',/html/);
 const home=await request(app).get('/').expect(200);
 assert.match(home.text,/SupplyMind/);
 const asset=home.text.match(/src="([^"]+\.js)"/)[1];
 await request(app).get(asset).expect(200).expect('Content-Type',/javascript/);
 await request(app).get('/api/not-a-route').set('Accept','text/html').expect(404).expect('Content-Type',/json/);
 await request(app).get('/.env').expect(404);
 await request(app).get('/missing.js').expect(404);
 await request(app).post('/api/auth/logout').set('Origin','http://localhost:5173').set('X-CSRF-Protection','sg-restock-web').expect(403);
});
