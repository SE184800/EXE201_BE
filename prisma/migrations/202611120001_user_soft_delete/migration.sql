ALTER TABLE [dbo].[users] ADD [deletedAt] DATETIME2 NULL;
CREATE INDEX [users_deletedAt_idx] ON [dbo].[users]([deletedAt]);
