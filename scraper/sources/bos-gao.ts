import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  await scrapeBosMeetings({
    sourceId: 'bos-gao',
    committeePatterns: ['Government Audit and Oversight'],
    meetingTitlePrefix: 'SF BOS Government Audit and Oversight Committee',
  });
}
