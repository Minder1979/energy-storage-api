'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://chuneng.bjx.com.cn';

// 预编译正则
const RE_PRICE1 = /(\d+\.?\d*)\s*元··\/Wh/i;
const RE_PRICE2 = /单价[为:]?\s*(\d+\.?\d*)\s*元/;
const RE_PRICE3 = /(\d+\.\d+)\s*元[··\/]/;
const RE_CAP1   = /(\d+\.?\d*)\s*MW[\s·]*\/?[\s·]*(\d+\.?\d*)\s*MWh/i;
const RE_CAP2   = /(\d+\.?\d*)\s*MW/;
const RE_CAP3   = /(\d+\.?\d*)\s*MWh/;
const RE_DATE1  = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/;
const RE_DATE2  = /(\d{4}年\d{1,2}月\d{1,2}日)/;

const RE_COMPANY = new RegExp(
  '([\\u4e00-\\u9fa5]{2,10}(?:公司|集团|电力|能源|建设|储能|技术))|' +
  '(?:中标|预中标)[^\\u4e00-\\u9fa5]*?([\\u4e00-\\u9fa5]{2,8})'
);
const RE_REGION = new RegExp('([\\u4e00-\\u9fa5]{2,4}(?:省|市|自治区|地区|县|盟))');

function isStorageRelated(title) {
  const keywords = ['储能','电池','PCS','MW','MWh','GWh','中标','招标','EPC','Wh','元/Wh','独立储能','共享储能','系统采购'];
  return keywords.some(k => title.includes(k));
}

function parseItem(title, href, source) {
  title = title.replace(/[\n\r\s]+/g, ' ').trim();

  const priceMatch = RE_PRICE1.test(title) ? RE_PRICE1.exec(title)
    : RE_PRICE2.test(title) ? RE_PRICE2.exec(title)
    : RE_PRICE3.exec(title);

  const capMatch = RE_CAP1.test(title) ? RE_CAP1.exec(title)
    : RE_CAP2.test(title) ? RE_CAP2.exec(title)
    : RE_CAP3.exec(title);

  const dateMatch = RE_DATE1.test(title) ? RE_DATE1.exec(title) : RE_DATE2.exec(title);

  let price = null;
  if (priceMatch) {
    price = parseFloat(priceMatch[1]);
    if (price > 10) price = price / 1000;
  }

  let capacity = null;
  if (capMatch) capacity = capMatch[0];

  let pubDate = null;
  if (dateMatch) {
    pubDate = dateMatch[1].replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
  } else {
    // Fallback to today if no date in title
    pubDate = new Date().toISOString().slice(0, 10);
  }

  let company = null;
  RE_COMPANY.lastIndex = 0;
  const cm = RE_COMPANY.exec(title);
  if (cm) company = cm[1] || cm[2];

  let region = null;
  RE_REGION.lastIndex = 0;
  const rm = RE_REGION.exec(title);
  if (rm) region = rm[1];

  return {
    title,
    price,
    price_unit: price ? '元/Wh' : null,
    capacity,
    company,
    region,
    pub_date: pubDate,
    source,
    source_url: href ? (href.startsWith('http') ? href : `${BASE_URL}${href}`) : null,
  };
}

async function scrapeBjx(pageLimit = 5) {
  const results = [];
  const seenTitles = new Set();

  for (let page = 1; page <= pageLimit; page++) {
    const url = page === 1
      ? `${BASE_URL}/zb/`
      : `${BASE_URL}/zb/?page=${page}`;

    try {
      const { data } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': BASE_URL,
        },
        timeout: 15000,
      });

      const $ = cheerio.load(data);
      let found = false;

      const selectors = [
        '.list ul li', 'ul.news-list li', '.bid-list li',
        '.news-list li', '.article-list li', '.zb-list li',
        '.list-item', '.item',
      ];
      for (const sel of selectors) {
        const items = $(sel);
        if (items.length > 0) {
          items.each((_, el) => {
            const $el = $(el);
            const raw = $el.clone().children().remove().end().text().trim();
            const href = $el.find('a').attr('href');
            if (raw && raw.length > 15 && !seenTitles.has(raw)) {
              seenTitles.add(raw);
              results.push(parseItem(raw, href, 'bjx'));
            }
          });
          found = true;
          break;
        }
      }

      if (!found) {
        $('a[href]').each((_, el) => {
          const $el = $(el);
          const t = $el.text().trim();
          const href = $el.attr('href');
          if (t && t.length > 15 && isStorageRelated(t) && !seenTitles.has(t)) {
            seenTitles.add(t);
            results.push(parseItem(t, href, 'bjx'));
          }
        });
      }

      await new Promise(r => setTimeout(r, 500));

    } catch (err) {
      console.error(`[bjx] Page ${page} error:`, err.message);
    }
  }

  const unique = results.filter((r, i, arr) =>
    arr.findIndex(x => x.title === r.title) === i
  );

  console.log(`[bjx] Scraped ${unique.length} items from ${pageLimit} pages`);
  return unique;
}

module.exports = { scrapeBjx };
