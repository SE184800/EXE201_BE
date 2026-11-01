BEGIN TRY
BEGIN TRAN;
ALTER TABLE [dbo].[wholesale_orders] ADD [inventoryImportedAt] DATETIME2 NULL;
ALTER TABLE [dbo].[inventory_lots] ADD [sourceOrderId] INT NULL;
CREATE INDEX [inventory_lots_sourceOrderId_idx] ON [dbo].[inventory_lots]([sourceOrderId]);
ALTER TABLE [dbo].[inventory_lots] ADD CONSTRAINT [inventory_lots_sourceOrderId_fkey]
FOREIGN KEY ([sourceOrderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Backfill legacy automatic imports without adding their quantities again.
EXEC(N'UPDATE orders SET inventoryImportedAt = history.importedAt
FROM dbo.wholesale_orders AS orders
CROSS APPLY (
  SELECT MIN(movement.createdAt) AS importedAt
  FROM dbo.stock_movements AS movement
  INNER JOIN dbo.inventory_items AS item ON item.id = movement.itemId
  WHERE item.ownerId = orders.buyerId AND movement.type IN (''IMPORT'', ''RECEIPT'')
    AND (CHARINDEX(N''[ĐƠN SỈ #'' + CONVERT(NVARCHAR(20), orders.id) + N'']'', movement.note) > 0
      OR CHARINDEX(N''đơn sỉ #'' + CONVERT(NVARCHAR(20), orders.id) + N'' ['', movement.note) > 0)
) AS history WHERE history.importedAt IS NOT NULL;');
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
