ALTER TABLE [dbo].[supplier_quote_lines] ADD [originalUnitPrice] DECIMAL(18,2) NULL;
ALTER TABLE [dbo].[supplier_quote_lines] ADD [discountRate] DECIMAL(5,2) NOT NULL CONSTRAINT [supplier_quote_lines_discountRate_df] DEFAULT 0;
