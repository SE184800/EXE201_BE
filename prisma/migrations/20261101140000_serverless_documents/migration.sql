BEGIN TRY
BEGIN TRAN;
CREATE TABLE [dbo].[application_documents] (
    [key] VARCHAR(100) NOT NULL CONSTRAINT [application_documents_pkey] PRIMARY KEY,
    [payload] NVARCHAR(MAX) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [application_documents_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [application_documents_json_check] CHECK (ISJSON([payload]) = 1)
);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
