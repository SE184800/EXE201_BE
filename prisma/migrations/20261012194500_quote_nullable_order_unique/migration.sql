BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[supplier_quotes]
DROP CONSTRAINT [supplier_quotes_orderId_key];

CREATE UNIQUE NONCLUSTERED INDEX [supplier_quotes_orderId_key]
ON [dbo].[supplier_quotes]([orderId])
WHERE [orderId] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
