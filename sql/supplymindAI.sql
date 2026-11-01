-- SupplyMind AI: SQL Server setup generated from repository migrations.
-- Run with sqlcmd -b -S .\SQLEXPRESS -E -C -i supplymindAI.sql
USE [master];
GO
IF DB_ID(N'supplymindAI') IS NULL EXEC(N'CREATE DATABASE [supplymindAI]');
GO
USE [supplymindAI];
GO
SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
IF OBJECT_ID(N'dbo._prisma_migrations', N'U') IS NULL
CREATE TABLE dbo._prisma_migrations (
 id NVARCHAR(36) NOT NULL PRIMARY KEY,
 checksum NVARCHAR(64) NOT NULL,
 finished_at DATETIMEOFFSET NULL,
 migration_name NVARCHAR(250) NOT NULL,
 logs NVARCHAR(MAX) NULL,
 rolled_back_at DATETIMEOFFSET NULL,
 started_at DATETIMEOFFSET NOT NULL DEFAULT CURRENT_TIMESTAMP,
 applied_steps_count INT NOT NULL DEFAULT 0
);
GO
-- Migration: 202609210001_init_auth
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210001_init_auth' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N''dbo'') EXEC sp_executesql N''CREATE SCHEMA [dbo];'';

-- CreateTable
CREATE TABLE [dbo].[roles] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] VARCHAR(30) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    CONSTRAINT [roles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [roles_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] INT NOT NULL IDENTITY(1,1),
    [username] VARCHAR(50) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [passwordHash] VARCHAR(255) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [users_isActive_df] DEFAULT 1,
    [roleId] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_username_key] UNIQUE NONCLUSTERED ([username])
);

-- CreateTable
CREATE TABLE [dbo].[auth_sessions] (
    [id] VARCHAR(36) NOT NULL,
    [userId] INT NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [auth_sessions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [auth_sessions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_roleId_idx] ON [dbo].[users]([roleId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [auth_sessions_userId_idx] ON [dbo].[auth_sessions]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [auth_sessions_expiresAt_idx] ON [dbo].[auth_sessions]([expiresAt]);

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[roles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[auth_sessions] ADD CONSTRAINT [auth_sessions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'172107d4c4e7a93dd76eedd0191a3d18e5fd4c2f473631ee9979abd9578e6478',N'202609210001_init_auth',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210002_add_registration_fields
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210002_add_registration_fields' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[users] ADD [dateOfBirth] DATE,
[email] VARCHAR(255),
[phone] VARCHAR(20);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_email_idx] ON [dbo].[users]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_phone_idx] ON [dbo].[users]([phone]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'7d4819d255bc078854ee34222ffc982f6fe1dda9c7230e02b8d52ab1fffb9634',N'202609210002_add_registration_fields',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210003_inventory
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210003_inventory' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY
BEGIN TRAN;
CREATE TABLE [dbo].[inventory_items] (
  [id] INT NOT NULL IDENTITY(1,1),
  [ownerId] INT NOT NULL,
  [name] NVARCHAR(100) NOT NULL,
  [unit] NVARCHAR(20) NOT NULL,
  [quantity] INT NOT NULL CONSTRAINT [inventory_items_quantity_df] DEFAULT 0,
  [lowThreshold] INT NOT NULL CONSTRAINT [inventory_items_lowThreshold_df] DEFAULT 5,
  [createdAt] DATETIME2 NOT NULL CONSTRAINT [inventory_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
  [updatedAt] DATETIME2 NOT NULL,
  CONSTRAINT [inventory_items_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [inventory_items_ownerId_name_key] UNIQUE NONCLUSTERED ([ownerId], [name]),
  CONSTRAINT [inventory_items_quantity_check] CHECK ([quantity] >= 0),
  CONSTRAINT [inventory_items_threshold_check] CHECK ([lowThreshold] >= 0),
  CONSTRAINT [inventory_items_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION
);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'45da7876e2f9fb833badb17c9b2a8b517ce2af46888753d636a485cf2bb59802',N'202609210003_inventory',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210003_unique_registration_contacts
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210003_unique_registration_contacts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'-- Seed/admin accounts may omit contact details. Enforce uniqueness only for
-- non-null values; a regular SQL Server UNIQUE constraint would allow one NULL.
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
  BEGIN TRAN;
  CREATE UNIQUE NONCLUSTERED INDEX [users_email_unique_not_null]
    ON [dbo].[users]([email]) WHERE [email] IS NOT NULL;
  CREATE UNIQUE NONCLUSTERED INDEX [users_phone_unique_not_null]
    ON [dbo].[users]([phone]) WHERE [phone] IS NOT NULL;
  DROP INDEX [users_email_idx] ON [dbo].[users];
  DROP INDEX [users_phone_idx] ON [dbo].[users];
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'b5bb6bc3ff918f6031aaf8f1e77c34b4fe8c13eefcd293ae0a5cc32ea62c8d13',N'202609210003_unique_registration_contacts',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210004_inventory_expiry
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210004_inventory_expiry' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'-- Optional expiry date: existing inventory stays unchanged with NULL.
ALTER TABLE [dbo].[inventory_items] ADD [expiryDate] DATE NULL;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'1d46d375e0ae35dae3653ecb757b072551b68c5c7ddb26362aec51876be3766b',N'202609210004_inventory_expiry',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210004_supplier_core_flow
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210004_supplier_core_flow' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[supplier_profiles] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [businessName] NVARCHAR(150) NOT NULL,
    [warehouseAddress] NVARCHAR(255) NOT NULL,
    [deliveryRadiusKm] DECIMAL(8,2) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [supplier_profiles_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [supplier_profiles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [supplier_profiles_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[supplier_products] (
    [id] INT NOT NULL IDENTITY(1,1),
    [supplierId] INT NOT NULL,
    [name] NVARCHAR(150) NOT NULL,
    [packaging] NVARCHAR(50) NOT NULL,
    [wholesalePrice] DECIMAL(18,2) NOT NULL,
    [stockQty] INT NOT NULL,
    [moq] INT NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [supplier_products_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [supplier_products_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [supplier_products_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[wholesale_orders] (
    [id] INT NOT NULL IDENTITY(1,1),
    [supplierId] INT NOT NULL,
    [buyerId] INT NOT NULL,
    [status] VARCHAR(30) NOT NULL,
    [subtotal] DECIMAL(18,2) NOT NULL,
    [deliveryFee] DECIMAL(18,2) NOT NULL,
    [total] DECIMAL(18,2) NOT NULL,
    [note] NVARCHAR(500),
    [rejectReason] NVARCHAR(255),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [wholesale_orders_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [wholesale_orders_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[wholesale_order_items] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderId] INT NOT NULL,
    [productId] INT NOT NULL,
    [productName] NVARCHAR(150) NOT NULL,
    [packaging] NVARCHAR(50) NOT NULL,
    [quantity] INT NOT NULL,
    [unitPrice] DECIMAL(18,2) NOT NULL,
    [lineTotal] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [wholesale_order_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_products_supplierId_isActive_idx] ON [dbo].[supplier_products]([supplierId], [isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wholesale_orders_supplierId_status_idx] ON [dbo].[wholesale_orders]([supplierId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wholesale_orders_buyerId_idx] ON [dbo].[wholesale_orders]([buyerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wholesale_order_items_orderId_idx] ON [dbo].[wholesale_order_items]([orderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wholesale_order_items_productId_idx] ON [dbo].[wholesale_order_items]([productId]);

-- AddForeignKey
ALTER TABLE [dbo].[supplier_profiles] ADD CONSTRAINT [supplier_profiles_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_products] ADD CONSTRAINT [supplier_products_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[supplier_profiles]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[wholesale_orders] ADD CONSTRAINT [wholesale_orders_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[supplier_profiles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[wholesale_orders] ADD CONSTRAINT [wholesale_orders_buyerId_fkey] FOREIGN KEY ([buyerId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[wholesale_order_items] ADD CONSTRAINT [wholesale_order_items_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[wholesale_order_items] ADD CONSTRAINT [wholesale_order_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[supplier_products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'e724dfefff33dc4bd4df16233049f04120fffa10ce67e93fe824b483a8a11df0',N'202609210004_supplier_core_flow',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210005_stock_movements
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210005_stock_movements' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY
BEGIN TRAN;
CREATE TABLE [dbo].[stock_movements] (
 [id] VARCHAR(36) NOT NULL,
 [itemId] INT NOT NULL,
 [type] VARCHAR(20) NOT NULL,
 [quantityChange] INT NOT NULL,
 [quantityBefore] INT NOT NULL,
 [quantityAfter] INT NOT NULL,
 [productName] NVARCHAR(100) NOT NULL,
 [unit] NVARCHAR(20) NOT NULL,
 [note] NVARCHAR(250) NOT NULL,
 [createdAt] DATETIME2 NOT NULL CONSTRAINT [stock_movements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT [stock_movements_pkey] PRIMARY KEY CLUSTERED ([id]),
 CONSTRAINT [stock_movements_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[inventory_items]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT [stock_movements_nonnegative_check] CHECK ([quantityBefore] >= 0 AND [quantityAfter] >= 0)
);
CREATE INDEX [stock_movements_itemId_createdAt_idx] ON [dbo].[stock_movements]([itemId], [createdAt]);
-- Snapshot only: do not invent historical purchases/sales for existing stock.
INSERT INTO [dbo].[stock_movements] ([id],[itemId],[type],[quantityChange],[quantityBefore],[quantityAfter],[productName],[unit],[note])
SELECT CONVERT(VARCHAR(36),NEWID()),[id],''OPENING'',0,[quantity],[quantity],[name],[unit],N''Tồn đầu kỳ khi bật lịch sử; không phải giao dịch nhập hàng''
FROM [dbo].[inventory_items];
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'ee32549dd842895f727719058f52a59f4dc98b146beb1fdc0bcc52d64897ab19',N'202609210005_stock_movements',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609210006_restock_plans
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609210006_restock_plans' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY
BEGIN TRAN;
CREATE TABLE [dbo].[restock_plans] (
 [id] VARCHAR(36) NOT NULL,
 [ownerId] INT NOT NULL,
 [name] NVARCHAR(100) NOT NULL,
 [note] NVARCHAR(500) NOT NULL,
 [horizonDays] INT NOT NULL,
 [safetyDays] INT NOT NULL,
 [requestHash] VARCHAR(64) NOT NULL,
 [createdAt] DATETIME2 NOT NULL CONSTRAINT [restock_plans_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
 [updatedAt] DATETIME2 NOT NULL,
 CONSTRAINT [restock_plans_pkey] PRIMARY KEY ([id]),
 CONSTRAINT [restock_plans_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT [restock_plans_days_check] CHECK ([horizonDays] IN (7,14,30) AND [safetyDays] BETWEEN 0 AND 7)
);
CREATE INDEX [restock_plans_ownerId_createdAt_idx] ON [dbo].[restock_plans]([ownerId], [createdAt]);
CREATE TABLE [dbo].[restock_plan_lines] (
 [id] INT NOT NULL IDENTITY(1,1),
 [planId] VARCHAR(36) NOT NULL,
 [sourceItemId] INT NOT NULL,
 [productName] NVARCHAR(100) NOT NULL,
 [unit] NVARCHAR(20) NOT NULL,
 [quantity] INT NOT NULL,
 [stockSnapshot] INT NOT NULL,
 [suggestedQuantity] INT NULL,
 [averageDailySales] FLOAT(53) NULL,
 [observedDays] INT NOT NULL,
 CONSTRAINT [restock_plan_lines_pkey] PRIMARY KEY ([id]),
 CONSTRAINT [restock_plan_lines_planId_sourceItemId_key] UNIQUE ([planId], [sourceItemId]),
 CONSTRAINT [restock_plan_lines_planId_fkey] FOREIGN KEY ([planId]) REFERENCES [dbo].[restock_plans]([id]) ON DELETE CASCADE ON UPDATE NO ACTION,
 CONSTRAINT [restock_plan_lines_quantity_check] CHECK ([quantity] > 0 AND [stockSnapshot] >= 0 AND [observedDays] >= 0)
);
-- sourceItemId is a snapshot identifier, not a foreign key: saved plans retain
-- product name/unit even if inventory changes. API verifies ownership on save.
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'2b76dc9e9e60ec24bd5c8b82ce703d35bd5ef538ee20b613b76e1878bc639752',N'202609210006_restock_plans',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609220001_product_prices
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609220001_product_prices' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
BEGIN TRAN;
ALTER TABLE dbo.inventory_items ADD purchasePrice INT NULL CONSTRAINT inventory_items_purchasePrice_check CHECK (purchasePrice >= 0), sellingPrice INT NULL CONSTRAINT inventory_items_sellingPrice_check CHECK (sellingPrice >= 0);
ALTER TABLE dbo.restock_plan_lines ADD purchasePrice INT NULL CONSTRAINT restock_plan_lines_price_check CHECK (purchasePrice >= 0);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;

';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'4587e313b2f5aa3d3b42a91b47d7b202b4317f7a55b9057232fff58dff179fdc',N'202609220001_product_prices',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609220002_orders_catalog_recovery
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609220002_orders_catalog_recovery' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
BEGIN TRAN;
ALTER TABLE dbo.supplier_profiles ADD deliveryFee DECIMAL(18,2) NOT NULL CONSTRAINT supplier_profiles_deliveryFee_df DEFAULT 0 CONSTRAINT supplier_profiles_deliveryFee_check CHECK (deliveryFee >= 0);
ALTER TABLE dbo.supplier_products ADD category NVARCHAR(60) NOT NULL CONSTRAINT supplier_products_category_df DEFAULT N''Khác'', imageUrl NVARCHAR(1000) NULL;
ALTER TABLE dbo.wholesale_orders ADD requestId VARCHAR(36) NULL, requestHash VARCHAR(64) NULL, recipientName NVARCHAR(100) NULL, recipientPhone VARCHAR(20) NULL, deliveryAddress NVARCHAR(500) NULL;
-- Legacy orders have no request id. Only new checkout requests are unique.
EXEC(N''CREATE UNIQUE INDEX wholesale_orders_requestId_key ON dbo.wholesale_orders(requestId) WHERE requestId IS NOT NULL'');
CREATE TABLE dbo.password_resets (
 tokenHash VARCHAR(64) NOT NULL CONSTRAINT password_resets_pkey PRIMARY KEY,
 userId INT NOT NULL,
 passwordSnapshot VARCHAR(255) NOT NULL,
 expiresAt DATETIME2 NOT NULL,
 CONSTRAINT password_resets_userId_fkey FOREIGN KEY(userId) REFERENCES dbo.users(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX password_resets_userId_idx ON dbo.password_resets(userId);
CREATE INDEX password_resets_expiresAt_idx ON dbo.password_resets(expiresAt);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'fa58a79e25b09b73079026feeb92a8141ae732bdb80a84759ea75a5be94ed5d8',N'202609220002_orders_catalog_recovery',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609220003_platform_admin
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609220003_platform_admin' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
ALTER TABLE dbo.users ADD suspendedUntil DATETIME2 NULL, lockReason NVARCHAR(500) NULL;
ALTER TABLE dbo.supplier_profiles ADD
    region NVARCHAR(100) NULL, taxCode VARCHAR(30) NULL,
    legalRepresentative NVARCHAR(100) NULL, verificationDocumentUrl NVARCHAR(1000) NULL,
    verificationStatus VARCHAR(20) NOT NULL CONSTRAINT supplier_profiles_verificationStatus_df DEFAULT ''DRAFT'',
    verificationVersion INT NOT NULL CONSTRAINT supplier_profiles_verificationVersion_df DEFAULT 0,
    verificationNote NVARCHAR(500) NULL, submittedAt DATETIME2 NULL, reviewedAt DATETIME2 NULL, reviewedBy INT NULL;
ALTER TABLE dbo.wholesale_orders ADD
    commissionRate DECIMAL(5,2) NULL, commissionAmount DECIMAL(18,2) NULL,
    deliveredAt DATETIME2 NULL, supplierRegion NVARCHAR(100) NULL,
    commissionPaidAt DATETIME2 NULL, commissionPaidBy INT NULL, commissionPaymentReference NVARCHAR(150) NULL;
EXEC(N''ALTER TABLE dbo.supplier_profiles ADD CONSTRAINT supplier_profiles_verification_check CHECK (verificationStatus IN (''''DRAFT'''',''''PENDING'''',''''APPROVED'''',''''REJECTED''''))'');
EXEC(N''ALTER TABLE dbo.wholesale_orders ADD CONSTRAINT wholesale_orders_commission_check CHECK ((commissionRate IS NULL OR commissionRate BETWEEN 0 AND 100) AND (commissionAmount IS NULL OR commissionAmount >= 0))'');
EXEC(N''CREATE INDEX wholesale_orders_deliveredAt_idx ON dbo.wholesale_orders(deliveredAt)'');
EXEC(N''CREATE INDEX wholesale_orders_commissionPaidAt_idx ON dbo.wholesale_orders(commissionPaidAt)'');
CREATE TABLE dbo.platform_settings (
    id INT NOT NULL CONSTRAINT platform_settings_pkey PRIMARY KEY,
    commissionRate DECIMAL(5,2) NOT NULL CONSTRAINT platform_settings_commissionRate_df DEFAULT 0,
    version INT NOT NULL CONSTRAINT platform_settings_version_df DEFAULT 0,
    updatedAt DATETIME2 NOT NULL,
    CONSTRAINT platform_settings_rate_check CHECK (id = 1 AND commissionRate BETWEEN 0 AND 100)
);
-- No commission policy existed before this migration. Admin chooses the rate for new orders.
INSERT INTO dbo.platform_settings(id, commissionRate, version, updatedAt) VALUES (1, 0, 0, CURRENT_TIMESTAMP);
CREATE TABLE dbo.audit_logs (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT audit_logs_pkey PRIMARY KEY,
    actorId INT NULL, action VARCHAR(60) NOT NULL, entityType VARCHAR(40) NOT NULL,
    entityId VARCHAR(50) NOT NULL, details NVARCHAR(MAX) NOT NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT audit_logs_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_logs_createdAt_id_idx ON dbo.audit_logs(createdAt, id);
CREATE INDEX audit_logs_action_createdAt_idx ON dbo.audit_logs(action, createdAt);
CREATE TABLE dbo.ai_usage_events (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT ai_usage_events_pkey PRIMARY KEY,
    userId INT NOT NULL, provider VARCHAR(20) NOT NULL, model NVARCHAR(100) NULL,
    status VARCHAR(20) NOT NULL, durationMs INT NOT NULL, inputTokens INT NULL, outputTokens INT NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT ai_usage_events_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_usage_events_createdAt_provider_idx ON dbo.ai_usage_events(createdAt, provider);
CREATE TABLE dbo.recommendation_runs (
    id VARCHAR(36) NOT NULL CONSTRAINT recommendation_runs_pkey PRIMARY KEY,
    ownerId INT NOT NULL, horizonDays INT NOT NULL, safetyDays INT NOT NULL,
    suggestions NVARCHAR(MAX) NOT NULL, acceptedAt DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT recommendation_runs_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX recommendation_runs_createdAt_idx ON dbo.recommendation_runs(createdAt);
CREATE INDEX recommendation_runs_ownerId_createdAt_idx ON dbo.recommendation_runs(ownerId, createdAt);
COMMIT TRANSACTION;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'0c37ae01c287630387d27b3072ffa90f68fddbd819d21ac3184945dabf7e1815',N'202609220003_platform_admin',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609230001_store_revenue
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609230001_store_revenue' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'SET XACT_ABORT ON;
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON; SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
BEGIN TRANSACTION;

ALTER TABLE [dbo].[stock_movements] ADD [unitSalePrice] INT NULL;
-- Compile the constraint after ALTER TABLE has added the column (SQL Server).
EXEC(N''ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_sale_price_check]
CHECK ([unitSalePrice] IS NULL OR ([type] = ''''SALE'''' AND [quantityChange] < 0 AND [unitSalePrice] >= 0))'');

-- Older movements have no price snapshot. Leave them unknown instead of
-- inventing revenue from the product''s current selling price.
COMMIT TRANSACTION;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
THROW;
END CATCH;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'41a0587d1096343bf7d310cb6a6911dd33b1c61788ebd2534858bd3c2e31c187',N'202609230001_store_revenue',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609280001_transaction_dates
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609280001_transaction_dates' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'-- createdAt is reused as the business occurrence time for late-entered movements.
-- No historical rows are rewritten.
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'528f016654b0a74cd457bbc5ac145bc61be15861819464967eed77f6b3eefe69',N'202609280001_transaction_dates',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202609280002_inventory_lots
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202609280002_inventory_lots' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'CREATE TABLE [dbo].[inventory_lots] (
  [id] INT NOT NULL IDENTITY(1,1),
  [itemId] INT NOT NULL,
  [quantity] INT NOT NULL CONSTRAINT [inventory_lots_quantity_df] DEFAULT 0,
  [receivedAt] DATETIME2 NOT NULL CONSTRAINT [inventory_lots_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
  [expiryDate] DATE NULL,
  [purchasePrice] INT NULL,
  CONSTRAINT [inventory_lots_pkey] PRIMARY KEY CLUSTERED ([id]),
  CONSTRAINT [inventory_lots_quantity_check] CHECK ([quantity] >= 0),
  CONSTRAINT [inventory_lots_purchasePrice_check] CHECK ([purchasePrice] IS NULL OR [purchasePrice] >= 0),
  CONSTRAINT [inventory_lots_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[inventory_items]([id]) ON DELETE CASCADE
);
CREATE INDEX [inventory_lots_itemId_expiryDate_receivedAt_idx] ON [dbo].[inventory_lots]([itemId], [expiryDate], [receivedAt]);
INSERT INTO [dbo].[inventory_lots] ([itemId],[quantity],[expiryDate],[purchasePrice])
SELECT [id],[quantity],[expiryDate],[purchasePrice] FROM [dbo].[inventory_items] WHERE [quantity] > 0;
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'32f5697594c1a6f635071c1ec2068d67bf8cbc3d8676483add392519d540e01d',N'202609280002_inventory_lots',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20260928095545_deal_and_complaints
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20260928095545_deal_and_complaints' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[inventory_lots] DROP CONSTRAINT [inventory_lots_itemId_fkey];

-- AlterTable
ALTER TABLE [dbo].[supplier_products] DROP CONSTRAINT [supplier_products_category_df];
ALTER TABLE [dbo].[supplier_products] ADD CONSTRAINT [supplier_products_category_df] DEFAULT ''Khác'' FOR [category];

-- AlterTable
ALTER TABLE [dbo].[wholesale_orders] ADD [agreedTotal] DECIMAL(18,2),
[dealResponse] NVARCHAR(500),
[dealStatus] VARCHAR(20),
[proposedTotal] DECIMAL(18,2);

-- CreateTable
CREATE TABLE [dbo].[order_complaints] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderId] INT NOT NULL,
    [buyerId] INT NOT NULL,
    [supplierId] INT NOT NULL,
    [reason] VARCHAR(40) NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [order_complaints_status_df] DEFAULT ''OPEN'',
    [response] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [order_complaints_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [order_complaints_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [order_complaints_orderId_key] UNIQUE NONCLUSTERED ([orderId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_complaints_buyerId_status_idx] ON [dbo].[order_complaints]([buyerId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_complaints_supplierId_status_idx] ON [dbo].[order_complaints]([supplierId], [status]);

-- AddForeignKey
ALTER TABLE [dbo].[inventory_lots] ADD CONSTRAINT [inventory_lots_itemId_fkey] FOREIGN KEY ([itemId]) REFERENCES [dbo].[inventory_items]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[order_complaints] ADD CONSTRAINT [order_complaints_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_complaints] ADD CONSTRAINT [order_complaints_buyerId_fkey] FOREIGN KEY ([buyerId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_complaints] ADD CONSTRAINT [order_complaints_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[supplier_profiles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'd3184d2db7e7495141b374d78672d0dfb49ce4ebe9fdbc3371c7e4405a71ddb5',N'20260928095545_deal_and_complaints',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 202610020001_complaint_image_and_unicode_reason
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'202610020001_complaint_image_and_unicode_reason' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'ALTER TABLE [dbo].[order_complaints] ALTER COLUMN [reason] NVARCHAR(200) NOT NULL;
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(''[dbo].[order_complaints]'') 
    AND name = ''imageUrl''
)
BEGIN
    ALTER TABLE [dbo].[order_complaints] ADD [imageUrl] NVARCHAR(1000) NULL;
END
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'd76a3139d7a772761877550ca691eeea276f734b3520873da132b49647d50735',N'202610020001_complaint_image_and_unicode_reason',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20261012052719_holiday_price_history
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20261012052719_holiday_price_history' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[supplier_product_price_history] (
    [id] INT NOT NULL IDENTITY(1,1),
    [productId] INT NOT NULL,
    [oldPrice] DECIMAL(18,2) NOT NULL,
    [newPrice] DECIMAL(18,2) NOT NULL,
    [changePercent] DECIMAL(9,2) NOT NULL,
    [reason] NVARCHAR(500),
    [changedBy] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [supplier_product_price_history_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [supplier_product_price_history_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[holiday_configs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(150) NOT NULL,
    [startDate] DATE NOT NULL,
    [endDate] DATE NOT NULL,
    [preparationDays] INT NOT NULL CONSTRAINT [holiday_configs_preparationDays_df] DEFAULT 14,
    [demandMultiplier] DECIMAL(4,2) NOT NULL CONSTRAINT [holiday_configs_demandMultiplier_df] DEFAULT 1,
    [categoryKeywords] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(500),
    [isActive] BIT NOT NULL CONSTRAINT [holiday_configs_isActive_df] DEFAULT 1,
    [version] INT NOT NULL CONSTRAINT [holiday_configs_version_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [holiday_configs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [holiday_configs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_product_price_history_productId_createdAt_idx] ON [dbo].[supplier_product_price_history]([productId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [holiday_configs_isActive_startDate_endDate_idx] ON [dbo].[holiday_configs]([isActive], [startDate], [endDate]);

-- AddForeignKey
ALTER TABLE [dbo].[supplier_product_price_history] ADD CONSTRAINT [supplier_product_price_history_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[supplier_products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'c8a82d1f914778d2bab45e8002bdbf00f7161e3912f1692188c164139fb87f8a',N'20261012052719_holiday_price_history',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20261012064027_deposits_and_marketing_quotes
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20261012064027_deposits_and_marketing_quotes' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[wholesale_orders] ADD [depositAmount] DECIMAL(18,2) NOT NULL CONSTRAINT [wholesale_orders_depositAmount_df] DEFAULT 0,
[depositPaidAt] DATETIME2,
[depositRate] DECIMAL(5,2) NOT NULL CONSTRAINT [wholesale_orders_depositRate_df] DEFAULT 0,
[depositReference] VARCHAR(100),
[depositStatus] VARCHAR(20) NOT NULL CONSTRAINT [wholesale_orders_depositStatus_df] DEFAULT ''NONE'';

-- CreateTable
CREATE TABLE [dbo].[supplier_quotes] (
    [id] INT NOT NULL IDENTITY(1,1),
    [supplierId] INT NOT NULL,
    [buyerId] INT NOT NULL,
    [title] NVARCHAR(150) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [supplier_quotes_status_df] DEFAULT ''SENT'',
    [validUntil] DATE NOT NULL,
    [subtotal] DECIMAL(18,2) NOT NULL,
    [deliveryFee] DECIMAL(18,2) NOT NULL CONSTRAINT [supplier_quotes_deliveryFee_df] DEFAULT 0,
    [total] DECIMAL(18,2) NOT NULL,
    [depositRate] DECIMAL(5,2) NOT NULL CONSTRAINT [supplier_quotes_depositRate_df] DEFAULT 0,
    [note] NVARCHAR(500),
    [responseNote] NVARCHAR(500),
    [respondedAt] DATETIME2,
    [orderId] INT,
    [version] INT NOT NULL CONSTRAINT [supplier_quotes_version_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [supplier_quotes_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [supplier_quotes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [supplier_quotes_orderId_key] UNIQUE NONCLUSTERED ([orderId])
);

-- CreateTable
CREATE TABLE [dbo].[supplier_quote_lines] (
    [id] INT NOT NULL IDENTITY(1,1),
    [quoteId] INT NOT NULL,
    [productId] INT NOT NULL,
    [productName] NVARCHAR(150) NOT NULL,
    [packaging] NVARCHAR(50) NOT NULL,
    [quantity] INT NOT NULL,
    [unitPrice] DECIMAL(18,2) NOT NULL,
    [lineTotal] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [supplier_quote_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_quotes_supplierId_status_createdAt_idx] ON [dbo].[supplier_quotes]([supplierId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_quotes_buyerId_status_createdAt_idx] ON [dbo].[supplier_quotes]([buyerId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_quote_lines_quoteId_idx] ON [dbo].[supplier_quote_lines]([quoteId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [supplier_quote_lines_productId_idx] ON [dbo].[supplier_quote_lines]([productId]);

-- AddForeignKey
ALTER TABLE [dbo].[supplier_quotes] ADD CONSTRAINT [supplier_quotes_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[supplier_profiles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_quotes] ADD CONSTRAINT [supplier_quotes_buyerId_fkey] FOREIGN KEY ([buyerId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_quotes] ADD CONSTRAINT [supplier_quotes_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_quote_lines] ADD CONSTRAINT [supplier_quote_lines_quoteId_fkey] FOREIGN KEY ([quoteId]) REFERENCES [dbo].[supplier_quotes]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[supplier_quote_lines] ADD CONSTRAINT [supplier_quote_lines_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[supplier_products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'9ba90b39cdb689b97ee26d5037b6b72788307a01c4128fe233201cebf2538226',N'20261012064027_deposits_and_marketing_quotes',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20261012071056_monthly_subscriptions
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20261012071056_monthly_subscriptions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[subscriptions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [subscriptions_status_df] DEFAULT ''TRIAL'',
    [monthlyPrice] DECIMAL(18,2) NOT NULL CONSTRAINT [subscriptions_monthlyPrice_df] DEFAULT 19000,
    [trialStartedAt] DATETIME2 NOT NULL,
    [trialEndsAt] DATETIME2 NOT NULL,
    [currentPeriodStart] DATETIME2,
    [currentPeriodEnd] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [subscriptions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [subscriptions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [subscriptions_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[subscription_payments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [subscriptionId] INT NOT NULL,
    [requestId] VARCHAR(36) NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [subscription_payments_status_df] DEFAULT ''PAID'',
    [method] VARCHAR(30) NOT NULL CONSTRAINT [subscription_payments_method_df] DEFAULT ''SIMULATED'',
    [reference] VARCHAR(100) NOT NULL,
    [periodStart] DATETIME2 NOT NULL,
    [periodEnd] DATETIME2 NOT NULL,
    [paidAt] DATETIME2 NOT NULL CONSTRAINT [subscription_payments_paidAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [subscription_payments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [subscription_payments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [subscription_payments_requestId_key] UNIQUE NONCLUSTERED ([requestId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_status_trialEndsAt_idx] ON [dbo].[subscriptions]([status], [trialEndsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_status_currentPeriodEnd_idx] ON [dbo].[subscriptions]([status], [currentPeriodEnd]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscription_payments_subscriptionId_paidAt_idx] ON [dbo].[subscription_payments]([subscriptionId], [paidAt]);

-- AddForeignKey
ALTER TABLE [dbo].[subscriptions] ADD CONSTRAINT [subscriptions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[subscription_payments] ADD CONSTRAINT [subscription_payments_subscriptionId_fkey] FOREIGN KEY ([subscriptionId]) REFERENCES [dbo].[subscriptions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'15b48985a38c8e761a6f951c9988f96bcd7c6144998246b8fb22c3019b3feaae',N'20261012071056_monthly_subscriptions',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20261012193000_direct_deposit_confirmation
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20261012193000_direct_deposit_confirmation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[supplier_profiles] ADD
  [bankName] NVARCHAR(100),
  [bankAccountNumber] VARCHAR(34),
  [bankAccountHolder] NVARCHAR(100);

ALTER TABLE [dbo].[wholesale_orders] ADD
  [depositBankName] NVARCHAR(100),
  [depositBankAccountNumber] VARCHAR(34),
  [depositBankAccountHolder] NVARCHAR(100),
  [depositSubmittedAt] DATETIME2,
  [depositReviewedAt] DATETIME2,
  [depositRejectionReason] NVARCHAR(255),
  [depositRefundedAt] DATETIME2,
  [depositRefundReference] VARCHAR(100);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'5a3a4f88ed1b9896ee8ed802803bd93f4fce74447fe854fc5286b5bf1ccf4c71',N'20261012193000_direct_deposit_confirmation',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO
-- Migration: 20261012194500_quote_nullable_order_unique
IF NOT EXISTS (SELECT 1 FROM dbo._prisma_migrations WHERE migration_name=N'20261012194500_quote_nullable_order_unique' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[supplier_quotes]
DROP CONSTRAINT [supplier_quotes_orderId_key];

CREATE UNIQUE NONCLUSTERED INDEX [supplier_quotes_orderId_key]
ON [dbo].[supplier_quotes]([orderId])
WHERE [orderId] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
';
  INSERT dbo._prisma_migrations(id,checksum,migration_name,finished_at,applied_steps_count)
  VALUES(CONVERT(NVARCHAR(36),NEWID()),N'0118edc8f483154a00cb27c6d72fdb53abe220a938363ee8c6806cfa7dd0353d',N'20261012194500_quote_nullable_order_unique',SYSDATETIMEOFFSET(),1);
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;
GO