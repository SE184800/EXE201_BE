SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRANSACTION;

ALTER TABLE [dbo].[stock_movements] ADD [unitSalePrice] INT NULL;
-- Compile the constraint after ALTER TABLE has added the column (SQL Server).
EXEC(N'ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_sale_price_check]
CHECK ([unitSalePrice] IS NULL OR ([type] = ''SALE'' AND [quantityChange] < 0 AND [unitSalePrice] >= 0))');

-- Older movements have no price snapshot. Leave them unknown instead of
-- inventing revenue from the product's current selling price.
COMMIT TRANSACTION;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
THROW;
END CATCH;
