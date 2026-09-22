require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const prisma=require('../config/db');
// Illustrative VND per inventory unit, not researched market prices.
const prices=[
 ['coca 500ml',9000,12000],['sting',8000,11000],
 ['[Mẫu] Pepsi 330ml',7500,10000],['[Mẫu] Sprite 330ml',7500,10000],['[Mẫu] 7Up 330ml',7500,10000],
 ['[Mẫu] Sting dâu 330ml',8000,11000],['[Mẫu] Red Bull 250ml',9500,13000],['[Mẫu] Aquafina 500ml',3500,5000],
 ['[Mẫu] Trà xanh Không Độ 455ml',7500,10000],['[Mẫu] Trà Ô Long Tea Plus 455ml',8000,11000],['[Mẫu] Nước cam Twister 320ml',7500,10000],['[Mẫu] Nước khoáng Vĩnh Hảo 500ml',3000,5000],
 ['[Mẫu] Mì Omachi bò hầm',7000,9000],['[Mẫu] Mì Kokomi tôm chua cay',3000,4000],['[Mẫu] Mì 3 Miền',3000,4000],['[Mẫu] Phở ăn liền Vifon',6500,8500],['[Mẫu] Cháo Gấu Đỏ',3000,4500],
 ['[Mẫu] Sữa TH true MILK 180ml',6500,8500],['[Mẫu] Sữa Dutch Lady 180ml',6000,8000],['[Mẫu] Sữa Milo 180ml',6500,9000],['[Mẫu] Sữa đậu nành Fami 200ml',4000,6000],['[Mẫu] Sữa chua Vinamilk 100g',5000,7000],
 ['[Mẫu] Bánh Oreo 133g',17000,23000],['[Mẫu] Bánh Cosy 160g',18000,25000],['[Mẫu] Snack Oishi 42g',4000,6000],['[Mẫu] Bánh Chocopie 6 cái',24000,32000],['[Mẫu] Kẹo Alpenliebe 120g',15000,20000],
 ['[Mẫu] Dầu ăn Tường An 1L',38000,48000],['[Mẫu] Nước mắm Nam Ngư 500ml',22000,29000],['[Mẫu] Đường Biên Hòa 1kg',21000,27000],['[Mẫu] Muối i-ốt 500g',4000,6000],['[Mẫu] Gạo thơm 5kg',85000,105000],
];
async function main(){
 const username=process.argv[2];
 if(!username) throw new Error('Cần username: node prisma/seed-demo-prices.js duy11');
 const user=await prisma.user.findUnique({where:{username},include:{role:true}});
 if(!user || user.role.code!=='STORE_OWNER') throw new Error('Không tìm thấy chủ tạp hóa.');
 let count=0;
 await prisma.$transaction(async tx=>{
  for(const [name,purchasePrice,sellingPrice] of prices){
   const item=await tx.inventoryItem.findUnique({where:{ownerId_name:{ownerId:user.id,name}}});
   if(!item) continue;
   const data={};
   if(item.purchasePrice===null) data.purchasePrice=purchasePrice;
   if(item.sellingPrice===null) data.sellingPrice=sellingPrice;
   if(Object.keys(data).length) count+=(await tx.inventoryItem.updateMany({where:{id:item.id,ownerId:user.id,updatedAt:item.updatedAt},data})).count;
  }
 });
 const sql=`-- GIÁ GIẢ ĐỊNH chỉ dùng demo (VND / đơn vị), không phải giá thị trường.\n-- Chạy sau SupplyMindAI_GiaSanPham.sql; đổi @username thành tài khoản người nhận.\n-- Chỉ điền giá NULL, không ghi đè giá đã nhập; không đổi tồn hay lịch sử.\nSET XACT_ABORT ON;\nDECLARE @username varchar(50)='duy11';\nBEGIN TRY\nBEGIN TRAN;\n${prices.map(([name,buy,sell])=>`UPDATE i SET purchasePrice=COALESCE(i.purchasePrice,${buy}),sellingPrice=COALESCE(i.sellingPrice,${sell}),updatedAt=SYSUTCDATETIME() FROM dbo.inventory_items i JOIN dbo.users u ON u.id=i.ownerId JOIN dbo.roles r ON r.id=u.roleId WHERE u.username=@username AND r.code='STORE_OWNER' AND i.name=N'${name.replaceAll("'","''")}' AND (i.purchasePrice IS NULL OR i.sellingPrice IS NULL);`).join('\n')}\nCOMMIT;\nEND TRY\nBEGIN CATCH\nIF @@TRANCOUNT>0 ROLLBACK;\nTHROW;\nEND CATCH;\n`;
 fs.writeFileSync(path.resolve(__dirname,'../../../SupplyMindAI_GiaMau.sql'),sql,'utf8');
 console.log(`Đã điền giá demo cho ${count} sản phẩm trong kho ${username}; giữ nguyên giá đã có.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
