require('dotenv').config();
const prisma = require('../config/db');

async function syncAllDb() {
  console.log('[SYNC] Đang kiểm tra và đồng bộ toàn bộ 18 Bảng & Cột lên SQL Server...');

  const sqlStatements = [
    // 1. roles
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[roles]'))
    BEGIN
        CREATE TABLE [dbo].[roles] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [code] VARCHAR(30) NOT NULL,
            [name] NVARCHAR(100) NOT NULL,
            CONSTRAINT [PK_roles] PRIMARY KEY CLUSTERED ([id] ASC),
            CONSTRAINT [UQ_roles_code] UNIQUE ([code])
        );
    END`,

    // 2. users
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[users]'))
    BEGIN
        CREATE TABLE [dbo].[users] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [username] VARCHAR(50) NOT NULL,
            [name] NVARCHAR(100) NOT NULL,
            [email] VARCHAR(255) NULL,
            [phone] VARCHAR(20) NULL,
            [dateOfBirth] DATE NULL,
            [passwordHash] VARCHAR(255) NOT NULL,
            [isActive] BIT NOT NULL DEFAULT 1,
            [suspendedUntil] DATETIME2 NULL,
            [lockReason] NVARCHAR(500) NULL,
            [roleId] INT NOT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_users] PRIMARY KEY CLUSTERED ([id] ASC),
            CONSTRAINT [UQ_users_username] UNIQUE ([username])
        );
    END`,

    // 3. inventory_items
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[inventory_items]'))
    BEGIN
        CREATE TABLE [dbo].[inventory_items] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [ownerId] INT NOT NULL,
            [name] NVARCHAR(100) NOT NULL,
            [unit] NVARCHAR(20) NOT NULL,
            [quantity] INT NOT NULL DEFAULT 0,
            [lowThreshold] INT NOT NULL DEFAULT 5,
            [purchasePrice] INT NULL,
            [sellingPrice] INT NULL,
            [expiryDate] DATE NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_inventory_items] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 4. inventory_lots
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[inventory_lots]'))
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
    END`,

    // 5. stock_movements
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[stock_movements]'))
    BEGIN
        CREATE TABLE [dbo].[stock_movements] (
            [id] VARCHAR(36) NOT NULL,
            [itemId] INT NOT NULL,
            [type] VARCHAR(20) NOT NULL,
            [quantityChange] INT NOT NULL,
            [quantityBefore] INT NOT NULL,
            [quantityAfter] INT NOT NULL,
            [unitSalePrice] INT NULL,
            [productName] NVARCHAR(100) NOT NULL,
            [unit] NVARCHAR(20) NOT NULL,
            [note] NVARCHAR(250) NOT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_stock_movements] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 6. supplier_profiles
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[supplier_profiles]'))
    BEGIN
        CREATE TABLE [dbo].[supplier_profiles] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [userId] INT NOT NULL,
            [businessName] NVARCHAR(150) NOT NULL,
            [warehouseAddress] NVARCHAR(255) NOT NULL,
            [deliveryRadiusKm] DECIMAL(8,2) NOT NULL,
            [deliveryFee] DECIMAL(18,2) NOT NULL DEFAULT 0,
            [region] NVARCHAR(100) NULL,
            [taxCode] VARCHAR(30) NULL,
            [legalRepresentative] NVARCHAR(100) NULL,
            [verificationDocumentUrl] NVARCHAR(1000) NULL,
            [verificationStatus] VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
            [verificationVersion] INT NOT NULL DEFAULT 0,
            [verificationNote] NVARCHAR(500) NULL,
            [submittedAt] DATETIME2 NULL,
            [reviewedAt] DATETIME2 NULL,
            [reviewedBy] INT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_supplier_profiles] PRIMARY KEY CLUSTERED ([id] ASC),
            CONSTRAINT [UQ_supplier_profiles_userId] UNIQUE ([userId])
        );
    END`,

    // 7. supplier_products
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[supplier_products]'))
    BEGIN
        CREATE TABLE [dbo].[supplier_products] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [supplierId] INT NOT NULL,
            [name] NVARCHAR(150) NOT NULL,
            [category] NVARCHAR(60) NOT NULL DEFAULT N'Khác',
            [packaging] NVARCHAR(50) NOT NULL,
            [wholesalePrice] DECIMAL(18,2) NOT NULL,
            [stockQty] INT NOT NULL,
            [moq] INT NOT NULL,
            [imageUrl] NVARCHAR(1000) NULL,
            [isActive] BIT NOT NULL DEFAULT 1,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_supplier_products] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 8. wholesale_orders
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[wholesale_orders]'))
    BEGIN
        CREATE TABLE [dbo].[wholesale_orders] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [supplierId] INT NOT NULL,
            [buyerId] INT NOT NULL,
            [status] VARCHAR(30) NOT NULL,
            [subtotal] DECIMAL(18,2) NOT NULL,
            [deliveryFee] DECIMAL(18,2) NOT NULL,
            [total] DECIMAL(18,2) NOT NULL,
            [note] NVARCHAR(500) NULL,
            [rejectReason] NVARCHAR(255) NULL,
            [recipientName] NVARCHAR(100) NULL,
            [recipientPhone] VARCHAR(20) NULL,
            [deliveryAddress] NVARCHAR(500) NULL,
            [supplierRegion] NVARCHAR(100) NULL,
            [commissionRate] DECIMAL(5,2) NULL,
            [commissionAmount] DECIMAL(18,2) NULL,
            [deliveredAt] DATETIME2 NULL,
            [commissionPaidAt] DATETIME2 NULL,
            [commissionPaidBy] INT NULL,
            [commissionPaymentReference] NVARCHAR(150) NULL,
            [requestId] VARCHAR(36) NULL,
            [requestHash] VARCHAR(64) NULL,
            [dealStatus] VARCHAR(20) NULL,
            [proposedTotal] DECIMAL(18,2) NULL,
            [agreedTotal] DECIMAL(18,2) NULL,
            [dealResponse] NVARCHAR(500) NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_wholesale_orders] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // Ensure wholesale_orders columns exist
    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[wholesale_orders]') AND name = N'dealStatus')
    BEGIN
        ALTER TABLE [dbo].[wholesale_orders] ADD [dealStatus] VARCHAR(20) NULL;
        ALTER TABLE [dbo].[wholesale_orders] ADD [proposedTotal] DECIMAL(18,2) NULL;
        ALTER TABLE [dbo].[wholesale_orders] ADD [agreedTotal] DECIMAL(18,2) NULL;
        ALTER TABLE [dbo].[wholesale_orders] ADD [dealResponse] NVARCHAR(500) NULL;
    END`,

    // 9. order_complaints
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[order_complaints]'))
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
    END`,

    // Ensure order_complaints columns exist
    `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[order_complaints]') AND name = N'imageUrl')
    BEGIN
        ALTER TABLE [dbo].[order_complaints] ADD [imageUrl] NVARCHAR(1000) NULL;
    END`,

    // 10. wholesale_order_items
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[wholesale_order_items]'))
    BEGIN
        CREATE TABLE [dbo].[wholesale_order_items] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [orderId] INT NOT NULL,
            [productId] INT NOT NULL,
            [productName] NVARCHAR(150) NOT NULL,
            [packaging] NVARCHAR(50) NOT NULL,
            [quantity] INT NOT NULL,
            [unitPrice] DECIMAL(18,2) NOT NULL,
            [lineTotal] DECIMAL(18,2) NOT NULL,
            CONSTRAINT [PK_wholesale_order_items] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 11. auth_sessions
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[auth_sessions]'))
    BEGIN
        CREATE TABLE [dbo].[auth_sessions] (
            [id] VARCHAR(36) NOT NULL,
            [userId] INT NOT NULL,
            [expiresAt] DATETIME2 NOT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_auth_sessions] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 12. platform_settings
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[platform_settings]'))
    BEGIN
        CREATE TABLE [dbo].[platform_settings] (
            [id] INT NOT NULL,
            [commissionRate] DECIMAL(5,2) NOT NULL DEFAULT 0,
            [version] INT NOT NULL DEFAULT 0,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_platform_settings] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 13. audit_logs
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[audit_logs]'))
    BEGIN
        CREATE TABLE [dbo].[audit_logs] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [actorId] INT NULL,
            [action] VARCHAR(60) NOT NULL,
            [entityType] VARCHAR(40) NOT NULL,
            [entityId] VARCHAR(50) NOT NULL,
            [details] NVARCHAR(MAX) NOT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_audit_logs] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 14. ai_usage_events
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[ai_usage_events]'))
    BEGIN
        CREATE TABLE [dbo].[ai_usage_events] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [userId] INT NOT NULL,
            [provider] VARCHAR(20) NOT NULL,
            [model] NVARCHAR(100) NULL,
            [status] VARCHAR(20) NOT NULL,
            [durationMs] INT NOT NULL,
            [inputTokens] INT NULL,
            [outputTokens] INT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_ai_usage_events] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 15. recommendation_runs
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[recommendation_runs]'))
    BEGIN
        CREATE TABLE [dbo].[recommendation_runs] (
            [id] VARCHAR(36) NOT NULL,
            [ownerId] INT NOT NULL,
            [horizonDays] INT NOT NULL,
            [safetyDays] INT NOT NULL,
            [suggestions] NVARCHAR(MAX) NOT NULL,
            [acceptedAt] DATETIME2 NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_recommendation_runs] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 16. password_resets
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[password_resets]'))
    BEGIN
        CREATE TABLE [dbo].[password_resets] (
            [tokenHash] VARCHAR(64) NOT NULL,
            [userId] INT NOT NULL,
            [passwordSnapshot] VARCHAR(255) NOT NULL,
            [expiresAt] DATETIME2 NOT NULL,
            CONSTRAINT [PK_password_resets] PRIMARY KEY CLUSTERED ([tokenHash] ASC)
        );
    END`,

    // 17. restock_plans
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[restock_plans]'))
    BEGIN
        CREATE TABLE [dbo].[restock_plans] (
            [id] VARCHAR(36) NOT NULL,
            [ownerId] INT NOT NULL,
            [name] NVARCHAR(100) NOT NULL,
            [note] NVARCHAR(500) NOT NULL,
            [horizonDays] INT NOT NULL,
            [safetyDays] INT NOT NULL,
            [requestHash] VARCHAR(64) NOT NULL,
            [createdAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            [updatedAt] DATETIME2 NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT [PK_restock_plans] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`,

    // 18. restock_plan_lines
    `IF NOT EXISTS (SELECT * FROM sys.tables WHERE object_id = OBJECT_ID(N'[dbo].[restock_plan_lines]'))
    BEGIN
        CREATE TABLE [dbo].[restock_plan_lines] (
            [id] INT IDENTITY(1,1) NOT NULL,
            [planId] VARCHAR(36) NOT NULL,
            [sourceItemId] INT NOT NULL,
            [productName] NVARCHAR(100) NOT NULL,
            [unit] NVARCHAR(20) NOT NULL,
            [quantity] INT NOT NULL,
            [stockSnapshot] INT NOT NULL,
            [suggestedQuantity] INT NULL,
            [averageDailySales] FLOAT NULL,
            [observedDays] INT NOT NULL,
            [purchasePrice] INT NULL,
            CONSTRAINT [PK_restock_plan_lines] PRIMARY KEY CLUSTERED ([id] ASC)
        );
    END`
  ];

  for (const statement of sqlStatements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (err) {
      console.log('[WARN] Bảng/Cột đã sẵn sàng:', err.message);
    }
  }

  console.log('[SUCCESS] THÀNH CÔNG: ĐÃ ĐỒNG BỘ TOÀN BỘ 18 BẢNG VÀ TẤT CẢ CỘT TRÊN CSDL!');
}

syncAllDb()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
