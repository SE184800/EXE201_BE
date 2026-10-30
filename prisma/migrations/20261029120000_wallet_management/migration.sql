BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[wallets] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [balance] DECIMAL(18,2) NOT NULL CONSTRAINT [wallets_balance_df] DEFAULT 0,
    [heldBalance] DECIMAL(18,2) NOT NULL CONSTRAINT [wallets_heldBalance_df] DEFAULT 0,
    [currency] VARCHAR(10) NOT NULL CONSTRAINT [wallets_currency_df] DEFAULT 'VND',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [wallets_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [wallets_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [wallets_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[wallet_transactions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [walletId] INT NOT NULL,
    [userId] INT NOT NULL,
    [type] VARCHAR(30) NOT NULL,
    [direction] VARCHAR(10) NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [balanceAfter] DECIMAL(18,2) NOT NULL,
    [reference] VARCHAR(100) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [wallet_transactions_status_df] DEFAULT 'COMPLETED',
    [orderId] INT,
    [note] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [wallet_transactions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [wallet_transactions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [wallet_transactions_reference_key] UNIQUE NONCLUSTERED ([reference])
);

-- CreateTable
CREATE TABLE [dbo].[deposit_requests] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [method] VARCHAR(30) NOT NULL CONSTRAINT [deposit_requests_method_df] DEFAULT 'BANK_TRANSFER',
    [bankName] NVARCHAR(100),
    [bankAccountNumber] VARCHAR(34),
    [bankAccountHolder] NVARCHAR(100),
    [reference] VARCHAR(100),
    [status] VARCHAR(20) NOT NULL CONSTRAINT [deposit_requests_status_df] DEFAULT 'PENDING',
    [note] NVARCHAR(500),
    [adminNote] NVARCHAR(500),
    [reviewedBy] INT,
    [reviewedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [deposit_requests_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [deposit_requests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[withdrawal_requests] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [bankName] NVARCHAR(100) NOT NULL,
    [bankAccountNumber] VARCHAR(34) NOT NULL,
    [bankAccountHolder] NVARCHAR(100) NOT NULL,
    [note] NVARCHAR(500),
    [status] VARCHAR(20) NOT NULL CONSTRAINT [withdrawal_requests_status_df] DEFAULT 'PENDING',
    [adminNote] NVARCHAR(500),
    [reference] VARCHAR(100),
    [reviewedBy] INT,
    [reviewedAt] DATETIME2,
    [completedBy] INT,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [withdrawal_requests_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [withdrawal_requests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[order_payments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderId] INT NOT NULL,
    [buyerId] INT NOT NULL,
    [supplierUserId] INT NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [commissionAmount] DECIMAL(18,2),
    [supplierAmount] DECIMAL(18,2),
    [status] VARCHAR(20) NOT NULL CONSTRAINT [order_payments_status_df] DEFAULT 'PAID',
    [reference] VARCHAR(100) NOT NULL,
    [paidAt] DATETIME2 NOT NULL CONSTRAINT [order_payments_paidAt_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [order_payments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [order_payments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [order_payments_orderId_key] UNIQUE NONCLUSTERED ([orderId]),
    CONSTRAINT [order_payments_reference_key] UNIQUE NONCLUSTERED ([reference])
);

-- CreateTable
CREATE TABLE [dbo].[refunds] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderId] INT NOT NULL,
    [orderPaymentId] INT NOT NULL,
    [amount] DECIMAL(18,2) NOT NULL,
    [reason] NVARCHAR(500) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [refunds_status_df] DEFAULT 'COMPLETED',
    [reference] VARCHAR(100) NOT NULL,
    [createdBy] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [refunds_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [refunds_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [refunds_orderPaymentId_key] UNIQUE NONCLUSTERED ([orderPaymentId]),
    CONSTRAINT [refunds_reference_key] UNIQUE NONCLUSTERED ([reference])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wallet_transactions_walletId_createdAt_idx] ON [dbo].[wallet_transactions]([walletId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wallet_transactions_userId_createdAt_idx] ON [dbo].[wallet_transactions]([userId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [wallet_transactions_orderId_idx] ON [dbo].[wallet_transactions]([orderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [deposit_requests_userId_status_createdAt_idx] ON [dbo].[deposit_requests]([userId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [deposit_requests_status_createdAt_idx] ON [dbo].[deposit_requests]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [withdrawal_requests_userId_status_createdAt_idx] ON [dbo].[withdrawal_requests]([userId], [status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [withdrawal_requests_status_createdAt_idx] ON [dbo].[withdrawal_requests]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_payments_buyerId_paidAt_idx] ON [dbo].[order_payments]([buyerId], [paidAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_payments_supplierUserId_paidAt_idx] ON [dbo].[order_payments]([supplierUserId], [paidAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refunds_orderId_idx] ON [dbo].[refunds]([orderId]);

-- AddForeignKey
ALTER TABLE [dbo].[wallets] ADD CONSTRAINT [wallets_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[wallet_transactions] ADD CONSTRAINT [wallet_transactions_walletId_fkey] FOREIGN KEY ([walletId]) REFERENCES [dbo].[wallets]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[wallet_transactions] ADD CONSTRAINT [wallet_transactions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[wallet_transactions] ADD CONSTRAINT [wallet_transactions_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[deposit_requests] ADD CONSTRAINT [deposit_requests_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[withdrawal_requests] ADD CONSTRAINT [withdrawal_requests_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_payments] ADD CONSTRAINT [order_payments_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_payments] ADD CONSTRAINT [order_payments_buyerId_fkey] FOREIGN KEY ([buyerId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_payments] ADD CONSTRAINT [order_payments_supplierUserId_fkey] FOREIGN KEY ([supplierUserId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[refunds] ADD CONSTRAINT [refunds_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[wholesale_orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[refunds] ADD CONSTRAINT [refunds_orderPaymentId_fkey] FOREIGN KEY ([orderPaymentId]) REFERENCES [dbo].[order_payments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
