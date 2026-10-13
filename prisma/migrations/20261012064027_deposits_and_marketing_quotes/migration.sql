BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[wholesale_orders] ADD [depositAmount] DECIMAL(18,2) NOT NULL CONSTRAINT [wholesale_orders_depositAmount_df] DEFAULT 0,
[depositPaidAt] DATETIME2,
[depositRate] DECIMAL(5,2) NOT NULL CONSTRAINT [wholesale_orders_depositRate_df] DEFAULT 0,
[depositReference] VARCHAR(100),
[depositStatus] VARCHAR(20) NOT NULL CONSTRAINT [wholesale_orders_depositStatus_df] DEFAULT 'NONE';

-- CreateTable
CREATE TABLE [dbo].[supplier_quotes] (
    [id] INT NOT NULL IDENTITY(1,1),
    [supplierId] INT NOT NULL,
    [buyerId] INT NOT NULL,
    [title] NVARCHAR(150) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [supplier_quotes_status_df] DEFAULT 'SENT',
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
