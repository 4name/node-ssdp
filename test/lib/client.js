require('../helper')
const moduleVersion = require('../../package.json').version

const expect = require('chai').expect
const assert = require('assert')

let Client

if (process.env.SSDP_COV) {
  Client = require('../../lib-cov/client')
} else {
  Client = require('../../lib/client')
}

describe('Client', function () {
  context('start', function () {
    let client
    beforeEach(function () {
      client = new Client()
    })

    afterEach(function () {
      client.stop()
    })

    it('takes callback', function (done) {
      client.start(function () {
        assert(true)
        done()
      })
    })

    it('returs a promise', function (done) {
      client.start().then(function () {
        assert(true)
        done()
      })
    })
  })

  context('when receiving a reply to M-SEARCH', function () {
    let client
    beforeEach(function () {
      client = new Client()
    })

    afterEach(function () {
      client.stop()
    })

    it('emit a parsed object', function (done) {
      const response = [
        'HTTP/1.1 200 OK',
        'ST: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'LOCATION: http://0.0.0.0:10000/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        'DATE: Fri, 30 May 2014 15:07:26 GMT',
        'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      client.on('response', function (headers, code, rinfo) {
        expect(code).to.equal(200)

        const expected = {
          ST: 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          USN: 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          LOCATION: 'http://0.0.0.0:10000/upnp/desc.html',
          'CACHE-CONTROL': 'max-age=1800',
          // 'DATE': 'Fri, 30 May 2014 15:07:26 GMT',
          SERVER: 'node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion,
          EXT: ''
        }

        const date = headers.DATE

        delete headers.DATE

        expect(expected).to.deep.equal(headers)
        expect(date).to.match(/\w+, \d+ \w+ \d+ [\d:]+ GMT/)

        done()
      })

      client.start()

      const iface = Object.keys(client.sockets)[0]

      client.sockets[iface].emit('message', Buffer(response.join('\r\n')))
    })
  })
})
