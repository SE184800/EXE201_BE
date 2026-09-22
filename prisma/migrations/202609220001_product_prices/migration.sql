SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
ALTER TABLE dbo.inventory_items ADD purchasePrice INT NULL CONSTRAINT inventory_items_purchasePrice_check CHECK (purchasePrice >= 0), sellingPrice INT NULL CONSTRAINT inventory_items_sellingPrice_check CHECK (sellingPrice >= 0);
ALTER TABLE dbo.restock_plan_lines ADD purchasePrice INT NULL CONSTRAINT restock_plan_lines_price_check CHECK (purchasePrice >= 0);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;

