export const sampleCardFileName: string = '.sample.card';

export function isIgnoredSampleCardFileName(fileName: string): boolean {
  return fileName === sampleCardFileName;
}
