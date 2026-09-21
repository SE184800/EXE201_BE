-- Seed/admin accounts may omit contact details. Enforce uniqueness only for
-- non-null values; a regular SQL Server UNIQUE constraint would allow one NULL.
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
  BEGIN TRAN;
  CREATE UNIQUE NONCLUSTERED INDEX [users_email_unique_not_null]
    ON [dbo].[users]([email]) WHERE [email] IS NOT NULL;
  CREATE UNIQUE NONCLUSTERED INDEX [users_phone_unique_not_null]
    ON [dbo].[users]([phone]) WHERE [phone] IS NOT NULL;
  DROP INDEX [users_email_idx] ON [dbo].[users];
  DROP INDEX [users_phone_idx] ON [dbo].[users];
  COMMIT TRAN;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
