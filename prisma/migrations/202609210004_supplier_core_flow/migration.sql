BEGIN TRY

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
