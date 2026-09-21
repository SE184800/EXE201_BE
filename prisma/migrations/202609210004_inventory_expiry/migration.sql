-- Optional expiry date: existing inventory stays unchanged with NULL.
ALTER TABLE [dbo].[inventory_items] ADD [expiryDate] DATE NULL;
