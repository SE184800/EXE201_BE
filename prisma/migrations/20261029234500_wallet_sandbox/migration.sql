BEGIN TRY

BEGIN TRAN;

-- AddColumn
ALTER TABLE [dbo].[wallet_transactions] ADD [method] VARCHAR(20) NOT NULL CONSTRAINT [wallet_transactions_method_df] DEFAULT 'REAL';

-- AddColumn
ALTER TABLE [dbo].[deposit_requests] ADD [isSandbox] BIT NOT NULL CONSTRAINT [deposit_requests_isSandbox_df] DEFAULT 0;

-- AddColumn
ALTER TABLE [dbo].[withdrawal_requests] ADD [isSandbox] BIT NOT NULL CONSTRAINT [withdrawal_requests_isSandbox_df] DEFAULT 0;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
