ALTER TABLE [dbo].[supplier_quotes] ADD [consignmentSettlementPrice] DECIMAL(18,2) NULL;
ALTER TABLE [dbo].[inventory_lots] ADD
  [consignmentSupplierId] INT NULL,
  [consignmentPackPrice] DECIMAL(18,2) NULL,
  [consignmentPackSize] INT NOT NULL CONSTRAINT [inventory_lots_consignment_pack_size_df] DEFAULT 1,
  [consignmentSoldQty] INT NOT NULL CONSTRAINT [inventory_lots_consignment_sold_qty_df] DEFAULT 0,
  [consignmentSettledQty] INT NOT NULL CONSTRAINT [inventory_lots_consignment_settled_qty_df] DEFAULT 0,
  [consignmentSettledAt] DATETIME2 NULL;
