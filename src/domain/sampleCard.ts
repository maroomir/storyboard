export const sampleCardFileName = '.sample.card';

export function isIgnoredSampleCardFileName(fileName: string): boolean {
  return fileName === sampleCardFileName;
}
