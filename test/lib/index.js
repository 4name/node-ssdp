require('../helper');

const assert = require('assert');

let SsdpBase;

if (process.env.SSDP_COV) {
  SsdpBase = require('../../lib-cov/index');
} else {
  SsdpBase = require('../../lib/index');
}

describe('Base class', function () {
  context('getMethod helper', function () {
    it('returns correct method, lowercased', function () {
      const ssdp = new SsdpBase();

      const message = [
        'BLAH URI HTTP/1.1',
        'SOMETHING: or other',
        'AND more stuff',
        'maybe not even upper case'
      ].join('\r\n');

      const method = ssdp._getMethod(message);

      assert.equal(method, 'blah');
    });
  });
});
