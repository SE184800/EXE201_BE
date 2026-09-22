SET XACT_ABORT ON;
BEGIN TRY
BEGIN TRAN;
ALTER TABLE dbo.supplier_profiles ADD deliveryFee DECIMAL(18,2) NOT NULL CONSTRAINT supplier_profiles_deliveryFee_df DEFAULT 0 CONSTRAINT supplier_profiles_deliveryFee_check CHECK (deliveryFee >= 0);
ALTER TABLE dbo.supplier_products ADD category NVARCHAR(60) NOT NULL CONSTRAINT supplier_products_category_df DEFAULT N'Khác', imageUrl NVARCHAR(1000) NULL;
ALTER TABLE dbo.wholesale_orders ADD requestId VARCHAR(36) NULL, requestHash VARCHAR(64) NULL, recipientName NVARCHAR(100) NULL, recipientPhone VARCHAR(20) NULL, deliveryAddress NVARCHAR(500) NULL;
-- Legacy orders have no request id. Only new checkout requests are unique.
EXEC(N'CREATE UNIQUE INDEX wholesale_orders_requestId_key ON dbo.wholesale_orders(requestId) WHERE requestId IS NOT NULL');
CREATE TABLE dbo.password_resets (
 tokenHash VARCHAR(64) NOT NULL CONSTRAINT password_resets_pkey PRIMARY KEY,
 userId INT NOT NULL,
 passwordSnapshot VARCHAR(255) NOT NULL,
 expiresAt DATETIME2 NOT NULL,
 CONSTRAINT password_resets_userId_fkey FOREIGN KEY(userId) REFERENCES dbo.users(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX password_resets_userId_idx ON dbo.password_resets(userId);
CREATE INDEX password_resets_expiresAt_idx ON dbo.password_resets(expiresAt);
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH;
