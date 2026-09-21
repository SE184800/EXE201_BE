BEGIN TRY
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
SELECT CONVERT(VARCHAR(36),NEWID()),[id],'OPENING',0,[quantity],[quantity],[name],[unit],N'Tồn đầu kỳ khi bật lịch sử; không phải giao dịch nhập hàng'
FROM [dbo].[inventory_items];
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
