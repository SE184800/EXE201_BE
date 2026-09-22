BEGIN TRY
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
