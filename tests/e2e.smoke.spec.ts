import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';

// Cross-repo smoke test exercising generator + report API + facade packaging concepts
// without yet wiring the facade JobManager to those external modules. This validates
// that the sibling packages can be invoked together in-process and their artifacts
// zipped similarly to facade's async job output strategy.

describe('cross repo smoke', () => {
  it('generates EaziPay file and INPUT report, packages zip', async () => {
    // Deterministic seed
    process.env.FAKER_SEED = '4321';
    // Use temp output roots isolated per run to avoid interference.
    const root = path.resolve(process.cwd(), 'tmp-e2e-smoke');
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    const genOut = path.join(root, 'generator');
    const reportOut = path.join(root, 'report');
    process.env.OUTPUT_ROOT = genOut; // for data-generator safeJoinOutput usage
    // Dynamic ESM imports of sibling packages (source, not dist) to avoid build step.
    const generatorMod = await import(path.resolve('../bacs-file-data-generator/src/index.ts'));
    const reportMod = await import(path.resolve('../bacs-report-api/src/services/report.service.ts'));

    // 1. Generate EaziPay CSV via generator library
    const genReq = { fileType: 'EaziPay', numberOfRows: 5, hasInvalidRows: false };
    const genResult = await generatorMod.generateFile(genReq);
    expect(genResult).toBeTruthy();
    expect(genResult.filePath).toBeDefined();
    const csvPath = genResult.filePath as string;
    expect(fs.existsSync(csvPath)).toBe(true);
    const csvSize = fs.statSync(csvPath).size;
    expect(csvSize).toBeGreaterThan(20);

    // 2. Run INPUT report using report API service (in-memory invocation)
    //   Force its OUTPUT_ROOT separate from generator output.
    process.env.OUTPUT_ROOT = reportOut;
    const reportResult = await reportMod.runReport('input', { rows: 5 });
    expect(reportResult).toBeTruthy();
    const xmlFile = path.join(reportResult.outputFolder, reportResult.files.xml);
    expect(fs.existsSync(xmlFile)).toBe(true);
    const xmlSize = fs.statSync(xmlFile).size;
    expect(xmlSize).toBeGreaterThan(50);

    // 3. Package artifacts similar to facade JobManager: csv + xml + metadata
    const zipDest = path.join(root, 'artifact.zip');
    const zip = new AdmZip();
    zip.addFile(path.basename(csvPath), fs.readFileSync(csvPath));
    zip.addFile(path.basename(xmlFile), fs.readFileSync(xmlFile));
    const meta = {
      generatorCsv: path.basename(csvPath),
      reportXml: path.basename(xmlFile),
      rows: 5,
      seed: 4321,
    };
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
    zip.writeZip(zipDest);
    expect(fs.existsSync(zipDest)).toBe(true);
  const zipSize = fs.statSync(zipDest).size;
  // Zip compression can reduce total size below raw sum; assert non-trivial size instead.
  expect(zipSize).toBeGreaterThan(500); // sanity threshold

    // 4. Basic integrity: read zip entries
    const inspect = new AdmZip(zipDest);
    const entries = inspect.getEntries().map(e => e.entryName).sort();
    // Generator filename may include date & seed variation; assert presence by patterns.
    expect(entries).toContain(path.basename(xmlFile));
    expect(entries).toContain('metadata.json');
    const csvEntry = entries.find(e => e.endsWith('.csv') || e.endsWith('.txt'));
    expect(csvEntry).toBeDefined();
  }, 20_000);

  it('generates EaziPay file and DDICA report (in-memory rows), packages zip', async () => {
    process.env.FAKER_SEED = '9876';
    const root = path.resolve(process.cwd(), 'tmp-e2e-smoke-ddica');
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    const genOut = path.join(root, 'generator');
    const reportOut = path.join(root, 'report');
    process.env.OUTPUT_ROOT = genOut;
    const generatorMod = await import(path.resolve('../bacs-file-data-generator/src/index.ts'));
    const reportMod = await import(path.resolve('../bacs-report-api/src/services/report.service.ts'));
    // Generate EaziPay CSV
    const genReq = { fileType: 'EaziPay', numberOfRows: 7, hasInvalidRows: false };
    const genResult = await generatorMod.generateFile(genReq);
    expect(genResult.filePath).toBeDefined();
    const csvPath = genResult.filePath as string;
    // Run DDICA report (exercise in-memory row path)
    process.env.OUTPUT_ROOT = reportOut;
    const ddicaResult = await reportMod.runReport('ddica', { rows: 6 });
    expect(ddicaResult.files.xml).toBeTruthy();
    const xmlFile = path.join(ddicaResult.outputFolder, ddicaResult.files.xml);
    expect(fs.existsSync(xmlFile)).toBe(true);
    // Zip
    const zipDest = path.join(root, 'artifact-ddica.zip');
    const zip = new AdmZip();
    zip.addFile(path.basename(csvPath), fs.readFileSync(csvPath));
    zip.addFile(path.basename(xmlFile), fs.readFileSync(xmlFile));
    const meta = { generatorCsv: path.basename(csvPath), ddicaXml: path.basename(xmlFile), seed: 9876 };
    zip.addFile('metadata.json', Buffer.from(JSON.stringify(meta, null, 2), 'utf8'));
    zip.writeZip(zipDest);
    expect(fs.existsSync(zipDest)).toBe(true);
    const inspect = new AdmZip(zipDest);
    const entries = inspect.getEntries().map(e => e.entryName);
    expect(entries).toContain('metadata.json');
    expect(entries.some(e => e.endsWith('.csv') || e.endsWith('.txt'))).toBe(true);
    expect(entries.some(e => /DDICA/i.test(e) || e.endsWith('.xml'))).toBe(true);
  }, 20_000);
});