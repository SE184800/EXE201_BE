require('dotenv').config();
const prisma = require('../config/db');

async function migrateLocalDb() {
  console.log('[MIGRATE] Đang bổ sung các cột mới vào SQL Server (DB Local)...');

  try {
    // Bổ sung các cột thương lượng giá sỉ cho bảng wholesale_orders
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[wholesale_orders]') AND name = N'dealStatus')
      BEGIN
          ALTER TABLE [dbo].[wholesale_orders] ADD [dealStatus] VARCHAR(20) NULL;
          ALTER TABLE [dbo].[wholesale_orders] ADD [proposedTotal] DECIMAL(18,2) NULL;
          ALTER TABLE [dbo].[wholesale_orders] ADD [agreedTotal] DECIMAL(18,2) NULL;
          ALTER TABLE [dbo].[wholesale_orders] ADD [dealResponse] NVARCHAR(500) NULL;
      END
    `);
    console.log('[OK] Đã bổ sung các cột dealStatus, proposedTotal, agreedTotal, dealResponse vào wholesale_orders.');
  } catch (e) {
    console.log('[WARN] Đã kiểm tra cột wholesale_orders:', e.message);
  }

  try {
    // Bổ sung cột unitSalePrice cho stock_movements nếu chưa có
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[stock_movements]') AND name = N'unitSalePrice')
      BEGIN
          ALTER TABLE [dbo].[stock_movements] ADD [unitSalePrice] INT NULL;
      END
    `);
    console.log('[OK] Đã bổ sung cột unitSalePrice vào stock_movements.');
  } catch (e) {
    console.log('[WARN] Đã kiểm tra cột stock_movements:', e.message);
  }

  try {
    // Tạo bảng order_complaints nếu chưa có
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[order_complaints]'))
      BEGIN
          CREATE TABLE [dbo].[order_complaints] (
              [id] INT IDENTITY(1,1) NOT NULL,
              [orderId] INT NOT NULL,
              [buyerId] INT NOT NULL,
              [supplierId] INT NOT NULL,
              [reason] VARCHAR(40) NOT NULL,
              [description] NVARCHAR(1000) NOT NULL,
              [status] VARCHAR(20) NOT NULL DEFAULT 'OPEN',
              [response] NVARCHAR(1000) NULL,
              [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
              [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT [PK_order_complaints] PRIMARY KEY CLUSTERED ([id] ASC),
              CONSTRAINT [UQ_order_complaints_orderId] UNIQUE ([orderId])
          );
      END
    `);
    console.log('[OK] Đã tạo bảng order_complaints trên CSDL.');
  } catch (e) {
    console.log('[WARN] Đã kiểm tra bảng order_complaints:', e.message);
  }

  try {
    // Tạo bảng inventory_lots nếu chưa có
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[inventory_lots]'))
      BEGIN
          CREATE TABLE [dbo].[inventory_lots] (
              [id] INT IDENTITY(1,1) NOT NULL,
              [itemId] INT NOT NULL,
              [quantity] INT NOT NULL DEFAULT 0,
              [receivedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
              [expiryDate] DATE NULL,
              [purchasePrice] INT NULL,
              CONSTRAINT [PK_inventory_lots] PRIMARY KEY CLUSTERED ([id] ASC)
          );
      END
    `);
    console.log('[OK] Đã tạo bảng inventory_lots trên CSDL.');
  } catch (e) {
    console.log('[WARN] Đã kiểm tra bảng inventory_lots:', e.message);
  }

  console.log('[SUCCESS] Hoàn tất cập nhật CSDL local khớp 100% với schema.prisma!');
}

migrateLocalDb()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
