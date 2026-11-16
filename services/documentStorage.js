const { AsyncLocalStorage } = require('node:async_hooks');
const { isDeepStrictEqual } = require('node:util');

const storage = new AsyncLocalStorage();
const clone = value => value === undefined ? undefined : structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const conflict = () => Object.assign(new Error('Dữ liệu vừa được cập nhật ở phiên khác. Vui lòng tải lại và thử lại.'), { status: 409 });

// Preserve independent changes from concurrent serverless requests. Reject
// conflicting edits instead of silently replacing another user's update.
function mergeDocument(base, proposed, current, atomicDepth = Infinity) {
  if (isDeepStrictEqual(base, proposed)) return clone(current);
  if (isDeepStrictEqual(base, current) || isDeepStrictEqual(proposed, current)) return clone(proposed);
  if (atomicDepth === 0 || !object(base) || !object(proposed) || !object(current)) throw conflict();
  const result = clone(current);
  for (const key of new Set([...Object.keys(base), ...Object.keys(proposed)])) {
    if (isDeepStrictEqual(base[key], proposed[key])) continue;
    if (!Object.hasOwn(proposed, key)) {
      if (!isDeepStrictEqual(base[key], current[key]) && Object.hasOwn(current, key)) throw conflict();
      delete result[key];
    } else {
      result[key] = mergeDocument(base[key], proposed[key], current[key], atomicDepth - 1);
    }
  }
  return result;
}

function active() { return Boolean(storage.getStore()); }
function readDocument(key, fallback) {
  const context = storage.getStore();
  if (!context) throw new Error('SQL document access requires a request context.');
  if (!context.documents.has(key)) {
    context.documents.set(key, clone(fallback));
    context.base.set(key, clone(fallback));
  }
  return context.documents.get(key);
}
function writeDocument(key, value) {
  const context = storage.getStore();
  if (!context) throw new Error('SQL document access requires a request context.');
  if (!context.base.has(key)) readDocument(key, {});
  context.documents.set(key, value);
  context.dirty.add(key);
}

async function commit(prisma, context) {
  if (!context.dirty.size) return;
  await prisma.$transaction(async tx => {
    for (const key of [...context.dirty].sort()) {
      const rows = await tx.$queryRaw`SELECT [payload] FROM [dbo].[application_documents] WITH (UPDLOCK, HOLDLOCK) WHERE [key] = ${key}`;
      const base = context.base.get(key);
      const current = rows.length ? JSON.parse(rows[0].payload) : clone(base);
      // Merge different contracts independently, but never combine a signature
      // with a concurrent edit to the signer details of that same contract.
      const atomicDepth = key === 'contracts' ? 2 : Infinity;
      const payload = JSON.stringify(mergeDocument(base, context.documents.get(key), current, atomicDepth));
      if (rows.length) await tx.$executeRaw`UPDATE [dbo].[application_documents] SET [payload] = ${payload}, [updatedAt] = SYSUTCDATETIME() WHERE [key] = ${key}`;
      else await tx.$executeRaw`INSERT INTO [dbo].[application_documents] ([key], [payload]) VALUES (${key}, ${payload})`;
    }
  }, { timeout: 20000, isolationLevel: 'Serializable' });
}

function documentMiddleware(prisma) {
  return async (req, res, next) => {
    try {
      const rows = await prisma.$queryRaw`SELECT [key], [payload] FROM [dbo].[application_documents]`;
      const documents = new Map(rows.map(row => [row.key, JSON.parse(row.payload)]));
      const context = { documents, base: new Map([...documents].map(([key, value]) => [key, clone(value)])), dirty: new Set() };
      storage.run(context, () => {
        const originalEnd = res.end;
        let ending = false;
        res.end = function (...args) {
          if (ending) return res;
          ending = true;
          const saved = res.statusCode < 400 ? commit(prisma, context) : Promise.resolve();
          saved.then(() => { res.end = originalEnd; originalEnd.apply(res, args); }).catch(error => {
            res.end = originalEnd;
            if (res.headersSent) return res.destroy(error);
            res.removeHeader('Content-Length');
            res.removeHeader('ETag');
            res.status(error.status || 503).json({ message: error.status ? error.message : 'Không lưu được dữ liệu. Vui lòng thử lại.' });
          });
          return res;
        };
        next();
      });
    } catch (error) { next(error); }
  };
}

module.exports = { active, readDocument, writeDocument, documentMiddleware, mergeDocument };
