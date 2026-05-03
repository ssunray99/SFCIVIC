import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  await scrapeBosMeetings({
    sourceId: 'bos',
    committeePatterns: ['Full Board'],
    meetingTitlePrefix: 'SF Board of Supervisors',
  });
}
