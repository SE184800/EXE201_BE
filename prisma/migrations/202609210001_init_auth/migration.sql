BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[roles] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] VARCHAR(30) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    CONSTRAINT [roles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [roles_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] INT NOT NULL IDENTITY(1,1),
    [username] VARCHAR(50) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [passwordHash] VARCHAR(255) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [users_isActive_df] DEFAULT 1,
    [roleId] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_username_key] UNIQUE NONCLUSTERED ([username])
);

-- CreateTable
CREATE TABLE [dbo].[auth_sessions] (
    [id] VARCHAR(36) NOT NULL,
    [userId] INT NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [auth_sessions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [auth_sessions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_roleId_idx] ON [dbo].[users]([roleId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [auth_sessions_userId_idx] ON [dbo].[auth_sessions]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [auth_sessions_expiresAt_idx] ON [dbo].[auth_sessions]([expiresAt]);

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[roles]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[auth_sessions] ADD CONSTRAINT [auth_sessions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
