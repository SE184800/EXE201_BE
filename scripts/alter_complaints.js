const prisma = require('../config/db');

async function main() {
  try {
    console.log('Altering reason column to NVARCHAR(200)...');
    await prisma.$executeRawUnsafe(`ALTER TABLE [dbo].[order_complaints] ALTER COLUMN [reason] NVARCHAR(200) NOT NULL`);
    console.log('Altered reason successfully.');

    console.log('Adding imageUrl column if not exists...');
    await prisma.$executeRawUnsafe(`
      IF NOT EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID('[dbo].[order_complaints]') 
        AND name = 'imageUrl'
      )
      BEGIN
        ALTER TABLE [dbo].[order_complaints] ADD [imageUrl] NVARCHAR(1000) NULL;
      END
    `);
    console.log('imageUrl column ready.');
  } catch (error) {
    console.error('Error altering table:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
