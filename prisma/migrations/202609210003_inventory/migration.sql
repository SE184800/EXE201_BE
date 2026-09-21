BEGIN TRY
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
