BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[inventory_lots] DROP CONSTRAINT [inventory_lots_itemId_fkey];

-- AlterTable
ALTER TABLE [dbo].[supplier_products] DROP CONSTRAINT [supplier_products_category_df];
ALTER TABLE [dbo].[supplier_products] ADD CONSTRAINT [supplier_products_category_df] DEFAULT 'Khác' FOR [category];

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
    [status] VARCHAR(20) NOT NULL CONSTRAINT [order_complaints_status_df] DEFAULT 'OPEN',
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
