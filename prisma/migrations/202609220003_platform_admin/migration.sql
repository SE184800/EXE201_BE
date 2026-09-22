SET XACT_ABORT ON;
BEGIN TRANSACTION;
ALTER TABLE dbo.users ADD suspendedUntil DATETIME2 NULL, lockReason NVARCHAR(500) NULL;
ALTER TABLE dbo.supplier_profiles ADD
    region NVARCHAR(100) NULL, taxCode VARCHAR(30) NULL,
    legalRepresentative NVARCHAR(100) NULL, verificationDocumentUrl NVARCHAR(1000) NULL,
    verificationStatus VARCHAR(20) NOT NULL CONSTRAINT supplier_profiles_verificationStatus_df DEFAULT 'DRAFT',
    verificationVersion INT NOT NULL CONSTRAINT supplier_profiles_verificationVersion_df DEFAULT 0,
    verificationNote NVARCHAR(500) NULL, submittedAt DATETIME2 NULL, reviewedAt DATETIME2 NULL, reviewedBy INT NULL;
ALTER TABLE dbo.wholesale_orders ADD
    commissionRate DECIMAL(5,2) NULL, commissionAmount DECIMAL(18,2) NULL,
    deliveredAt DATETIME2 NULL, supplierRegion NVARCHAR(100) NULL,
    commissionPaidAt DATETIME2 NULL, commissionPaidBy INT NULL, commissionPaymentReference NVARCHAR(150) NULL;
EXEC(N'ALTER TABLE dbo.supplier_profiles ADD CONSTRAINT supplier_profiles_verification_check CHECK (verificationStatus IN (''DRAFT'',''PENDING'',''APPROVED'',''REJECTED''))');
EXEC(N'ALTER TABLE dbo.wholesale_orders ADD CONSTRAINT wholesale_orders_commission_check CHECK ((commissionRate IS NULL OR commissionRate BETWEEN 0 AND 100) AND (commissionAmount IS NULL OR commissionAmount >= 0))');
EXEC(N'CREATE INDEX wholesale_orders_deliveredAt_idx ON dbo.wholesale_orders(deliveredAt)');
EXEC(N'CREATE INDEX wholesale_orders_commissionPaidAt_idx ON dbo.wholesale_orders(commissionPaidAt)');
CREATE TABLE dbo.platform_settings (
    id INT NOT NULL CONSTRAINT platform_settings_pkey PRIMARY KEY,
    commissionRate DECIMAL(5,2) NOT NULL CONSTRAINT platform_settings_commissionRate_df DEFAULT 0,
    version INT NOT NULL CONSTRAINT platform_settings_version_df DEFAULT 0,
    updatedAt DATETIME2 NOT NULL,
    CONSTRAINT platform_settings_rate_check CHECK (id = 1 AND commissionRate BETWEEN 0 AND 100)
);
-- No commission policy existed before this migration. Admin chooses the rate for new orders.
INSERT INTO dbo.platform_settings(id, commissionRate, version, updatedAt) VALUES (1, 0, 0, CURRENT_TIMESTAMP);
CREATE TABLE dbo.audit_logs (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT audit_logs_pkey PRIMARY KEY,
    actorId INT NULL, action VARCHAR(60) NOT NULL, entityType VARCHAR(40) NOT NULL,
    entityId VARCHAR(50) NOT NULL, details NVARCHAR(MAX) NOT NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT audit_logs_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX audit_logs_createdAt_id_idx ON dbo.audit_logs(createdAt, id);
CREATE INDEX audit_logs_action_createdAt_idx ON dbo.audit_logs(action, createdAt);
CREATE TABLE dbo.ai_usage_events (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT ai_usage_events_pkey PRIMARY KEY,
    userId INT NOT NULL, provider VARCHAR(20) NOT NULL, model NVARCHAR(100) NULL,
    status VARCHAR(20) NOT NULL, durationMs INT NOT NULL, inputTokens INT NULL, outputTokens INT NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT ai_usage_events_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ai_usage_events_createdAt_provider_idx ON dbo.ai_usage_events(createdAt, provider);
CREATE TABLE dbo.recommendation_runs (
    id VARCHAR(36) NOT NULL CONSTRAINT recommendation_runs_pkey PRIMARY KEY,
    ownerId INT NOT NULL, horizonDays INT NOT NULL, safetyDays INT NOT NULL,
    suggestions NVARCHAR(MAX) NOT NULL, acceptedAt DATETIME2 NULL,
    createdAt DATETIME2 NOT NULL CONSTRAINT recommendation_runs_createdAt_df DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX recommendation_runs_createdAt_idx ON dbo.recommendation_runs(createdAt);
CREATE INDEX recommendation_runs_ownerId_createdAt_idx ON dbo.recommendation_runs(ownerId, createdAt);
COMMIT TRANSACTION;
