require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../config/db');
const { dayStart } = require('../services/restockForecast');
const DAY = 86400000;
const samples = [
 ['Pepsi 330ml','lon'],['Sprite 330ml','lon'],['7Up 330ml','lon'],['Sting dâu 330ml','lon'],['Red Bull 250ml','lon'],
 ['Aquafina 500ml','chai'],['Trà xanh Không Độ 455ml','chai'],['Trà Ô Long Tea Plus 455ml','chai'],['Nước cam Twister 320ml','chai'],['Nước khoáng Vĩnh Hảo 500ml','chai'],
 ['Mì Omachi bò hầm','gói'],['Mì Kokomi tôm chua cay','gói'],['Mì 3 Miền','gói'],['Phở ăn liền Vifon','gói'],['Cháo Gấu Đỏ','gói'],
 ['Sữa TH true MILK 180ml','hộp'],['Sữa Dutch Lady 180ml','hộp'],['Sữa Milo 180ml','hộp'],['Sữa đậu nành Fami 200ml','hộp'],['Sữa chua Vinamilk 100g','hộp'],
 ['Bánh Oreo 133g','gói'],['Bánh Cosy 160g','gói'],['Snack Oishi 42g','gói'],['Bánh Chocopie 6 cái','hộp'],['Kẹo Alpenliebe 120g','gói'],
 ['Dầu ăn Tường An 1L','chai'],['Nước mắm Nam Ngư 500ml','chai'],['Đường Biên Hòa 1kg','túi'],['Muối i-ốt 500g','gói'],['Gạo thơm 5kg','túi'],
].map(([name, unit], index) => ({ name: `[Mẫu] ${name}`, unit, quantity: index % 9 === 0 ? 0 : 8 + index * 3, rate: index < 24 ? 1 + index % 5 : 0, expiryDays: index % 10 === 1 ? -2 : index % 4 === 0 ? 5 + index % 10 : 90 + index }));
const quote = (text) => `N'${text.replaceAll("'", "''")}'`;
function writeSql() {
 const statements = samples.map((item) => {
  const opening = item.quantity + item.rate * 14;
  return `IF NOT EXISTS (SELECT 1 FROM dbo.inventory_items WHERE ownerId=@ownerId AND name=${quote(item.name)})\nBEGIN\nINSERT dbo.inventory_items (ownerId,name,unit,quantity,lowThreshold,expiryDate,createdAt,updatedAt) VALUES (@ownerId,${quote(item.name)},${quote(item.unit)},${item.quantity},5,DATEADD(day,${item.expiryDays},@today),DATEADD(day,-15,@today),SYSUTCDATETIME());\nSET @itemId=SCOPE_IDENTITY();\nINSERT dbo.stock_movements (id,itemId,type,quantityChange,quantityBefore,quantityAfter,productName,unit,note,createdAt) VALUES(CONVERT(varchar(36),NEWID()),@itemId,'OPENING',${opening},0,${opening},${quote(item.name)},${quote(item.unit)},N'DỮ LIỆU MẪU: tồn giả lập để test',DATEADD(hour,-7,CAST(DATEADD(day,-15,@today) AS datetime2)));\n${Array.from({length:item.rate ? 14 : 0},(_,i)=>`INSERT dbo.stock_movements (id,itemId,type,quantityChange,quantityBefore,quantityAfter,productName,unit,note,createdAt) VALUES(CONVERT(varchar(36),NEWID()),@itemId,'SALE',-${item.rate},${opening-i*item.rate},${opening-(i+1)*item.rate},${quote(item.name)},${quote(item.unit)},N'DỮ LIỆU MẪU: bán giả lập, không phải giao dịch thật',DATEADD(hour,3,CAST(DATEADD(day,${i-14},@today) AS datetime2)));`).join('\n')}\nEND;`;
 });
 const sql = `-- 30 sản phẩm và lịch sử GIẢ LẬP để test. Không sửa hàng đã có.\n-- Chọn database dự án; cần users, roles, inventory_items, stock_movements.\n-- Đổi @username thành tài khoản CHỦ TẠP HÓA của bạn. Không dùng cho báo cáo kinh doanh thật.\nSET XACT_ABORT ON;\nDECLARE @username nvarchar(100)=N'duy11', @ownerId int, @itemId int;\nDECLARE @today date=CAST(DATEADD(hour,7,SYSUTCDATETIME()) AS date);\nSELECT @ownerId=u.id FROM dbo.users u JOIN dbo.roles r ON r.id=u.roleId WHERE u.username=@username AND r.code='STORE_OWNER';\nIF @ownerId IS NULL THROW 50001,'Khong tim thay tai khoan chu tap hoa.',1;\nBEGIN TRY\nBEGIN TRAN;\n${statements.join('\n')}\nCOMMIT;\nEND TRY\nBEGIN CATCH\nIF @@TRANCOUNT>0 ROLLBACK;\nTHROW;\nEND CATCH;\n`;
 fs.writeFileSync(path.resolve(__dirname,'../../../SupplyMindAI_30SanPhamMau.sql'),sql,'utf8');
}
async function main() {
 writeSql();
 if (process.argv.includes('--sql-only')) return;
 const username = process.argv[2];
 if (!username) throw new Error('Truyền username chủ tạp hóa: node prisma/seed-demo-products.js duy11');
 const user=await prisma.user.findUnique({where:{username},include:{role:true}});
 if (!user || user.role.code!=='STORE_OWNER') throw new Error('Không tìm thấy chủ tạp hóa.');
 const today=dayStart(new Date());
 let count=0;
 await prisma.$transaction(async(tx)=>{
  for (const item of samples) {
   if (await tx.inventoryItem.findUnique({where:{ownerId_name:{ownerId:user.id,name:item.name}}})) continue;
   const opening=item.quantity+item.rate*14;
   const movements=[{type:'OPENING',quantityChange:opening,quantityBefore:0,quantityAfter:opening,productName:item.name,unit:item.unit,note:'DỮ LIỆU MẪU: tồn giả lập để test',createdAt:new Date(today-15*DAY)}];
   for(let i=0;i<(item.rate ? 14:0);i++) movements.push({type:'SALE',quantityChange:-item.rate,quantityBefore:opening-i*item.rate,quantityAfter:opening-(i+1)*item.rate,productName:item.name,unit:item.unit,note:'DỮ LIỆU MẪU: bán giả lập, không phải giao dịch thật',createdAt:new Date(today+(i-14)*DAY+10*3600000)});
   await tx.inventoryItem.create({data:{ownerId:user.id,name:item.name,unit:item.unit,quantity:item.quantity,expiryDate:new Date(today+7*3600000+item.expiryDays*DAY),createdAt:new Date(today-15*DAY),movements:{create:movements}}});
   count++;
  }
 },{timeout:60000});
 console.log(`Đã thêm ${count} sản phẩm mẫu vào ${username}; giữ nguyên sản phẩm có sẵn. Đã xuất SupplyMindAI_30SanPhamMau.sql.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
