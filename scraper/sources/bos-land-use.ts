import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  await scrapeBosMeetings({
    sourceId: 'bos-land-use',
    committeePatterns: ['Land Use and Transportation'],
    meetingTitlePrefix: 'SF BOS Land Use and Transportation Committee',
  });
}
