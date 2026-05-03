import { scrapeBosMeetings } from '../lib/bos-shared.ts';

export async function scrape(): Promise<void> {
  // sf.gov titles observed to contain "Rules Committee" — verify on first run
  // by checking the log line "[bos-rules] processing: <title> — <url>".
  await scrapeBosMeetings({
    sourceId: 'bos-rules',
    committeePatterns: ['Rules Committee'],
    meetingTitlePrefix: 'SF BOS Rules Committee',
  });
}
