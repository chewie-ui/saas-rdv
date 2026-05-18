const fs = require('fs');
const base = 'C:/Users/quent/Documents/saas-rdv/locales/';
const langs = ['fr', 'en', 'nl', 'de', 'es', 'it'];

let ok = 0, fail = 0;
langs.forEach(lang => {
  const filePath = base + lang + '.json';
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.pro_landing && data.pro_landing.tests) {
      data.pro_landing.tests.items = [];
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(lang + ': OK');
    ok++;
  } catch(e) {
    console.error(lang + ': FAIL - ' + e.message);
    fail++;
  }
});
console.log('Total: ' + ok + ' OK, ' + fail + ' failed');
