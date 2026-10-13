BEGIN TRY

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
