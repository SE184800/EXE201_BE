require('dotenv').config();
const {spawnSync}=require('node:child_process');
const {readConfig}=require('../config/env');
const prisma=require('../config/db');
async function main(){
 readConfig();
 if(!process.env.DATABASE_URL) throw new Error('Thiếu DATABASE_URL.');
 // Azure serverless may need time to wake; retry connection only, not a failed migration.
 for(let attempt=0;attempt<6;attempt++){
  try{await prisma.$connect();break;}catch{if(attempt===5)throw new Error('Chưa kết nối được database online. Kiểm tra trạng thái, firewall và DATABASE_URL.');await new Promise(r=>setTimeout(r,5000));}
 }
 await prisma.$disconnect();
 const migration=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{stdio:'inherit',env:process.env});
 if(migration.status!==0) throw new Error('Migration chưa thành công; không khởi động bản mới. Không dùng migrate reset.');
 for(const [code,name] of [['STORE_OWNER','Chủ tạp hóa'],['SUPPLIER','Chủ vựa'],['ADMIN','Quản trị viên']]){
  await prisma.role.upsert({where:{code},update:{},create:{code,name}});
 }
 await prisma.$disconnect();
 require('../server');
}
main().catch(async()=>{console.error('Deploy startup thất bại. Kiểm tra cấu hình và trạng thái migration trong log; không chia sẻ log chứa chuỗi kết nối.');await prisma.$disconnect();process.exitCode=1;});
