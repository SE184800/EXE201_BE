BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[users] ADD [dateOfBirth] DATE,
[email] VARCHAR(255),
[phone] VARCHAR(20);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_email_idx] ON [dbo].[users]([email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_phone_idx] ON [dbo].[users]([phone]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
