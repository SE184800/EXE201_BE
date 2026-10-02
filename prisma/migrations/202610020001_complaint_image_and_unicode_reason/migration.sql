ALTER TABLE [dbo].[order_complaints] ALTER COLUMN [reason] NVARCHAR(200) NOT NULL;
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('[dbo].[order_complaints]') 
    AND name = 'imageUrl'
)
BEGIN
    ALTER TABLE [dbo].[order_complaints] ADD [imageUrl] NVARCHAR(1000) NULL;
END
