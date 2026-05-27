DELETE FROM public.entity_timeline
WHERE source IN (
  'OSINT scan','Breach database','Platform enumeration','Dark web monitoring',
  'Username enumeration','Platform scan','Social media crawl','Web scraper',
  'WHOIS lookup','DNS history','Certificate transparency','Passive DNS',
  'Phone lookup','Carrier OSINT','App enumeration','IP intelligence',
  'Shodan','Abuse DB','Geo-IP service','Profile monitor','API enumeration'
);