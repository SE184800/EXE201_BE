BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[supplier_profiles] ADD
  [bankName] NVARCHAR(100),
  [bankAccountNumber] VARCHAR(34),
  [bankAccountHolder] NVARCHAR(100);

ALTER TABLE [dbo].[wholesale_orders] ADD
  [depositBankName] NVARCHAR(100),
  [depositBankAccountNumber] VARCHAR(34),
  [depositBankAccountHolder] NVARCHAR(100),
  [depositSubmittedAt] DATETIME2,
  [depositReviewedAt] DATETIME2,
  [depositRejectionReason] NVARCHAR(255),
  [depositRefundedAt] DATETIME2,
  [depositRefundReference] VARCHAR(100);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
