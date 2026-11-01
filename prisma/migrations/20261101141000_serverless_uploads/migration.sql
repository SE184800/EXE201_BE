BEGIN TRY
BEGIN TRAN;
CREATE TABLE [dbo].[application_uploads] (
    [filename] VARCHAR(150) NOT NULL CONSTRAINT [application_uploads_pkey] PRIMARY KEY,
    [contentType] VARCHAR(100) NOT NULL,
    [content] VARBINARY(MAX) NOT NULL,
    [ownerId] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [application_uploads_createdAt_df] DEFAULT SYSUTCDATETIME()
);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
