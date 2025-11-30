export async function generateFile(req: { fileType: string; numberOfRows: number }) {
  const rows = req.numberOfRows ?? 5;
  const header = 'AccountName,AccountNumber,SortCode,Amount';
  const body = Array.from({ length: rows }, (_, i) => `Name${i+1},1234567${i},12-34-5${i},${(i+1)*1.11.toFixed(2)}`);
  const content = [header, ...body].join('\n');
  return {
    fileContent: content,
    filePath: `${process.cwd()}/output/EaziPay-${rows}.csv`
  };
}
