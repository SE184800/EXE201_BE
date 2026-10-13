BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[subscriptions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [subscriptions_status_df] DEFAULT 'TRIAL',
    [monthlyPrice] DECIMAL(18,2) NOT NULL CONSTRAINT [subscriptions_monthlyPrice_df] DEFAULT 19000,
    [trialStartedAt] DATETIME2 NOT NULL,
    [trialEndsAt] DATETIME2 NOT NULL,
    [currentPeriodStart] DATETIME2,
    [currentPeriodEnd] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [subscriptions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [subscriptions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [subscriptions_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[subscription_payments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [subscriptionId] INT NOT NULL,
    [requestId] VARCHAR(36) NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [subscription_payments_status_df] DEFAULT 'PAID',
    [method] VARCHAR(30) NOT NULL CONSTRAINT [subscription_payments_method_df] DEFAULT 'SIMULATED',
    [reference] VARCHAR(100) NOT NULL,
    [periodStart] DATETIME2 NOT NULL,
    [periodEnd] DATETIME2 NOT NULL,
    [paidAt] DATETIME2 NOT NULL CONSTRAINT [subscription_payments_paidAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [subscription_payments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [subscription_payments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [subscription_payments_requestId_key] UNIQUE NONCLUSTERED ([requestId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_status_trialEndsAt_idx] ON [dbo].[subscriptions]([status], [trialEndsAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscriptions_status_currentPeriodEnd_idx] ON [dbo].[subscriptions]([status], [currentPeriodEnd]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [subscription_payments_subscriptionId_paidAt_idx] ON [dbo].[subscription_payments]([subscriptionId], [paidAt]);

-- AddForeignKey
ALTER TABLE [dbo].[subscriptions] ADD CONSTRAINT [subscriptions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[subscription_payments] ADD CONSTRAINT [subscription_payments_subscriptionId_fkey] FOREIGN KEY ([subscriptionId]) REFERENCES [dbo].[subscriptions]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
