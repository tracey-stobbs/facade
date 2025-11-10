import { FastifyInstance } from 'fastify';
import { loadConfig } from '../shared/config.js';
import { createLogger } from '../shared/logger.js';

const logger = createLogger();

interface GenerateBody {
  fileTypes?: string[];
  rows?: number;
  seed?: number;
  processingDate?: string;
  originatingAccount?: {
    sortCode?: string;
    accountNumber?: string;
    accountName?: string;
    accountType?: 'C' | 'S';
  };
}

interface NormalisedSuccess {
  fileTypes: string[];
  rows: number;
  seed?: number;
  processingDate?: string;
  originatingAccount: {
    sortCode: string;
    accountNumber: string;
    accountName?: string;
    accountType?: 'C' | 'S';
  };
}

type NormalisedResult = NormalisedSuccess | { error: string; rows?: number; syncRowLimit?: number };

function normalise(body: GenerateBody, syncRowLimit: number, defaults: { originatingAccount: { sortCode: string; accountNumber: string; accountName?: string; accountType?: 'C' | 'S'; } }): NormalisedResult {
  const fileTypes = Array.isArray(body.fileTypes) ? body.fileTypes : [];
  const rows = typeof body.rows === 'number' ? body.rows : 0;
  if (fileTypes.length === 0) {
    return { error: 'NO_FILE_TYPES' };
  }
  if (rows <= 0) {
    return { error: 'INVALID_ROWS' };
  }
  if (rows > syncRowLimit) {
    return { error: 'ROWS_EXCEED_SYNC_LIMIT', rows, syncRowLimit };
  }
  const accountDefaults = defaults.originatingAccount;
  const originatingAccount = {
    sortCode: body.originatingAccount?.sortCode || accountDefaults.sortCode,
    accountNumber: body.originatingAccount?.accountNumber || accountDefaults.accountNumber,
    accountName: body.originatingAccount?.accountName || accountDefaults.accountName,
    accountType: body.originatingAccount?.accountType || accountDefaults.accountType
  };
  return { fileTypes, rows, seed: body.seed, processingDate: body.processingDate, originatingAccount };
}

export async function registerGenerateRoute(app: FastifyInstance): Promise<void> {
  app.post('/generate', async (req, reply): Promise<void> => {
    const config = await loadConfig();
    const body = req.body as GenerateBody || {};
    const model = normalise(body, config.syncRowLimit, config.defaults);
    if ('error' in model) {
      const status = model.error === 'ROWS_EXCEED_SYNC_LIMIT' ? 413 : 400;
      return reply.status(status).send({ code: model.error, detail: model });
    }
    // Stub generator call (will be HTTP in Milestone 2)
    const csvContent = `header1,header2\nvalue1,value2\n`; // deterministic stub
    const filename = `${model.fileTypes[0]}-${Date.now()}.csv`;
    logger.info({ event: 'generate.success', filename }, 'Generated stub file');
    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.send(csvContent);
    return;
  });
}
