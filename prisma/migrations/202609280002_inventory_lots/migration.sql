CREATE TABLE [dbo].[inventory_lots] (
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
