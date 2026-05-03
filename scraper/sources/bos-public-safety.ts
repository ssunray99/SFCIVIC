import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  await scrapeBosMeetings({
    sourceId: 'bos-public-safety',
    committeePatterns: ['Public Safety and Neighborhood Services'],
    meetingTitlePrefix: 'SF BOS Public Safety and Neighborhood Services Committee',
  });
}
