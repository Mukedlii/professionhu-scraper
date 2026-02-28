import { Actor } from 'apify';
import { HttpCrawler } from 'crawlee';
import * as cheerio from 'cheerio';

await Actor.init();

const input = await Actor.getInput() ?? {};

const {
    searchUrl = 'https://www.profession.hu/allasok',
    maxPages = 5,
    keyword = '',
} = input;

console.log('💼 Profession.hu Scraper indítása...');
console.log(`URL: ${searchUrl}`);

let totalResults = 0;

const crawler = new HttpCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,

    preNavigationHooks: [
        async ({ request }) => {
            request.headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'hu-HU,hu;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://www.profession.hu/',
            };
        },
    ],

    async requestHandler({ request, body, log }) {
        log.info(`Feldolgozás: ${request.url}`);

        const $ = cheerio.load(body);
        const listings = [];

        // Profession.hu állásajánlat kártyák
        $('article.job-card, .job-list-item, [class*="job-card"], .advertisement-list-item').each((_, el) => {
            try {
                const card = $(el);

                const title = card.find('h2, h3, .job-card__title, [class*="title"]').first().text().trim();
                const company = card.find('.job-card__company, [class*="company"], .company-name').first().text().trim();
                const location = card.find('.job-card__location, [class*="location"], [class*="city"]').first().text().trim();
                const salary = card.find('[class*="salary"], [class*="wage"], [class*="ber"]').first().text().trim();
                const jobType = card.find('[class*="type"], [class*="category"]').first().text().trim();
                const link = card.find('a').first().attr('href') ?? '';
                const postedAt = card.find('time, [class*="date"], [class*="time"]').first().text().trim();

                if (title || company) {
                    listings.push({
                        title,
                        company,
                        location,
                        salary,
                        jobType,
                        link: link.startsWith('http') ? link : `https://www.profession.hu${link}`,
                        postedAt,
                        scrapedAt: new Date().toISOString(),
                    });
                }
            } catch (e) { /* skip */ }
        });

        // Fallback: próbáljuk más selectorokkal
        if (listings.length === 0) {
            $('a[href*="/allas/"]').each((_, el) => {
                try {
                    const link = $(el);
                    const href = link.attr('href') ?? '';
                    const title = link.text().trim();
                    const parent = link.closest('li, div, article');
                    const company = parent.find('[class*="company"], [class*="ceg"]').first().text().trim();
                    const location = parent.find('[class*="location"], [class*="city"], [class*="telepules"]').first().text().trim();

                    if (title && href.includes('/allas/')) {
                        listings.push({
                            title,
                            company,
                            location,
                            salary: '',
                            jobType: '',
                            link: href.startsWith('http') ? href : `https://www.profession.hu${href}`,
                            postedAt: '',
                            scrapedAt: new Date().toISOString(),
                        });
                    }
                } catch (e) { /* skip */ }
            });
        }

        log.info(`✅ ${listings.length} állásajánlat találva ezen az oldalon`);

        for (const listing of listings) {
            if (keyword && !listing.title.toLowerCase().includes(keyword.toLowerCase()) &&
                !listing.company.toLowerCase().includes(keyword.toLowerCase())) continue;
            await Actor.pushData(listing);
            totalResults++;
        }

        // Következő oldal
        const currentPage = request.userData?.pageNum ?? 1;
        if (currentPage < maxPages && listings.length > 0) {
            const nextLink = $('a[rel="next"], .pagination__next, [aria-label="Következő"], a.next').attr('href');
            let nextUrl;
            if (nextLink) {
                nextUrl = nextLink.startsWith('http') ? nextLink : `https://www.profession.hu${nextLink}`;
            } else {
                const url = new URL(request.url);
                const currentPageNum = parseInt(url.searchParams.get('page') ?? '1');
                url.searchParams.set('page', currentPageNum + 1);
                nextUrl = url.toString();
            }
            if (nextUrl !== request.url) {
                await crawler.addRequests([{ url: nextUrl, userData: { pageNum: currentPage + 1 } }]);
            }
        }
    },

    failedRequestHandler({ request, log }) {
        log.error(`Sikertelen: ${request.url}`);
    },
});

await crawler.run([{ url: searchUrl, userData: { pageNum: 1 } }]);

console.log(`\n🎉 Kész! Összesen ${totalResults} állásajánlat mentve.`);

await Actor.exit();
