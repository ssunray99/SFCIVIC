import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  await scrapeBosMeetings({
    sourceId: 'bos-budget',
    committeePatterns: ['Budget and Appropriations'],
    meetingTitlePrefix: 'SF BOS Budget and Appropriations Committee',
  });
}
